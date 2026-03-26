import { create } from "zustand";
import {
  addCrossSpeakLinkOnBroker,
  removeCrossSpeakLinkOnBroker,
} from "../lib/broker";
import type {
  SwarmNode,
  Agent,
  AgentStatus,
  AgentRole,
  AgentConfig,
  ConnectionEdge,
  BrokerStatus,
  AgentMessage,
  DiffEntry,
  CrossSpeakLink,
  ActivityEvent,
  ConciergeStatus,
  ConciergeMessage,
  PermissionPrompt,
} from "../types";

function defaultAgentConfig(role: AgentRole): AgentConfig {
  return {
    model: role === "boss" ? "opus" : "sonnet",
    permissionMode: "auto",
    maxTurns: null,
    customSystemPrompt: "",
    allowedTools: [],
    disallowedTools: [],
  };
}

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

interface SwarmSettings {
  autoSendMessages: boolean; // auto-press Enter after injecting peer messages
  nickname: string; // user nickname shown on welcome screen
}

interface AppState {
  // Data
  nodes: SwarmNode[];
  agents: Agent[];
  connections: ConnectionEdge[];
  crossSpeakLinks: CrossSpeakLink[];
  broker: BrokerStatus;
  settings: SwarmSettings;

  // Notifications — per-node unread count (bell icon on node cards)
  nodeNotifications: Record<string, number>;
  addNodeNotification: (nodeId: string) => void;
  clearNodeNotifications: (nodeId: string) => void;

  // UI state
  currentView: "welcome" | "orchestrator" | "settings";
  selectedNodeId: string | null;
  selectedAgentId: string | null;
  showDiffFor: string | null; // agent ID to show diff panel
  sidebarOpen: boolean;
  sidebarView: "nodes" | "activity";
  rightDrawerOpen: boolean;
  panelView: "chat" | "swarm" | "diff" | "info";
  conciergeSidebarOpen: boolean;

  // Drag-to-connect state
  dragging: { fromNodeId: string; cursorX: number; cursorY: number } | null;
  connectionMenu: { nodeId: string; x: number; y: number } | null;

  // Actions - Settings
  updateSettings: (patch: Partial<SwarmSettings>) => void;

  // Actions - Nodes
  createNode: (name: string, directory: string) => SwarmNode;
  removeNode: (id: string) => void;
  updateNodePosition: (id: string, pos: [number, number, number]) => void;

  // Actions - Cross-speak
  addCrossSpeakLink: (nodeA: string, nodeB: string) => void;
  removeCrossSpeakLink: (linkId: string) => void;
  canNodesCommunicate: (nodeIdA: string, nodeIdB: string) => boolean;

  // Actions - Agents
  addAgent: (nodeId: string, name: string, cwd: string, role?: AgentRole, id?: string) => Agent;
  removeAgent: (id: string) => void;
  updateAgentStatus: (id: string, status: AgentStatus) => void;
  updateAgentSummary: (id: string, summary: string) => void;
  updateAgentPeerId: (id: string, peerId: string) => void;
  updateAgentPid: (id: string, pid: number) => void;
  updateAgentSessionId: (id: string, sessionId: string) => void;
  addAgentMessage: (agentId: string, message: AgentMessage) => void;
  setAgentDiff: (agentId: string, diff: DiffEntry | null) => void;
  setAgentDiffs: (agentId: string, diffs: DiffEntry[]) => void;
  updateAgentConfig: (agentId: string, patch: Partial<AgentConfig>) => void;

  // Actions - Connections
  addConnection: (from: string, to: string) => void;

  // Activity feed
  activityLog: ActivityEvent[];
  activityFeedOpen: boolean;
  pushActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void;
  toggleActivityFeed: () => void;

  // Actions - Drag-to-connect
  startDrag: (fromNodeId: string, cursorX: number, cursorY: number) => void;
  updateDrag: (cursorX: number, cursorY: number) => void;
  endDrag: () => void;
  openConnectionMenu: (nodeId: string, x: number, y: number) => void;
  closeConnectionMenu: () => void;

  // Permission prompts
  pendingPermissions: PermissionPrompt[];
  addPermission: (prompt: PermissionPrompt) => void;
  removePermission: (id: string) => void;
  clearPermissionsForAgent: (agentId: string) => void;

  // Concierge
  conciergeStatus: ConciergeStatus;
  conciergeMessages: ConciergeMessage[];
  setConciergeStatus: (status: ConciergeStatus) => void;
  addConciergeMessage: (msg: Omit<ConciergeMessage, "id" | "timestamp">) => void;
  clearConciergeMessages: () => void;

  // Workspace persistence
  currentWorkspaceName: string | null;
  currentWorkspacePath: string | null;
  workspaceDirty: boolean;
  setWorkspaceInfo: (name: string | null, path: string | null) => void;
  markWorkspaceDirty: () => void;
  markWorkspaceClean: () => void;
  hydrateFromWorkspace: (data: {
    nodes: SwarmNode[];
    agents: Agent[];
    crossSpeakLinks: CrossSpeakLink[];
    settings: SwarmSettings;
    workspaceName: string;
    workspacePath: string;
    currentView: "welcome" | "orchestrator" | "settings";
  }) => void;

  // Actions - UI
  selectNode: (id: string | null) => void;
  selectAgent: (id: string | null) => void;
  toggleDiff: (agentId: string | null) => void;
  toggleSidebar: () => void;
  setSidebarView: (view: "nodes" | "activity") => void;
  toggleRightDrawer: () => void;
  openRightDrawer: () => void;
  toggleConciergeSidebar: () => void;
  openConciergeSidebar: () => void;
  closeConciergeSidebar: () => void;
  setCurrentView: (view: "welcome" | "orchestrator" | "settings") => void;
  setPanelView: (view: "chat" | "swarm" | "diff" | "info") => void;
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
  settings: { autoSendMessages: true, nickname: "" },

  currentView: "welcome",
  selectedNodeId: null,
  selectedAgentId: null,
  showDiffFor: null,
  sidebarOpen: true,
  sidebarView: "nodes",
  rightDrawerOpen: false,
  panelView: "chat",
  conciergeSidebarOpen: false,
  nodeNotifications: {},
  activityLog: [],
  activityFeedOpen: false,
  dragging: null,
  connectionMenu: null,

  // Permission prompts
  pendingPermissions: [],

  addPermission: (prompt) =>
    set((s) => ({
      // One active prompt per agent — new prompt replaces the old one
      pendingPermissions: [
        ...s.pendingPermissions.filter((p) => p.agentId !== prompt.agentId),
        prompt,
      ],
    })),

  removePermission: (id) =>
    set((s) => ({
      pendingPermissions: s.pendingPermissions.filter((p) => p.id !== id),
    })),

  clearPermissionsForAgent: (agentId) =>
    set((s) => ({
      pendingPermissions: s.pendingPermissions.filter((p) => p.agentId !== agentId),
    })),

  // Concierge
  conciergeStatus: "off",
  conciergeMessages: [],

  setConciergeStatus: (status) => set({ conciergeStatus: status }),

  addConciergeMessage: (msg) =>
    set((s) => ({
      conciergeMessages: [
        ...s.conciergeMessages,
        {
          ...msg,
          id: Math.random().toString(36).slice(2, 10),
          timestamp: new Date().toISOString(),
        },
      ],
    })),

  clearConciergeMessages: () => set({ conciergeMessages: [] }),

  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  addNodeNotification: (nodeId) =>
    set((s) => ({
      nodeNotifications: {
        ...s.nodeNotifications,
        [nodeId]: (s.nodeNotifications[nodeId] ?? 0) + 1,
      },
    })),

  clearNodeNotifications: (nodeId) =>
    set((s) => {
      const { [nodeId]: _, ...rest } = s.nodeNotifications;
      return { nodeNotifications: rest };
    }),

  createNode: (name, directory) => {
    const state = get();
    const color = NODE_COLORS[colorIndex++ % NODE_COLORS.length];
    const node: SwarmNode = {
      id: genId(),
      name,
      directory,
      color,
      position: getNodePosition(state.nodes.length, state.nodes.length + 1),
      agents: [],
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ nodes: [...s.nodes, node] }));

    // Register with the broker so agents can reference the node by ID
    fetch("http://127.0.0.1:7899/create-node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: node.id, name, color }),
    }).catch(() => {});

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

  addAgent: (nodeId, name, cwd, role, id) => {
    const state = get();
    const node = state.nodes.find((n) => n.id === nodeId);
    const resolvedId = id ?? genId();

    // Idempotency: if an agent with this ID already exists, return it
    const existing = state.agents.find((a) => a.id === resolvedId);
    if (existing) return existing;

    const resolvedRole = role ?? "worker";
    const agent: Agent = {
      id: resolvedId,
      peerId: null,
      nodeId,
      name,
      role: resolvedRole,
      status: "starting",
      summary: "",
      cwd,
      pid: null,
      messages: [],
      diff: null,
      diffs: [],
      config: defaultAgentConfig(resolvedRole),
      sessionId: null,
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

  updateAgentSessionId: (id, sessionId) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, sessionId } : a)),
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

      // Fire a node notification when a boss/lead agent receives a substantial
      // inbound message (long summary or COMPLETED report from sub-agents).
      if (
        message.direction === "inbound" &&
        agent.role === "boss" &&
        (message.text.length >= 300 || /COMPLETED:/i.test(message.text))
      ) {
        get().addNodeNotification(agent.nodeId);
      }
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

  updateAgentConfig: (agentId, patch) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId ? { ...a, config: { ...a.config, ...patch } } : a
      ),
    })),

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
    const linkId = genId();
    set((s) => ({
      crossSpeakLinks: [
        ...s.crossSpeakLinks,
        { id: linkId, nodeA, nodeB, createdAt: new Date().toISOString() },
      ],
    }));
    get().pushActivity({
      type: "cross_speak",
      text: `Cross-speak enabled: "${nA?.name ?? nodeA}" <-> "${nB?.name ?? nodeB}"`,
    });
    addCrossSpeakLinkOnBroker(linkId, nodeA, nodeB).catch(() => {});
  },

  removeCrossSpeakLink: (linkId) => {
    set((s) => ({
      crossSpeakLinks: s.crossSpeakLinks.filter((l) => l.id !== linkId),
    }));
    removeCrossSpeakLinkOnBroker(linkId).catch(() => {});
  },

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

  startDrag: (fromNodeId, cursorX, cursorY) =>
    set({ dragging: { fromNodeId, cursorX, cursorY } }),
  updateDrag: (cursorX, cursorY) =>
    set((s) => (s.dragging ? { dragging: { ...s.dragging, cursorX, cursorY } } : {})),
  endDrag: () => set({ dragging: null }),
  openConnectionMenu: (nodeId, x, y) =>
    set({ connectionMenu: { nodeId, x, y } }),
  closeConnectionMenu: () => set({ connectionMenu: null }),

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
  setCurrentView: (view) => set({ currentView: view }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarView: (view) => set({ sidebarView: view }),
  toggleRightDrawer: () => set((s) => ({ rightDrawerOpen: !s.rightDrawerOpen })),
  openRightDrawer: () => set({ rightDrawerOpen: true }),
  toggleConciergeSidebar: () => set((s) => ({ conciergeSidebarOpen: !s.conciergeSidebarOpen })),
  openConciergeSidebar: () => set({ conciergeSidebarOpen: true }),
  closeConciergeSidebar: () => set({ conciergeSidebarOpen: false }),
  setPanelView: (view) => set({ panelView: view }),
  setBrokerStatus: (status) =>
    set((s) => ({ broker: { ...s.broker, ...status } })),

  // Workspace persistence
  currentWorkspaceName: null,
  currentWorkspacePath: null,
  workspaceDirty: false,

  setWorkspaceInfo: (name, path) =>
    set({ currentWorkspaceName: name, currentWorkspacePath: path }),

  markWorkspaceDirty: () => set({ workspaceDirty: true }),
  markWorkspaceClean: () => set({ workspaceDirty: false }),

  hydrateFromWorkspace: (data) =>
    set({
      nodes: data.nodes,
      agents: data.agents,
      crossSpeakLinks: data.crossSpeakLinks,
      settings: data.settings,
      connections: [],
      activityLog: [],
      pendingPermissions: [],
      selectedNodeId: null,
      selectedAgentId: null,
      showDiffFor: null,
      currentView: data.currentView,
      currentWorkspaceName: data.workspaceName,
      currentWorkspacePath: data.workspacePath,
      workspaceDirty: false,
    }),
}));
