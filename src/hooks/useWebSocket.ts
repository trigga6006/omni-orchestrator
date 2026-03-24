import { useEffect, useRef, useCallback } from "react";
import { useAppStore } from "../stores/appStore";

const BROKER_WS_URL = "ws://127.0.0.1:7899/ws";
const RECONNECT_INTERVAL = 3000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setBrokerStatus = useAppStore((s) => s.setBrokerStatus);
  const updateAgentStatus = useAppStore((s) => s.updateAgentStatus);
  const updateAgentSummary = useAppStore((s) => s.updateAgentSummary);
  const addAgentMessage = useAppStore((s) => s.addAgentMessage);
  const addConnection = useAppStore((s) => s.addConnection);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(BROKER_WS_URL);

      ws.onopen = () => {
        setBrokerStatus({ connected: true });
        // Request current state
        ws.send(JSON.stringify({ type: "sync" }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "peer_registered":
              // A new peer came online — update agent if we're tracking it
              break;

            case "peer_unregistered":
              // A peer went offline
              break;

            case "message_sent": {
              const { from_id, to_id, text, sent_at } = data;
              // Find agents by peerId and add message
              const agents = useAppStore.getState().agents;
              const toAgent = agents.find((a) => a.peerId === to_id);
              const fromAgent = agents.find((a) => a.peerId === from_id);
              if (toAgent) {
                addAgentMessage(toAgent.id, {
                  id: Math.random().toString(36).slice(2),
                  fromId: from_id,
                  toId: to_id,
                  text,
                  sentAt: sent_at,
                  direction: "inbound",
                });
              }
              if (fromAgent && toAgent) {
                addConnection(fromAgent.id, toAgent.id);
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
              setBrokerStatus({ peerCount: data.peer_count ?? 0 });
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
        // Auto-reconnect
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
  }, [setBrokerStatus, updateAgentSummary, addAgentMessage, addConnection]);

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
