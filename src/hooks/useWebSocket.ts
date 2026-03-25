import { useEffect, useRef, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { notifyPeersOfNewAgent, spawnAgent } from "../lib/agentManager";

const BROKER_WS_URL = "ws://127.0.0.1:7899/ws";
const RECONNECT_INTERVAL = 3000;

// Dedup guard: prevent double-spawning from duplicate WebSocket messages
const recentSpawnKeys = new Set<string>();
function dedup(key: string, ttlMs = 30_000): boolean {
  if (recentSpawnKeys.has(key)) return false;
  recentSpawnKeys.add(key);
  setTimeout(() => recentSpawnKeys.delete(key), ttlMs);
  return true; // first time seeing this key
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setBrokerStatus = useAppStore((s) => s.setBrokerStatus);
  const updateAgentStatus = useAppStore((s) => s.updateAgentStatus);
  const updateAgentSummary = useAppStore((s) => s.updateAgentSummary);
  const updateAgentPeerId = useAppStore((s) => s.updateAgentPeerId);
  const addAgentMessage = useAppStore((s) => s.addAgentMessage);
  const addConnection = useAppStore((s) => s.addConnection);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(BROKER_WS_URL);

      ws.onopen = () => {
        setBrokerStatus({ connected: true });
        ws.send(JSON.stringify({ type: "sync" }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "peer_registered": {
              // A new peer came online — the agent manager handles its own
              // registration, so only match unregistered agents by PID > 0
              const peer = data.peer;
              if (!peer) break;
              const agents = useAppStore.getState().agents;
              // Try to match by PID (skip PID 0 which is used by managed agents)
              let agent =
                peer.pid > 0
                  ? agents.find((a) => a.pid === peer.pid && !a.peerId)
                  : null;
              // Fall back to matching by cwd for starting agents
              if (!agent) {
                agent = agents.find(
                  (a) => a.cwd === peer.cwd && a.status === "starting" && !a.peerId
                );
              }
              if (agent) {
                updateAgentPeerId(agent.id, peer.id);

                // Notify existing agents in the same node about the new peer
                if (peer.node_id) {
                  notifyPeersOfNewAgent(
                    peer.node_id,
                    agent.name,
                    peer.id
                  ).catch(() => {});
                }
              }
              setBrokerStatus({
                peerCount: useAppStore.getState().broker.peerCount + 1,
              });
              break;
            }

            case "peer_unregistered": {
              // A peer went offline — update agent status
              const { peer_id } = data;
              const agents = useAppStore.getState().agents;
              const agent = agents.find((a) => a.peerId === peer_id);
              if (agent && agent.status !== "stopped") {
                updateAgentStatus(agent.id, "stopped");
              }
              setBrokerStatus({
                peerCount: Math.max(
                  0,
                  useAppStore.getState().broker.peerCount - 1
                ),
              });
              break;
            }

            case "message_sent": {
              const { from_id, to_id, text, sent_at } = data;
              const agents = useAppStore.getState().agents;
              const toAgent = agents.find((a) => a.peerId === to_id);
              const fromAgent = agents.find((a) => a.peerId === from_id);

              // Only add inbound messages (outbound are added locally on send)
              // Skip if from_id is "user" — that's us, we already added it
              if (toAgent && from_id !== "user") {
                addAgentMessage(toAgent.id, {
                  id: Math.random().toString(36).slice(2),
                  fromId: from_id,
                  toId: to_id,
                  text,
                  sentAt: sent_at,
                  direction: "inbound",
                });
              }

              // Track connections between agents
              if (fromAgent && toAgent) {
                addConnection(fromAgent.id, toAgent.id);
              }
              break;
            }

            case "message_broadcast": {
              const { from_id, node_id, text, sent_at } = data;
              // Add message to all agents in the node (except sender)
              const agents = useAppStore.getState().agents;
              const nodes = useAppStore.getState().nodes;
              const node = nodes.find((n) => n.id === node_id);
              if (!node) break;

              for (const agentId of node.agents) {
                const agent = agents.find((a) => a.id === agentId);
                if (agent && agent.peerId !== from_id) {
                  addAgentMessage(agent.id, {
                    id: Math.random().toString(36).slice(2),
                    fromId: from_id,
                    toId: agent.peerId ?? agent.id,
                    text,
                    sentAt: sent_at,
                    direction: from_id === "user" ? "outbound" : "inbound",
                  });
                }
              }
              break;
            }

            case "summary_updated": {
              const { peer_id, summary } = data;
              const agents = useAppStore.getState().agents;
              const agent = agents.find((a) => a.peerId === peer_id);
              if (agent) updateAgentSummary(agent.id, summary);
              break;
            }

            case "sync_state": {
              const peers = data.peers ?? [];
              const peerCount = data.peer_count ?? peers.length;
              setBrokerStatus({ peerCount });

              // Reconcile: update agent statuses based on live peers
              const agents = useAppStore.getState().agents;
              const livePeerIds = new Set(peers.map((p: { id: string }) => p.id));
              for (const agent of agents) {
                if (
                  agent.peerId &&
                  !livePeerIds.has(agent.peerId) &&
                  agent.status === "active"
                ) {
                  updateAgentStatus(agent.id, "stopped");
                }
              }
              break;
            }

            case "spawn_request": {
              const { node_id, task, model, requester_peer_id } = data;
              // Normalize name: lowercase, trim, collapse whitespace
              const name = (data.name ?? "").trim().toLowerCase().replace(/\s+/g, "-");
              if (!name) break;

              // Dedup: skip if we already processed this request recently
              const dedupKey = `${node_id}:${name}`;
              if (!dedup(dedupKey)) break;

              const store = useAppStore.getState();
              const node = store.nodes.find((n) => n.id === node_id);
              if (!node) {
                console.warn(`[spawn_request] Node ${node_id} not found`);
                break;
              }

              // Skip if an agent with this name already exists in the node
              const existing = store.agents.find(
                (a) => a.nodeId === node_id && a.name.toLowerCase() === name
              );
              if (existing) {
                console.warn(`[spawn_request] Agent "${name}" already exists in node, skipping`);
                break;
              }

              // Append report-back instruction if boss peer ID is known
              let fullTask = task;
              if (requester_peer_id) {
                fullTask += `\n\nIMPORTANT: When you complete your task, send a completion summary to the lead agent using:\ncurl -s -X POST http://127.0.0.1:7899/send-message -H "Content-Type: application/json" -d '{"from_id":"YOUR_PEER_ID","to_id":"${requester_peer_id}","text":"COMPLETED: <your summary>"}'`;
              }

              const agent = store.addAgent(node_id, name, node.directory, "worker");

              spawnAgent(agent.id, node_id, name, node.directory, fullTask, "worker", model).catch(
                (err) => {
                  console.error(`[spawn_request] Failed to spawn "${name}":`, err);
                  useAppStore.getState().updateAgentStatus(agent.id, "error");
                }
              );

              store.pushActivity({
                type: "agent_spawn",
                agentId: agent.id,
                agentName: name,
                nodeId: node_id,
                nodeName: node.name,
                text: `Lead agent spawned sub-agent "${name}" on "${node.name}"`,
              });
              break;
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setBrokerStatus({ connected: false });
        wsRef.current = null;
        reconnectTimer.current = setTimeout(connect, RECONNECT_INTERVAL);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    } catch {
      setBrokerStatus({ connected: false });
      reconnectTimer.current = setTimeout(connect, RECONNECT_INTERVAL);
    }
  }, [
    setBrokerStatus,
    updateAgentStatus,
    updateAgentSummary,
    updateAgentPeerId,
    addAgentMessage,
    addConnection,
  ]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { send };
}
