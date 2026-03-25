import { useMemo, useCallback, useRef, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, Link2, GripHorizontal, Unlink, Bell } from "lucide-react";
import { AgentIcon, getNodeIcon } from "@/lib/utils";
import type { SwarmNode, Agent, CrossSpeakLink } from "@/types";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 120;
const CANVAS_PADDING = 60;

/**
 * 2D node map that renders nodes in a grid layout with SVG connection lines.
 * Supports drag-to-connect: grab the bottom-right handle and drag to another node.
 */
export default function NodeCanvas() {
  const nodes = useAppStore((s) => s.nodes);
  const agents = useAppStore((s) => s.agents);
  const crossSpeakLinks = useAppStore((s) => s.crossSpeakLinks);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectNode = useAppStore((s) => s.selectNode);
  const dragging = useAppStore((s) => s.dragging);
  const connectionMenu = useAppStore((s) => s.connectionMenu);
  const startDrag = useAppStore((s) => s.startDrag);
  const updateDrag = useAppStore((s) => s.updateDrag);
  const endDrag = useAppStore((s) => s.endDrag);
  const addCrossSpeakLink = useAppStore((s) => s.addCrossSpeakLink);
  const removeCrossSpeakLink = useAppStore((s) => s.removeCrossSpeakLink);
  const openConnectionMenu = useAppStore((s) => s.openConnectionMenu);
  const closeConnectionMenu = useAppStore((s) => s.closeConnectionMenu);

  const canvasRef = useRef<HTMLDivElement>(null);

  // Lay out nodes in a grid
  const positions = useMemo(() => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    const gapX = NODE_WIDTH + 48;
    const gapY = NODE_HEIGHT + 48;
    const map = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      map.set(node.id, {
        x: CANVAS_PADDING + col * gapX,
        y: CANVAS_PADDING + row * gapY,
      });
    });
    return map;
  }, [nodes]);

  // Convert client coordinates to canvas-local coordinates
  const toCanvasCoords = useCallback(
    (clientX: number, clientY: number) => {
      const el = canvasRef.current;
      if (!el) return { x: clientX, y: clientY };
      const rect = el.getBoundingClientRect();
      return {
        x: clientX - rect.left + el.scrollLeft,
        y: clientY - rect.top + el.scrollTop,
      };
    },
    []
  );

  // Hit-test: find which node the cursor is over
  const hitTestNode = useCallback(
    (canvasX: number, canvasY: number): string | null => {
      for (const [nodeId, pos] of positions) {
        if (
          canvasX >= pos.x &&
          canvasX <= pos.x + NODE_WIDTH &&
          canvasY >= pos.y &&
          canvasY <= pos.y + NODE_HEIGHT
        ) {
          return nodeId;
        }
      }
      return null;
    },
    [positions]
  );

  // Determine which node is being hovered during drag
  const dragTargetNodeId = useMemo(() => {
    if (!dragging) return null;
    const target = hitTestNode(dragging.cursorX, dragging.cursorY);
    return target && target !== dragging.fromNodeId ? target : null;
  }, [dragging, hitTestNode]);

  // Window-level drag tracking
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const coords = toCanvasCoords(e.clientX, e.clientY);
      updateDrag(coords.x, coords.y);
    };

    const handleMouseUp = (e: MouseEvent) => {
      const coords = toCanvasCoords(e.clientX, e.clientY);
      const target = hitTestNode(coords.x, coords.y);
      if (target && target !== dragging.fromNodeId) {
        addCrossSpeakLink(dragging.fromNodeId, target);
      }
      endDrag();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, toCanvasCoords, hitTestNode, addCrossSpeakLink, endDrag, updateDrag]);

  // Close connection menu on click-away or Escape
  useEffect(() => {
    if (!connectionMenu) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-connection-menu]")) {
        closeConnectionMenu();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeConnectionMenu();
    };

    // Defer so the right-click that opened the menu doesn't immediately close it
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handleClick);
      window.addEventListener("keydown", handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [connectionMenu, closeConnectionMenu]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        selectNode(null);
        closeConnectionMenu();
      }
    },
    [selectNode, closeConnectionMenu]
  );

  const handleDragStart = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const coords = toCanvasCoords(e.clientX, e.clientY);
      startDrag(nodeId, coords.x, coords.y);
    },
    [toCanvasCoords, startDrag]
  );

  const handleContextMenu = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openConnectionMenu(nodeId, e.clientX, e.clientY);
    },
    [openConnectionMenu]
  );

  if (nodes.length === 0) {
    return <EmptyCanvas />;
  }

  // Build a lookup of node colors by ID
  const nodeColorMap = new Map(nodes.map((n) => [n.id, n.color]));

  // Source node center for the temp drag line
  const dragSourcePos = dragging ? positions.get(dragging.fromNodeId) : null;

  return (
    <div
      ref={canvasRef}
      className={cn("flex-1 relative overflow-auto", dragging && "cursor-grabbing")}
      onClick={handleCanvasClick}
    >
      {/* SVG connection lines */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
        <defs>
          {/* Glow filter for connection lines */}
          <filter id="link-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          {/* Per-link gradients using node colors */}
          {crossSpeakLinks.map((link) => {
            const posA = positions.get(link.nodeA);
            const posB = positions.get(link.nodeB);
            if (!posA || !posB) return null;
            const colorA = nodeColorMap.get(link.nodeA) ?? "#06b6d4";
            const colorB = nodeColorMap.get(link.nodeB) ?? "#06b6d4";
            return (
              <linearGradient
                key={`grad-${link.id}`}
                id={`link-grad-${link.id}`}
                gradientUnits="userSpaceOnUse"
                x1={posA.x + NODE_WIDTH / 2}
                y1={posA.y + NODE_HEIGHT / 2}
                x2={posB.x + NODE_WIDTH / 2}
                y2={posB.y + NODE_HEIGHT / 2}
              >
                <stop offset="0%" stopColor={colorA} stopOpacity="0.9" />
                <stop offset="100%" stopColor={colorB} stopOpacity="0.9" />
              </linearGradient>
            );
          })}
        </defs>

        {/* Permanent connection lines */}
        {crossSpeakLinks.map((link) => {
          const posA = positions.get(link.nodeA);
          const posB = positions.get(link.nodeB);
          if (!posA || !posB) return null;
          const x1 = posA.x + NODE_WIDTH / 2;
          const y1 = posA.y + NODE_HEIGHT / 2;
          const x2 = posB.x + NODE_WIDTH / 2;
          const y2 = posB.y + NODE_HEIGHT / 2;
          return (
            <g key={link.id}>
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={`url(#link-grad-${link.id})`}
                strokeWidth="2.5"
                strokeLinecap="round"
                filter="url(#link-glow)"
              />
              {/* Midpoint icon */}
              <g transform={`translate(${(x1 + x2) / 2 - 8}, ${(y1 + y2) / 2 - 8})`}>
                <rect width="16" height="16" rx="4" fill="oklch(0.11 0.005 285)" stroke="oklch(0.25 0 0)" strokeWidth="1" />
              </g>
            </g>
          );
        })}

        {/* Temporary drag line */}
        {dragging && dragSourcePos && (
          <line
            x1={dragSourcePos.x + NODE_WIDTH / 2}
            y1={dragSourcePos.y + NODE_HEIGHT / 2}
            x2={dragging.cursorX}
            y2={dragging.cursorY}
            stroke="white"
            strokeWidth="2"
            strokeDasharray="8 4"
            strokeOpacity="0.5"
            strokeLinecap="round"
          />
        )}
      </svg>

      {/* Node cards */}
      {nodes.map((node, i) => {
        const pos = positions.get(node.id);
        if (!pos) return null;
        const nodeAgents = agents.filter((a) => a.nodeId === node.id);
        return (
          <NodeCard
            key={node.id}
            node={node}
            agents={nodeAgents}
            x={pos.x}
            y={pos.y}
            selected={selectedNodeId === node.id}
            onSelect={() => selectNode(node.id)}
            index={i}
            isDragTarget={dragTargetNodeId === node.id}
            onDragStart={(e) => handleDragStart(node.id, e)}
            onHandleContextMenu={(e) => handleContextMenu(node.id, e)}
          />
        );
      })}

      {/* Connection context menu */}
      {connectionMenu && (
        <ConnectionContextMenu
          nodeId={connectionMenu.nodeId}
          x={connectionMenu.x}
          y={connectionMenu.y}
          nodes={nodes}
          crossSpeakLinks={crossSpeakLinks}
          onDisconnect={(linkId) => {
            removeCrossSpeakLink(linkId);
            closeConnectionMenu();
          }}
          onClose={closeConnectionMenu}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

function EmptyCanvas() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-3 animate-fade-in-up">
        <div className="w-14 h-14 rounded-2xl bg-secondary/40 border border-border/50 flex items-center justify-center mx-auto">
          <FolderOpen className="w-6 h-6 text-muted-foreground/50" />
        </div>
        <div>
          <p className="text-[14px] font-medium text-foreground/60">No nodes configured</p>
          <p className="text-[12px] text-muted-foreground/50 mt-1">
            Create a node from the sidebar to get started
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Connection Context Menu                                             */
/* ------------------------------------------------------------------ */

interface ConnectionContextMenuProps {
  nodeId: string;
  x: number;
  y: number;
  nodes: SwarmNode[];
  crossSpeakLinks: CrossSpeakLink[];
  onDisconnect: (linkId: string) => void;
  onClose: () => void;
}

function ConnectionContextMenu({
  nodeId,
  x,
  y,
  nodes,
  crossSpeakLinks,
  onDisconnect,
}: ConnectionContextMenuProps) {
  const links = crossSpeakLinks.filter(
    (l) => l.nodeA === nodeId || l.nodeB === nodeId
  );

  return (
    <div
      data-connection-menu
      className="fixed z-50 min-w-[180px] rounded-lg bg-popover border border-border shadow-xl shadow-black/30 p-1 animate-fade-in-up"
      style={{ left: x, top: y }}
    >
      <div className="px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        Connections
      </div>
      {links.length === 0 ? (
        <div className="px-2.5 py-2 text-[12px] text-muted-foreground/50 italic">
          No connections
        </div>
      ) : (
        links.map((link) => {
          const otherNodeId = link.nodeA === nodeId ? link.nodeB : link.nodeA;
          const otherNode = nodes.find((n) => n.id === otherNodeId);
          return (
            <button
              key={link.id}
              onClick={() => onDisconnect(link.id)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] text-foreground/80 hover:bg-secondary/60 transition-colors group/item"
            >
              {(() => {
                const otherIdx = nodes.findIndex((n) => n.id === otherNodeId);
                const OtherIcon = getNodeIcon(otherIdx >= 0 ? otherIdx : 0);
                return <OtherIcon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
              })()}
              <span className="truncate flex-1 text-left">
                {otherNode?.name ?? otherNodeId}
              </span>
              <Unlink className="w-3.5 h-3.5 text-rose/70 opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0" />
            </button>
          );
        })
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Node Card                                                           */
/* ------------------------------------------------------------------ */

interface NodeCardProps {
  node: SwarmNode;
  agents: Agent[];
  x: number;
  y: number;
  selected: boolean;
  onSelect: () => void;
  index: number;
  isDragTarget: boolean;
  onDragStart: (e: React.MouseEvent) => void;
  onHandleContextMenu: (e: React.MouseEvent) => void;
}

function NodeCard({
  node,
  agents,
  x,
  y,
  selected,
  onSelect,
  index,
  isDragTarget,
  onDragStart,
  onHandleContextMenu,
}: NodeCardProps) {
  const activeCount = agents.filter((a) => a.status === "active").length;
  const hasLinks = useAppStore(
    (s) => s.crossSpeakLinks.some((l) => l.nodeA === node.id || l.nodeB === node.id)
  );
  const notifCount = useAppStore((s) => s.nodeNotifications[node.id] ?? 0);
  const clearNodeNotifications = useAppStore((s) => s.clearNodeNotifications);

  const handleClick = useCallback(() => {
    onSelect();
    if (notifCount > 0) clearNodeNotifications(node.id);
  }, [onSelect, notifCount, clearNodeNotifications, node.id]);

  return (
    <button
      onClick={handleClick}
      className={cn(
        "absolute rounded-xl border transition-all duration-200 text-left group",
        "bg-card/80 backdrop-blur-sm hover:bg-card",
        selected
          ? "border-border ring-1 ring-ring/30 shadow-lg shadow-black/20"
          : "border-border/50 hover:border-border",
        isDragTarget && "ring-2 ring-white/40 shadow-lg shadow-white/10 border-white/30",
        "animate-fade-in-up"
      )}
      style={{
        left: x,
        top: y,
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        animationDelay: `${index * 50}ms`,
        zIndex: selected ? 10 : isDragTarget ? 5 : 1,
      }}
    >
      {/* Node icon accent */}
      {(() => {
        const NodeIcon = getNodeIcon(index);
        return (
          <div className="absolute left-2.5 top-3.5">
            <NodeIcon className={cn(
              "w-4 h-4 transition-opacity duration-200",
              selected ? "text-zinc-300" : "text-zinc-500"
            )} />
          </div>
        );
      })()}

      {/* Notification bell — top-right */}
      {notifCount > 0 && (
        <div className="absolute top-2 right-2 flex items-center gap-1 z-10 animate-fade-in-up">
          <div className="relative">
            <Bell className="w-4 h-4 text-amber" />
            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-amber text-[9px] font-bold text-black px-0.5 leading-none">
              {notifCount > 9 ? "9+" : notifCount}
            </span>
          </div>
        </div>
      )}

      <div className="p-3.5 pl-8 space-y-2.5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-foreground/90 truncate">
            {node.name}
          </span>
          <div className="flex items-center gap-1.5">
            {hasLinks && (
              <span title="Cross-speak enabled">
                <Link2 className="w-3 h-3 text-cyan" />
              </span>
            )}
            {agents.length > 0 && (
              <Badge
                variant="secondary"
                className="h-4.5 px-1.5 text-[10px] font-mono"
              >
                {activeCount}/{agents.length}
              </Badge>
            )}
          </div>
        </div>

        {/* Agent list */}
        {agents.length > 0 ? (
          <div className="space-y-1">
            {agents.slice(0, 4).map((agent) => {
              const status = agent.status;
              return (
                <div
                  key={agent.id}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                >
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      status === "active" && "bg-emerald animate-pulse-dot",
                      status === "starting" && "bg-amber",
                      status === "idle" && "bg-sky",
                      status === "error" && "bg-rose",
                      status === "stopped" && "bg-muted-foreground/50"
                    )}
                  />
                  <AgentIcon className="w-3 h-3 shrink-0 opacity-50" />
                  <span className="truncate">{agent.name}</span>
                </div>
              );
            })}
            {agents.length > 4 && (
              <p className="text-[10px] text-muted-foreground/50 pl-4">
                +{agents.length - 4} more
              </p>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground/40 italic">
            No agents
          </p>
        )}
      </div>

      {/* Drag handle — bottom-right corner */}
      <div
        className={cn(
          "absolute bottom-0 right-0 w-7 h-7 flex items-center justify-center",
          "rounded-tl-lg rounded-br-xl cursor-grab",
          "opacity-0 group-hover:opacity-100 transition-all duration-150",
          "hover:scale-110 active:scale-95 active:cursor-grabbing"
        )}
        style={{ backgroundColor: node.color + "30" }}
        onMouseDown={onDragStart}
        onContextMenu={onHandleContextMenu}
        title="Drag to connect · Right-click for options"
      >
        <GripHorizontal className="w-3.5 h-3.5" style={{ color: node.color }} />
      </div>
    </button>
  );
}
