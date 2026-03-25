import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/stores/appStore";
import { spawnAgent } from "@/lib/agentManager";
import { cn, formatRelative, truncatePath, getNodeIcon, AgentIcon } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  ChevronRight,
  Circle,
  Activity,
  FolderOpen,
  Trash2,
  Power,
  MessageSquare,
  GitBranch,
  Zap,
  Link2,
  X,
} from "lucide-react";
import type { AgentStatus, SwarmNode } from "@/types";

const STATUS_CONFIG: Record<AgentStatus, { color: string; label: string }> = {
  starting: { color: "bg-amber", label: "Starting" },
  active: { color: "bg-emerald", label: "Active" },
  idle: { color: "bg-sky", label: "Idle" },
  error: { color: "bg-rose", label: "Error" },
  stopped: { color: "bg-muted-foreground", label: "Stopped" },
};

export default function Sidebar() {
  const sidebarView = useAppStore((s) => s.sidebarView);
  const setSidebarView = useAppStore((s) => s.setSidebarView);

  return (
    <aside className="w-[260px] shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col animate-slide-left">
      {/* Manual tab switcher — avoids Base UI Tabs infinite loop */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex h-8 rounded-lg bg-muted p-[3px]">
          <button
            onClick={() => setSidebarView("nodes")}
            className={cn(
              "flex-1 rounded-md text-xs font-medium transition-colors",
              sidebarView === "nodes"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Nodes
          </button>
          <button
            onClick={() => setSidebarView("activity")}
            className={cn(
              "flex-1 rounded-md text-xs font-medium transition-colors",
              sidebarView === "activity"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Activity
          </button>
        </div>
      </div>

      <div className="h-px bg-border" />

      {sidebarView === "nodes" ? <NodesView /> : <ActivityView />}
    </aside>
  );
}

/* ================================================================== */
/* Nodes View                                                          */
/* ================================================================== */

function NodesView() {
  const nodes = useAppStore((s) => s.nodes);
  const agents = useAppStore((s) => s.agents);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectNode = useAppStore((s) => s.selectNode);
  const [showCreateNode, setShowCreateNode] = useState(false);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3 py-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full h-8 text-xs justify-start gap-2 border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
          onClick={() => setShowCreateNode(true)}
        >
          <Plus className="w-3.5 h-3.5" />
          Create Node
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-1.5">
        <div className="space-y-0.5 pb-3 stagger-children">
          {nodes.length === 0 ? (
            <EmptyNodes onCreateClick={() => setShowCreateNode(true)} />
          ) : (
            nodes.map((node, i) => (
              <NodeItem
                key={node.id}
                node={node}
                agents={agents.filter((a) => a.nodeId === node.id)}
                selected={selectedNodeId === node.id}
                onSelect={() => selectNode(node.id)}
                nodeIndex={i}
              />
            ))
          )}
        </div>
      </div>

      {showCreateNode && (
        <CreateNodeDialog onClose={() => setShowCreateNode(false)} />
      )}
    </div>
  );
}

function EmptyNodes({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-10 h-10 rounded-xl bg-secondary/50 flex items-center justify-center mb-3">
        <FolderOpen className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-[13px] text-muted-foreground mb-1">No nodes yet</p>
      <p className="text-[11px] text-muted-foreground/60 mb-4 leading-relaxed">
        Create a node to start orchestrating agents
      </p>
      <Button
        variant="outline"
        size="sm"
        className="text-xs"
        onClick={onCreateClick}
      >
        <Plus className="w-3.5 h-3.5 mr-1.5" />
        Create Node
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Single Node Item — manual expand/collapse, no Collapsible           */
/* ------------------------------------------------------------------ */

interface NodeItemProps {
  node: SwarmNode;
  agents: ReturnType<typeof useAppStore.getState>["agents"];
  selected: boolean;
  onSelect: () => void;
  nodeIndex: number;
}

function NodeItem({ node, agents, selected, onSelect, nodeIndex }: NodeItemProps) {
  const [expanded, setExpanded] = useState(true);
  const selectAgent = useAppStore((s) => s.selectAgent);
  const removeNode = useAppStore((s) => s.removeNode);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const activeCount = agents.filter((a) => a.status === "active").length;

  return (
    <div>
      <div
        className={cn(
          "rounded-lg transition-colors",
          selected ? "bg-secondary/80" : "hover:bg-secondary/40"
        )}
      >
        {/* Trigger — plain button, no Base UI Collapsible */}
        <button
          onClick={() => {
            onSelect();
            setExpanded((prev) => !prev);
          }}
          className="w-full flex items-center gap-2 px-2.5 py-2 text-left group"
        >
          <ChevronRight
            className={cn(
              "w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-200",
              expanded && "rotate-90"
            )}
          />
          {(() => {
            const NodeIcon = getNodeIcon(nodeIndex);
            return <NodeIcon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
          })()}
          <span className="text-[13px] font-medium text-foreground/90 truncate flex-1">
            {node.name}
          </span>
          {agents.length > 0 && (
            <Badge
              variant="secondary"
              className="h-4.5 px-1.5 text-[10px] font-mono tabular-nums"
            >
              {activeCount}/{agents.length}
            </Badge>
          )}
        </button>

        {/* Content */}
        {expanded && (
          <div className="pl-7 pr-2 pb-2 space-y-0.5">
            {/* Directory */}
            <div
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 font-mono px-1 py-0.5 truncate w-full"
              title={node.directory}
            >
              <FolderOpen className="w-3 h-3 shrink-0" />
              <span className="truncate">{truncatePath(node.directory, 28)}</span>
            </div>

            {/* Agents */}
            {agents.map((agent) => {
              const status = STATUS_CONFIG[agent.status];
              return (
                <button
                  key={agent.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectAgent(agent.id);
                  }}
                  className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/50 transition-colors"
                >
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      status.color,
                      agent.status === "active" && "animate-pulse-dot"
                    )}
                  />
                  <AgentIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="text-[12px] text-foreground/80 truncate flex-1">
                    {agent.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50">
                    {status.label}
                  </span>
                </button>
              );
            })}

            {/* Actions */}
            <div className="flex items-center gap-1 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px] text-muted-foreground hover:text-foreground px-2 gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAddAgent(true);
                }}
              >
                <Plus className="w-3 h-3" />
                Agent
              </Button>
              <div className="flex-1" />
              <button
                className="inline-flex items-center justify-center h-6 w-6 p-0 rounded-md text-muted-foreground/40 hover:text-rose hover:bg-secondary/50 transition-colors"
                title="Remove node"
                onClick={(e) => {
                  e.stopPropagation();
                  removeNode(node.id);
                }}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      {showAddAgent && (
        <AddAgentDialog
          onClose={() => setShowAddAgent(false)}
          node={node}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/* Activity View                                                       */
/* ================================================================== */

function ActivityView() {
  const activityLog = useAppStore((s) => s.activityLog);

  const typeIcon: Record<string, typeof Zap> = {
    agent_spawn: Zap,
    agent_stop: Power,
    message: MessageSquare,
    diff: GitBranch,
    system: Activity,
    cross_speak: Link2,
  };

  const typeColor: Record<string, string> = {
    agent_spawn: "text-emerald",
    agent_stop: "text-muted-foreground",
    message: "text-sky",
    diff: "text-amber",
    system: "text-violet",
    cross_speak: "text-cyan",
  };

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-1.5">
      <div className="space-y-0.5 py-2">
        {activityLog.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Activity className="w-5 h-5 text-muted-foreground/40 mb-2" />
            <p className="text-[12px] text-muted-foreground/60">No activity yet</p>
          </div>
        ) : (
          [...activityLog].reverse().map((event) => {
            const Icon = typeIcon[event.type] ?? Circle;
            const color = typeColor[event.type] ?? "text-muted-foreground";
            return (
              <div
                key={event.id}
                className="flex items-start gap-2 px-2.5 py-1.5 rounded-md hover:bg-secondary/30 transition-colors"
              >
                <Icon className={cn("w-3 h-3 mt-0.5 shrink-0", color)} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-foreground/75 leading-relaxed break-words">
                    {event.text}
                  </p>
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                    {formatRelative(event.timestamp)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Simple Modal                                                        */
/* ================================================================== */

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md mx-4 bg-card border border-border rounded-xl p-4 shadow-2xl animate-fade-in-up">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        {children}
      </div>
    </div>,
    document.body
  );
}

/* ================================================================== */
/* Dialogs                                                             */
/* ================================================================== */

function CreateNodeDialog({ onClose }: { onClose: () => void }) {
  const createNode = useAppStore((s) => s.createNode);
  const addAgent = useAppStore((s) => s.addAgent);
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [task, setTask] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !directory.trim()) return;
    const node = createNode(name.trim(), directory.trim());

    // If a task is provided, auto-spawn a boss agent
    if (task.trim()) {
      const bossName = `${name.trim()}-lead`;
      const agent = addAgent(node.id, bossName, directory.trim(), "boss");
      try {
        await spawnAgent(agent.id, node.id, bossName, directory.trim(), task.trim(), "boss", "opus");
      } catch (err) {
        console.error("Failed to spawn boss agent:", err);
      }
    }

    setName("");
    setDirectory("");
    setTask("");
    onClose();
  }, [name, directory, task, createNode, addAgent, onClose]);

  const pickFolder = useCallback(async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({ directory: true });
      if (selected) setDirectory(selected as string);
    } catch {
      // Dialog not available in dev
    }
  }, []);

  const hasTask = task.trim().length > 0;

  return (
    <Modal onClose={onClose}>
      <h3 className="text-sm font-semibold mb-4">Create Node</h3>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Name
          </label>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. frontend-app"
            className="flex h-8 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => e.key === "Enter" && !hasTask && handleCreate()}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Directory
          </label>
          <div className="flex gap-2">
            <input
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder="/path/to/project"
              className="flex h-8 w-full rounded-md border border-border bg-background px-3 text-[13px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={(e) => e.key === "Enter" && !hasTask && handleCreate()}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 shrink-0"
              onClick={pickFolder}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Initial Task
            <span className="normal-case tracking-normal font-normal text-muted-foreground/40 ml-1">(optional)</span>
          </label>
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe what this node should accomplish. A lead agent will analyze the task and spawn sub-agents automatically..."
            rows={3}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none leading-relaxed"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border/50">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={!name.trim() || !directory.trim()}
          className={cn(
            "text-white",
            hasTask
              ? "bg-violet hover:bg-violet/90"
              : "bg-emerald hover:bg-emerald/90"
          )}
        >
          {hasTask ? "Create & Deploy" : "Create"}
        </Button>
      </div>
    </Modal>
  );
}

function AddAgentDialog({
  onClose,
  node,
}: {
  onClose: () => void;
  node: SwarmNode;
}) {
  const addAgent = useAppStore((s) => s.addAgent);
  const [name, setName] = useState("");
  const [task, setTask] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    const agent = addAgent(node.id, name.trim(), node.directory);
    try {
      await spawnAgent(agent.id, node.id, name.trim(), node.directory, task || undefined);
    } catch (err) {
      console.error("Failed to spawn agent:", err);
    }
    setName("");
    setTask("");
    onClose();
  }, [name, task, node, addAgent, onClose]);

  return (
    <Modal onClose={onClose}>
      <h3 className="text-sm font-semibold mb-4">
        Add Agent to {node.name}
      </h3>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Agent Name
          </label>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. code-reviewer"
            className="flex h-8 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Initial Task (optional)
          </label>
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="What should this agent do?"
            className="flex h-8 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border/50">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={!name.trim()}
          className="bg-emerald text-white hover:bg-emerald/90"
        >
          Spawn Agent
        </Button>
      </div>
    </Modal>
  );
}
