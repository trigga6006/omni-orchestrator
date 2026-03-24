/**
 * Broker HTTP API client.
 * All communication with the broker goes through here.
 */

const BROKER_URL = "http://127.0.0.1:7899";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BROKER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Broker error: ${res.status}`);
  }
  return res.json();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BROKER_URL}${path}`);
  if (!res.ok) throw new Error(`Broker GET ${path} failed: ${res.status}`);
  return res.json();
}

// ---- Peer lifecycle ----

export interface RegisterParams {
  pid: number;
  cwd: string;
  git_root: string | null;
  tty: string | null;
  summary: string;
  node_id?: string | null;
}

export async function registerPeer(params: RegisterParams): Promise<{ id: string }> {
  return post("/register", params);
}

export async function unregisterPeer(id: string): Promise<void> {
  await post("/unregister", { id });
}

export async function heartbeat(id: string): Promise<void> {
  await post("/heartbeat", { id });
}

export async function setSummary(id: string, summary: string): Promise<void> {
  await post("/set-summary", { id, summary });
}

export async function assignNode(peerId: string, nodeId: string | null): Promise<void> {
  await post("/assign-node", { peer_id: peerId, node_id: nodeId });
}

// ---- Messaging ----

export interface BrokerMessage {
  id: number;
  from_id: string;
  to_id: string;
  text: string;
  sent_at: string;
  delivered: boolean;
}

export async function sendMessage(
  fromId: string,
  toId: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  return post("/send-message", { from_id: fromId, to_id: toId, text });
}

export async function pollMessages(
  peerId: string
): Promise<{ messages: BrokerMessage[] }> {
  return post("/poll-messages", { id: peerId });
}

export async function broadcastToNode(
  fromId: string,
  nodeId: string,
  text: string
): Promise<{ ok: boolean; sent_to: number }> {
  return post("/broadcast", { from_id: fromId, node_id: nodeId, text });
}

export async function routeMessage(
  text: string,
  nodeId?: string
): Promise<{ ok: boolean; routed_to: string; peer_id: string }> {
  return post("/route-message", { text, node_id: nodeId });
}

// ---- Diff ----

export interface DiffFile {
  fileName: string;
  patch: string;
  original: string;
  modified: string;
}

export async function getAgentDiff(
  peerId: string
): Promise<{ files: DiffFile[] }> {
  return post("/get-diff", { peer_id: peerId });
}

// ---- Nodes ----

export async function createNodeOnBroker(
  name: string,
  color: string
): Promise<{ id: string; name: string; color: string; created_at: string }> {
  return post("/create-node", { name, color });
}

export async function deleteNodeOnBroker(id: string): Promise<void> {
  await post("/delete-node", { id });
}

// ---- Queries ----

export async function listPeers(): Promise<unknown[]> {
  return get("/peers");
}

export async function healthCheck(): Promise<{ status: string; peers: number }> {
  return get("/health");
}
