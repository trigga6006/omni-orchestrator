/**
 * Three-Layer Context Provider — inspired by OpenCrew's knowledge distillation.
 *
 * Layer 0 (Raw): Ring buffer of activity events. Never injected directly.
 * Layer 1 (Session Summary): Algorithmically compressed current state + recent
 *   transitions. Injected into the concierge every interval.
 * Layer 2 (Persistent Knowledge): Cross-session patterns, scars, and principles.
 *   Stored in localStorage, loaded on startup, injected once + on change.
 *
 * The concierge can contribute to Layer 2 by outputting [KNOWLEDGE] lines,
 * which we detect and persist.
 */

import { useAppStore } from "../stores/appStore";
import { sendToConcierge, CONCIERGE_AGENT_ID } from "./concierge";
import { isAgentRunning, getCleanOutputSince, getPtyOutputBufferLength } from "./agentManager";
import type {
  IConciergeContextProvider,
  ConciergeContextSnapshot,
  ActivityEvent,
} from "../types";

/* ------------------------------------------------------------------ */
/* Layer 2: Persistent Knowledge Store                                  */
/* ------------------------------------------------------------------ */

const KNOWLEDGE_STORAGE_KEY = "omni-concierge-knowledge";
const MAX_KNOWLEDGE_ENTRIES = 50;

export interface KnowledgeEntry {
  id: string;
  type: "pattern" | "scar" | "principle";
  content: string;
  boundary: string; // when this applies
  createdAt: string;
}

function loadKnowledge(): KnowledgeEntry[] {
  try {
    const raw = localStorage.getItem(KNOWLEDGE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveKnowledge(entries: KnowledgeEntry[]): void {
  localStorage.setItem(
    KNOWLEDGE_STORAGE_KEY,
    JSON.stringify(entries.slice(-MAX_KNOWLEDGE_ENTRIES)),
  );
}

export function addKnowledgeEntry(entry: Omit<KnowledgeEntry, "id" | "createdAt">): void {
  const entries = loadKnowledge();
  entries.push({
    ...entry,
    id: Math.random().toString(36).slice(2, 10),
    createdAt: new Date().toISOString(),
  });
  saveKnowledge(entries);
}

export function getKnowledge(): KnowledgeEntry[] {
  return loadKnowledge();
}

export function clearKnowledge(): void {
  localStorage.removeItem(KNOWLEDGE_STORAGE_KEY);
}

/* ------------------------------------------------------------------ */
/* Layer 1: Session Summary Compression                                 */
/* ------------------------------------------------------------------ */

interface AgentTransition {
  name: string;
  nodeId: string;
  nodeName: string;
  transitions: string[]; // e.g. ["starting→active", "active: changed 3 files"]
  currentStatus: string;
  role: string;
}

/**
 * Compress recent activity events into a grouped, deduped summary.
 * This is purely algorithmic — no LLM calls.
 */
function compressEvents(events: ActivityEvent[]): string {
  if (events.length === 0) return "none";

  // Group by agent
  const byAgent = new Map<string, ActivityEvent[]>();
  const systemEvents: string[] = [];

  for (const e of events) {
    if (e.agentId) {
      const key = e.agentName || e.agentId;
      if (!byAgent.has(key)) byAgent.set(key, []);
      byAgent.get(key)!.push(e);
    } else {
      systemEvents.push(e.text);
    }
  }

  const lines: string[] = [];

  // Collapse per-agent events into transition summaries
  for (const [name, agentEvents] of byAgent) {
    const types = new Map<string, number>();
    for (const e of agentEvents) {
      types.set(e.type, (types.get(e.type) || 0) + 1);
    }

    const parts: string[] = [];
    if (types.has("agent_spawn")) parts.push("spawned");
    if (types.has("agent_stop")) parts.push("stopped");

    const msgCount = types.get("message") || 0;
    if (msgCount > 0) parts.push(`${msgCount} msg${msgCount > 1 ? "s" : ""}`);

    const diffCount = types.get("diff") || 0;
    if (diffCount > 0) parts.push(`${diffCount} file change${diffCount > 1 ? "s" : ""}`);

    if (parts.length > 0) {
      lines.push(`${name}: ${parts.join(", ")}`);
    }
  }

  // Dedupe system events
  const uniqueSystem = [...new Set(systemEvents)];
  if (uniqueSystem.length > 0) {
    lines.push(`system: ${uniqueSystem.slice(-3).join("; ")}`);
  }

  return lines.join(" | ") || "none";
}

/**
 * Build a signal score for recent events (0-3).
 * Higher score = more noteworthy changes since last injection.
 */
function computeSignal(events: ActivityEvent[]): number {
  if (events.length === 0) return 0;

  let score = 0;
  for (const e of events) {
    if (e.type === "agent_spawn" || e.type === "agent_stop") score += 2;
    else if (e.type === "diff") score += 1;
    else if (e.type === "cross_speak") score += 2;
    else if (e.type === "message") score += 0.3;
  }

  if (score >= 6) return 3;
  if (score >= 3) return 2;
  if (score >= 1) return 1;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Three-Layer Provider Implementation                                  */
/* ------------------------------------------------------------------ */

export class ThreeLayerContextProvider implements IConciergeContextProvider {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastInjectedHash = "";
  private lastEventCount = 0;
  private lastKnowledgeHash = "";
  private knowledgeInjected = false;
  private outputWatchTimer: ReturnType<typeof setInterval> | null = null;
  private lastWatchedCounter = 0;

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
      .slice(-20)
      .map((e) => e.text);

    return {
      activeNodes,
      agents: activeAgents,
      recentActivity,
      timestamp: new Date().toISOString(),
    };
  }

  formatForInjection(snapshot: ConciergeContextSnapshot): string {
    const { activityLog } = useAppStore.getState();
    const recentEvents = activityLog.slice(-20);
    const signal = computeSignal(recentEvents.slice(this.lastEventCount));

    // Layer 1: Compressed state
    const nodes = snapshot.activeNodes
      .map((n) => `${n.name} (${n.agentCount} agents)`)
      .join(", ") || "none";

    const agents = snapshot.agents
      .map((a) => `${a.name} [${a.role}/${a.status}]`)
      .join(", ") || "none";

    const history = compressEvents(recentEvents);

    const lines = [
      `[CONTEXT_UPDATE @ ${snapshot.timestamp} | signal:${signal}]`,
      `NODES: ${nodes}`,
      `AGENTS: ${agents}`,
      `ACTIVITY: ${history}`,
    ];

    // Layer 2: Append knowledge on first injection or when changed
    const knowledge = loadKnowledge();
    const knowledgeHash = simpleHash(JSON.stringify(knowledge));

    if (knowledge.length > 0 && (!this.knowledgeInjected || knowledgeHash !== this.lastKnowledgeHash)) {
      lines.push(`KNOWLEDGE (${knowledge.length} entries):`);
      for (const k of knowledge.slice(-10)) {
        lines.push(`  [${k.type}] ${k.content} (when: ${k.boundary})`);
      }
      this.knowledgeInjected = true;
      this.lastKnowledgeHash = knowledgeHash;
    }

    this.lastEventCount = activityLog.length;

    return lines.join("\n");
  }

  /**
   * Legacy start method — kept for interface compat but no longer starts a timer.
   * Use injectNow() directly from action call sites.
   */
  start(_intervalMs?: number): void {
    this.stop();
    this.startKnowledgeWatcher();
  }

  /**
   * Start only the knowledge watcher (parses [KNOWLEDGE] lines from concierge output).
   * Does NOT start the context injection timer — context is pushed on-demand.
   */
  startKnowledgeWatcherOnly(): void {
    if (this.outputWatchTimer) return; // already running
    this.startKnowledgeWatcher();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.outputWatchTimer) {
      clearInterval(this.outputWatchTimer);
      this.outputWatchTimer = null;
    }
  }

  async injectNow(): Promise<void> {
    if (!isAgentRunning(CONCIERGE_AGENT_ID)) return;

    const snapshot = this.buildSnapshot();

    // Skip injection if signal is 0 (nothing noteworthy changed)
    const { activityLog } = useAppStore.getState();
    const newEvents = activityLog.slice(this.lastEventCount);
    const signal = computeSignal(newEvents);

    // Always inject on first run or when knowledge changed, otherwise respect signal
    const knowledgeHash = simpleHash(JSON.stringify(loadKnowledge()));
    const knowledgeChanged = knowledgeHash !== this.lastKnowledgeHash;

    if (signal === 0 && !knowledgeChanged && this.lastInjectedHash !== "") {
      return; // nothing noteworthy to report
    }

    const formatted = this.formatForInjection(snapshot);
    const hash = simpleHash(formatted);

    if (hash === this.lastInjectedHash) return;
    this.lastInjectedHash = hash;

    await sendToConcierge(formatted);
  }

  /**
   * Watch the concierge's output for [KNOWLEDGE] entries.
   * When detected, parse and persist to Layer 2.
   */
  private startKnowledgeWatcher(): void {
    this.lastWatchedCounter = getPtyOutputBufferLength(CONCIERGE_AGENT_ID);

    this.outputWatchTimer = setInterval(() => {
      if (!isAgentRunning(CONCIERGE_AGENT_ID)) return;

      const output = getCleanOutputSince(CONCIERGE_AGENT_ID, this.lastWatchedCounter);
      this.lastWatchedCounter = getPtyOutputBufferLength(CONCIERGE_AGENT_ID);

      if (!output.includes("[KNOWLEDGE]")) return;

      // Parse [KNOWLEDGE] lines
      const lines = output.split("\n");
      for (const line of lines) {
        const match = line.match(
          /\[KNOWLEDGE\]\s*\[(pattern|scar|principle)\]\s*(.+?)(?:\s*\(when:\s*(.+?)\))?$/i,
        );
        if (match) {
          addKnowledgeEntry({
            type: match[1].toLowerCase() as KnowledgeEntry["type"],
            content: match[2].trim(),
            boundary: match[3]?.trim() || "general",
          });
        }
      }
    }, 10_000); // check every 10s
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
