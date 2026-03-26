export type AgentStatus = "starting" | "active" | "idle" | "error" | "stopped" | "suspended";
export type AgentRole = "boss" | "worker";
export type AgentModel = "opus" | "sonnet" | "haiku";
export type PermissionMode = "auto" | "interactive";

export interface AgentConfig {
  model: AgentModel;
  permissionMode: PermissionMode;
  maxTurns: number | null;       // null = unlimited
  customSystemPrompt: string;    // additional instructions appended to system prompt
  allowedTools: string[];        // tool whitelist — empty = all tools allowed
  disallowedTools: string[];     // tool blocklist
}

export interface SwarmNode {
  id: string;
  name: string;
  directory: string; // required project directory for this node
  color: string;
  position: [number, number, number];
  agents: string[]; // agent IDs
  createdAt: string;
}

export interface CrossSpeakLink {
  id: string;
  nodeA: string; // node ID
  nodeB: string; // node ID
  createdAt: string;
}

export interface Agent {
  id: string;
  peerId: string | null; // from broker, once registered
  nodeId: string;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  summary: string;
  cwd: string;
  pid: number | null;
  messages: AgentMessage[];
  diff: DiffEntry | null;
  diffs: DiffEntry[];     // all changed files
  config: AgentConfig;
  sessionId: string | null; // Claude Code session ID for --resume
  createdAt: string;
  lastSeen: string;
}

export interface AgentMessage {
  id: string;
  fromId: string;
  toId: string;
  text: string;
  sentAt: string;
  direction: "inbound" | "outbound";
}

export interface DiffEntry {
  fileName: string;
  language: string;
  original: string;
  modified: string;
  timestamp: string;
}

export interface BrokerStatus {
  connected: boolean;
  peerCount: number;
  nodeCount: number;
  url: string;
}

export interface ConnectionEdge {
  from: string; // agent ID
  to: string;   // agent ID
  active: boolean;
  lastMessageAt: string;
}

export interface ActivityEvent {
  id: string;
  type: "message" | "agent_spawn" | "agent_stop" | "diff" | "system" | "cross_speak";
  agentId?: string;
  agentName?: string;
  nodeId?: string;
  nodeName?: string;
  text: string;
  timestamp: string;
}

/* ------------------------------------------------------------------ */
/* Concierge Agent Layer                                                */
/* ------------------------------------------------------------------ */

export type ConciergeStatus = "off" | "starting" | "ready" | "processing" | "error";

export interface ConciergeMessage {
  id: string;
  role: "user" | "concierge";
  text: string;
  timestamp: string;
}

/* ------------------------------------------------------------------ */
/* Permission Prompts                                                    */
/* ------------------------------------------------------------------ */

export type PromptKind = "permission" | "question";

export interface PromptOption {
  index: number;       // 1-based number as shown in the terminal
  label: string;       // option text (e.g. "Red")
  description?: string; // sub-text (e.g. "Bold and energetic")
}

export interface PermissionPrompt {
  id: string;
  agentId: string;
  agentName: string;
  kind: PromptKind;
  // For "permission" kind
  toolName: string;    // "Bash", "Edit", "Read", etc.
  action: string;      // the command or file path
  // For "question" kind (AskUserQuestion)
  question: string;    // the question text
  options: PromptOption[]; // clickable choices
  // Common
  rawText: string;     // full matched text for debugging
  detectedAt: number;  // timestamp (Date.now())
}

export interface ConciergeContextSnapshot {
  activeNodes: { id: string; name: string; agentCount: number }[];
  agents: { id: string; name: string; status: AgentStatus; role: AgentRole }[];
  recentActivity: string[];
  timestamp: string;
}

/** Pluggable context provider — swap in a custom implementation via setContextProvider() */
export interface IConciergeContextProvider {
  buildSnapshot(): ConciergeContextSnapshot;
  formatForInjection(snapshot: ConciergeContextSnapshot): string;
  start(intervalMs?: number): void;
  startKnowledgeWatcherOnly(): void;
  stop(): void;
  injectNow(): Promise<void>;
}
