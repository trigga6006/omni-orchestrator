import { create } from "zustand";
import type {
  SwarmNode,
  Agent,
  AgentStatus,
  ConnectionEdge,
  BrokerStatus,
  AgentMessage,
  DiffEntry,
  CrossSpeakLink,
  ActivityEvent,
} from "../types";

const NODE_COLORS = [
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#ec4899", // pink
  "#3b82f6", // blue
  "#f97316", // orange
];

interface AppState {
  // Data
  nodes: SwarmNode[];
  agents: Agent[];
  connections: ConnectionEdge[];
  crossSpeakLinks: CrossSpeakLink[];
  broker: BrokerStatus;

  // UI state
  selectedNodeId: string | null;
  selectedAgentId: string | null;
  showDiffFor: string | null; // agent ID to show diff panel
  sidebarOpen: boolean;
  sidebarView: "nodes" | "activity";
  rightDrawerOpen: boolean;
  panelView: "chat" | "diff" | "info";

  // Actions - Nodes
  createNode: (name: string, directory: string) => SwarmNode;
  removeNode: (id: string) => void;
  updateNodePosition: (id: string, pos: [number, number, number]) => void;

  // Actions - Cross-speak
  addCrossSpeakLink: (nodeA: string, nodeB: string) => void;
  removeCrossSpeakLink: (linkId: string) => void;
  canNodesCommunicate: (nodeIdA: string, nodeIdB: string) => boolean;

  // Actions - Agents
  addAgent: (nodeId: string, name: string, cwd: string) => Agent;
  removeAgent: (id: string) => void;
  updateAgentStatus: (id: string, status: AgentStatus) => void;
  updateAgentSummary: (id: string, summary: string) => void;
  updateAgentPeerId: (id: string, peerId: string) => void;
  updateAgentPid: (id: string, pid: number) => void;
  addAgentMessage: (agentId: string, message: AgentMessage) => void;
  setAgentDiff: (agentId: string, diff: DiffEntry | null) => void;
  setAgentDiffs: (agentId: string, diffs: DiffEntry[]) => void;

  // Actions - Connections
  addConnection: (from: string, to: string) => void;

  // Activity feed
  activityLog: ActivityEvent[];
  activityFeedOpen: boolean;
  pushActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void;
  toggleActivityFeed: () => void;

  // Actions - UI
  selectNode: (id: string | null) => void;
  selectAgent: (id: string | null) => void;
  toggleDiff: (agentId: string | null) => void;
  toggleSidebar: () => void;
  setSidebarView: (view: "nodes" | "activity") => void;
  toggleRightDrawer: () => void;
  openRightDrawer: () => void;
  setPanelView: (view: "chat" | "diff" | "info") => void;
  setBrokerStatus: (status: Partial<BrokerStatus>) => void;
}

let colorIndex = 0;

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Normalize a directory path for comparison (lowercase, trim trailing slashes). */
function normalizePath(p: string): string {
  return p.replace(/[\\/]+$/, "").toLowerCase();
}

// Arrange nodes in a circle
function getNodePosition(index: number, total: number): [number, number, number] {
  const radius = Math.max(6, total * 2.5);
  const angle = (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
  return [
    Math.cos(angle) * radius,
    (Math.random() - 0.5) * 2, // slight Y variation
    Math.sin(angle) * radius,
  ];
}

export const useAppStore = create<AppState>((set, get) => ({
  nodes: [],
  agents: [],
  connections: [],
  crossSpeakLinks: [],
  broker: { connected: false, peerCount: 0, nodeCount: 0, url: "ws://127.0.0.1:7899" },

  selectedNodeId: null,
  selectedAgentId: null,
  showDiffFor: null,
  sidebarOpen: true,
  sidebarView: "nodes",
  rightDrawerOpen: false,
  panelView: "chat",
  activityLog: [],
  activityFeedOpen: false,

  createNode: (name, directory) => {
    const state = get();
    const node: SwarmNode = {
      id: genId(),
      name,
      directory,
      color: NODE_COLORS[colorIndex++ % NODE_COLORS.length],
      position: getNodePosition(state.nodes.length, state.nodes.length + 1),
      agents: [],
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ nodes: [...s.nodes, node] }));
    return node;
  },

  removeNode: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      agents: s.agents.filter((a) => a.nodeId !== id),
      crossSpeakLinks: s.crossSpeakLinks.filter(
        (l) => l.nodeA !== id && l.nodeB !== id
      ),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
    })),

  updateNodePosition: (id, pos) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, position: pos } : n)),
    })),

  addAgent: (nodeId, name, cwd) => {
    const state = get();
    const node = state.nodes.find((n) => n.id === nodeId);
    const agent: Agent = {
      id: genId(),
      peerId: null,
      nodeId,
      name,
      status: "starting",
      summary: "",
      cwd,
      pid: null,
      messages: [],
      diff: null,
      diffs: [],
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };
    set((s) => ({
      agents: [...s.agents, agent],
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, agents: [...n.agents, agent.id] } : n
      ),
    }));
    get().pushActivity({
      type: "agent_spawn",
      agentId: agent.id,
      agentName: name,
      nodeId,
      nodeName: node?.name,
      text: `Agent "${name}" spawned on node "${node?.name ?? "unknown"}"`,
    });
    return agent;
  },

  removeAgent: (id) =>
    set((s) => ({
      agents: s.agents.filter((a) => a.id !== id),
      nodes: s.nodes.map((n) => ({
        ...n,
        agents: n.agents.filter((a) => a !== id),
      })),
      selectedAgentId: s.selectedAgentId === id ? null : s.selectedAgentId,
    })),

  updateAgentStatus: (id, status) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, status } : a)),
    })),

  updateAgentSummary: (id, summary) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, summary } : a)),
    })),

  updateAgentPeerId: (id, peerId) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, peerId } : a)),
    })),

  updateAgentPid: (id, pid) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, pid } : a)),
    })),

  addAgentMessage: (agentId, message) => {
    const agent = get().agents.find((a) => a.id === agentId);
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId
          ? { ...a, messages: [...a.messages, message] }
          : a
      ),
    }));
    if (agent) {
      get().pushActivity({
        type: "message",
        agentId,
        agentName: agent.name,
        nodeId: agent.nodeId,
        text: message.direction === "outbound"
          ? `[${agent.name}] -> ${message.text.slice(0, 120)}`
          : `[${agent.name}] <- ${message.text.slice(0, 120)}`,
      });
    }
  },

  setAgentDiff: (agentId, diff) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, diff } : a)),
    })),

  setAgentDiffs: (agentId, diffs) => {
    const agent = get().agents.find((a) => a.id === agentId);
    const prevCount = agent?.diffs.length ?? 0;
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId
          ? { ...a, diffs, diff: diffs.length > 0 ? diffs[0] : null }
          : a
      ),
    }));
    if (agent && diffs.length > 0 && diffs.length !== prevCount) {
      get().pushActivity({
        type: "diff",
        agentId,
        agentName: agent.name,
        nodeId: agent.nodeId,
        text: `${agent.name} changed ${diffs.length} file(s): ${diffs.map((d) => d.fileName.split("/").pop()).join(", ")}`,
      });
    }
  },

  addConnection: (from, to) =>
    set((s) => {
      const exists = s.connections.some(
        (c) => (c.from === from && c.to === to) || (c.from === to && c.to === from)
      );
      if (exists) {
        return {
          connections: s.connections.map((c) =>
            (c.from === from && c.to === to) || (c.from === to && c.to === from)
              ? { ...c, active: true, lastMessageAt: new Date().toISOString() }
              : c
          ),
        };
      }
      return {
        connections: [
          ...s.connections,
          { from, to, active: true, lastMessageAt: new Date().toISOString() },
        ],
      };
    }),

  addCrossSpeakLink: (nodeA, nodeB) => {
    const state = get();
    const exists = state.crossSpeakLinks.some(
      (l) =>
        (l.nodeA === nodeA && l.nodeB === nodeB) ||
        (l.nodeA === nodeB && l.nodeB === nodeA)
    );
    if (exists) return;
    const nA = state.nodes.find((n) => n.id === nodeA);
    const nB = state.nodes.find((n) => n.id === nodeB);
    set((s) => ({
      crossSpeakLinks: [
        ...s.crossSpeakLinks,
        { id: genId(), nodeA, nodeB, createdAt: new Date().toISOString() },
      ],
    }));
    get().pushActivity({
      type: "cross_speak",
      text: `Cross-speak enabled: "${nA?.name ?? nodeA}" <-> "${nB?.name ?? nodeB}"`,
    });
  },

  removeCrossSpeakLink: (linkId) =>
    set((s) => ({
      crossSpeakLinks: s.crossSpeakLinks.filter((l) => l.id !== linkId),
    })),

  pushActivity: (event) =>
    set((s) => ({
      activityLog: [
        ...s.activityLog.slice(-199), // keep last 200 events
        { ...event, id: genId(), timestamp: new Date().toISOString() },
      ],
    })),

  toggleActivityFeed: () =>
    set((s) => ({ activityFeedOpen: !s.activityFeedOpen })),

  canNodesCommunicate: (nodeIdA, nodeIdB) => {
    if (nodeIdA === nodeIdB) return true;
    const state = get();
    const nodeA = state.nodes.find((n) => n.id === nodeIdA);
    const nodeB = state.nodes.find((n) => n.id === nodeIdB);
    if (!nodeA || !nodeB) return false;

    // Same directory = auto-communicate
    if (normalizePath(nodeA.directory) === normalizePath(nodeB.directory))
      return true;

    // Explicit cross-speak link
    return state.crossSpeakLinks.some(
      (l) =>
        (l.nodeA === nodeIdA && l.nodeB === nodeIdB) ||
        (l.nodeA === nodeIdB && l.nodeB === nodeA.id)
    );
  },

  selectNode: (id) => set({ selectedNodeId: id, selectedAgentId: null, rightDrawerOpen: !!id }),
  selectAgent: (id) => {
    if (id) {
      const agent = get().agents.find((a) => a.id === id);
      set({ selectedAgentId: id, selectedNodeId: agent?.nodeId ?? get().selectedNodeId, rightDrawerOpen: true });
    } else {
      set({ selectedAgentId: null });
    }
  },
  toggleDiff: (agentId) =>
    set((s) => ({
      showDiffFor: s.showDiffFor === agentId ? null : agentId,
      panelView: "diff",
    })),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarView: (view) => set({ sidebarView: view }),
  toggleRightDrawer: () => set((s) => ({ rightDrawerOpen: !s.rightDrawerOpen })),
  openRightDrawer: () => set({ rightDrawerOpen: true }),
  setPanelView: (view) => set({ panelView: view }),
  setBrokerStatus: (status) =>
    set((s) => ({ broker: { ...s.broker, ...status } })),
}));
