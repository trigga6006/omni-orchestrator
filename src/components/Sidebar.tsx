import { useState } from "react";
import { useAppStore } from "../stores/appStore";
import { cn, truncatePath } from "../lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { spawnAgent } from "../lib/agentManager";
import ActivityMonitor from "./ActivityMonitor";
import {
  Plus,
  ChevronRight,
  ChevronDown,
  Circle,
  Folder,
  Activity,
  Layers,
  Bot,
  Trash2,
  Link2,
  X,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  starting: "text-accent-amber",
  active: "text-accent-green",
  idle: "text-fg-muted",
  error: "text-accent-red",
  stopped: "text-fg-dim",
};

export default function Sidebar() {
  const sidebarView = useAppStore((s) => s.sidebarView);
  const setSidebarView = useAppStore((s) => s.setSidebarView);
  const activityCount = useAppStore((s) => s.activityLog.length);

  return (
    <div className="w-64 h-full flex flex-col bg-subtle border-r border-edge shrink-0 animate-slide-left">
      {/* View toggle tabs */}
      <div className="flex border-b border-edge">
        <button
          onClick={() => setSidebarView("nodes")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors",
            sidebarView === "nodes"
              ? "text-fg border-b border-accent-blue"
              : "text-fg-muted hover:text-fg"
          )}
        >
          <Layers size={13} />
          Nodes
        </button>
        <button
          onClick={() => setSidebarView("activity")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors relative",
            sidebarView === "activity"
              ? "text-fg border-b border-accent-blue"
              : "text-fg-muted hover:text-fg"
          )}
        >
          <Activity size={13} />
          Activity
          {activityCount > 0 && (
            <span className="text-[9px] px-1 py-0 rounded bg-accent-blue/15 text-accent-blue font-mono">
              {activityCount}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {sidebarView === "nodes" ? <NodesView /> : <ActivityMonitor />}
      </div>
    </div>
  );
}

function NodesView() {
  const nodes = useAppStore((s) => s.nodes);
  const agents = useAppStore((s) => s.agents);
  const crossSpeakLinks = useAppStore((s) => s.crossSpeakLinks);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const selectNode = useAppStore((s) => s.selectNode);
  const selectAgent = useAppStore((s) => s.selectAgent);
  const removeNode = useAppStore((s) => s.removeNode);
  const addCrossSpeakLink = useAppStore((s) => s.addCrossSpeakLink);
  const removeCrossSpeakLink = useAppStore((s) => s.removeCrossSpeakLink);

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [showCreateNode, setShowCreateNode] = useState(false);

  const toggleExpand = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  return (
    <div className="p-2 flex flex-col gap-1">
      {/* Create node button */}
      <button
        onClick={() => setShowCreateNode(!showCreateNode)}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-fg-muted hover:text-fg hover:bg-hover transition-colors"
      >
        <Plus size={13} />
        <span>New Node</span>
      </button>

      {showCreateNode && (
        <CreateNodeForm onClose={() => setShowCreateNode(false)} />
      )}

      {/* Node list */}
      {nodes.map((node) => {
        const nodeAgents = agents.filter((a) => a.nodeId === node.id);
        const isExpanded = expandedNodes.has(node.id);
        const isSelected = selectedNodeId === node.id;
        const nodeLinks = crossSpeakLinks.filter(
          (l) => l.nodeA === node.id || l.nodeB === node.id
        );

        return (
          <div key={node.id} className="flex flex-col">
            {/* Node row */}
            <div
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors group",
                isSelected ? "bg-elevated text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg"
              )}
              onClick={() => {
                selectNode(node.id);
                if (!isExpanded) toggleExpand(node.id);
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(node.id);
                }}
                className="text-fg-muted hover:text-fg"
              >
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              <Circle size={8} fill={node.color} stroke={node.color} />
              <span className="flex-1 truncate font-medium">{node.name}</span>
              <span className="text-fg-dim text-[10px] font-mono">{nodeAgents.length}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeNode(node.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-fg-dim hover:text-accent-red transition-all"
              >
                <Trash2 size={11} />
              </button>
            </div>

            {/* Expanded: agents + directory + cross-speak */}
            {isExpanded && (
              <div className="ml-5 flex flex-col gap-0.5 mt-0.5">
                <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-fg-dim font-mono">
                  <Folder size={10} />
                  <span className="truncate">{truncatePath(node.directory, 30)}</span>
                </div>

                {nodeAgents.map((agent) => (
                  <div
                    key={agent.id}
                    onClick={() => selectAgent(agent.id)}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1 rounded text-[11px] cursor-pointer transition-colors",
                      selectedAgentId === agent.id
                        ? "bg-elevated text-fg"
                        : "text-fg-secondary hover:bg-hover hover:text-fg"
                    )}
                  >
                    <Circle
                      size={6}
                      className={cn(
                        STATUS_COLORS[agent.status],
                        agent.status === "active" && "animate-pulse-dot"
                      )}
                      fill="currentColor"
                    />
                    <span className="flex-1 truncate">{agent.name}</span>
                    <span className="text-[9px] text-fg-dim">{agent.status}</span>
                    {agent.diffs.length > 0 && (
                      <span className="text-[9px] px-1 rounded bg-accent-violet/15 text-accent-violet font-mono">
                        {agent.diffs.length}
                      </span>
                    )}
                    {agent.messages.length > 0 && (
                      <span className="text-[9px] px-1 rounded bg-accent-blue/15 text-accent-blue font-mono">
                        {agent.messages.length}
                      </span>
                    )}
                  </div>
                ))}

                {/* Cross-speak links */}
                {nodeLinks.length > 0 && (
                  <div className="px-2 py-1 flex flex-col gap-0.5">
                    {nodeLinks.map((link) => {
                      const otherId = link.nodeA === node.id ? link.nodeB : link.nodeA;
                      const other = nodes.find((n) => n.id === otherId);
                      if (!other) return null;
                      return (
                        <div key={link.id} className="flex items-center gap-1.5 text-[10px] text-accent-violet group/link">
                          <Link2 size={9} />
                          <span className="truncate flex-1">{other.name}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeCrossSpeakLink(link.id); }}
                            className="opacity-0 group-hover/link:opacity-100 text-fg-dim hover:text-accent-red text-[9px]"
                          >
                            <X size={9} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add agent inline */}
                <AddAgentInline nodeId={node.id} nodeCwd={node.directory} />

                {/* Add cross-speak link */}
                <CrossSpeakAdd node={node} allNodes={nodes} addLink={addCrossSpeakLink} existingLinks={crossSpeakLinks} />
              </div>
            )}
          </div>
        );
      })}

      {nodes.length === 0 && !showCreateNode && (
        <div className="text-center text-fg-dim text-xs py-8">
          No nodes yet. Create one to get started.
        </div>
      )}
    </div>
  );
}

function CreateNodeForm({ onClose }: { onClose: () => void }) {
  const createNode = useAppStore((s) => s.createNode);
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");

  const pickDirectory = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setDirectory(selected);
  };

  const handleSubmit = () => {
    if (!name.trim() || !directory.trim()) return;
    createNode(name.trim(), directory.trim());
    setName("");
    setDirectory("");
    onClose();
  };

  return (
    <div className="mx-1 p-2.5 rounded-md bg-card border border-edge flex flex-col gap-2 animate-fade-in">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Node name"
        className="w-full bg-elevated border border-edge rounded px-2 py-1.5 text-xs text-fg placeholder:text-fg-dim focus:outline-none focus:border-edge-focus"
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
      />
      <div className="flex gap-1.5">
        <input
          value={directory}
          onChange={(e) => setDirectory(e.target.value)}
          placeholder="Project directory"
          className="flex-1 bg-elevated border border-edge rounded px-2 py-1.5 text-xs text-fg placeholder:text-fg-dim focus:outline-none focus:border-edge-focus font-mono"
        />
        <button
          onClick={pickDirectory}
          className="px-2 py-1.5 rounded bg-elevated border border-edge text-xs text-fg-muted hover:text-fg hover:bg-hover transition-colors"
        >
          <Folder size={12} />
        </button>
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || !directory.trim()}
          className="flex-1 py-1.5 rounded bg-accent-blue/15 text-accent-blue text-xs font-medium hover:bg-accent-blue/25 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Create
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded text-xs text-fg-muted hover:text-fg hover:bg-hover transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddAgentInline({ nodeId, nodeCwd }: { nodeId: string; nodeCwd: string }) {
  const addAgent = useAppStore((s) => s.addAgent);
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [task, setTask] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) return;
    const agent = addAgent(nodeId, name.trim(), nodeCwd);
    try {
      await spawnAgent(agent.id, nodeId, name.trim(), nodeCwd, task.trim() || undefined);
    } catch (err) {
      console.error("Failed to spawn agent:", err);
    }
    setName("");
    setTask("");
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-fg-dim hover:text-fg-muted transition-colors rounded hover:bg-hover"
      >
        <Bot size={11} />
        <span>Add agent</span>
      </button>
    );
  }

  return (
    <div className="p-2 rounded bg-card border border-edge flex flex-col gap-1.5 animate-fade-in">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Agent name"
        className="w-full bg-elevated border border-edge rounded px-2 py-1 text-[11px] text-fg placeholder:text-fg-dim focus:outline-none focus:border-edge-focus"
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
      />
      <input
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Initial task (optional)"
        className="w-full bg-elevated border border-edge rounded px-2 py-1 text-[11px] text-fg placeholder:text-fg-dim focus:outline-none focus:border-edge-focus"
        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
      />
      <div className="flex gap-1">
        <button
          onClick={handleCreate}
          disabled={!name.trim()}
          className="flex-1 py-1 rounded bg-accent-green/15 text-accent-green text-[11px] hover:bg-accent-green/25 transition-colors disabled:opacity-30"
        >
          Spawn
        </button>
        <button
          onClick={() => { setIsOpen(false); setName(""); setTask(""); }}
          className="px-2 py-1 rounded text-[11px] text-fg-dim hover:text-fg-muted hover:bg-hover transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function CrossSpeakAdd({
  node,
  allNodes,
  addLink,
  existingLinks,
}: {
  node: typeof allNodes[0];
  allNodes: typeof allNodes;
  addLink: (a: string, b: string) => void;
  existingLinks: { nodeA: string; nodeB: string }[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();

  const linkedIds = new Set(
    existingLinks
      .filter((l) => l.nodeA === node.id || l.nodeB === node.id)
      .map((l) => (l.nodeA === node.id ? l.nodeB : l.nodeA))
  );
  const sameDirIds = new Set(
    allNodes.filter((n) => n.id !== node.id && norm(n.directory) === norm(node.directory)).map((n) => n.id)
  );
  const linkable = allNodes.filter(
    (n) => n.id !== node.id && !linkedIds.has(n.id) && !sameDirIds.has(n.id)
  );

  if (linkable.length === 0) return null;

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-fg-dim hover:text-accent-violet transition-colors rounded hover:bg-hover"
      >
        <Link2 size={11} />
        <span>Link node</span>
      </button>
    );
  }

  return (
    <div className="p-2 rounded bg-card border border-edge flex flex-col gap-1 animate-fade-in">
      <span className="text-[10px] text-fg-dim uppercase tracking-wider">Link to:</span>
      {linkable.map((n) => (
        <button
          key={n.id}
          onClick={() => { addLink(node.id, n.id); setIsOpen(false); }}
          className="flex items-center gap-1.5 px-1 py-0.5 rounded text-[11px] text-fg-secondary hover:text-accent-violet hover:bg-hover transition-colors"
        >
          <Circle size={6} fill={n.color} stroke={n.color} />
          <span className="truncate">{n.name}</span>
        </button>
      ))}
      <button
        onClick={() => setIsOpen(false)}
        className="text-[10px] text-fg-dim hover:text-fg-muted mt-0.5"
      >
        Cancel
      </button>
    </div>
  );
}

