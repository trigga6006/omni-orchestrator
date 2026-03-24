import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { killAgent } from "../lib/agentManager";
import { cn, formatTime, formatRelative, truncatePath } from "../lib/utils";
import {
  X,
  Circle,
  MessageSquare,
  FileCode,
  Info,
  Skull,
  Terminal as TerminalIcon,
  Maximize2,
  Minimize2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

export default function RightDrawer() {
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const agents = useAppStore((s) => s.agents);
  const nodes = useAppStore((s) => s.nodes);
  const toggleRightDrawer = useAppStore((s) => s.toggleRightDrawer);

  const agent = agents.find((a) => a.id === selectedAgentId);
  const node = nodes.find((n) => n.id === (agent?.nodeId ?? selectedNodeId));

  const [terminalExpanded, setTerminalExpanded] = useState(false);

  return (
    <div className="w-96 h-full flex flex-col bg-subtle border-l border-edge shrink-0 animate-slide-right">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-edge shrink-0">
        {node && (
          <Circle size={8} fill={node.color} stroke={node.color} />
        )}
        <span className="text-sm font-medium text-fg truncate flex-1">
          {agent ? agent.name : node?.name ?? "Details"}
        </span>
        {agent && (
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded font-medium",
            agent.status === "active" ? "text-accent-green bg-accent-green/10" :
            agent.status === "starting" ? "text-accent-amber bg-accent-amber/10" :
            agent.status === "error" ? "text-accent-red bg-accent-red/10" :
            "text-fg-dim bg-fg-dim/10"
          )}>
            {agent.status}
          </span>
        )}
        <button
          onClick={() => toggleRightDrawer()}
          className="p-1 rounded text-fg-muted hover:text-fg hover:bg-hover transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content: Info panel (top) */}
      <div className={cn(
        "flex flex-col overflow-hidden transition-all",
        terminalExpanded ? "h-32" : "flex-1"
      )}>
        {agent ? <AgentDetail agent={agent} node={node} /> : <NodeDetail node={node} />}
      </div>

      {/* Terminal section (bottom) */}
      <div className={cn(
        "flex flex-col border-t border-edge transition-all",
        terminalExpanded ? "flex-1" : "h-48"
      )}>
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-edge shrink-0">
          <TerminalIcon size={12} className="text-fg-muted" />
          <span className="text-[11px] text-fg-muted font-mono flex-1 truncate">
            {agent?.cwd ?? node?.directory ?? "~"}
          </span>
          <button
            onClick={() => setTerminalExpanded(!terminalExpanded)}
            className="p-0.5 text-fg-dim hover:text-fg transition-colors"
          >
            {terminalExpanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
        </div>
        <div className="flex-1 bg-base p-3 overflow-auto font-mono text-xs text-fg-muted">
          <p className="text-fg-dim">
            $ <span className="text-fg-muted">Terminal session coming soon...</span>
          </p>
          <p className="text-fg-dim mt-1">
            PowerShell integration for {truncatePath(agent?.cwd ?? node?.directory ?? "~", 50)}
          </p>
        </div>
      </div>
    </div>
  );
}

function AgentDetail({
  agent,
  node,
}: {
  agent: NonNullable<ReturnType<typeof useAppStore.getState>["agents"][0]>;
  node: ReturnType<typeof useAppStore.getState>["nodes"][0] | undefined;
}) {
  const panelView = useAppStore((s) => s.panelView);
  const setPanelView = useAppStore((s) => s.setPanelView);

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-edge shrink-0">
        {([
          { key: "chat" as const, label: "Chat", icon: MessageSquare },
          { key: "diff" as const, label: "Diffs", icon: FileCode },
          { key: "info" as const, label: "Info", icon: Info },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setPanelView(key)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium transition-colors",
              panelView === key
                ? "text-fg border-b border-accent-blue"
                : "text-fg-muted hover:text-fg"
            )}
          >
            <Icon size={12} />
            {label}
            {key === "diff" && agent.diffs.length > 0 && (
              <span className="text-[9px] px-1 rounded bg-accent-violet/15 text-accent-violet">
                {agent.diffs.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {panelView === "chat" && <ChatView agent={agent} />}
        {panelView === "diff" && <DiffView agent={agent} />}
        {panelView === "info" && <InfoView agent={agent} node={node} />}
      </div>
    </div>
  );
}

function ChatView({ agent }: { agent: ReturnType<typeof useAppStore.getState>["agents"][0] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agent.messages.length]);

  if (agent.messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-fg-dim">
        No messages yet
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-2">
      {agent.messages.map((msg) => (
        <div
          key={msg.id}
          className={cn(
            "px-3 py-2 rounded-lg text-xs leading-relaxed max-w-[90%]",
            msg.direction === "outbound"
              ? "bg-accent-blue/10 text-fg ml-auto border border-accent-blue/20"
              : "bg-elevated text-fg-secondary border border-edge"
          )}
        >
          <p className="whitespace-pre-wrap break-words">{msg.text}</p>
          <p className="text-[9px] text-fg-dim mt-1 text-right">
            {formatTime(msg.sentAt)}
          </p>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function DiffView({ agent }: { agent: ReturnType<typeof useAppStore.getState>["agents"][0] }) {
  const [selectedFile, setSelectedFile] = useState(0);

  if (agent.diffs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-fg-dim">
        No file changes detected
      </div>
    );
  }

  const diff = agent.diffs[selectedFile];

  return (
    <div className="flex flex-col h-full">
      {/* File tabs */}
      {agent.diffs.length > 1 && (
        <div className="flex gap-1 px-2 py-1.5 border-b border-edge overflow-x-auto">
          {agent.diffs.map((d, i) => (
            <button
              key={i}
              onClick={() => setSelectedFile(i)}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-mono shrink-0 transition-colors",
                i === selectedFile
                  ? "bg-accent-violet/15 text-accent-violet"
                  : "text-fg-dim hover:text-fg-muted"
              )}
            >
              {d.fileName.split("/").pop()}
            </button>
          ))}
        </div>
      )}

      {/* Diff content */}
      <div className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
        <div className="text-fg-dim mb-2">
          {diff.fileName} <span className="text-fg-dim">({diff.language})</span>
        </div>
        <pre className="whitespace-pre-wrap break-all text-fg-secondary bg-base rounded p-3 border border-edge">
          {diff.modified || diff.original || "Empty file"}
        </pre>
      </div>
    </div>
  );
}

function InfoView({
  agent,
  node,
}: {
  agent: ReturnType<typeof useAppStore.getState>["agents"][0];
  node: ReturnType<typeof useAppStore.getState>["nodes"][0] | undefined;
}) {
  const removeAgent = useAppStore((s) => s.removeAgent);

  const handleKill = async () => {
    await killAgent(agent.id);
  };

  const rows = [
    { label: "Agent ID", value: agent.id },
    { label: "Peer ID", value: agent.peerId ?? "—" },
    { label: "Node", value: node?.name ?? "—" },
    { label: "Working Dir", value: agent.cwd },
    { label: "PID", value: agent.pid?.toString() ?? "—" },
    { label: "Status", value: agent.status },
    { label: "Messages", value: agent.messages.length.toString() },
    { label: "Changed Files", value: agent.diffs.length.toString() },
    { label: "Created", value: formatRelative(agent.createdAt) },
    { label: "Last Seen", value: formatRelative(agent.lastSeen) },
  ];

  return (
    <div className="p-3 flex flex-col gap-1">
      {agent.summary && (
        <div className="px-3 py-2 rounded bg-elevated border border-edge text-xs text-fg-secondary leading-relaxed mb-2">
          {agent.summary}
        </div>
      )}

      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-center justify-between px-1 py-1 text-xs">
          <span className="text-fg-muted">{label}</span>
          <span className="text-fg font-mono text-[11px] truncate max-w-[200px] text-right">
            {value}
          </span>
        </div>
      ))}

      <div className="mt-4 flex gap-2">
        {agent.status !== "stopped" && (
          <button
            onClick={handleKill}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-accent-red bg-accent-red/10 hover:bg-accent-red/20 transition-colors"
          >
            <Skull size={12} />
            Kill Agent
          </button>
        )}
        {agent.status === "stopped" && (
          <button
            onClick={() => removeAgent(agent.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-fg-muted bg-elevated hover:bg-hover transition-colors"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function NodeDetail({
  node,
}: {
  node: ReturnType<typeof useAppStore.getState>["nodes"][0] | undefined;
}) {
  const agents = useAppStore((s) => s.agents);
  if (!node) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-fg-dim">
        Select a node or agent to view details
      </div>
    );
  }

  const nodeAgents = agents.filter((a) => a.nodeId === node.id);
  const activeCount = nodeAgents.filter((a) => a.status === "active").length;

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between px-1 py-1 text-xs">
        <span className="text-fg-muted">Directory</span>
        <span className="text-fg font-mono text-[11px] truncate max-w-[220px]">{node.directory}</span>
      </div>
      <div className="flex items-center justify-between px-1 py-1 text-xs">
        <span className="text-fg-muted">Agents</span>
        <span className="text-fg font-mono text-[11px]">{nodeAgents.length}</span>
      </div>
      <div className="flex items-center justify-between px-1 py-1 text-xs">
        <span className="text-fg-muted">Active</span>
        <span className="text-accent-green font-mono text-[11px]">{activeCount}</span>
      </div>
      <div className="flex items-center justify-between px-1 py-1 text-xs">
        <span className="text-fg-muted">Created</span>
        <span className="text-fg font-mono text-[11px]">{formatRelative(node.createdAt)}</span>
      </div>
    </div>
  );
}
