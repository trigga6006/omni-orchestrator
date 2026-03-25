// ---- Peer types (compatible with claude-peers-mcp) ----

export type PeerId = string;

export interface Peer {
  id: PeerId;
  pid: number;
  cwd: string;
  git_root: string | null;
  tty: string | null;
  summary: string;
  node_id: string | null; // swarm extension
  registered_at: string;
  last_seen: string;
}

export interface Message {
  id: number;
  from_id: PeerId;
  to_id: PeerId;
  text: string;
  sent_at: string;
  delivered: boolean;
}

// ---- Swarm Node types ----

export interface SwarmNode {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

// ---- Broker API requests ----

export interface RegisterRequest {
  pid: number;
  cwd: string;
  git_root: string | null;
  tty: string | null;
  summary: string;
  node_id?: string | null;
}

export interface RegisterResponse {
  id: PeerId;
}

export interface HeartbeatRequest {
  id: PeerId;
}

export interface SetSummaryRequest {
  id: PeerId;
  summary: string;
}

export interface ListPeersRequest {
  scope: "machine" | "directory" | "repo" | "node";
  cwd: string;
  git_root: string | null;
  node_id?: string;
  exclude_id?: PeerId;
}

export interface SendMessageRequest {
  from_id: PeerId;
  to_id: PeerId;
  text: string;
}

export interface BroadcastRequest {
  from_id: PeerId;
  node_id: string;
  text: string;
}

export interface PollMessagesRequest {
  id: PeerId;
}

export interface PollMessagesResponse {
  messages: Message[];
}

// ---- Swarm Node requests ----

export interface CreateNodeRequest {
  name: string;
  color: string;
}

export interface DeleteNodeRequest {
  id: string;
}

export interface AssignNodeRequest {
  peer_id: PeerId;
  node_id: string | null;
}

export interface AddCrossSpeakLinkRequest {
  id: string;
  node_a: string;
  node_b: string;
}

export interface RemoveCrossSpeakLinkRequest {
  id: string;
}

export interface SpawnAgentRequest {
  node_id: string;
  name: string;
  task: string;
  model?: string; // "opus", "sonnet", "haiku" — passed to claude --model
  requester_peer_id?: PeerId; // boss agent's peer ID (so sub-agents know who to report to)
}

// ---- WebSocket events (broker -> UI) ----

export type WsEvent =
  | { type: "peer_registered"; peer: Peer }
  | { type: "peer_unregistered"; peer_id: PeerId }
  | { type: "message_sent"; from_id: PeerId; to_id: PeerId; text: string; sent_at: string }
  | { type: "message_broadcast"; from_id: PeerId; node_id: string; text: string; sent_at: string }
  | { type: "summary_updated"; peer_id: PeerId; summary: string }
  | { type: "node_created"; node: SwarmNode }
  | { type: "node_deleted"; node_id: string }
  | { type: "peer_assigned"; peer_id: PeerId; node_id: string | null }
  | { type: "sync_state"; peers: Peer[]; nodes: SwarmNode[]; peer_count: number; crossspeak_links?: { id: string; node_a: string; node_b: string; created_at: string }[] }
  | { type: "spawn_request"; node_id: string; name: string; task: string; model?: string; requester_peer_id?: PeerId }
  | { type: "crossspeak_link_added"; id: string; node_a: string; node_b: string }
  | { type: "crossspeak_link_removed"; id: string };
