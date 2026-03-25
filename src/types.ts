export type AgentStatus = "starting" | "active" | "idle" | "error" | "stopped";
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
