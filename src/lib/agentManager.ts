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
import { PermissionDetector } from "./permissionDetector";
import { pushConciergeContext } from "./conciergeContextProvider";

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
  permissionDetector: PermissionDetector | null;
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

/** Build the peer roster section (shared by both roles). */
function buildPeerRoster(
  nodeId: string,
  excludeName: string,
  excludePeerId: string,
): string {
  const store = useAppStore.getState();
  const peerAgents = store.agents.filter(
    (a) => a.nodeId === nodeId && a.id !== excludeName && a.peerId && a.peerId !== excludePeerId
  );

  if (peerAgents.length === 0) {
    return "  (no other agents yet — you will be notified when peers join)";
  }
  return peerAgents
    .map((a) => `  - "${a.name}" (${a.role}) → peer ID: ${a.peerId}`)
    .join("\n");
}

/** System prompt for the lead/boss agent of a node. */
function buildBossPrompt(
  name: string,
  peerId: string,
  nodeId: string,
  nodeName: string,
  cwd: string,
  peerList: string,
): string {
  // IMPORTANT: This prompt is passed as a CLI argument via --append-system-prompt.
  // On Windows with cmd.exe shims, special characters are interpreted by the shell.
  // Keep this plain text — no backticks, no pipe tables, no markdown bold/headers.
  // The content IS the system prompt — Claude will follow these instructions.
  return [
    `You are "${name}", the lead agent of the "${nodeName}" swarm node inside Omniforge, a desktop AI-agent orchestration platform.`,
    `You are a fully autonomous Claude Code session running in a pseudo-terminal managed by the Omniforge UI.`,
    `You do NOT need to explore Omniforge source code or understand its infrastructure. Everything you need is described here.`,
    ``,
    `IDENTITY`,
    `  Agent name: ${name}`,
    `  Role: lead`,
    `  Peer ID: ${peerId}`,
    `  Node: "${nodeName}" (ID: ${nodeId})`,
    `  Working directory: ${cwd}`,
    ``,
    `ENVIRONMENT`,
    `You have full access to the standard Claude Code tools: Read, Edit, Write, Bash, Glob, Grep, and the internal Agent tool.`,
    `Use the dedicated tools rather than shell equivalents (Read not cat, Edit not sed, Grep not grep, Glob not find).`,
    `Use Bash for commands that need a shell: build, test, install, git, and curl for swarm communication.`,
    ``,
    `SWARM COMMUNICATION`,
    `You communicate with peer agents through a broker at ${BROKER_URL} using curl from the Bash tool.`,
    `Always use escaped double quotes in the JSON payload (never single quotes, they break on Windows).`,
    ``,
    `Send a message to a peer:`,
    `  curl -s -X POST ${BROKER_URL}/send-message -H "Content-Type: application/json" -d "{\\"from_id\\":\\"${peerId}\\",\\"to_id\\":\\"THEIR_PEER_ID\\",\\"text\\":\\"your message\\"}"`,
    ``,
    `Broadcast to all peers in your node:`,
    `  curl -s -X POST ${BROKER_URL}/broadcast -H "Content-Type: application/json" -d "{\\"from_id\\":\\"${peerId}\\",\\"node_id\\":\\"${nodeId}\\",\\"text\\":\\"your message\\"}"`,
    ``,
    `List all active peers:`,
    `  curl -s ${BROKER_URL}/peers`,
    ``,
    `Incoming messages from peers are delivered directly into this session. You do not need to poll.`,
    ``,
    `Current peers in your node:`,
    peerList,
    ``,
    `SPAWNING SWARM AGENTS`,
    `This is your most important capability. You can spawn new Claude Code sessions as swarm agents using a single curl command.`,
    `This is NOT the same as your built-in Agent tool. The Agent tool creates sub-agents inside your own session.`,
    `Swarm spawning creates independent, persistent Claude Code sessions that appear as separate terminals in the Omniforge UI.`,
    `Each spawned agent gets its own system prompt, its own tools, and the ability to message you and other peers.`,
    `The orchestrator handles all setup automatically. You just issue the curl command.`,
    ``,
    `Spawn a new swarm agent:`,
    `  curl -s -X POST ${BROKER_URL}/spawn-agent -H "Content-Type: application/json" -d "{\\"node_id\\":\\"${nodeId}\\",\\"name\\":\\"AGENT_NAME\\",\\"task\\":\\"TASK_DESCRIPTION\\",\\"requester_peer_id\\":\\"${peerId}\\",\\"model\\":\\"MODEL\\"}"`,
    ``,
    `Parameters:`,
    `  name - Descriptive kebab-case name (e.g. "api-routes", "ui-forms", "test-writer")`,
    `  task - What the agent should do. Include all context it needs.`,
    `  model - "sonnet" (default, use for most tasks), "opus" (complex reasoning), or "haiku" (trivial tasks)`,
    `  requester_peer_id - Always use "${peerId}" (your own peer ID)`,
    `  node_id - Always use "${nodeId}" (this node)`,
    ``,
    `Spawn rules:`,
    `  Each name must be unique. Never reuse a name you already spawned.`,
    `  Each spawned agent is a full independent Claude Code session in the same working directory.`,
    `  Agents automatically know how to message you back. You do not need to teach them communication.`,
    ``,
    `TASK EXECUTION STRATEGY`,
    `When you receive a task, choose the right approach:`,
    ``,
    `Simple tasks (single fix, small change, quick question):`,
    `  Do it yourself directly. No need to spawn agents.`,
    ``,
    `Complex tasks (multiple independent features, broad audit):`,
    `  Break into independent sub-tasks and spawn a swarm agent for each.`,
    ``,
    `Agent management requests (e.g. "spawn 2 agents", "create a team", "set up agents to stand by"):`,
    `  This is a direct infrastructure command. Execute the spawn curl commands immediately.`,
    `  Do NOT explore the codebase, analyze the project, or think about what agents might do.`,
    `  Just spawn them. For stand-by agents, set their task to: "Await instructions from the lead agent."`,
    ``,
    `COORDINATION`,
    `After spawning agents for a complex task:`,
    `  Wait for exactly N "COMPLETED:" messages (one per agent) before proceeding.`,
    `  Do not begin summaries or edits until all agents report back.`,
    `  While waiting, you may check status: curl -s ${BROKER_URL}/peers`,
    `  If an agent is slow, message it asking for a status update.`,
    ``,
    `BEHAVIOR`,
    `Be direct and action-oriented. Execute immediately when the task is clear.`,
    `Do not over-analyze or explore the codebase unless the task specifically requires understanding unfamiliar code.`,
  ].join("\n");
}

/** System prompt for a worker/sub-agent within a node. */
function buildWorkerPrompt(
  name: string,
  peerId: string,
  nodeId: string,
  nodeName: string,
  cwd: string,
  peerList: string,
): string {
  // IMPORTANT: Same shell-safety rules as buildBossPrompt — plain text only.
  return [
    `You are "${name}", a worker agent in the "${nodeName}" swarm node inside Omniforge, a desktop AI-agent orchestration platform.`,
    `You are a fully autonomous Claude Code session running in a pseudo-terminal managed by the Omniforge UI.`,
    `You were spawned to handle a specific task. You do NOT need to explore Omniforge source code or understand its infrastructure.`,
    ``,
    `IDENTITY`,
    `  Agent name: ${name}`,
    `  Role: worker`,
    `  Peer ID: ${peerId}`,
    `  Node: "${nodeName}" (ID: ${nodeId})`,
    `  Working directory: ${cwd}`,
    ``,
    `ENVIRONMENT`,
    `You have full access to the standard Claude Code tools: Read, Edit, Write, Bash, Glob, Grep, and the internal Agent tool.`,
    `Use the dedicated tools rather than shell equivalents (Read not cat, Edit not sed, Grep not grep, Glob not find).`,
    `Use Bash for commands that need a shell: build, test, install, git, and curl for swarm communication.`,
    ``,
    `SWARM COMMUNICATION`,
    `You communicate with peer agents through a broker at ${BROKER_URL} using curl from the Bash tool.`,
    `Always use escaped double quotes in the JSON payload (never single quotes, they break on Windows).`,
    ``,
    `Send a message to a peer:`,
    `  curl -s -X POST ${BROKER_URL}/send-message -H "Content-Type: application/json" -d "{\\"from_id\\":\\"${peerId}\\",\\"to_id\\":\\"THEIR_PEER_ID\\",\\"text\\":\\"your message\\"}"`,
    ``,
    `Broadcast to all peers in your node:`,
    `  curl -s -X POST ${BROKER_URL}/broadcast -H "Content-Type: application/json" -d "{\\"from_id\\":\\"${peerId}\\",\\"node_id\\":\\"${nodeId}\\",\\"text\\":\\"your message\\"}"`,
    ``,
    `List all active peers:`,
    `  curl -s ${BROKER_URL}/peers`,
    ``,
    `Incoming messages from peers are delivered directly into this session. You do not need to poll.`,
    ``,
    `Current peers in your node:`,
    peerList,
    ``,
    `TASK EXECUTION`,
    `You were spawned to complete a specific task. Follow these rules:`,
    ``,
    `1. Focus on your assigned task. Do not take on work outside your scope.`,
    `   If you discover something outside your scope, message the lead agent about it.`,
    ``,
    `2. Execute directly. Your task description contains everything you need.`,
    `   Start working immediately. Do not explore the codebase for general "context"`,
    `   unless your task specifically requires understanding unfamiliar code.`,
    ``,
    `3. Use the right tools. Read files before editing. Use Grep and Glob to find what you need.`,
    `   Use Bash for builds, tests, and git operations.`,
    ``,
    `4. Report completion. When done, send a message to the lead agent (or broadcast)`,
    `   starting with "COMPLETED:" followed by a concise summary of what you did.`,
    ``,
    `5. Report blockers. If something prevents you from completing your task,`,
    `   message the lead agent with "BLOCKED:" followed by the issue.`,
    ``,
    `6. Stay available. After completing your task, remain available for follow-up messages.`,
    `   If you receive a new instruction from the lead agent, execute it.`,
    ``,
    `BEHAVIOR`,
    `Be direct and action-oriented. Execute immediately when the task is clear.`,
    `Keep messages to peers concise. State facts and results, not process narration.`,
  ].join("\n");
}

function buildSwarmIdentityPrompt(
  name: string,
  peerId: string,
  nodeId: string,
  role: AgentRole = "worker",
): string {
  const store = useAppStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  const nodeName = node?.name ?? "unknown";
  const cwd = node?.directory ?? ".";
  const peerList = buildPeerRoster(nodeId, name, peerId);

  if (role === "boss") {
    return buildBossPrompt(name, peerId, nodeId, nodeName, cwd, peerList);
  }
  return buildWorkerPrompt(name, peerId, nodeId, nodeName, cwd, peerList);
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
    permissionDetector: new PermissionDetector(agentId),
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

    if (!systemPrompt) {
      console.warn(`[agent:${name}] WARNING: No system prompt built — peerId=${peerId}. Agent will not have swarm capabilities.`);
    } else {
      console.log(`[agent:${name}] System prompt built (${systemPrompt.length} chars, role=${role})`);
    }

    // Build the custom system prompt by combining swarm identity + user custom instructions
    let fullSystemPrompt = systemPrompt ?? null;
    if (config?.customSystemPrompt && fullSystemPrompt) {
      fullSystemPrompt += "\n\n" + config.customSystemPrompt;
    } else if (config?.customSystemPrompt) {
      fullSystemPrompt = config.customSystemPrompt;
    }

    // Generate a stable session ID so we can --resume this agent later
    const sessionId = crypto.randomUUID();

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
      envVars: null,
      sessionId,
      resumeSessionId: null,
    });

    entry.pid = pid;
    store.updateAgentStatus(agentId, "active");
    store.updateAgentPid(agentId, pid);
    store.updateAgentSessionId(agentId, sessionId);
    pushConciergeContext();

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

    // Debounced prompt detection — only detect after output settles
    let promptDetectTimer: ReturnType<typeof setTimeout> | null = null;

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

        // Feed chunk to detector buffer (accumulates), but debounce detection
        if (entry.permissionDetector) {
          entry.permissionDetector.feed(event.payload);
          if (promptDetectTimer) clearTimeout(promptDetectTimer);
          promptDetectTimer = setTimeout(() => {
            if (!entry.alive || !entry.permissionDetector) return;
            const prompt = entry.permissionDetector.detect();
            if (prompt) {
              const agentState = useAppStore.getState().agents.find((a) => a.id === agentId);
              useAppStore.getState().addPermission({
                ...prompt,
                agentName: agentState?.name ?? name,
              });
            }
          }, 800);
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
 * Spawn a lightweight Claude Code PTY for the welcome-screen chat.
 * No broker registration, no swarm identity, no node required.
 * Output is buffered so XtermPanel can replay on mount.
 * Returns the PID on success.
 */
export async function spawnChatAgent(
  agentId: string,
  cwd: string,
  taskPrompt?: string,
  model?: string,
  systemPrompt?: string,
  envVars?: Record<string, string>,
  initialCols?: number,
  initialRows?: number,
): Promise<number> {
  const entry: RunningAgent = {
    agentId,
    peerId: null,
    nodeId: "__chat__",
    name: "claude",
    cwd,
    role: "worker",
    pid: 0,
    heartbeatTimer: null,
    pollTimer: null,
    outputBuffer: [],
    outputChunkCount: 0,
    unlistenOutput: null,
    unlistenExit: null,
    alive: true,
    identityInjected: false,
    permissionDetector: new PermissionDetector(agentId),
  };

  runningAgents.set(agentId, entry);

  const sessionId = crypto.randomUUID();

  const pid = await invoke<number>("spawn_pty", {
    id: agentId,
    cwd,
    cols: initialCols ?? 120,
    rows: initialRows ?? 30,
    model: model || undefined,
    systemPrompt: systemPrompt ?? null,
    permissionMode: "auto",
    maxTurns: null,
    allowedTools: null,
    disallowedTools: null,
    envVars: envVars ?? null,
    sessionId,
    resumeSessionId: null,
  });

  entry.pid = pid;

  // Update the store (chat agents are now tracked in the Zustand store)
  useAppStore.getState().updateAgentStatus(agentId, "active");
  useAppStore.getState().updateAgentPid(agentId, pid);
  useAppStore.getState().updateAgentSessionId(agentId, sessionId);

  // Buffer output + silence-based ready detection
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let readyFired = false;
  let chatPromptDetectTimer: ReturnType<typeof setTimeout> | null = null;

  const fireWhenReady = () => {
    if (readyFired || !entry.alive) return;
    readyFired = true;
    if (readyTimer) clearTimeout(readyTimer);
    if (taskPrompt) {
      entry.identityInjected = true;
      const line = taskPrompt.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
      writeToPty(agentId, line + "\r").catch(() => {});
    }
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
      if (!readyFired) {
        if (readyTimer) clearTimeout(readyTimer);
        readyTimer = setTimeout(fireWhenReady, READY_SILENCE_MS);
      }

      // Feed chunk to detector buffer, debounce actual detection
      if (entry.permissionDetector) {
        entry.permissionDetector.feed(event.payload);
        if (chatPromptDetectTimer) clearTimeout(chatPromptDetectTimer);
        chatPromptDetectTimer = setTimeout(() => {
          if (!entry.alive || !entry.permissionDetector) return;
          const prompt = entry.permissionDetector.detect();
          if (prompt) {
            useAppStore.getState().addPermission({
              ...prompt,
              agentName: entry.name,
            });
          }
        }, 800);
      }
    }
  );

  setTimeout(() => {
    if (!readyFired && entry.alive) fireWhenReady();
  }, READY_MAX_WAIT_MS);

  entry.unlistenExit = await listen(`pty-exit-${agentId}`, () => {
    entry.alive = false;
    useAppStore.getState().updateAgentStatus(agentId, "stopped");
    cleanupAgent(agentId);
  });

  return pid;
}

/**
 * Adopt an already-running lightweight chat agent into the full swarm system.
 * Creates broker registration, heartbeat, and polling. Used when promoting
 * a welcome-screen chat session to a node boss.
 */
export async function adoptAgent(
  agentId: string,
  nodeId: string,
  name: string,
  role: AgentRole = "boss",
): Promise<void> {
  const entry = runningAgents.get(agentId);
  if (!entry || !entry.alive) return;

  entry.nodeId = nodeId;
  entry.name = name;
  entry.role = role;

  // Register with broker
  try {
    const reg = await registerPeer({
      pid: entry.pid,
      cwd: entry.cwd,
      git_root: null,
      tty: null,
      summary: `Agent "${name}" — promoted to ${role}`,
      node_id: nodeId,
    });
    entry.peerId = reg.id;
    useAppStore.getState().updateAgentPeerId(agentId, reg.id);
  } catch (err) {
    console.warn(`[adopt:${name}] broker registration failed:`, err);
  }

  // Start heartbeat + polling
  if (entry.peerId) {
    entry.heartbeatTimer = setInterval(() => {
      if (entry.peerId) heartbeat(entry.peerId).catch(() => {});
    }, 15_000);

    entry.identityInjected = true;
    entry.pollTimer = setInterval(() => {
      if (entry.alive && entry.peerId && entry.identityInjected) {
        pollAndDeliverMessages(entry).catch(() => {});
      }
    }, POLL_INTERVAL);

    notifyPeersOfNewAgent(nodeId, name, entry.peerId).catch(() => {});
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
  pushConciergeContext();
}

/**
 * Resume a previously-saved agent by spawning a PTY with --resume <sessionId>.
 * Claude Code picks up the prior conversation. No task injection needed.
 */
export async function resumeAgent(
  agentId: string,
  nodeId: string,
  name: string,
  cwd: string,
  sessionId: string,
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
    identityInjected: true, // session already has context
    permissionDetector: new PermissionDetector(agentId),
  };

  runningAgents.set(agentId, entry);

  try {
    const agentState = store.agents.find((a) => a.id === agentId);
    const config = agentState?.config;
    const resolvedModel = model ?? config?.model ?? undefined;

    // Register with broker (new peerId)
    let peerId: string | null = null;
    try {
      const reg = await registerPeer({
        pid: 0,
        cwd,
        git_root: null,
        tty: null,
        summary: `Agent "${name}" — resumed`,
        node_id: nodeId,
      });
      peerId = reg.id;
      entry.peerId = peerId;
      store.updateAgentPeerId(agentId, peerId);
    } catch (err) {
      console.warn(`[resume:${name}] broker registration failed:`, err);
    }

    // Build system prompt with new peerId for swarm communication
    const systemPrompt = peerId
      ? buildSwarmIdentityPrompt(name, peerId, nodeId, role)
      : undefined;

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
      envVars: null,
      sessionId: null,
      resumeSessionId: sessionId,
    });

    entry.pid = pid;
    store.updateAgentStatus(agentId, "active");
    store.updateAgentPid(agentId, pid);
    pushConciergeContext();

    // Buffer output + permission detection (no task injection — session already has context)
    let promptDetectTimer: ReturnType<typeof setTimeout> | null = null;

    entry.unlistenOutput = await listen<string>(
      `pty-output-${agentId}`,
      (event) => {
        entry.outputBuffer.push(event.payload);
        entry.outputChunkCount++;
        let total = entry.outputBuffer.reduce((s, c) => s + c.length, 0);
        while (total > MAX_BUFFER_BYTES && entry.outputBuffer.length > 1) {
          total -= entry.outputBuffer.shift()!.length;
        }

        if (entry.permissionDetector) {
          entry.permissionDetector.feed(event.payload);
          if (promptDetectTimer) clearTimeout(promptDetectTimer);
          promptDetectTimer = setTimeout(() => {
            if (!entry.alive || !entry.permissionDetector) return;
            const prompt = entry.permissionDetector.detect();
            if (prompt) {
              useAppStore.getState().addPermission({
                ...prompt,
                agentName: name,
              });
            }
          }, 800);
        }
      }
    );

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

    store.pushActivity({
      type: "agent_spawn",
      agentId,
      agentName: name,
      nodeId,
      text: `Agent "${name}" resumed from saved session`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[resume:${name}] failed:`, msg);
    store.updateAgentStatus(agentId, "error");
    store.updateAgentSummary(agentId, `Resume failed: ${msg}`);
    runningAgents.delete(agentId);
    throw err;
  }
}

/**
 * Resume all suspended agents that have a stored session ID.
 */
export async function resumeAllAgents(): Promise<void> {
  const store = useAppStore.getState();
  const suspended = store.agents.filter(
    (a) => a.status === "suspended" && a.sessionId
  );
  await Promise.all(
    suspended.map((a) =>
      resumeAgent(a.id, a.nodeId, a.name, a.cwd, a.sessionId!, a.role, a.config.model)
    )
  );
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
 * Respond to a permission prompt (y/n) detected in an agent's PTY output.
 */
export async function respondToPermission(
  agentId: string,
  permissionId: string,
  allow: boolean,
): Promise<void> {
  const entry = runningAgents.get(agentId);
  if (!entry || !entry.alive) return;

  await writeToPty(agentId, allow ? "y" : "n");
  entry.permissionDetector?.reset();
  useAppStore.getState().removePermission(permissionId);
}

/**
 * Respond to an AskUserQuestion multi-choice prompt by selecting an option.
 * The optionIndex is the 1-based number as shown in the terminal menu.
 * The menu starts at option 1 — we send (index-1) arrow-downs then Enter.
 * Small delays between keystrokes ensure the TUI processes each one.
 */
export async function respondToQuestion(
  agentId: string,
  permissionId: string,
  optionIndex: number,
): Promise<void> {
  const entry = runningAgents.get(agentId);
  if (!entry || !entry.alive) return;

  const arrowDowns = optionIndex - 1;
  for (let i = 0; i < arrowDowns; i++) {
    await writeToPty(agentId, "\x1b[B"); // ESC [ B = arrow down
    // Small delay to let the TUI process each keystroke
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 50));
  await writeToPty(agentId, "\r"); // Enter to select

  entry.permissionDetector?.reset();
  useAppStore.getState().removePermission(permissionId);
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
// Bulk cleanup
// ---------------------------------------------------------------------------

/**
 * Kill all agents belonging to a specific node.
 * Call this before removing a node to avoid orphaned PTY processes.
 */
export async function killAgentsForNode(nodeId: string): Promise<void> {
  const agentIds = [...runningAgents.entries()]
    .filter(([, entry]) => entry.nodeId === nodeId)
    .map(([id]) => id);

  await Promise.all(agentIds.map((id) => killAgent(id)));
}

/**
 * Kill every running agent. Used on app shutdown to prevent orphaned processes.
 */
export async function killAllAgents(): Promise<void> {
  const agentIds = [...runningAgents.keys()];
  await Promise.all(agentIds.map((id) => killAgent(id)));
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
  useAppStore.getState().clearPermissionsForAgent(agentId);
  runningAgents.delete(agentId);
}
