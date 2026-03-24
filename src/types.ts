export type AgentStatus = "starting" | "active" | "idle" | "error" | "stopped";

export interface SwarmNode {
  id: string;
  name: string;
  color: string;
  position: [number, number, number];
  agents: string[]; // agent IDs
  createdAt: string;
}

export interface Agent {
  id: string;
  peerId: string | null; // from broker, once registered
  nodeId: string;
  name: string;
  status: AgentStatus;
  summary: string;
  cwd: string;
  pid: number | null;
  messages: AgentMessage[];
  diff: DiffEntry | null;
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
