/**
 * Pluggable context feed for the Concierge agent.
 *
 * The default implementation reads Zustand store state and injects compact
 * summaries into the concierge PTY at a configurable interval. A hash-based
 * dedup mechanism prevents redundant injections when state hasn't changed.
 *
 * To swap in a custom provider (e.g. a third-party memory algorithm):
 *   import { setContextProvider } from "./conciergeContextProvider";
 *   setContextProvider(new MyCustomProvider());
 */

import { useAppStore } from "../stores/appStore";
import { sendToConcierge, CONCIERGE_AGENT_ID } from "./concierge";
import { isAgentRunning } from "./agentManager";
import { ThreeLayerContextProvider } from "./threeLayerContextProvider";
import type { IConciergeContextProvider, ConciergeContextSnapshot } from "../types";

/* ------------------------------------------------------------------ */
/* Default implementation                                               */
/* ------------------------------------------------------------------ */

class DefaultConciergeContextProvider implements IConciergeContextProvider {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastHash = "";

  buildSnapshot(): ConciergeContextSnapshot {
    const { nodes, agents, activityLog } = useAppStore.getState();

    const activeNodes = nodes
      .map((n) => ({
        id: n.id,
        name: n.name,
        agentCount: n.agents.length,
      }))
      .filter((n) => n.agentCount > 0);

    const activeAgents = agents
      .filter((a) => a.id !== CONCIERGE_AGENT_ID && a.status !== "stopped")
      .map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        role: a.role,
      }));

    const recentActivity = activityLog
      .slice(-10)
      .map((e) => e.text);

    return {
      activeNodes,
      agents: activeAgents,
      recentActivity,
      timestamp: new Date().toISOString(),
    };
  }

  formatForInjection(snapshot: ConciergeContextSnapshot): string {
    const nodes = snapshot.activeNodes
      .map((n) => `${n.name} (${n.agentCount} agents)`)
      .join(", ") || "none";

    const agents = snapshot.agents
      .map((a) => `${a.name} (${a.role}, ${a.status})`)
      .join(", ") || "none";

    const recent = snapshot.recentActivity.length > 0
      ? snapshot.recentActivity.map((r) => `"${r}"`).join(" | ")
      : "none";

    return [
      `[CONTEXT_UPDATE @ ${snapshot.timestamp}]`,
      `NODES: ${nodes}`,
      `AGENTS: ${agents}`,
      `RECENT: ${recent}`,
    ].join("\n");
  }

  start(_intervalMs?: number): void {
    this.stop();
  }

  startKnowledgeWatcherOnly(): void {
    // Default provider has no knowledge watcher — no-op
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async injectNow(): Promise<void> {
    if (!isAgentRunning(CONCIERGE_AGENT_ID)) return;

    const snapshot = this.buildSnapshot();
    const formatted = this.formatForInjection(snapshot);

    // Simple hash for dedup (nodes + agents portion only)
    const hashInput = JSON.stringify({
      n: snapshot.activeNodes,
      a: snapshot.agents,
    });
    const hash = simpleHash(hashInput);

    if (hash === this.lastHash) return; // nothing changed
    this.lastHash = hash;

    await sendToConcierge(formatted);
  }
}

/* ------------------------------------------------------------------ */
/* Hash utility                                                         */
/* ------------------------------------------------------------------ */

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/* ------------------------------------------------------------------ */
/* Provider factory                                                     */
/* ------------------------------------------------------------------ */

let activeProvider: IConciergeContextProvider | null = null;

export function getContextProvider(): IConciergeContextProvider {
  if (!activeProvider) {
    activeProvider = new ThreeLayerContextProvider();
  }
  return activeProvider;
}

/** Swap in a custom context provider (stops the previous one). */
export function setContextProvider(provider: IConciergeContextProvider): void {
  if (activeProvider) activeProvider.stop();
  activeProvider = provider;
}

/**
 * Push a context update to the concierge NOW.
 * Call this from action sites (agent spawn, node creation, etc.)
 * instead of relying on a timer.
 */
export function pushConciergeContext(): void {
  getContextProvider().injectNow().catch(() => {});
}
