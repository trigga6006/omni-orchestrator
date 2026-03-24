import { useState, useRef, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import { sendMessage as brokerSendMessage, routeMessage } from "../lib/broker";
import { writeToAgent } from "../lib/agentManager";
import DiffViewer from "./DiffViewer";
import type { AgentStatus } from "../types";

const STATUS_BADGE: Record<AgentStatus, { bg: string; text: string }> = {
  starting: { bg: "bg-accent-amber/15", text: "text-accent-amber" },
  active: { bg: "bg-accent-cyan/15", text: "text-accent-cyan" },
  idle: { bg: "bg-text-muted/15", text: "text-text-muted" },
  error: { bg: "bg-accent-red/15", text: "text-accent-red" },
  stopped: { bg: "bg-bg-hover", text: "text-text-muted" },
};

export default function AgentPanel() {
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const agents = useAppStore((s) => s.agents);
  const nodes = useAppStore((s) => s.nodes);
  const panelView = useAppStore((s) => s.panelView);
  const setPanelView = useAppStore((s) => s.setPanelView);
  const selectAgent = useAppStore((s) => s.selectAgent);
  const removeAgent = useAppStore((s) => s.removeAgent);

  const agent = agents.find((a) => a.id === selectedAgentId);
  if (!agent) return null;

  const node = nodes.find((n) => n.id === agent.nodeId);
  const badge = STATUS_BADGE[agent.status];

  return (
    <div className="w-96 h-full bg-bg-secondary border-l border-border-subtle flex flex-col shrink-0 animate-slide-right">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: node?.color }}
            />
            <h3 className="text-sm font-medium text-text-primary truncate">
              {agent.name}
            </h3>
            <span
              className={`px-1.5 py-0.5 text-[10px] rounded-full ${badge.bg} ${badge.text} capitalize`}
            >
              {agent.status}
            </span>
          </div>
          <button
            onClick={() => selectAgent(null)}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-text-primary shrink-0"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" />
              <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>

        {agent.summary && (
          <p className="mt-1 text-xs text-text-muted line-clamp-2">{agent.summary}</p>
        )}

        {/* Tab bar */}
        <div className="flex gap-0.5 mt-3 p-0.5 bg-bg-primary rounded-lg">
          {(["chat", "diff", "info"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setPanelView(tab)}
              className={`flex-1 px-2 py-1.5 text-xs rounded-md capitalize transition-colors ${
                panelView === tab
                  ? "bg-bg-elevated text-text-primary"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {panelView === "chat" && <ChatView agentId={agent.id} />}
        {panelView === "diff" && <DiffView agentId={agent.id} />}
        {panelView === "info" && <InfoView agentId={agent.id} />}
      </div>

      {/* Footer actions */}
      <div className="px-4 py-2 border-t border-border-subtle flex gap-2">
        <button
          onClick={async () => {
            const { killAgent } = await import("../lib/agentManager");
            await killAgent(agent.id);
            removeAgent(agent.id);
          }}
          className="px-3 py-1.5 text-xs rounded-md text-accent-red hover:bg-accent-red/10 transition-colors"
        >
          Kill Agent
        </button>
      </div>
    </div>
  );
}

function ChatView({ agentId }: { agentId: string }) {
  const agent = useAppStore((s) => s.agents.find((a) => a.id === agentId));
  const addAgentMessage = useAppStore((s) => s.addAgentMessage);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agent?.messages.length]);

  if (!agent) return null;

  const handleSend = async () => {
    const text = message.trim();
    if (!text || sending) return;

    setSending(true);
    setMessage("");

    // Add the outbound message to local state immediately
    const outMsg = {
      id: Math.random().toString(36).slice(2),
      fromId: "user",
      toId: agent.peerId ?? agent.id,
      text,
      sentAt: new Date().toISOString(),
      direction: "outbound" as const,
    };
    addAgentMessage(agent.id, outMsg);

    try {
      // Strategy 1: If agent has a peerId, send via broker
      if (agent.peerId) {
        await brokerSendMessage("user", agent.peerId, text);
      }

      // Strategy 2: Also write directly to the agent's stdin
      // This ensures the Claude session gets the message even if
      // broker message polling isn't set up in the agent
      await writeToAgent(agent.id, text);
    } catch (err) {
      console.error("Failed to send message:", err);
      // Message was already added to UI, add error indicator
      addAgentMessage(agent.id, {
        id: Math.random().toString(36).slice(2),
        fromId: "system",
        toId: agent.id,
        text: "Failed to deliver message. Agent may not be running.",
        sentAt: new Date().toISOString(),
        direction: "inbound",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {agent.messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-xs text-text-muted">
              No messages yet. Send a message or wait for peer communication.
            </p>
          </div>
        ) : (
          <>
            {agent.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.direction === "outbound" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-lg text-xs whitespace-pre-wrap ${
                    msg.direction === "outbound"
                      ? "bg-accent-cyan/15 text-text-primary"
                      : msg.fromId === "system"
                        ? "bg-accent-amber/10 text-accent-amber"
                        : "bg-bg-elevated text-text-primary"
                  }`}
                >
                  {msg.text}
                </div>
                <span className="text-[10px] text-text-muted mt-0.5 px-1">
                  {new Date(msg.sentAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border-subtle">
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              agent.status === "active"
                ? "Send message to agent..."
                : `Agent is ${agent.status}...`
            }
            disabled={sending}
            className="flex-1 px-3 py-2 text-xs bg-bg-primary border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/50 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={sending || !message.trim()}
            className="px-3 py-2 text-xs rounded-lg bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? "..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DiffView({ agentId }: { agentId: string }) {
  const agent = useAppStore((s) => s.agents.find((a) => a.id === agentId));
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);

  const diffs = agent?.diffs ?? [];
  const activeDiff = diffs[selectedFileIdx] ?? agent?.diff;

  if (!activeDiff) {
    return (
      <div className="h-full flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-xs text-text-muted">No diff available</p>
          <p className="text-[10px] text-text-muted mt-1">
            Diffs will appear here as the agent makes changes
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* File list (if multiple) */}
      {diffs.length > 1 && (
        <div className="px-2 py-1.5 border-b border-border-subtle flex gap-1 overflow-x-auto">
          {diffs.map((d, i) => (
            <button
              key={d.fileName}
              onClick={() => setSelectedFileIdx(i)}
              className={`px-2 py-1 text-[10px] font-mono rounded whitespace-nowrap transition-colors ${
                i === selectedFileIdx
                  ? "bg-accent-cyan/15 text-accent-cyan"
                  : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
              }`}
            >
              {d.fileName.split("/").pop()}
            </button>
          ))}
        </div>
      )}

      {/* Active diff header */}
      <div className="px-4 py-2 border-b border-border-subtle flex items-center gap-2">
        <span className="text-xs text-text-secondary font-mono">
          {activeDiff.fileName}
        </span>
        <span className="text-[10px] text-text-muted">
          {new Date(activeDiff.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Diff editor */}
      <div className="flex-1 overflow-hidden">
        <DiffViewer
          original={activeDiff.original}
          modified={activeDiff.modified}
          language={activeDiff.language}
          fileName={activeDiff.fileName}
        />
      </div>
    </div>
  );
}

function InfoView({ agentId }: { agentId: string }) {
  const agent = useAppStore((s) => s.agents.find((a) => a.id === agentId));
  const node = useAppStore((s) => s.nodes.find((n) => n.id === agent?.nodeId));

  if (!agent) return null;

  const fields = [
    { label: "Agent ID", value: agent.id },
    { label: "Peer ID", value: agent.peerId ?? "Not registered" },
    { label: "Node", value: node?.name ?? "Unknown" },
    { label: "Working Dir", value: agent.cwd },
    { label: "PID", value: agent.pid?.toString() ?? "N/A" },
    { label: "Status", value: agent.status },
    { label: "Messages", value: agent.messages.length.toString() },
    { label: "Created", value: new Date(agent.createdAt).toLocaleString() },
    { label: "Last Seen", value: new Date(agent.lastSeen).toLocaleString() },
  ];

  return (
    <div className="px-4 py-3 space-y-2 overflow-y-auto">
      {fields.map((f) => (
        <div key={f.label} className="flex items-start gap-2">
          <span className="text-[10px] text-text-muted uppercase tracking-wider w-20 shrink-0 pt-0.5">
            {f.label}
          </span>
          <span className="text-xs text-text-secondary font-mono break-all">
            {f.value}
          </span>
        </div>
      ))}
    </div>
  );
}
