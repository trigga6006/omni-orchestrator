/**
 * Agent Process Manager — PTY-based with Swarm Communication
 *
 * Each agent is a real interactive Claude Code session running inside a
 * pseudo-terminal (PTY) managed by the Rust backend. The frontend embeds
 * the TUI via xterm.js.
 *
 * Swarm communication works by:
 *   1. Registering each agent with the broker (gets a peerId)
 *   2. After Claude Code starts, injecting a swarm-identity prompt via stdin
 *      that teaches the agent how to talk to peers using curl + the broker API
 *   3. Polling the broker for incoming messages and injecting them via stdin
 *   4. Notifying agents when new peers join
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  registerPeer,
  unregisterPeer,
  heartbeat,
  pollMessages,
} from "./broker";
import { useAppStore } from "../stores/appStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { AgentRole } from "../types";

interface RunningAgent {
  agentId: string;
  peerId: string | null;
  nodeId: string;
  name: string;
  cwd: string;
  role: AgentRole;
  pid: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  outputBuffer: string[];
  /** Monotonic counter — increments on every push, never decreases (survives shift). */
  outputChunkCount: number;
  unlistenOutput: UnlistenFn | null;
  unlistenExit: UnlistenFn | null;
  alive: boolean;
  identityInjected: boolean;
}

const runningAgents = new Map<string, RunningAgent>();

const MAX_BUFFER_BYTES = 500_000;
const BROKER_URL = "http://127.0.0.1:7899";
const POLL_INTERVAL = 5_000;
// How long PTY output must be silent before we consider Claude Code "ready"
const READY_SILENCE_MS = 2_500;
// Absolute max wait — inject even if still getting output
const READY_MAX_WAIT_MS = 60_000;

// ---------------------------------------------------------------------------
// Swarm prompt builder
// ---------------------------------------------------------------------------

function buildSwarmIdentityPrompt(
  name: string,
  peerId: string,
  nodeId: string,
  role: AgentRole = "worker",
): string {
  const store = useAppStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);

  // Gather peer agents in the same node
  const peerAgents = store.agents.filter(
    (a) => a.nodeId === nodeId && a.id !== name && a.peerId && a.peerId !== peerId
  );

  let peerList = "";
  if (peerAgents.length === 0) {
    peerList = "  (no other agents yet — you'll be notified when peers join)";
  } else {
    for (const a of peerAgents) {
      peerList += `  - "${a.name}" (${a.role}) → peer ID: ${a.peerId}\n`;
    }
  }

  let prompt = `You are agent "${name}" in the "${node?.name ?? "unknown"}" swarm node.
Your peer ID is: ${peerId}
Broker URL: ${BROKER_URL}

PEERS IN YOUR NODE:
${peerList}

COMMUNICATION — use your Bash tool with curl to talk to peers.
IMPORTANT: Always use escaped double quotes in the -d payload (never single quotes — they break on Windows):

Send a message to a peer:
  curl -s -X POST ${BROKER_URL}/send-message -H "Content-Type: application/json" -d "{\\"from_id\\":\\"${peerId}\\",\\"to_id\\":\\"THEIR_PEER_ID\\",\\"text\\":\\"your message\\"}"

List all active peers:
  curl -s ${BROKER_URL}/peers

You will receive incoming messages directly in this session. Coordinate with your peers on shared tasks.`;

  if (role === "boss") {
    prompt += `

YOU ARE THE LEAD AGENT for this node. Assess the task and decide the best approach:

IF THE TASK IS SIMPLE (single file fix, small change, quick question, one focused concern):
- Just do it yourself directly. No need to spawn sub-agents.

IF THE TASK IS COMPLEX (multiple independent features, broad audit, cross-cutting concerns):
- Break it into independent sub-tasks and spawn a dedicated agent for each one.

SPAWN SUB-AGENTS using your Bash tool (use escaped double quotes, never single quotes):
  curl -s -X POST ${BROKER_URL}/spawn-agent -H "Content-Type: application/json" -d "{\\"node_id\\":\\"${nodeId}\\",\\"name\\":\\"AGENT_NAME\\",\\"task\\":\\"SPECIFIC_SUB_TASK\\",\\"requester_peer_id\\":\\"${peerId}\\",\\"model\\":\\"MODEL\\"}"

MODEL OPTIONS — use "sonnet" as default for most sub-tasks:
- "sonnet" — PREFERRED DEFAULT. Fast, capable, cost-efficient. Use for most sub-tasks.
- "opus" — Only for highly complex architectural or reasoning-heavy sub-tasks.
- "haiku" — For trivial mechanical tasks (formatting, simple grep, boilerplate).

SPAWN RULES (only when spawning):
- Use descriptive kebab-case names (e.g. "api-routes", "ui-forms", "test-writer")
- Each sub-task should be self-contained and parallelizable
- Only spawn as many agents as there are truly independent sub-tasks
- Each spawned agent is a full independent Claude Code session working in this directory
- Sub-agents will automatically know how to message you back
- NEVER send a spawn request for an agent name you already spawned — each name must be unique
- NEVER tell sub-agents to "stand by" or "wait" — they are idle by default after completing

CRITICAL COORDINATION RULES:
- After spawning N agents, you MUST wait for exactly N "COMPLETED:" messages before doing ANYTHING else
- Do NOT begin writing summaries, reports, or making edits until ALL N agents have reported back
- Do NOT assume an agent is done just because it was spawned — wait for its explicit "COMPLETED:" message
- While waiting, you may periodically check status: curl -s ${BROKER_URL}/peers
- If an agent hasn't reported after a long time, send it a message asking for a status update
- Only after receiving ALL N completion reports, synthesize results into your final summary`;
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Spawn a new interactive Claude Code session inside a PTY.
 */
export async function spawnAgent(
  agentId: string,
  nodeId: string,
  name: string,
  cwd: string,
  taskPrompt?: string,
  role: AgentRole = "worker",
  model?: string,
): Promise<void> {
  const store = useAppStore.getState();

  const entry: RunningAgent = {
    agentId,
    peerId: null,
    nodeId,
    name,
    cwd,
    role,
    pid: 0,
    heartbeatTimer: null,
    pollTimer: null,
    outputBuffer: [],
    outputChunkCount: 0,
    unlistenOutput: null,
    unlistenExit: null,
    alive: true,
    identityInjected: false,
  };

  runningAgents.set(agentId, entry);

  try {
    // Read the agent's stored config for spawn parameters
    const agentState = store.agents.find((a) => a.id === agentId);
    const config = agentState?.config;
    const resolvedModel = model ?? config?.model ?? (role === "boss" ? "opus" : undefined);

    // 1. Register with the broker FIRST (pid=0) to get the real peerId.
    //    We need the peerId in the system prompt so agents can use it in curl commands.
    let peerId: string | null = null;
    try {
      const reg = await registerPeer({
        pid: 0,
        cwd,
        git_root: null,
        tty: null,
        summary: `Agent "${name}" — starting`,
        node_id: nodeId,
      });
      peerId = reg.id;
      entry.peerId = peerId;
      store.updateAgentPeerId(agentId, peerId);
    } catch (err) {
      console.warn(`[agent:${name}] broker registration failed:`, err);
    }

    // 2. Build the swarm context with the real peerId and pass it via CLI
    //    as --append-system-prompt. This avoids PTY input buffer limits.
    const systemPrompt = peerId
      ? buildSwarmIdentityPrompt(name, peerId, nodeId, role)
      : undefined;

    // Build the custom system prompt by combining swarm identity + user custom instructions
    let fullSystemPrompt = systemPrompt ?? null;
    if (config?.customSystemPrompt && fullSystemPrompt) {
      fullSystemPrompt += "\n\n" + config.customSystemPrompt;
    } else if (config?.customSystemPrompt) {
      fullSystemPrompt = config.customSystemPrompt;
    }

    const pid = await invoke<number>("spawn_pty", {
      id: agentId,
      cwd,
      cols: 80,
      rows: 24,
      model: resolvedModel,
      systemPrompt: fullSystemPrompt,
      permissionMode: config?.permissionMode ?? "auto",
      maxTurns: config?.maxTurns ?? null,
      allowedTools: config?.allowedTools?.length ? config.allowedTools : null,
      disallowedTools: config?.disallowedTools?.length ? config.disallowedTools : null,
    });

    entry.pid = pid;
    store.updateAgentStatus(agentId, "active");
    store.updateAgentPid(agentId, pid);

    // 3. Buffer PTY output for replay on tab switch.
    //    Also detect when Claude Code is "ready" (output silence) to inject the task.
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let readyFired = false;

    const fireWhenReady = () => {
      if (readyFired || !entry.alive) return;
      readyFired = true;
      if (readyTimer) clearTimeout(readyTimer);
      // Context is already in the system prompt. Now just inject the task.
      injectTask(entry, taskPrompt);
    };

    entry.unlistenOutput = await listen<string>(
      `pty-output-${agentId}`,
      (event) => {
        entry.outputBuffer.push(event.payload);
        entry.outputChunkCount++;
        let total = entry.outputBuffer.reduce((s, c) => s + c.length, 0);
        while (total > MAX_BUFFER_BYTES && entry.outputBuffer.length > 1) {
          total -= entry.outputBuffer.shift()!.length;
        }

        // Reset the silence timer on every output chunk
        if (!readyFired) {
          if (readyTimer) clearTimeout(readyTimer);
          readyTimer = setTimeout(fireWhenReady, READY_SILENCE_MS);
        }
      }
    );

    // Absolute fallback
    setTimeout(() => {
      if (!readyFired && entry.alive) {
        console.log(`[agent:${name}] max wait reached, forcing task injection`);
        fireWhenReady();
      }
    }, READY_MAX_WAIT_MS);

    // 4. Detect process exit
    entry.unlistenExit = await listen(`pty-exit-${agentId}`, () => {
      if (entry.alive) {
        useAppStore.getState().updateAgentStatus(agentId, "stopped");
        useAppStore.getState().pushActivity({
          type: "agent_stop",
          agentId,
          agentName: name,
          nodeId,
          text: `Agent "${name}" session ended`,
        });
      }
      cleanupAgent(agentId);
    });

    // 5. Start heartbeat + polling + notify peers
    if (peerId) {
      entry.heartbeatTimer = setInterval(() => {
        if (entry.peerId) heartbeat(entry.peerId).catch(() => {});
      }, 15_000);

      entry.pollTimer = setInterval(() => {
        if (entry.alive && entry.peerId && entry.identityInjected) {
          pollAndDeliverMessages(entry).catch(() => {});
        }
      }, POLL_INTERVAL);

      notifyPeersOfNewAgent(nodeId, name, peerId).catch(() => {});
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[agent:${name}] failed to spawn PTY:`, msg);
    store.updateAgentStatus(agentId, "error");
    store.updateAgentSummary(agentId, `Spawn failed: ${msg}`);
    runningAgents.delete(agentId);
    throw err;
  }
}

/**
 * Write data to an agent's PTY stdin and press Enter to submit.
 * Collapses newlines to spaces (newlines act as Enter in the PTY).
 */
export async function writeToAgent(
  agentId: string,
  text: string
): Promise<boolean> {
  try {
    const singleLine = text.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
    await invoke("write_pty", { id: agentId, data: singleLine + "\r" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill an agent's PTY session.
 */
export async function killAgent(agentId: string): Promise<void> {
  const entry = runningAgents.get(agentId);
  if (!entry) return;

  entry.alive = false;

  if (entry.peerId) {
    await unregisterPeer(entry.peerId).catch(() => {});
  }

  try {
    await invoke("kill_pty", { id: agentId });
  } catch {
    // PTY may already be dead
  }

  cleanupAgent(agentId);
  useAppStore.getState().updateAgentStatus(agentId, "stopped");
}

/** Get the buffered PTY output for replaying into a fresh xterm.js instance. */
export function getPtyOutputBuffer(agentId: string): string[] {
  return runningAgents.get(agentId)?.outputBuffer ?? [];
}

/** Get the monotonic output chunk counter (survives buffer trimming). */
export function getPtyOutputBufferLength(agentId: string): number {
  return runningAgents.get(agentId)?.outputChunkCount ?? 0;
}

/** Strip ANSI escape codes from terminal output. */
function stripAnsi(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[?]?[0-9;]*[a-zA-Z]/g, "")  // CSI sequences (including private ?-prefixed)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")  // OSC sequences (BEL or ST terminated)
    .replace(/\x1b[()][AB012]/g, "")               // charset switches
    .replace(/\x1b[78]/g, "")                       // save/restore cursor
    .replace(/\x1b[>=]/g, "")                       // keypad modes
    .replace(/\x1b\[\d*[ABCDJKHS]/g, "")            // cursor movement / erase (redundant safety)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""); // control chars (preserves \t \n \r)
}

/**
 * Resolve carriage returns: for each line, keep only the text visible
 * after all \r overwrites (last segment wins).
 */
function resolveCarriageReturns(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!line.includes("\r")) return line;
      // Each \r resets the cursor to column 0; the LAST segment is what's visible
      const segments = line.split("\r");
      // Take the last non-empty segment
      for (let i = segments.length - 1; i >= 0; i--) {
        if (segments[i].length > 0) return segments[i];
      }
      return "";
    })
    .join("\n");
}

/**
 * Get cleaned PTY output since a given monotonic counter value.
 * The counter never decreases, so this survives buffer trimming (shift).
 */
export function getCleanOutputSince(agentId: string, sinceCounter: number): string {
  const entry = runningAgents.get(agentId);
  if (!entry) {
    console.debug(`[preview] no entry in runningAgents for ${agentId}`);
    return "";
  }
  // How many chunks have been shifted out of the front of the array
  const droppedCount = entry.outputChunkCount - entry.outputBuffer.length;
  // Convert the monotonic counter to an index into the current array
  const startIndex = Math.max(0, sinceCounter - droppedCount);
  if (startIndex >= entry.outputBuffer.length) {
    console.debug(
      `[preview] no new chunks: sinceCounter=${sinceCounter} chunkCount=${entry.outputChunkCount} bufLen=${entry.outputBuffer.length}`
    );
    return "";
  }
  const chunks = entry.outputBuffer.slice(startIndex);
  const raw = chunks.join("");
  const cleaned = resolveCarriageReturns(stripAnsi(raw))
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .join("\n")
    // Strip Claude Code REPL prompt separator (--- > --- blocks)
    .replace(/-{5,}\n>\s*\n?-{0,}[^\n]*/g, "")
    // Strip trailing "> " prompt (waiting-for-input indicator)
    .replace(/\n>\s*$/, "")
    .trim();
  if (!cleaned && raw.length > 0) {
    // Aggressive cleaning removed all content — fall back to basic ANSI strip
    const fallback = stripAnsi(raw)
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0)
      .slice(-100)
      .join("\n")
      .trim();
    if (fallback) return fallback;
  }
  return cleaned;
}

/**
 * Trigger an immediate poll for pending broker messages for this agent.
 * Called after sending a broker message to avoid waiting for the 5s poll interval.
 */
export function triggerImmediatePoll(agentId: string): void {
  const entry = runningAgents.get(agentId);
  if (entry && entry.alive && entry.peerId && entry.identityInjected) {
    pollAndDeliverMessages(entry).catch(() => {});
  }
}

/** Get the broker peer ID for an agent. */
export function getAgentPeerId(agentId: string): string | null {
  return runningAgents.get(agentId)?.peerId ?? null;
}

/** Check if an agent's PTY is alive. */
export function isAgentRunning(agentId: string): boolean {
  return runningAgents.get(agentId)?.alive ?? false;
}

/**
 * Notify existing agents in a node that a new peer has joined.
 */
export async function notifyPeersOfNewAgent(
  nodeId: string,
  newAgentName: string,
  newPeerId: string
): Promise<void> {
  for (const [, entry] of runningAgents) {
    if (
      entry.alive &&
      entry.identityInjected &&
      entry.nodeId === nodeId &&
      entry.peerId !== newPeerId
    ) {
      const { autoSendMessages } = useAppStore.getState().settings;
      const msg = `[SWARM] New agent "${newAgentName}" (peer: ${newPeerId}) joined your node. You can send them messages using their peer ID.`;
      const suffix = autoSendMessages ? "\r" : "";
      await writeToPty(entry.agentId, msg + suffix).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Internal — swarm communication
// ---------------------------------------------------------------------------

/** Write raw text to a PTY's stdin. */
async function writeToPty(agentId: string, data: string): Promise<void> {
  await invoke("write_pty", { id: agentId, data });
}

/**
 * Inject ONLY the user's task into the agent's PTY.
 * The swarm context (identity, peers, communication tools, spawn rules) is already
 * loaded via --append-system-prompt at spawn time. This function just types the
 * short task text and presses Enter.
 */
async function injectTask(
  entry: RunningAgent,
  taskPrompt?: string,
): Promise<void> {
  if (!entry.alive) return;

  entry.identityInjected = true; // context is in system prompt

  if (!taskPrompt) {
    console.log(`[agent:${entry.name}] no task to inject, agent ready`);
    return;
  }

  try {
    // Collapse to single line and submit
    const taskLine = taskPrompt.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
    await writeToPty(entry.agentId, taskLine + "\r");
    console.log(`[agent:${entry.name}] task injected`);
  } catch (err) {
    console.error(`[agent:${entry.name}] failed to inject task:`, err);
  }
}

/**
 * Poll the broker for messages destined to this agent and deliver them
 * by typing them into the PTY's stdin.
 */
async function pollAndDeliverMessages(entry: RunningAgent): Promise<void> {
  if (!entry.peerId || !entry.alive) return;

  const { messages } = await pollMessages(entry.peerId);
  if (messages.length === 0) return;

  const store = useAppStore.getState();

  for (const msg of messages) {
    // Find sender name
    const senderAgent = store.agents.find((a) => a.peerId === msg.from_id);
    const senderName = senderAgent?.name ?? msg.from_id;

    // Format and inject into the PTY
    const { autoSendMessages } = useAppStore.getState().settings;
    const formatted = `[Message from "${senderName}"]: ${msg.text}`;
    // \r = Enter key in PTY. Auto-send submits immediately.
    const suffix = autoSendMessages ? "\r" : "";
    await writeToPty(entry.agentId, formatted + suffix).catch(() => {});

    // Log in the UI
    store.addAgentMessage(entry.agentId, {
      id: Math.random().toString(36).slice(2),
      fromId: msg.from_id,
      toId: msg.to_id,
      text: `[From "${senderName}"]: ${msg.text}`,
      sentAt: msg.sent_at,
      direction: "inbound",
    });

    if (senderAgent) {
      store.addConnection(senderAgent.id, entry.agentId);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal — cleanup
// ---------------------------------------------------------------------------

function cleanupAgent(agentId: string) {
  const entry = runningAgents.get(agentId);
  if (!entry) return;
  if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer);
  if (entry.pollTimer) clearInterval(entry.pollTimer);
  if (entry.unlistenOutput) entry.unlistenOutput();
  if (entry.unlistenExit) entry.unlistenExit();
  runningAgents.delete(agentId);
}
