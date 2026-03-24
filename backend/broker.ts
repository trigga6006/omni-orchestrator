#!/usr/bin/env bun
/**
 * Claude Swarm — Extended Broker
 *
 * Extends the claude-peers-mcp broker with:
 * - Swarm nodes (logical groups of agents)
 * - WebSocket push to the Tauri UI
 * - Broadcast messaging to all agents in a node
 * - Node CRUD operations
 *
 * Run: bun broker.ts
 */

import { Database } from "bun:sqlite";
import type {
  PeerId,
  Peer,
  Message,
  SwarmNode,
  RegisterRequest,
  RegisterResponse,
  HeartbeatRequest,
  SetSummaryRequest,
  ListPeersRequest,
  SendMessageRequest,
  BroadcastRequest,
  PollMessagesRequest,
  PollMessagesResponse,
  CreateNodeRequest,
  DeleteNodeRequest,
  AssignNodeRequest,
  WsEvent,
} from "./shared/types.ts";

const PORT = parseInt(process.env.CLAUDE_PEERS_PORT ?? "7899", 10);
const DB_PATH =
  process.env.CLAUDE_PEERS_DB ??
  `${process.env.HOME ?? process.env.USERPROFILE}/.claude-swarm.db`;

// ---- Database ----

const db = new Database(DB_PATH);
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA busy_timeout = 3000");

db.run(`
  CREATE TABLE IF NOT EXISTS peers (
    id TEXT PRIMARY KEY,
    pid INTEGER NOT NULL,
    cwd TEXT NOT NULL,
    git_root TEXT,
    tty TEXT,
    summary TEXT NOT NULL DEFAULT '',
    node_id TEXT,
    registered_at TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE SET NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    text TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#06b6d4',
    created_at TEXT NOT NULL
  )
`);

// ---- Prepared statements ----

const insertPeer = db.prepare(
  `INSERT INTO peers (id, pid, cwd, git_root, tty, summary, node_id, registered_at, last_seen)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const updateLastSeen = db.prepare(`UPDATE peers SET last_seen = ? WHERE id = ?`);
const updateSummary = db.prepare(`UPDATE peers SET summary = ? WHERE id = ?`);
const updatePeerNode = db.prepare(`UPDATE peers SET node_id = ? WHERE id = ?`);
const deletePeer = db.prepare(`DELETE FROM peers WHERE id = ?`);
const selectAllPeers = db.prepare(`SELECT * FROM peers`);
const selectPeersByDir = db.prepare(`SELECT * FROM peers WHERE cwd = ?`);
const selectPeersByGit = db.prepare(`SELECT * FROM peers WHERE git_root = ?`);
const selectPeersByNode = db.prepare(`SELECT * FROM peers WHERE node_id = ?`);

const insertMessage = db.prepare(
  `INSERT INTO messages (from_id, to_id, text, sent_at, delivered) VALUES (?, ?, ?, ?, 0)`
);
const selectUndelivered = db.prepare(
  `SELECT * FROM messages WHERE to_id = ? AND delivered = 0 ORDER BY sent_at ASC`
);
const markDelivered = db.prepare(`UPDATE messages SET delivered = 1 WHERE id = ?`);

const insertNode = db.prepare(
  `INSERT INTO nodes (id, name, color, created_at) VALUES (?, ?, ?, ?)`
);
const deleteNode = db.prepare(`DELETE FROM nodes WHERE id = ?`);
const selectAllNodes = db.prepare(`SELECT * FROM nodes`);

// ---- Stale peer cleanup ----

function cleanStalePeers() {
  const peers = db.query("SELECT id, pid FROM peers").all() as { id: string; pid: number }[];
  for (const peer of peers) {
    try {
      process.kill(peer.pid, 0);
    } catch {
      deletePeer.run(peer.id);
      db.run("DELETE FROM messages WHERE to_id = ? AND delivered = 0", [peer.id]);
      broadcast({ type: "peer_unregistered", peer_id: peer.id });
    }
  }
}

cleanStalePeers();
setInterval(cleanStalePeers, 30_000);

// ---- ID generation ----

function genId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// ---- WebSocket clients ----

const wsClients = new Set<{ send: (data: string) => void }>();

function broadcast(event: WsEvent) {
  const data = JSON.stringify(event);
  for (const ws of wsClients) {
    try {
      ws.send(data);
    } catch {
      wsClients.delete(ws);
    }
  }
}

// ---- Request handlers ----

function handleRegister(body: RegisterRequest): RegisterResponse {
  const id = genId();
  const now = new Date().toISOString();

  // Remove existing registration for this PID
  const existing = db.query("SELECT id FROM peers WHERE pid = ?").get(body.pid) as {
    id: string;
  } | null;
  if (existing) {
    deletePeer.run(existing.id);
  }

  insertPeer.run(
    id,
    body.pid,
    body.cwd,
    body.git_root,
    body.tty,
    body.summary,
    body.node_id ?? null,
    now,
    now
  );

  const peer: Peer = {
    id,
    pid: body.pid,
    cwd: body.cwd,
    git_root: body.git_root,
    tty: body.tty,
    summary: body.summary,
    node_id: body.node_id ?? null,
    registered_at: now,
    last_seen: now,
  };

  broadcast({ type: "peer_registered", peer });
  return { id };
}

function handleHeartbeat(body: HeartbeatRequest): void {
  updateLastSeen.run(new Date().toISOString(), body.id);
}

function handleSetSummary(body: SetSummaryRequest): void {
  updateSummary.run(body.summary, body.id);
  broadcast({ type: "summary_updated", peer_id: body.id, summary: body.summary });
}

function handleListPeers(body: ListPeersRequest): Peer[] {
  let peers: Peer[];
  switch (body.scope) {
    case "node":
      peers = body.node_id
        ? (selectPeersByNode.all(body.node_id) as Peer[])
        : (selectAllPeers.all() as Peer[]);
      break;
    case "directory":
      peers = selectPeersByDir.all(body.cwd) as Peer[];
      break;
    case "repo":
      peers = body.git_root
        ? (selectPeersByGit.all(body.git_root) as Peer[])
        : (selectPeersByDir.all(body.cwd) as Peer[]);
      break;
    default:
      peers = selectAllPeers.all() as Peer[];
  }

  if (body.exclude_id) {
    peers = peers.filter((p) => p.id !== body.exclude_id);
  }

  // Verify alive (Windows-compatible: try/catch on process.kill)
  return peers.filter((p) => {
    try {
      process.kill(p.pid, 0);
      return true;
    } catch {
      deletePeer.run(p.id);
      return false;
    }
  });
}

function handleSendMessage(body: SendMessageRequest): { ok: boolean; error?: string } {
  const target = db.query("SELECT id FROM peers WHERE id = ?").get(body.to_id) as {
    id: string;
  } | null;
  if (!target) return { ok: false, error: `Peer ${body.to_id} not found` };

  const now = new Date().toISOString();
  insertMessage.run(body.from_id, body.to_id, body.text, now);
  broadcast({
    type: "message_sent",
    from_id: body.from_id,
    to_id: body.to_id,
    text: body.text,
    sent_at: now,
  });
  return { ok: true };
}

function handleBroadcast(body: BroadcastRequest): { ok: boolean; sent_to: number } {
  const peers = selectPeersByNode.all(body.node_id) as Peer[];
  const now = new Date().toISOString();
  let sentTo = 0;
  for (const peer of peers) {
    if (peer.id !== body.from_id) {
      insertMessage.run(body.from_id, peer.id, body.text, now);
      sentTo++;
    }
  }
  broadcast({
    type: "message_broadcast",
    from_id: body.from_id,
    node_id: body.node_id,
    text: body.text,
    sent_at: now,
  });
  return { ok: true, sent_to: sentTo };
}

function handlePollMessages(body: PollMessagesRequest): PollMessagesResponse {
  const messages = selectUndelivered.all(body.id) as Message[];
  for (const msg of messages) markDelivered.run(msg.id);
  return { messages };
}

function handleUnregister(body: { id: string }): void {
  deletePeer.run(body.id);
  broadcast({ type: "peer_unregistered", peer_id: body.id });
}

// ---- Node handlers ----

function handleCreateNode(body: CreateNodeRequest): SwarmNode {
  const id = genId();
  const now = new Date().toISOString();
  insertNode.run(id, body.name, body.color, now);
  const node: SwarmNode = { id, name: body.name, color: body.color, created_at: now };
  broadcast({ type: "node_created", node });
  return node;
}

function handleDeleteNode(body: DeleteNodeRequest): void {
  deleteNode.run(body.id);
  // Peers in that node get node_id set to NULL via ON DELETE SET NULL
  broadcast({ type: "node_deleted", node_id: body.id });
}

function handleAssignNode(body: AssignNodeRequest): void {
  updatePeerNode.run(body.node_id, body.peer_id);
  broadcast({ type: "peer_assigned", peer_id: body.peer_id, node_id: body.node_id });
}

function handleSync(): WsEvent {
  const peers = selectAllPeers.all() as Peer[];
  const nodes = selectAllNodes.all() as SwarmNode[];
  return { type: "sync_state", peers, nodes, peer_count: peers.length };
}

// ---- Diff handler ----

interface DiffFile {
  fileName: string;
  patch: string;
  original: string;
  modified: string;
}

async function handleGetDiff(body: { peer_id: string }): Promise<{ files: DiffFile[] }> {
  const peer = db.query("SELECT * FROM peers WHERE id = ?").get(body.peer_id) as Peer | null;
  if (!peer) return { files: [] };

  const cwd = peer.cwd;

  try {
    // Get list of changed files (staged + unstaged)
    const diffNameOnly = Bun.spawnSync(["git", "diff", "--name-only", "HEAD"], { cwd });
    const fileNames = diffNameOnly.stdout.toString().trim().split("\n").filter(Boolean);

    if (fileNames.length === 0) {
      // Also check for untracked files
      const untracked = Bun.spawnSync(["git", "ls-files", "--others", "--exclude-standard"], { cwd });
      const untrackedFiles = untracked.stdout.toString().trim().split("\n").filter(Boolean);

      if (untrackedFiles.length === 0) return { files: [] };

      // For untracked files, original is empty, modified is the file content
      const files: DiffFile[] = [];
      for (const fileName of untrackedFiles.slice(0, 20)) {
        try {
          const content = await Bun.file(`${cwd}/${fileName}`).text();
          files.push({
            fileName,
            patch: `+++ new file: ${fileName}`,
            original: "",
            modified: content,
          });
        } catch {
          // skip files we can't read
        }
      }
      return { files };
    }

    const files: DiffFile[] = [];

    for (const fileName of fileNames.slice(0, 20)) {
      try {
        // Get the original version from HEAD
        const origProc = Bun.spawnSync(["git", "show", `HEAD:${fileName}`], { cwd });
        const original = origProc.exitCode === 0 ? origProc.stdout.toString() : "";

        // Get the current working version
        let modified = "";
        try {
          modified = await Bun.file(`${cwd}/${fileName}`).text();
        } catch {
          modified = ""; // file was deleted
        }

        // Get the unified diff patch
        const patchProc = Bun.spawnSync(["git", "diff", "HEAD", "--", fileName], { cwd });
        const patch = patchProc.stdout.toString();

        files.push({ fileName, patch, original, modified });
      } catch {
        // skip files we can't process
      }
    }

    return { files };
  } catch (err) {
    console.error("[broker] git diff failed:", err);
    return { files: [] };
  }
}

// ---- Route message handler ----
// Picks the best agent in a node (or globally) to handle a user message.

function handleRouteMessage(body: {
  text: string;
  node_id?: string;
}): { ok: boolean; routed_to: string; peer_id: string } | { ok: false; error: string } {
  let peers: Peer[];

  if (body.node_id) {
    peers = selectPeersByNode.all(body.node_id) as Peer[];
  } else {
    peers = selectAllPeers.all() as Peer[];
  }

  // Filter to alive peers only
  peers = peers.filter((p) => {
    try {
      process.kill(p.pid, 0);
      return true;
    } catch {
      return false;
    }
  });

  if (peers.length === 0) {
    return { ok: false, error: "No active agents available" };
  }

  // Simple routing: pick the peer whose summary best matches the message,
  // or fall back to the most recently seen peer.
  const textLower = body.text.toLowerCase();
  let bestPeer = peers[0];
  let bestScore = 0;

  for (const peer of peers) {
    // Simple keyword overlap scoring
    const summaryWords = peer.summary.toLowerCase().split(/\s+/);
    const textWords = textLower.split(/\s+/);
    let score = 0;
    for (const word of textWords) {
      if (word.length > 2 && summaryWords.some((sw) => sw.includes(word))) {
        score++;
      }
    }
    // Also favor more recently active peers
    const recency = new Date(peer.last_seen).getTime();
    score += recency / 1e15; // tiny tiebreaker

    if (score > bestScore) {
      bestScore = score;
      bestPeer = peer;
    }
  }

  // Send the message to the chosen peer
  const now = new Date().toISOString();
  insertMessage.run("user", bestPeer.id, body.text, now);
  broadcast({
    type: "message_sent",
    from_id: "user",
    to_id: bestPeer.id,
    text: body.text,
    sent_at: now,
  });

  return { ok: true, routed_to: bestPeer.summary || bestPeer.id, peer_id: bestPeer.id };
}

// ---- HTTP + WebSocket Server ----

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined as any;
    }

    // CORS headers for Tauri dev
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      if (url.pathname === "/health") {
        const allPeers = selectAllPeers.all() as Peer[];
        return Response.json(
          { status: "ok", peers: allPeers.length },
          { headers: corsHeaders }
        );
      }
      if (url.pathname === "/nodes") {
        return Response.json(selectAllNodes.all(), { headers: corsHeaders });
      }
      if (url.pathname === "/peers") {
        return Response.json(selectAllPeers.all(), { headers: corsHeaders });
      }
      return new Response("claude-swarm broker", { status: 200, headers: corsHeaders });
    }

    try {
      const body = await req.json();
      let result: unknown;

      switch (url.pathname) {
        case "/register":
          result = handleRegister(body);
          break;
        case "/heartbeat":
          handleHeartbeat(body);
          result = { ok: true };
          break;
        case "/set-summary":
          handleSetSummary(body);
          result = { ok: true };
          break;
        case "/list-peers":
          result = handleListPeers(body);
          break;
        case "/send-message":
          result = handleSendMessage(body);
          break;
        case "/broadcast":
          result = handleBroadcast(body);
          break;
        case "/poll-messages":
          result = handlePollMessages(body);
          break;
        case "/unregister":
          handleUnregister(body);
          result = { ok: true };
          break;
        case "/create-node":
          result = handleCreateNode(body);
          break;
        case "/delete-node":
          handleDeleteNode(body);
          result = { ok: true };
          break;
        case "/assign-node":
          handleAssignNode(body);
          result = { ok: true };
          break;
        case "/get-diff":
          result = await handleGetDiff(body);
          break;
        case "/route-message":
          result = handleRouteMessage(body);
          break;
        default:
          return Response.json({ error: "not found" }, { status: 404, headers: corsHeaders });
      }

      return Response.json(result, { headers: corsHeaders });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json({ error: msg }, { status: 500, headers: corsHeaders });
    }
  },

  websocket: {
    open(ws) {
      wsClients.add(ws);
      // Send initial state
      ws.send(JSON.stringify(handleSync()));
    },
    message(ws, message) {
      try {
        const data = JSON.parse(String(message));
        if (data.type === "sync") {
          ws.send(JSON.stringify(handleSync()));
        }
      } catch {
        // ignore
      }
    },
    close(ws) {
      wsClients.delete(ws);
    },
  },
});

console.error(`[claude-swarm broker] listening on 127.0.0.1:${PORT} (db: ${DB_PATH})`);
