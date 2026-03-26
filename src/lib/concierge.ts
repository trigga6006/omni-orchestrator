/**
 * Concierge Agent — a persistent, system-level Claude Code session that acts
 * as a thin intelligent layer between the user and the orchestrator.
 *
 * It uses the lightweight spawnChatAgent() pattern (no broker, no swarm
 * identity). It never appears in store.agents[], the node canvas, or any
 * target picker.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  spawnChatAgent,
  writeToAgent,
  killAgent,
  isAgentRunning,
  getCleanOutputSince,
  getPtyOutputBufferLength,
} from "./agentManager";
import { cleanPtyOutput } from "./ptyClean";
import { useAppStore } from "../stores/appStore";

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

export const CONCIERGE_AGENT_ID = "concierge-agent";
export const CONCIERGE_MODEL = "opus";

const REWRITE_POLL_MS = 400;
const REWRITE_STALE_MS = 3_000; // silence = response complete
const REWRITE_TIMEOUT_MS = 60_000;
const RESPAWN_DELAY_MS = 5_000;

const CONCIERGE_SYSTEM_PROMPT = `You are the Concierge for Omniforge, an AI agent orchestration desktop app. You are NOT a swarm agent and do NOT participate in agent communication. You are a helper for the USER who operates this app.

Your capabilities:
1. PROMPT REWRITING: When you receive a message prefixed with [REWRITE], rewrite it to be clearer, more technically precise, and better suited for agent execution. Return ONLY the rewritten prompt — no preamble, no explanation, no markdown formatting, no quotes.
2. STATUS QUERIES: When asked about the current state, refer to the context injections you receive (prefixed with [CONTEXT_UPDATE]) which describe active nodes, agents, and recent activity. Context updates include a signal score (0-3) indicating how noteworthy recent changes are.
3. GENERAL HELP: Answer questions about how the orchestrator works, help the user think through task decomposition, suggest which agent configurations to use.
4. KNOWLEDGE CONTRIBUTION: When you notice a reusable pattern, important lesson, or decision principle from the work happening in the orchestrator, you may output a knowledge entry in this exact format:
   [KNOWLEDGE] [pattern|scar|principle] <content> (when: <boundary condition>)
   Examples:
   [KNOWLEDGE] [pattern] User pairs backend and frontend nodes for full-stack tasks (when: new project setup)
   [KNOWLEDGE] [scar] Agents fail when cwd doesn't exist yet (when: spawning agents for new projects)
   [KNOWLEDGE] [principle] Use Opus for architectural tasks, Sonnet for implementation (when: choosing agent models)
   Only contribute knowledge that is genuinely reusable across sessions. Do not contribute trivial or one-off observations.

When you receive a [CONTEXT_UPDATE], do NOT respond to it. It is background context for your reference. Simply absorb the information silently. Context updates may include a KNOWLEDGE section — these are your accumulated cross-session knowledge entries.

When you receive a [REWRITE] request, return ONLY the rewritten text with no preamble, no explanation, no markdown formatting.`;

/* ------------------------------------------------------------------ */
/* Internal state                                                       */
/* ------------------------------------------------------------------ */

let exitUnlisten: UnlistenFn | null = null;
let respawnTimer: ReturnType<typeof setTimeout> | null = null;

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */

export async function spawnConcierge(cwd: string): Promise<void> {
  const store = useAppStore.getState();

  // Skip spawning when not running inside Tauri
  if (!(window as any).__TAURI_INTERNALS__) {
    store.setConciergeStatus("off");
    return;
  }

  if (isAgentRunning(CONCIERGE_AGENT_ID)) {
    store.setConciergeStatus("ready");
    return;
  }

  // Clean up any stale exit listener from a previous spawn
  if (exitUnlisten) {
    exitUnlisten();
    exitUnlisten = null;
  }

  store.setConciergeStatus("starting");

  try {
    await spawnChatAgent(
      CONCIERGE_AGENT_ID,
      cwd,
      undefined, // no initial task
      CONCIERGE_MODEL,
      CONCIERGE_SYSTEM_PROMPT,
      undefined, // no env vars
      54,        // cols — sized for the 400px sidebar
      30,        // rows
    );

    // Guard against the double pty-exit event (Rust emits from two threads).
    let exitHandled = false;
    exitUnlisten = await listen(`pty-exit-${CONCIERGE_AGENT_ID}`, () => {
      if (exitHandled) return;
      exitHandled = true;
      console.warn("[concierge] PTY exited unexpectedly, will respawn in 5s");
      useAppStore.getState().setConciergeStatus("error");
      scheduleRespawn(cwd);
    });

    store.setConciergeStatus("ready");
  } catch (err) {
    console.error("[concierge] spawn failed:", err);
    store.setConciergeStatus("error");
    scheduleRespawn(cwd);
  }
}

export async function killConcierge(): Promise<void> {
  if (respawnTimer) {
    clearTimeout(respawnTimer);
    respawnTimer = null;
  }
  if (exitUnlisten) {
    exitUnlisten();
    exitUnlisten = null;
  }
  try {
    await killAgent(CONCIERGE_AGENT_ID);
  } catch {
    // already dead — fine
  }
  useAppStore.getState().setConciergeStatus("off");
}

function scheduleRespawn(cwd: string): void {
  if (respawnTimer) return;
  respawnTimer = setTimeout(() => {
    respawnTimer = null;
    spawnConcierge(cwd).catch(() => {});
  }, RESPAWN_DELAY_MS);
}

/* ------------------------------------------------------------------ */
/* Communication                                                        */
/* ------------------------------------------------------------------ */

export async function sendToConcierge(text: string): Promise<boolean> {
  return writeToAgent(CONCIERGE_AGENT_ID, text);
}

/**
 * Request a prompt rewrite from the concierge.
 * Writes `[REWRITE] <prompt>` and polls for the cleaned response.
 */
export async function requestRewrite(prompt: string): Promise<string> {
  const store = useAppStore.getState();
  store.setConciergeStatus("processing");

  const startCounter = getPtyOutputBufferLength(CONCIERGE_AGENT_ID);
  await writeToAgent(CONCIERGE_AGENT_ID, `[REWRITE] ${prompt}`);

  return new Promise<string>((resolve) => {
    let lastOutput = "";
    let lastChangeTime = Date.now();
    const deadline = Date.now() + REWRITE_TIMEOUT_MS;

    const timer = setInterval(() => {
      const raw = getCleanOutputSince(CONCIERGE_AGENT_ID, startCounter);
      // Apply aggressive TUI artifact stripping (same as node-graph response panels)
      const current = cleanPtyOutput(raw);

      if (current !== lastOutput) {
        lastOutput = current;
        lastChangeTime = Date.now();
      }

      const silent = Date.now() - lastChangeTime >= REWRITE_STALE_MS;
      const timedOut = Date.now() >= deadline;

      if ((silent && lastOutput.trim()) || timedOut) {
        clearInterval(timer);
        useAppStore.getState().setConciergeStatus("ready");
        resolve(lastOutput.trim() || prompt); // fallback to original if empty
      }
    }, REWRITE_POLL_MS);
  });
}

/**
 * Get cleaned concierge output since a given counter value.
 */
export function getConciergeOutputSince(sinceCounter: number): string {
  return getCleanOutputSince(CONCIERGE_AGENT_ID, sinceCounter);
}

/**
 * Get current output buffer length (monotonic counter).
 */
export function getConciergeOutputCounter(): number {
  return getPtyOutputBufferLength(CONCIERGE_AGENT_ID);
}
