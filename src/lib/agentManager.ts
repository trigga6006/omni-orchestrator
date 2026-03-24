/**
 * Agent Process Manager
 *
 * Spawns persistent Claude Code sessions via the Tauri shell plugin,
 * registers them with the broker, manages lifecycle, and relays
 * inter-agent messages through the broker.
 *
 * Architecture:
 * - Each agent runs as a persistent `claude --output-format stream-json` process
 * - Initial task prompt is written to stdin after spawn
 * - The UI polls the broker for messages destined to each agent
 * - Peer messages are formatted and injected via stdin
 * - Agent stdout is parsed for peer-addressed messages (@agent-name:)
 *   which get routed through the broker to the target agent
 */

import { Command, type Child } from "@tauri-apps/plugin-shell";
import {
  registerPeer,
  unregisterPeer,
  heartbeat,
  sendMessage as brokerSendMessage,
  pollMessages,
  setSummary,
} from "./broker";
import { useAppStore } from "../stores/appStore";

interface RunningAgent {
  agentId: string;
  peerId: string | null;
  nodeId: string;
  child: Child | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  sessionReady: boolean;
}

const runningAgents = new Map<string, RunningAgent>();

/**
 * Build the system prompt that makes the agent swarm-aware.
 */
function buildSystemPrompt(name: string, cwd: string, nodeId: string): string {
  const store = useAppStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  const nodeAgents = store.agents.filter(
    (a) => a.nodeId === nodeId && a.status === "active"
  );

  const peerList =
    nodeAgents.length > 0
      ? nodeAgents
          .map((a) => `  - "${a.name}" (peer: ${a.peerId ?? "registering..."})`)
          .join("\n")
      : "  (no other agents yet)";

  return `You are agent "${name}" working in ${cwd}.
You are part of a multi-agent swarm in the "${node?.name ?? "unknown"}" node, coordinated by a central broker.

## Peer Agents in Your Node
${peerList}

## Communication Protocol
- To send a message to another agent, start your response line with: @agent-name: your message
  Example: @frontend-fix: Can you check if the navbar component renders correctly?
- You may receive messages from peer agents. They will appear as:
  [From "Agent Name"]: their message
- You can address multiple agents in one response using multiple @agent-name: lines.
- Messages without an @agent-name: prefix are shown to the user.

## Guidelines
- Focus on your assigned task and coordinate with peers when needed.
- Report progress clearly and concisely.
- When you need input from a peer agent, ask them directly using the @agent-name: syntax.
- When you complete your task, summarize what you did.`;
}

/**
 * Spawn a new persistent Claude Code session for an agent.
 */
export async function spawnAgent(
  agentId: string,
  nodeId: string,
  name: string,
  cwd: string,
  taskPrompt?: string
): Promise<void> {
  const store = useAppStore.getState();

  // Interactive mode: no -p flag. We write prompts to stdin.
  const args = ["--output-format", "stream-json", "--verbose"];

  const entry: RunningAgent = {
    agentId,
    peerId: null,
    nodeId,
    child: null,
    heartbeatTimer: null,
    pollTimer: null,
    sessionReady: false,
  };

  runningAgents.set(agentId, entry);

  try {
    const command = Command.create("claude-agent", args, { cwd });

    command.on("close", (event) => {
      console.log(`[agent:${name}] exited with code ${event.code}`);
      useAppStore
        .getState()
        .updateAgentStatus(agentId, event.code === 0 ? "stopped" : "error");
      cleanupAgent(agentId);
    });

    command.on("error", (error) => {
      console.error(`[agent:${name}] error:`, error);
      useAppStore.getState().updateAgentStatus(agentId, "error");
      cleanupAgent(agentId);
    });

    command.stdout.on("data", (line) => {
      handleAgentOutput(agentId, name, line);
    });

    command.stderr.on("data", (line) => {
      console.debug(`[agent:${name}] stderr:`, line);
    });

    // Spawn the child process
    const child = await command.spawn();
    entry.child = child;

    store.updateAgentStatus(agentId, "active");
    store.updateAgentPid(agentId, child.pid);

    // Register with broker
    try {
      const { id: peerId } = await registerPeer({
        pid: child.pid,
        cwd,
        git_root: null,
        tty: null,
        summary: `Agent "${name}" — starting up`,
        node_id: nodeId,
      });

      entry.peerId = peerId;
      store.updateAgentPeerId(agentId, peerId);

      // Heartbeat every 15s
      entry.heartbeatTimer = setInterval(() => {
        heartbeat(peerId).catch(() => {});
      }, 15_000);

      // Start message relay polling every 5s
      entry.pollTimer = setInterval(() => {
        pollAndRelayMessages(agentId).catch((err) => {
          console.debug(`[agent:${name}] poll error:`, err);
        });
      }, 5_000);
    } catch (err) {
      console.warn(`[agent:${name}] broker registration failed:`, err);
    }

    // Write the initial prompt to stdin after a short delay to let the process initialize
    const systemPrompt = buildSystemPrompt(name, cwd, nodeId);
    const initialMessage = taskPrompt
      ? `${systemPrompt}\n\n## Your Task\n${taskPrompt}`
      : systemPrompt;

    // Small delay to let claude initialize before sending stdin
    setTimeout(async () => {
      try {
        await child.write(initialMessage + "\n");
        entry.sessionReady = true;
        console.log(`[agent:${name}] initial prompt sent`);
      } catch (err) {
        console.error(`[agent:${name}] failed to write initial prompt:`, err);
      }
    }, 500);
  } catch (err) {
    console.error(`[agent:${name}] failed to spawn:`, err);
    store.updateAgentStatus(agentId, "error");
    runningAgents.delete(agentId);
    throw err;
  }
}

/**
 * Send a message to a running agent's stdin.
 */
export async function writeToAgent(
  agentId: string,
  text: string
): Promise<boolean> {
  const entry = runningAgents.get(agentId);
  if (!entry?.child) return false;

  try {
    await entry.child.write(text + "\n");
    return true;
  } catch (err) {
    console.error(`[agent:${agentId}] stdin write failed:`, err);
    return false;
  }
}

/**
 * Send a formatted peer message to an agent's stdin.
 */
async function deliverPeerMessage(
  agentId: string,
  fromName: string,
  fromPeerId: string,
  text: string
): Promise<boolean> {
  const formatted = `[From "${fromName}" (${fromPeerId})]: ${text}`;
  return writeToAgent(agentId, formatted);
}

/**
 * Poll the broker for messages destined to this agent and relay them.
 */
async function pollAndRelayMessages(agentId: string): Promise<void> {
  const entry = runningAgents.get(agentId);
  if (!entry?.peerId || !entry.child || !entry.sessionReady) return;

  const { messages } = await pollMessages(entry.peerId);
  if (messages.length === 0) return;

  const store = useAppStore.getState();

  for (const msg of messages) {
    // Find the sender agent to get their display name
    const senderAgent = store.agents.find((a) => a.peerId === msg.from_id);
    const senderName = senderAgent?.name ?? msg.from_id;

    // Deliver to agent via stdin
    await deliverPeerMessage(agentId, senderName, msg.from_id, msg.text);

    // Also add to the UI message list
    store.addAgentMessage(agentId, {
      id: Math.random().toString(36).slice(2),
      fromId: msg.from_id,
      toId: msg.to_id,
      text: `[From "${senderName}"]: ${msg.text}`,
      sentAt: msg.sent_at,
      direction: "inbound",
    });

    // Track the connection in the UI
    if (senderAgent) {
      store.addConnection(senderAgent.id, agentId);
    }
  }
}

/**
 * Route a peer-addressed message from agent output through the broker.
 * Parses lines like: @agent-name: message text
 */
function routePeerMessage(
  fromAgentId: string,
  fromPeerId: string,
  targetName: string,
  text: string
): boolean {
  const store = useAppStore.getState();

  // Find the target agent by name (case-insensitive)
  const targetAgent = store.agents.find(
    (a) =>
      a.name.toLowerCase() === targetName.toLowerCase() && a.peerId != null
  );

  if (!targetAgent || !targetAgent.peerId) {
    console.warn(
      `[routing] Could not find active agent "${targetName}" to deliver message`
    );
    return false;
  }

  // Send through broker
  brokerSendMessage(fromPeerId, targetAgent.peerId, text).catch((err) => {
    console.error(`[routing] Failed to send message via broker:`, err);
  });

  // Track connection in UI
  store.addConnection(fromAgentId, targetAgent.id);

  // Add outbound message to sender's message list
  store.addAgentMessage(fromAgentId, {
    id: Math.random().toString(36).slice(2),
    fromId: fromPeerId,
    toId: targetAgent.peerId,
    text: `[@${targetName}]: ${text}`,
    sentAt: new Date().toISOString(),
    direction: "outbound",
  });

  return true;
}

/**
 * Kill a running agent process.
 */
export async function killAgent(agentId: string): Promise<void> {
  const entry = runningAgents.get(agentId);
  if (!entry) return;

  // Unregister from broker
  if (entry.peerId) {
    await unregisterPeer(entry.peerId).catch(() => {});
  }

  // Kill the child process
  if (entry.child) {
    try {
      await entry.child.kill();
    } catch {
      // Process may have already exited
    }
  }

  cleanupAgent(agentId);
  useAppStore.getState().updateAgentStatus(agentId, "stopped");
}

/**
 * Get the broker peer ID for an agent.
 */
export function getAgentPeerId(agentId: string): string | null {
  return runningAgents.get(agentId)?.peerId ?? null;
}

/**
 * Check if an agent is running.
 */
export function isAgentRunning(agentId: string): boolean {
  return runningAgents.has(agentId);
}

/**
 * Notify all agents in a node about a new peer joining.
 */
export async function notifyPeersOfNewAgent(
  nodeId: string,
  newAgentName: string,
  newPeerId: string
): Promise<void> {
  const store = useAppStore.getState();
  const nodeAgents = store.agents.filter(
    (a) => a.nodeId === nodeId && a.peerId && a.peerId !== newPeerId
  );

  for (const agent of nodeAgents) {
    const entry = runningAgents.get(agent.id);
    if (entry?.child && entry.sessionReady) {
      const msg = `[System]: New agent "${newAgentName}" (peer: ${newPeerId}) has joined your node. You can communicate with them using @${newAgentName}: your message`;
      await writeToAgent(agent.id, msg).catch(() => {});
    }
  }
}

// ---- Internal ----

function cleanupAgent(agentId: string) {
  const entry = runningAgents.get(agentId);
  if (!entry) return;
  if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer);
  if (entry.pollTimer) clearInterval(entry.pollTimer);
  runningAgents.delete(agentId);
}

/** Regex to match peer-addressed messages: @agent-name: message */
const PEER_MESSAGE_REGEX = /^@([\w\s-]+?):\s*(.+)$/m;

function handleAgentOutput(agentId: string, _name: string, line: string) {
  const store = useAppStore.getState();
  const agent = store.agents.find((a) => a.id === agentId);
  if (!agent) return;

  const entry = runningAgents.get(agentId);

  // Try to parse as stream-json from Claude
  try {
    const event = JSON.parse(line);

    switch (event.type) {
      case "assistant": {
        const text =
          event.message?.content
            ?.filter((c: { type: string }) => c.type === "text")
            .map((c: { text: string }) => c.text)
            .join("") ?? "";
        if (text) {
          // Check for peer-addressed messages in the output
          const processed = processPeerMessages(agentId, text);

          // Show remaining (non-peer) text to user
          if (processed.userText.trim()) {
            store.addAgentMessage(agentId, {
              id: Math.random().toString(36).slice(2),
              fromId: agent.peerId ?? agentId,
              toId: "user",
              text: processed.userText.trim(),
              sentAt: new Date().toISOString(),
              direction: "inbound",
            });
          }

          // Update the agent's summary on the broker
          if (entry?.peerId && text.length > 20) {
            const summary = text.slice(0, 200);
            setSummary(entry.peerId, summary).catch(() => {});
          }
        }
        break;
      }

      case "result": {
        const text =
          typeof event.result === "string"
            ? event.result
            : event.result?.text ?? JSON.stringify(event.result);
        if (text) {
          const processed = processPeerMessages(agentId, text);
          if (processed.userText.trim()) {
            store.addAgentMessage(agentId, {
              id: Math.random().toString(36).slice(2),
              fromId: agent.peerId ?? agentId,
              toId: "user",
              text: processed.userText.trim(),
              sentAt: new Date().toISOString(),
              direction: "inbound",
            });
          }
        }
        break;
      }

      case "system": {
        if (event.subtype === "init" && event.session_id) {
          // Capture session ID for potential --resume fallback
          console.log(
            `[agent:${_name}] session started: ${event.session_id}`
          );
        }
        if (event.message) {
          store.updateAgentSummary(agentId, event.message);
        }
        break;
      }
    }
  } catch {
    // Plain text output
    if (line.trim()) {
      const processed = processPeerMessages(agentId, line.trim());
      if (processed.userText.trim()) {
        store.addAgentMessage(agentId, {
          id: Math.random().toString(36).slice(2),
          fromId: agent.peerId ?? agentId,
          toId: "user",
          text: processed.userText.trim(),
          sentAt: new Date().toISOString(),
          direction: "inbound",
        });
      }
    }
  }
}

/**
 * Process text output for peer-addressed messages.
 * Returns the remaining user-facing text after extracting peer messages.
 */
function processPeerMessages(
  agentId: string,
  text: string
): { userText: string; routedCount: number } {
  const agent = useAppStore.getState().agents.find((a) => a.id === agentId);
  const entry = runningAgents.get(agentId);
  if (!agent?.peerId || !entry) {
    return { userText: text, routedCount: 0 };
  }

  let routedCount = 0;
  const lines = text.split("\n");
  const userLines: string[] = [];

  for (const line of lines) {
    const match = line.match(PEER_MESSAGE_REGEX);
    if (match) {
      const [, targetName, message] = match;
      if (routePeerMessage(agentId, agent.peerId, targetName.trim(), message.trim())) {
        routedCount++;
        continue; // Don't show routed messages to user
      }
    }
    userLines.push(line);
  }

  return { userText: userLines.join("\n"), routedCount };
}
