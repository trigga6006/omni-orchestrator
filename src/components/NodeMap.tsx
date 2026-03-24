import { useAppStore } from "../stores/appStore";
import { cn, truncatePath } from "../lib/utils";
import {
  Circle,
  Bot,
  ArrowRightLeft,
  Zap,
} from "lucide-react";
import type { SwarmNode, Agent, CrossSpeakLink } from "../types";

const STATUS_COLORS: Record<string, string> = {
  starting: "bg-accent-amber",
  active: "bg-accent-green",
  idle: "bg-fg-muted",
  error: "bg-accent-red",
  stopped: "bg-fg-dim",
};

const STATUS_LABEL_COLORS: Record<string, string> = {
  starting: "text-accent-amber bg-accent-amber/10",
  active: "text-accent-green bg-accent-green/10",
  idle: "text-fg-muted bg-fg-muted/10",
  error: "text-accent-red bg-accent-red/10",
  stopped: "text-fg-dim bg-fg-dim/10",
};

export default function NodeMap() {
  const nodes = useAppStore((s) => s.nodes);
  const agents = useAppStore((s) => s.agents);
  const crossSpeakLinks = useAppStore((s) => s.crossSpeakLinks);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const selectNode = useAppStore((s) => s.selectNode);
  const selectAgent = useAppStore((s) => s.selectAgent);

  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center dot-grid">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-card border border-edge flex items-center justify-center mx-auto mb-3">
            <Zap size={20} className="text-fg-dim" />
          </div>
          <p className="text-sm text-fg-muted">No nodes yet</p>
          <p className="text-xs text-fg-dim mt-1">
            Create a node from the sidebar to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto dot-grid p-6">
      {/* Node cards grid */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 max-w-6xl mx-auto">
        {nodes.map((node) => {
          const nodeAgents = agents.filter((a) => a.nodeId === node.id);
          const links = crossSpeakLinks.filter(
            (l) => l.nodeA === node.id || l.nodeB === node.id
          );

          return (
            <NodeCard
              key={node.id}
              node={node}
              agents={nodeAgents}
              links={links}
              allNodes={nodes}
              isSelected={selectedNodeId === node.id}
              selectedAgentId={selectedAgentId}
              onSelectNode={selectNode}
              onSelectAgent={selectAgent}
            />
          );
        })}
      </div>

      {/* Connection lines info */}
      {crossSpeakLinks.length > 0 && (
        <div className="mt-6 flex items-center justify-center gap-4 text-[11px] text-fg-dim">
          <span className="flex items-center gap-1.5">
            <ArrowRightLeft size={11} className="text-accent-violet" />
            {crossSpeakLinks.length} cross-speak link{crossSpeakLinks.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function NodeCard({
  node,
  agents,
  links,
  allNodes,
  isSelected,
  selectedAgentId,
  onSelectNode,
  onSelectAgent,
}: {
  node: SwarmNode;
  agents: Agent[];
  links: CrossSpeakLink[];
  allNodes: SwarmNode[];
  isSelected: boolean;
  selectedAgentId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectAgent: (id: string | null) => void;
}) {
  const activeCount = agents.filter((a) => a.status === "active").length;

  return (
    <div
      className={cn(
        "rounded-lg border transition-all cursor-pointer",
        isSelected
          ? "bg-card border-edge-strong shadow-[0_0_0_1px_rgba(59,130,246,0.2)]"
          : "bg-card/60 border-edge hover:border-edge-strong hover:bg-card"
      )}
      onClick={() => onSelectNode(node.id)}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-edge">
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: node.color }}
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-fg truncate">{node.name}</h3>
          <p className="text-[11px] text-fg-dim font-mono truncate mt-0.5">
            {truncatePath(node.directory, 36)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] shrink-0">
          {activeCount > 0 && (
            <span className="flex items-center gap-1 text-accent-green">
              <Circle size={5} fill="currentColor" className="animate-pulse-dot" />
              {activeCount}
            </span>
          )}
          <span className="text-fg-dim font-mono">{agents.length}</span>
          <Bot size={13} className="text-fg-dim" />
        </div>
      </div>

      {/* Agents list */}
      <div className="px-2 py-1.5">
        {agents.length === 0 ? (
          <div className="px-2 py-3 text-center text-[11px] text-fg-dim">
            No agents spawned
          </div>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectAgent(agent.id);
              }}
              className={cn(
                "flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors",
                selectedAgentId === agent.id
                  ? "bg-elevated"
                  : "hover:bg-elevated/50"
              )}
            >
              <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", STATUS_COLORS[agent.status])} />
              <span className="text-xs text-fg flex-1 truncate">{agent.name}</span>
              {agent.messages.length > 0 && (
                <span className="text-[9px] px-1 py-0 rounded bg-accent-blue/10 text-accent-blue font-mono">
                  {agent.messages.length} msg
                </span>
              )}
              {agent.diffs.length > 0 && (
                <span className="text-[9px] px-1 py-0 rounded bg-accent-violet/10 text-accent-violet font-mono">
                  {agent.diffs.length} diff
                </span>
              )}
              <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-medium", STATUS_LABEL_COLORS[agent.status])}>
                {agent.status}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Cross-speak footer */}
      {links.length > 0 && (
        <div className="px-4 py-2 border-t border-edge flex items-center gap-2 flex-wrap">
          <ArrowRightLeft size={10} className="text-accent-violet shrink-0" />
          {links.map((link) => {
            const otherId = link.nodeA === node.id ? link.nodeB : link.nodeA;
            const other = allNodes.find((n) => n.id === otherId);
            return (
              <span key={link.id} className="text-[10px] text-accent-violet bg-accent-violet/10 px-1.5 py-0.5 rounded">
                {other?.name ?? "Unknown"}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
