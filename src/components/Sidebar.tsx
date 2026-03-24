import { useState } from "react";
import { useAppStore } from "../stores/appStore";
import { spawnAgent, killAgent } from "../lib/agentManager";
import type { AgentStatus } from "../types";

const STATUS_DOT: Record<AgentStatus, string> = {
  starting: "bg-accent-amber",
  active: "bg-accent-cyan",
  idle: "bg-text-muted",
  error: "bg-accent-red",
  stopped: "bg-bg-hover",
};

export default function Sidebar() {
  const nodes = useAppStore((s) => s.nodes);
  const agents = useAppStore((s) => s.agents);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const createNode = useAppStore((s) => s.createNode);
  const removeNode = useAppStore((s) => s.removeNode);
  const addAgent = useAppStore((s) => s.addAgent);
  const removeAgent = useAppStore((s) => s.removeAgent);
  const selectNode = useAppStore((s) => s.selectNode);
  const selectAgent = useAppStore((s) => s.selectAgent);

  const [newNodeName, setNewNodeName] = useState("");
  const [showNewNode, setShowNewNode] = useState(false);
  const [showNewAgent, setShowNewAgent] = useState<string | null>(null);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentCwd, setNewAgentCwd] = useState("");
  const [newAgentTask, setNewAgentTask] = useState("");

  const handleCreateNode = () => {
    if (!newNodeName.trim()) return;
    const node = createNode(newNodeName.trim());
    setNewNodeName("");
    setShowNewNode(false);
    selectNode(node.id);
  };

  const handleCreateAgent = async (nodeId: string) => {
    if (!newAgentName.trim()) return;
    const cwd = newAgentCwd.trim() || ".";
    const name = newAgentName.trim();
    const task = newAgentTask.trim() || undefined;
    const agent = addAgent(nodeId, name, cwd);
    setNewAgentName("");
    setNewAgentCwd("");
    setNewAgentTask("");
    setShowNewAgent(null);
    selectAgent(agent.id);

    // Spawn the persistent Claude Code process
    try {
      await spawnAgent(agent.id, nodeId, name, cwd, task);
    } catch (err) {
      console.error("Failed to spawn agent:", err);
    }
  };

  return (
    <div className="w-64 h-full bg-bg-secondary border-r border-border-subtle flex flex-col shrink-0 animate-slide-left">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border-subtle flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
          Nodes
        </span>
        <button
          onClick={() => setShowNewNode(true)}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-accent-cyan text-lg leading-none"
          title="Create node"
        >
          +
        </button>
      </div>

      {/* New node form */}
      {showNewNode && (
        <div className="px-3 py-2 border-b border-border-subtle animate-fade-in">
          <input
            type="text"
            value={newNodeName}
            onChange={(e) => setNewNodeName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateNode();
              if (e.key === "Escape") setShowNewNode(false);
            }}
            placeholder="Node name..."
            autoFocus
            className="w-full px-2 py-1.5 text-xs bg-bg-primary border border-border-default rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/50"
          />
          <div className="flex gap-1.5 mt-1.5">
            <button
              onClick={handleCreateNode}
              className="flex-1 px-2 py-1 text-xs rounded-md bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25 transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => setShowNewNode(false)}
              className="px-2 py-1 text-xs rounded-md text-text-muted hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Node list */}
      <div className="flex-1 overflow-y-auto">
        {nodes.length === 0 && !showNewNode && (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-text-muted">No nodes yet</p>
            <button
              onClick={() => setShowNewNode(true)}
              className="mt-2 text-xs text-accent-cyan hover:text-accent-cyan/80 transition-colors"
            >
              Create your first node
            </button>
          </div>
        )}

        {nodes.map((node) => {
          const nodeAgents = agents.filter((a) => a.nodeId === node.id);
          const isExpanded = selectedNodeId === node.id;

          return (
            <div key={node.id} className="border-b border-border-subtle/50">
              {/* Node row */}
              <button
                onClick={() => selectNode(isExpanded ? null : node.id)}
                className={`w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-bg-hover/50 transition-colors ${
                  isExpanded ? "bg-bg-hover/30" : ""
                }`}
              >
                <div
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: node.color }}
                />
                <span className="text-sm text-text-primary truncate flex-1">
                  {node.name}
                </span>
                <span className="text-xs text-text-muted">{nodeAgents.length}</span>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  className={`text-text-muted transition-transform ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                >
                  <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.5" fill="none" />
                </svg>
              </button>

              {/* Expanded: agents list */}
              {isExpanded && (
                <div className="animate-fade-in">
                  {nodeAgents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() =>
                        selectAgent(selectedAgentId === agent.id ? null : agent.id)
                      }
                      className={`w-full px-3 pl-7 py-1.5 flex items-center gap-2 text-left hover:bg-bg-hover/50 transition-colors ${
                        selectedAgentId === agent.id ? "bg-bg-hover/40" : ""
                      }`}
                    >
                      <div
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          STATUS_DOT[agent.status]
                        }`}
                      />
                      <span className="text-xs text-text-secondary truncate flex-1">
                        {agent.name}
                      </span>
                      <span className="text-[10px] text-text-muted capitalize">
                        {agent.status}
                      </span>
                    </button>
                  ))}

                  {/* Add agent button */}
                  {showNewAgent === node.id ? (
                    <div className="px-3 pl-7 py-2 animate-fade-in">
                      <input
                        type="text"
                        value={newAgentName}
                        onChange={(e) => setNewAgentName(e.target.value)}
                        placeholder="Agent name..."
                        autoFocus
                        className="w-full px-2 py-1 text-xs bg-bg-primary border border-border-default rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/50"
                      />
                      <input
                        type="text"
                        value={newAgentCwd}
                        onChange={(e) => setNewAgentCwd(e.target.value)}
                        placeholder="Working directory..."
                        className="w-full px-2 py-1 mt-1 text-xs bg-bg-primary border border-border-default rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/50"
                      />
                      <textarea
                        value={newAgentTask}
                        onChange={(e) => setNewAgentTask(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleCreateAgent(node.id);
                          }
                          if (e.key === "Escape") setShowNewAgent(null);
                        }}
                        placeholder="Task description (optional)..."
                        rows={2}
                        className="w-full px-2 py-1 mt-1 text-xs bg-bg-primary border border-border-default rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/50 resize-none"
                      />
                      <div className="flex gap-1.5 mt-1.5">
                        <button
                          onClick={() => handleCreateAgent(node.id)}
                          className="flex-1 px-2 py-1 text-xs rounded bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25 transition-colors"
                        >
                          Spawn
                        </button>
                        <button
                          onClick={() => setShowNewAgent(null)}
                          className="px-2 py-1 text-xs rounded text-text-muted hover:bg-bg-hover transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowNewAgent(node.id)}
                      className="w-full px-3 pl-7 py-1.5 flex items-center gap-2 text-left text-xs text-text-muted hover:text-accent-cyan hover:bg-bg-hover/30 transition-colors"
                    >
                      <span>+</span>
                      <span>Add agent</span>
                    </button>
                  )}

                  {/* Remove node */}
                  <button
                    onClick={() => removeNode(node.id)}
                    className="w-full px-3 pl-7 py-1.5 flex items-center gap-2 text-left text-xs text-text-muted hover:text-accent-red hover:bg-bg-hover/30 transition-colors"
                  >
                    <span className="text-[10px]">x</span>
                    <span>Remove node</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
