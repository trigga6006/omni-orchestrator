import { useState } from "react";
import { useAppStore } from "../stores/appStore";
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
          onClick={() => removeAgent(agent.id)}
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
  const [message, setMessage] = useState("");

  if (!agent) return null;

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
          agent.messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.direction === "outbound" ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`max-w-[85%] px-3 py-2 rounded-lg text-xs ${
                  msg.direction === "outbound"
                    ? "bg-accent-cyan/15 text-text-primary"
                    : "bg-bg-elevated text-text-primary"
                }`}
              >
                {msg.text}
              </div>
              <span className="text-[10px] text-text-muted mt-0.5 px-1">
                {new Date(msg.sentAt).toLocaleTimeString()}
              </span>
            </div>
          ))
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
              if (e.key === "Enter" && message.trim()) {
                // TODO: Send via broker
                setMessage("");
              }
            }}
            placeholder="Send message to agent..."
            className="flex-1 px-3 py-2 text-xs bg-bg-primary border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/50"
          />
          <button className="px-3 py-2 text-xs rounded-lg bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25 transition-colors">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function DiffView({ agentId }: { agentId: string }) {
  const agent = useAppStore((s) => s.agents.find((a) => a.id === agentId));

  if (!agent?.diff) {
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
      <div className="px-4 py-2 border-b border-border-subtle flex items-center gap-2">
        <span className="text-xs text-text-secondary font-mono">
          {agent.diff.fileName}
        </span>
        <span className="text-[10px] text-text-muted">
          {new Date(agent.diff.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div className="flex-1 overflow-hidden">
        <DiffViewer
          original={agent.diff.original}
          modified={agent.diff.modified}
          language={agent.diff.language}
          fileName={agent.diff.fileName}
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
