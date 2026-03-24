import { useState, useRef, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { writeToAgent } from "../lib/agentManager";
import { sendMessage as brokerSendMessage } from "../lib/broker";
import { cn } from "../lib/utils";
import {
  Send,
  ChevronDown,
  Circle,
  Layers,
  Bot,
  X,
} from "lucide-react";

type Target =
  | { type: "none" }
  | { type: "node"; nodeId: string }
  | { type: "agent"; agentId: string };

export default function PromptBar() {
  const [text, setText] = useState("");
  const [target, setTarget] = useState<Target>({ type: "none" });
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorLevel, setSelectorLevel] = useState<"nodes" | { nodeId: string }>("nodes");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const nodes = useAppStore((s) => s.nodes);
  const agents = useAppStore((s) => s.agents);
  const addAgentMessage = useAppStore((s) => s.addAgentMessage);

  const getTargetLabel = useCallback(() => {
    if (target.type === "agent") {
      const agent = agents.find((a) => a.id === target.agentId);
      return agent?.name ?? "Agent";
    }
    if (target.type === "node") {
      const node = nodes.find((n) => n.id === target.nodeId);
      return node?.name ?? "Node";
    }
    return "Select target";
  }, [target, agents, nodes]);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    if (target.type === "none") return;

    setSending(true);
    try {
      if (target.type === "agent") {
        const agent = agents.find((a) => a.id === target.agentId);
        if (agent) {
          // Write to agent's stdin
          await writeToAgent(agent.id, text.trim());
          // Add as outbound message in UI
          addAgentMessage(agent.id, {
            id: Math.random().toString(36).slice(2),
            fromId: "user",
            toId: agent.peerId ?? agent.id,
            text: text.trim(),
            sentAt: new Date().toISOString(),
            direction: "outbound",
          });

          // Also send via broker if agent has a peer ID
          if (agent.peerId) {
            await brokerSendMessage("user", agent.peerId, text.trim()).catch(() => {});
          }
        }
      }
      setText("");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="shrink-0 border-t border-edge bg-subtle px-4 py-3">
      <div className="flex items-end gap-2 max-w-4xl mx-auto">
        {/* Text input */}
        <div className="flex-1 flex items-end bg-card border border-edge rounded-lg focus-within:border-edge-strong transition-colors">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              target.type === "none"
                ? "Select a target agent first..."
                : `Message ${getTargetLabel()}...`
            }
            disabled={target.type === "none"}
            rows={1}
            className="flex-1 bg-transparent px-3 py-2.5 text-sm text-fg placeholder:text-fg-dim resize-none focus:outline-none disabled:opacity-40 min-h-[40px] max-h-[120px]"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending || target.type === "none"}
            className="p-2.5 text-fg-muted hover:text-accent-blue disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} />
          </button>
        </div>

        {/* Agent selector */}
        <div className="relative">
          <button
            onClick={() => {
              setSelectorOpen(!selectorOpen);
              setSelectorLevel("nodes");
            }}
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap",
              target.type !== "none"
                ? "bg-card border-edge-strong text-fg"
                : "bg-card border-edge text-fg-muted hover:text-fg hover:border-edge-strong"
            )}
          >
            {target.type === "agent" && (
              <Circle size={6} className="text-accent-green" fill="currentColor" />
            )}
            {target.type === "node" && (
              <Layers size={12} className="text-accent-blue" />
            )}
            <span>{getTargetLabel()}</span>
            {target.type !== "none" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setTarget({ type: "none" });
                  setSelectorOpen(false);
                }}
                className="text-fg-dim hover:text-fg ml-1"
              >
                <X size={12} />
              </button>
            )}
            <ChevronDown size={12} className="text-fg-dim" />
          </button>

          {/* Dropdown */}
          {selectorOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-56 bg-card border border-edge-strong rounded-lg shadow-xl overflow-hidden animate-fade-in z-50">
              {selectorLevel === "nodes" ? (
                <>
                  <div className="px-3 py-2 text-[10px] text-fg-dim uppercase tracking-wider border-b border-edge">
                    Select Node
                  </div>
                  {nodes.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-fg-dim text-center">
                      No nodes available
                    </div>
                  ) : (
                    nodes.map((node) => {
                      const nodeAgents = agents.filter((a) => a.nodeId === node.id);
                      return (
                        <button
                          key={node.id}
                          onClick={() => setSelectorLevel({ nodeId: node.id })}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-fg-secondary hover:bg-hover hover:text-fg transition-colors"
                        >
                          <Circle size={7} fill={node.color} stroke={node.color} />
                          <span className="flex-1 text-left truncate">{node.name}</span>
                          <span className="text-fg-dim font-mono">{nodeAgents.length}</span>
                          <ChevronDown size={11} className="text-fg-dim -rotate-90" />
                        </button>
                      );
                    })
                  )}
                </>
              ) : (
                (() => {
                  const nodeId = (selectorLevel as { nodeId: string }).nodeId;
                  const node = nodes.find((n) => n.id === nodeId);
                  const nodeAgents = agents.filter((a) => a.nodeId === nodeId);
                  return (
                    <>
                      <button
                        onClick={() => setSelectorLevel("nodes")}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-fg-dim uppercase tracking-wider border-b border-edge hover:bg-hover transition-colors"
                      >
                        <ChevronDown size={11} className="rotate-90" />
                        {node?.name ?? "Back"}
                      </button>
                      {nodeAgents.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-fg-dim text-center">
                          No agents in this node
                        </div>
                      ) : (
                        nodeAgents.map((agent) => (
                          <button
                            key={agent.id}
                            onClick={() => {
                              setTarget({ type: "agent", agentId: agent.id });
                              setSelectorOpen(false);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-fg-secondary hover:bg-hover hover:text-fg transition-colors"
                          >
                            <Bot size={12} className="text-fg-dim" />
                            <span className="flex-1 text-left truncate">{agent.name}</span>
                            <span className={cn(
                              "text-[9px] px-1.5 py-0.5 rounded font-medium",
                              agent.status === "active" ? "text-accent-green bg-accent-green/10" : "text-fg-dim bg-fg-dim/10"
                            )}>
                              {agent.status}
                            </span>
                          </button>
                        ))
                      )}
                    </>
                  );
                })()
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
