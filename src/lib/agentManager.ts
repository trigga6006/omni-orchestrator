/**
 * Agent Process Manager
 *
 * Spawns Claude Code sessions via the Tauri shell plugin,
 * registers them with the broker, and manages their lifecycle.
 */

import { Command, type Child } from "@tauri-apps/plugin-shell";
import { registerPeer, unregisterPeer, heartbeat } from "./broker";
import { useAppStore } from "../stores/appStore";

interface RunningAgent {
  agentId: string;
  peerId: string | null;
  nodeId: string;
  child: Child | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

const runningAgents = new Map<string, RunningAgent>();

/**
 * Spawn a new Claude Code session for an agent.
 */
export async function spawnAgent(
  agentId: string,
  nodeId: string,
  name: string,
  cwd: string
): Promise<void> {
  const store = useAppStore.getState();

  // Build claude command args.
  // --output-format stream-json gives structured output we can parse.
  // -p sends an initial prompt to kick off the session.
  const args = [
    "--output-format",
    "stream-json",
    "--verbose",
    "-p",
    `You are agent "${name}" working in ${cwd}. You are part of a multi-agent swarm coordinated by a broker. Focus on tasks assigned to you and report progress clearly.`,
  ];

  const entry: RunningAgent = {
    agentId,
    peerId: null,
    nodeId,
    child: null,
    heartbeatTimer: null,
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

    // Spawn and track the child handle
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
    } catch (err) {
      console.warn(`[agent:${name}] broker registration failed:`, err);
    }
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
 * Kill a running agent process.
 */
export async function killAgent(agentId: string): Promise<void> {
  const entry = runningAgents.get(agentId);
  if (!entry) return;

  // Unregister from broker
  if (entry.peerId) {
    await unregisterPeer(entry.peerId).catch(() => {});
  }

  // Kill the child process via the tracked handle
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

// ---- Internal ----

function cleanupAgent(agentId: string) {
  const entry = runningAgents.get(agentId);
  if (!entry) return;
  if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer);
  runningAgents.delete(agentId);
}

function handleAgentOutput(agentId: string, _name: string, line: string) {
  const store = useAppStore.getState();
  const agent = store.agents.find((a) => a.id === agentId);
  if (!agent) return;

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
          store.addAgentMessage(agentId, {
            id: Math.random().toString(36).slice(2),
            fromId: agent.peerId ?? agentId,
            toId: "user",
            text,
            sentAt: new Date().toISOString(),
            direction: "inbound",
          });
        }
        break;
      }

      case "result": {
        const text =
          typeof event.result === "string"
            ? event.result
            : event.result?.text ?? JSON.stringify(event.result);
        if (text) {
          store.addAgentMessage(agentId, {
            id: Math.random().toString(36).slice(2),
            fromId: agent.peerId ?? agentId,
            toId: "user",
            text,
            sentAt: new Date().toISOString(),
            direction: "inbound",
          });
        }
        break;
      }

      case "system": {
        if (event.message) {
          store.updateAgentSummary(agentId, event.message);
        }
        break;
      }
    }
  } catch {
    // Plain text output
    if (line.trim()) {
      store.addAgentMessage(agentId, {
        id: Math.random().toString(36).slice(2),
        fromId: agent.peerId ?? agentId,
        toId: "user",
        text: line.trim(),
        sentAt: new Date().toISOString(),
        direction: "inbound",
      });
    }
  }
}
