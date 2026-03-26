import { useState, useCallback, useEffect, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import { spawnAgent, spawnChatAgent, resumeAgent, writeToAgent, adoptAgent, killAgent, getCleanOutputSince, getPtyOutputBufferLength } from "@/lib/agentManager";
import { requestRewrite } from "@/lib/concierge";
import { listWorkspaces, loadWorkspace, type WorkspaceInfo } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import XtermPanel from "@/components/XtermPanel";
import PixelAvatar from "@/components/PixelAvatar";
import PermissionBanner from "@/components/PermissionBanner";
import {
  ArrowUp,
  MessageSquare,
  Hexagon,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Network,
  Search,
  RefreshCw,
  Shield,
  Plus,
  GitBranch,
  Play,
  Save,
  X,
  Loader2,
  Radio,
  Settings,
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type WelcomeMode = "chat" | "node";
type ModelId = "opus" | "sonnet" | "haiku";

interface ChatSession {
  id: string;
  model: ModelId;
  label: string;
  color: string;
}

// Vivid, distinct agent colors — pixel-art palette
const AGENT_COLORS = [
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#ef4444", // red
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#a3e635", // lime
  "#e879f9", // fuchsia
  "#2dd4bf", // teal
];

interface WorkflowStep {
  sessionId: string;
  role: string;
  task: string;
  model: ModelId;
}

interface WorkflowTemplate {
  name: string;
  builtin?: boolean;
  steps: { role: string; task: string; model: ModelId }[];
}

const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    name: "Code Review Pipeline",
    builtin: true,
    steps: [
      { role: "Author", task: "Write or modify the code as requested. Output your changes clearly with file paths.", model: "opus" },
      { role: "Reviewer", task: "Review the code from the previous agent. Identify bugs, style issues, and improvements. Be specific with line numbers.", model: "sonnet" },
      { role: "Fixer", task: "Apply the review feedback from the previous agent. Fix all identified issues and output the final code.", model: "sonnet" },
    ],
  },
  {
    name: "Research & Implement",
    builtin: true,
    steps: [
      { role: "Researcher", task: "Research the topic thoroughly. Analyze the codebase, identify patterns, and create a detailed implementation plan.", model: "opus" },
      { role: "Implementer", task: "Implement the plan from the previous agent. Follow their recommendations exactly.", model: "opus" },
    ],
  },
];

function loadSavedTemplates(): WorkflowTemplate[] {
  try {
    const raw = localStorage.getItem("omni-workflow-templates");
    if (raw) return [...BUILTIN_TEMPLATES, ...JSON.parse(raw)];
  } catch { /* ignore */ }
  return [...BUILTIN_TEMPLATES];
}

function saveCustomTemplates(templates: WorkflowTemplate[]) {
  const custom = templates.filter((t) => !t.builtin);
  localStorage.setItem("omni-workflow-templates", JSON.stringify(custom));
}

/** Generate pixel-segment colors from a base hex color */
function pixelColors(hex: string): string[] {
  // Parse hex
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lighter = `rgb(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)})`;
  const darker = `rgb(${Math.max(0, r - 40)},${Math.max(0, g - 40)},${Math.max(0, b - 40)})`;
  const shifted = `rgb(${Math.min(255, g + 30)},${Math.min(255, b + 30)},${Math.min(255, r + 30)})`;
  return [hex, lighter, darker, shifted];
}

const MODELS: { id: ModelId; label: string; desc: string }[] = [
  { id: "opus", label: "Opus", desc: "Most capable" },
  { id: "sonnet", label: "Sonnet", desc: "Balanced" },
  { id: "haiku", label: "Haiku", desc: "Fastest" },
];

const SUGGESTIONS = [
  {
    icon: Search,
    label: "Audit this codebase for errors",
    prompt: "Audit this codebase thoroughly — look for bugs, type errors, dead code, and potential runtime issues. Summarize findings with file paths and severity.",
  },
  {
    icon: RefreshCw,
    label: "Refactor to modern patterns",
    prompt: "Refactor this codebase to use modern language patterns and best practices. Identify outdated patterns and suggest concrete improvements.",
  },
  {
    icon: Shield,
    label: "Security & dependency review",
    prompt: "Review this project for security vulnerabilities, outdated dependencies, and OWASP top 10 risks. Provide a prioritized list of fixes.",
  },
];

const MIN_PANEL_FRACTION = 0.15;

/* ------------------------------------------------------------------ */
/* WelcomeScreen                                                       */
/* ------------------------------------------------------------------ */

export default function WelcomeScreen() {
  // Idle-state controls
  const [mode, setMode] = useState<WelcomeMode>("chat");
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ModelId>("opus");
  const [swarmMode, setSwarmMode] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [chatDir, setChatDir] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  // Multi-agent chat state
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [panelWidths, setPanelWidths] = useState<number[]>([]);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [parallelSend, setParallelSend] = useState(false);
  const addAgentRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const panelContainerRef = useRef<HTMLDivElement>(null);

  // Divider drag state
  const dragRef = useRef<{ index: number; startX: number; startWidths: number[] } | null>(null);

  // Track which agents are actively outputting (for pixel animation)
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set());
  const prevBufferLengths = useRef<Map<string, number>>(new Map());

  // Panel context menu
  const [panelMenu, setPanelMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const panelMenuRef = useRef<HTMLDivElement>(null);

  // Recent workspaces
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [loadingWorkspace, setLoadingWorkspace] = useState<string | null>(null);
  const addAgentToStore = useAppStore((s) => s.addAgent);
  const removeAgentFromStore = useAppStore((s) => s.removeAgent);
  const updateAgentConfig = useAppStore((s) => s.updateAgentConfig);
  const storeAgents = useAppStore((s) => s.agents);

  useEffect(() => {
    listWorkspaces().then(setRecentWorkspaces).catch(() => {});
  }, []);

  // Hydrate chat sessions from the Zustand store when a workspace is loaded.
  // Triggers on currentWorkspacePath change (not just mount), so it works
  // even when the user is already on the WelcomeScreen when they click load.
  const currentWorkspacePath = useAppStore((s) => s.currentWorkspacePath);

  useEffect(() => {
    if (!currentWorkspacePath) return;

    // Read fresh from the store (not the stale closure value)
    const freshAgents = useAppStore.getState().agents;
    const chatAgents = freshAgents.filter(
      (a) => a.nodeId === "__chat__" && a.status === "suspended"
    );
    if (chatAgents.length === 0) return;

    const sessions: ChatSession[] = chatAgents.map((a, i) => ({
      id: a.id,
      model: a.config.model as ModelId,
      label: a.name,
      color: AGENT_COLORS[i % AGENT_COLORS.length],
    }));
    setChatSessions(sessions);
    setActiveSessionId(sessions[0].id);
    setPanelWidths(Array(sessions.length).fill(1 / sessions.length));

    // Auto-resume each chat agent's PTY session
    for (const agent of chatAgents) {
      if (agent.sessionId) {
        // Has a saved session ID — resume the prior conversation
        resumeAgent(
          agent.id, agent.nodeId, agent.name, agent.cwd,
          agent.sessionId, agent.role, agent.config.model,
        ).catch((err) => console.error(`[workspace] failed to resume chat agent ${agent.name}:`, err));
      } else {
        // No session ID (old save) — spawn a fresh agent
        spawnChatAgent(agent.id, agent.cwd, undefined, agent.config.model)
          .catch((err) => console.error(`[workspace] failed to respawn chat agent ${agent.name}:`, err));
      }
    }

    // Force xterm.js to refit after the DOM settles with final panel sizes
    setTimeout(() => window.dispatchEvent(new Event("resize")), 300);
  }, [currentWorkspacePath]);

  // Workflow state
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [workflowMode, setWorkflowMode] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Concierge rewrite
  const conciergeStatus = useAppStore((s) => s.conciergeStatus);
  const [isRewriting, setIsRewriting] = useState(false);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>(loadSavedTemplates);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement>(null);

  // Node creation fields
  const [nodeName, setNodeName] = useState("");
  const [nodeDir, setNodeDir] = useState("");
  const [nodeTask, setNodeTask] = useState("");
  const nodeNameRef = useRef<HTMLInputElement>(null);

  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const nickname = useAppStore((s) => s.settings.nickname);
  const createNode = useAppStore((s) => s.createNode);
  const addAgent = useAppStore((s) => s.addAgent);

  const chatActive = chatSessions.length > 0;
  const activeSession = chatSessions.find((s) => s.id === activeSessionId) ?? null;

  // Auto-resize textarea (idle state)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  // Focus appropriate input on mode switch (idle state only)
  useEffect(() => {
    if (chatActive) return;
    if (mode === "chat") {
      textareaRef.current?.focus();
    } else {
      nodeNameRef.current?.focus();
    }
  }, [mode, chatActive]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!modelOpen && !addAgentOpen && !templateMenuOpen && !panelMenu) return;
    const handle = (e: MouseEvent) => {
      if (modelOpen && modelRef.current && !modelRef.current.contains(e.target as Node))
        setModelOpen(false);
      if (addAgentOpen && addAgentRef.current && !addAgentRef.current.contains(e.target as Node))
        setAddAgentOpen(false);
      if (templateMenuOpen && templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node))
        setTemplateMenuOpen(false);
      if (panelMenu && panelMenuRef.current && !panelMenuRef.current.contains(e.target as Node))
        setPanelMenu(null);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [modelOpen, addAgentOpen, templateMenuOpen, panelMenu]);

  // Poll PTY output buffer to detect which agents are actively outputting
  useEffect(() => {
    if (chatSessions.length === 0) return;
    const interval = setInterval(() => {
      const nowActive = new Set<string>();
      for (const session of chatSessions) {
        const len = getPtyOutputBufferLength(session.id);
        const prev = prevBufferLengths.current.get(session.id) ?? 0;
        if (len > prev) nowActive.add(session.id);
        prevBufferLengths.current.set(session.id, len);
      }
      setActiveAgents(nowActive);
    }, 500);
    return () => clearInterval(interval);
  }, [chatSessions]);

  // Divider drag handlers (document-level mouse events)
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || !panelContainerRef.current) return;
      const containerWidth = panelContainerRef.current.getBoundingClientRect().width;
      const deltaFraction = (e.clientX - drag.startX) / containerWidth;
      const newWidths = [...drag.startWidths];
      const left = newWidths[drag.index] + deltaFraction;
      const right = newWidths[drag.index + 1] - deltaFraction;
      if (left >= MIN_PANEL_FRACTION && right >= MIN_PANEL_FRACTION) {
        newWidths[drag.index] = left;
        newWidths[drag.index + 1] = right;
        setPanelWidths(newWidths);
      }
    };
    const onMouseUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ------------------------------------------------------------------
  // Concierge: rewrite any text input
  // ------------------------------------------------------------------
  const handleRewrite = useCallback(async (
    value: string,
    setter: (v: string) => void,
  ) => {
    if (!value.trim() || isRewriting || conciergeStatus !== "ready") return;
    setIsRewriting(true);
    try {
      const rewritten = await requestRewrite(value.trim());
      setter(rewritten);
    } finally {
      setIsRewriting(false);
    }
  }, [isRewriting, conciergeStatus]);

  // ------------------------------------------------------------------
  // Chat mode: spawn a lightweight PTY and stay on this page
  // ------------------------------------------------------------------

  // System prompt injected when swarm/teams mode is active — tells the
  // agent to use Claude Code's built-in agent teams feature.
  const SWARM_SYSTEM_PROMPT = [
    "You have Claude Code Agent Teams enabled (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1).",
    "You MUST use the agent teams feature to accomplish the user's task.",
    "Create a team of teammates to work in parallel — do NOT fall back to regular subagents.",
    "",
    "How to use agent teams:",
    "- Analyze the task and break it into independent parallel work streams.",
    "- Spawn teammate agents for each stream. Each teammate is a full independent Claude Code session.",
    "- Teammates share a task list, can message each other directly, and coordinate autonomously.",
    "- Assign each teammate a clear role and specific task via their spawn prompt.",
    "- Wait for all teammates to complete before synthesizing results.",
    "",
    "Best practices:",
    "- Use 3-5 teammates for most tasks. More is not always better.",
    "- Give each teammate enough context in their spawn prompt (they don't inherit your conversation).",
    "- Avoid assigning the same files to multiple teammates to prevent conflicts.",
    "- For research/review, assign different focus areas (e.g. security, performance, correctness).",
    "- For implementation, assign different modules or features to each teammate.",
    "- Use plan approval for complex or risky tasks: require teammates to plan before implementing.",
    "- You are the team lead. Coordinate, delegate, and synthesize — let teammates do the work.",
  ].join("\n");

  const startChat = useCallback(
    async (text?: string) => {
      const msg = (text ?? input).trim();
      if (!msg) return;
      const cwd = chatDir.trim() || ".";
      const agentId = `chat-${Date.now()}`;
      const envVars = swarmMode
        ? { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
        : undefined;
      const systemPrompt = swarmMode ? SWARM_SYSTEM_PROMPT : undefined;

      try {
        // Track in the Zustand store so workspace save/load persists it
        addAgentToStore("__chat__", "Agent 1", cwd, "worker", agentId);
        updateAgentConfig(agentId, { model });
        await spawnChatAgent(agentId, cwd, msg, model, systemPrompt, envVars);
        const session: ChatSession = { id: agentId, model, label: "Agent 1", color: AGENT_COLORS[0] };
        setChatSessions([session]);
        setActiveSessionId(agentId);
        setPanelWidths([1]);
        setInput("");
      } catch (err) {
        console.error("Failed to spawn chat agent:", err);
      }
    },
    [input, chatDir, model, swarmMode, addAgentToStore, updateAgentConfig]
  );

  // Add another agent session
  const addChatAgent = useCallback(
    async (agentModel: ModelId) => {
      const cwd = chatDir.trim() || ".";
      const agentId = `chat-${Date.now()}`;
      const num = chatSessions.length + 1;
      const envVars = swarmMode
        ? { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
        : undefined;
      const systemPrompt = swarmMode ? SWARM_SYSTEM_PROMPT : undefined;

      try {
        // Track in the Zustand store so workspace save/load persists it
        addAgentToStore("__chat__", `Agent ${num}`, cwd, "worker", agentId);
        updateAgentConfig(agentId, { model: agentModel });
        await spawnChatAgent(agentId, cwd, undefined, agentModel, systemPrompt, envVars);
        const color = AGENT_COLORS[chatSessions.length % AGENT_COLORS.length];
        const session: ChatSession = { id: agentId, model: agentModel, label: `Agent ${num}`, color };
        setChatSessions((prev) => [...prev, session]);
        setActiveSessionId(agentId);
        // Redistribute widths evenly
        const count = chatSessions.length + 1;
        setPanelWidths(Array(count).fill(1 / count));
        setAddAgentOpen(false);
        // Force xterm.js to refit after panel layout changes
        setTimeout(() => window.dispatchEvent(new Event("resize")), 300);
      } catch (err) {
        console.error("Failed to spawn additional agent:", err);
      }
    },
    [chatDir, chatSessions.length, swarmMode]
  );

  // Follow-up message in active chat (or all chats in parallel-send mode)
  const sendFollowUp = useCallback(async () => {
    const msg = input.trim();
    if (!msg) return;
    setInput("");

    if (parallelSend && chatSessions.length > 1) {
      // Parallel send — write to every session concurrently
      await Promise.all(chatSessions.map((s) => writeToAgent(s.id, msg)));
    } else if (activeSessionId) {
      await writeToAgent(activeSessionId, msg);
    }
  }, [input, activeSessionId, parallelSend, chatSessions]);

  // Select a panel and focus the prompt bar
  const selectPanel = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    // Small delay to ensure state update before focusing
    requestAnimationFrame(() => chatInputRef.current?.focus());
  }, []);

  // Start divider drag
  const startDividerDrag = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { index, startX: e.clientX, startWidths: [...panelWidths] };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [panelWidths]);

  // Promote ALL chat agents to a node and switch to orchestrator
  const promoteToNode = useCallback(async () => {
    if (chatSessions.length === 0) return;
    const cwd = chatDir.trim() || ".";
    const node = createNode("chat-session", cwd);

    for (let i = 0; i < chatSessions.length; i++) {
      const session = chatSessions[i];
      const role = i === 0 ? "boss" as const : "worker" as const;
      const agent = addAgent(node.id, session.label, cwd, role, session.id);
      await adoptAgent(session.id, node.id, session.label, role);
      useAppStore.getState().updateAgentStatus(agent.id, "active");
    }

    useAppStore.getState().selectAgent(chatSessions[0].id);
    setCurrentView("orchestrator");
  }, [chatSessions, chatDir, createNode, addAgent, setCurrentView]);

  // ------------------------------------------------------------------
  // Workflow
  // ------------------------------------------------------------------
  const openWorkflowSetup = useCallback(() => {
    // Pre-populate steps from existing sessions
    const steps: WorkflowStep[] = chatSessions.map((s) => ({
      sessionId: s.id,
      role: s.label,
      task: "",
      model: s.model,
    }));
    setWorkflowSteps(steps.length > 0 ? steps : [{ sessionId: "", role: "Agent 1", task: "", model: "opus" }]);
    setWorkflowOpen(true);
  }, [chatSessions]);

  const loadTemplate = useCallback((template: WorkflowTemplate) => {
    const steps: WorkflowStep[] = template.steps.map((s, i) => ({
      sessionId: chatSessions[i]?.id ?? "",
      role: s.role,
      task: s.task,
      model: s.model,
    }));
    setWorkflowSteps(steps);
    setTemplateMenuOpen(false);
  }, [chatSessions]);

  const saveAsTemplate = useCallback(() => {
    const name = prompt("Template name:");
    if (!name) return;
    const tpl: WorkflowTemplate = {
      name,
      steps: workflowSteps.map((s) => ({ role: s.role, task: s.task, model: s.model })),
    };
    const updated = [...templates, tpl];
    setTemplates(updated);
    saveCustomTemplates(updated);
  }, [workflowSteps, templates]);

  const startWorkflow = useCallback(async () => {
    const cwd = chatDir.trim() || ".";
    const envVars = swarmMode
      ? { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      : undefined;

    // Spawn agents for steps that don't have one yet
    const updatedSteps = [...workflowSteps];
    const updatedSessions = [...chatSessions];
    for (let i = 0; i < updatedSteps.length; i++) {
      const step = updatedSteps[i];
      if (!step.sessionId || !updatedSessions.find((s) => s.id === step.sessionId)) {
        const agentId = `chat-${Date.now()}-${i}`;
        await spawnChatAgent(agentId, cwd, undefined, step.model, swarmMode ? SWARM_SYSTEM_PROMPT : undefined, envVars);
        const color = AGENT_COLORS[(updatedSessions.length) % AGENT_COLORS.length];
        updatedSessions.push({ id: agentId, model: step.model, label: step.role, color });
        updatedSteps[i] = { ...step, sessionId: agentId };
      } else {
        // Update label to match role
        const idx = updatedSessions.findIndex((s) => s.id === step.sessionId);
        if (idx >= 0) updatedSessions[idx] = { ...updatedSessions[idx], label: step.role };
      }
    }

    setChatSessions(updatedSessions);
    setPanelWidths(Array(updatedSessions.length).fill(1 / updatedSessions.length));
    setWorkflowSteps(updatedSteps);

    // Inject context into each agent
    for (let i = 0; i < updatedSteps.length; i++) {
      const step = updatedSteps[i];
      const ctx = [
        `You are step ${i + 1} of ${updatedSteps.length} in a workflow pipeline.`,
        `Your role: ${step.role}`,
        step.task ? `Your task: ${step.task}` : "",
        i < updatedSteps.length - 1
          ? "When you finish, summarize your output clearly — it will be passed to the next agent."
          : "You are the final step. Produce the definitive output.",
      ].filter(Boolean).join("\n");
      await writeToAgent(step.sessionId, ctx);
    }

    setWorkflowMode(true);
    setCurrentStepIndex(0);
    setActiveSessionId(updatedSteps[0].sessionId);
    setWorkflowOpen(false);
  }, [workflowSteps, chatSessions, chatDir, swarmMode]);

  const feedForward = useCallback(async () => {
    if (currentStepIndex >= workflowSteps.length - 1) return;
    const currentStep = workflowSteps[currentStepIndex];
    const nextStep = workflowSteps[currentStepIndex + 1];

    // Get clean output from current agent
    const output = getCleanOutputSince(currentStep.sessionId, 0);
    const truncated = output.length > 8000 ? output.slice(-8000) : output;

    // Feed to next agent
    const msg = `Output from "${currentStep.role}" (previous step):\n\n${truncated}\n\nPlease proceed with your task based on the above.`;
    await writeToAgent(nextStep.sessionId, msg);

    setCurrentStepIndex((i) => i + 1);
    setActiveSessionId(nextStep.sessionId);
  }, [currentStepIndex, workflowSteps]);

  // ------------------------------------------------------------------
  // Panel context menu actions
  // ------------------------------------------------------------------
  const handlePanelRightClick = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    selectPanel(sessionId);
    setPanelMenu({ sessionId, x: e.clientX, y: e.clientY });
  }, [selectPanel]);

  const handleClearContext = useCallback(async () => {
    if (!panelMenu) return;
    await writeToAgent(panelMenu.sessionId, "/clear");
    setPanelMenu(null);
  }, [panelMenu]);

  const handleCompact = useCallback(async () => {
    if (!panelMenu) return;
    await writeToAgent(panelMenu.sessionId, "/compact");
    setPanelMenu(null);
  }, [panelMenu]);

  const handleCloseSession = useCallback(async () => {
    if (!panelMenu) return;
    const id = panelMenu.sessionId;
    setPanelMenu(null);
    await killAgent(id);
    removeAgentFromStore(id);
    setChatSessions((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      // Redistribute widths
      if (updated.length > 0) {
        setPanelWidths(Array(updated.length).fill(1 / updated.length));
        if (activeSessionId === id) setActiveSessionId(updated[0].id);
      }
      return updated;
    });
  }, [panelMenu, activeSessionId, removeAgentFromStore]);

  // ------------------------------------------------------------------
  // Node mode: create node + optional agent, switch to orchestrator
  // ------------------------------------------------------------------
  const [nodeCreating, setNodeCreating] = useState(false);
  const handleNodeCreate = useCallback(async () => {
    if (!nodeName.trim() || !nodeDir.trim() || nodeCreating) return;
    setNodeCreating(true);
    try {
      const node = createNode(nodeName.trim(), nodeDir.trim());

      if (nodeTask.trim()) {
        const bossName = `${nodeName.trim()}-lead`;
        const agent = addAgent(node.id, bossName, nodeDir.trim(), "boss");
        try {
          await spawnAgent(
            agent.id,
            node.id,
            bossName,
            nodeDir.trim(),
            nodeTask.trim(),
            "boss",
            "opus"
          );
        } catch (err) {
          console.error("Failed to spawn boss agent:", err);
        }
      }

      setCurrentView("orchestrator");
    } finally {
      setNodeCreating(false);
    }
  }, [nodeName, nodeDir, nodeTask, nodeCreating, createNode, addAgent, setCurrentView]);

  const pickFolder = useCallback(async (target: "node" | "chat" = "node") => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({ directory: true });
      if (selected) {
        if (target === "chat") setChatDir(selected as string);
        else setNodeDir(selected as string);
      }
    } catch {
      // Dialog not available in dev
    }
  }, []);

  const selectedModel = MODELS.find((m) => m.id === model)!;

  /** Truncate a path for display: show last 2 segments */
  const displayPath = (p: string) => {
    if (!p) return "";
    const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length <= 2) return p;
    return "…/" + parts.slice(-2).join("/");
  };

  // ====================================================================
  // CHAT ACTIVE STATE — multi-agent panels + prompt bar + workflow
  // ====================================================================
  if (chatActive) {
    const isLastStep = workflowMode && currentStepIndex >= workflowSteps.length - 1;
    const canFeedForward = workflowMode && !isLastStep;

    return (
      <div className="w-full h-full flex flex-col bg-black">
        {/* Top bar — avatar circles + actions */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {/* Overlapping agent circles — animated pixel avatars */}
            <div className="flex items-center">
              {chatSessions.map((session, i) => {
                const isSelected = session.id === activeSessionId;
                const isOutputting = activeAgents.has(session.id);
                return (
                  <button
                    key={session.id}
                    onClick={() => selectPanel(session.id)}
                    className={cn(
                      "relative rounded-full overflow-hidden transition-transform",
                      isSelected ? "ring-1 ring-white/30 scale-110" : "hover:scale-105"
                    )}
                    style={{
                      marginLeft: i > 0 ? -5 : 0,
                      zIndex: isSelected ? 10 : chatSessions.length - i,
                    }}
                    title={`${session.label} · ${MODELS.find((m) => m.id === session.model)?.label}`}
                  >
                    <PixelAvatar color={session.color} size={16} active={isOutputting} />
                  </button>
                );
              })}

              {/* Add agent circle */}
              <div className="relative" ref={addAgentRef} style={{ marginLeft: chatSessions.length > 0 ? -3 : 0 }}>
                <button
                  onClick={() => setAddAgentOpen((v) => !v)}
                  className={cn(
                    "flex items-center justify-center w-4 h-4 rounded-full border border-dashed transition-all",
                    addAgentOpen
                      ? "border-white/30 bg-white/[0.08] text-white/50"
                      : "border-white/[0.12] text-white/15 hover:border-white/25 hover:text-white/35"
                  )}
                  title="Add agent"
                >
                  <Plus className="w-2 h-2" />
                </button>

                {addAgentOpen && (
                  <div className="absolute left-0 top-full mt-1 w-40 p-1 bg-[#111] border border-white/[0.08] rounded-lg shadow-2xl z-50 animate-fade-in-up">
                    <p className="text-[9px] text-white/25 uppercase tracking-wider px-2 py-0.5 font-medium">Model</p>
                    {MODELS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => addChatAgent(m.id)}
                        className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left transition-colors text-white/50 hover:text-white/70 hover:bg-white/[0.03]"
                      >
                        <span className="text-[11px] font-medium">{m.label}</span>
                        <span className="text-[9px] text-white/25">{m.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Active agent label */}
            {activeSession && (
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="font-medium" style={{ color: activeSession.color }}>
                  {activeSession.label}
                </span>
                <span className="text-white/15">·</span>
                <span className="text-white/25">
                  {MODELS.find((m) => m.id === activeSession.model)?.label}
                </span>
              </div>
            )}

            {/* Workflow step indicator */}
            {workflowMode && (
              <div className="flex items-center gap-1 text-[10px] text-white/25">
                <GitBranch className="w-3 h-3" />
                <span>Step {currentStepIndex + 1}/{workflowSteps.length}</span>
              </div>
            )}

            {/* Directory badge */}
            {chatDir && (
              <>
                <div className="w-px h-3 bg-white/[0.06]" />
                <div className="flex items-center gap-1 text-[10px] text-white/20 font-mono truncate">
                  <FolderOpen className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">{displayPath(chatDir)}</span>
                </div>
              </>
            )}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            {!workflowMode && (
              <button
                onClick={openWorkflowSetup}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-white/30 hover:text-white/50 hover:bg-white/[0.04] transition-colors"
              >
                <GitBranch className="w-3 h-3" />
                Workflow
              </button>
            )}
            <Button
              size="sm"
              onClick={promoteToNode}
              className="text-[11px] px-2.5 h-6 bg-violet/15 text-violet hover:bg-violet/25 border border-violet/20"
            >
              <Network className="w-3 h-3 mr-1" />
              Node
            </Button>
          </div>
        </div>

        {/* Workflow setup panel (overlay) */}
        {workflowOpen && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="w-full max-w-[600px] max-h-[80vh] bg-[#0a0a0a] border border-white/[0.08] rounded-2xl overflow-hidden flex flex-col animate-fade-in-up">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-white/40" />
                  <span className="text-[14px] font-medium text-white/80">Create Workflow</span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Templates dropdown */}
                  <div className="relative" ref={templateMenuRef}>
                    <button
                      onClick={() => setTemplateMenuOpen((v) => !v)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-white/30 hover:text-white/50 hover:bg-white/[0.04] transition-colors"
                    >
                      Templates
                      <ChevronDown className="w-2.5 h-2.5" />
                    </button>
                    {templateMenuOpen && (
                      <div className="absolute right-0 top-full mt-1 w-52 p-1 bg-[#111] border border-white/[0.08] rounded-lg shadow-2xl z-50">
                        {templates.map((t, i) => (
                          <button
                            key={i}
                            onClick={() => loadTemplate(t)}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left transition-colors text-white/50 hover:text-white/70 hover:bg-white/[0.03]"
                          >
                            <span className="text-[11px] font-medium">{t.name}</span>
                            {t.builtin && <span className="text-[9px] text-white/20">built-in</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setWorkflowOpen(false)}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Visual chain */}
              <div className="flex items-center gap-1 px-5 py-3 border-b border-white/[0.04]">
                {workflowSteps.map((step, i) => {
                  const session = chatSessions.find((s) => s.id === step.sessionId);
                  const color = session?.color ?? AGENT_COLORS[i % AGENT_COLORS.length];
                  return (
                    <div key={i} className="flex items-center gap-1">
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: `${color}20`, color }}>
                        <span>{i + 1}</span>
                        <span className="truncate max-w-[80px]">{step.role || `Step ${i + 1}`}</span>
                      </div>
                      {i < workflowSteps.length - 1 && (
                        <ChevronRight className="w-3 h-3 text-white/15 shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Steps editor */}
              <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 scrollbar-thin">
                {workflowSteps.map((step, i) => {
                  const color = chatSessions[i]?.color ?? AGENT_COLORS[i % AGENT_COLORS.length];
                  return (
                    <div key={i} className="space-y-2 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: color }}>
                          {i + 1}
                        </div>
                        <span className="text-[11px] text-white/40">Step {i + 1}</span>
                        {/* Model picker for step */}
                        <select
                          value={step.model}
                          onChange={(e) => {
                            const updated = [...workflowSteps];
                            updated[i] = { ...step, model: e.target.value as ModelId };
                            setWorkflowSteps(updated);
                          }}
                          className="ml-auto text-[10px] bg-white/[0.04] border border-white/[0.06] rounded px-1.5 py-0.5 text-white/50 focus:outline-none"
                        >
                          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                      </div>
                      <input
                        value={step.role}
                        onChange={(e) => {
                          const updated = [...workflowSteps];
                          updated[i] = { ...step, role: e.target.value };
                          setWorkflowSteps(updated);
                        }}
                        placeholder="Role name (e.g. Reviewer)"
                        className="w-full h-7 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 text-[12px] text-white placeholder:text-white/15 focus:outline-none focus:ring-1 focus:ring-white/[0.1]"
                      />
                      <div className="relative">
                        <textarea
                          value={step.task}
                          onChange={(e) => {
                            const updated = [...workflowSteps];
                            updated[i] = { ...step, task: e.target.value };
                            setWorkflowSteps(updated);
                          }}
                          placeholder="Task description — what should this agent do?"
                          rows={2}
                          className="w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 pr-8 text-[12px] text-white placeholder:text-white/15 focus:outline-none focus:ring-1 focus:ring-white/[0.1] resize-none"
                        />
                        {step.task.trim() && (
                          <button
                            onClick={() => handleRewrite(step.task, (v) => {
                              const updated = [...workflowSteps];
                              updated[i] = { ...step, task: v };
                              setWorkflowSteps(updated);
                            })}
                            disabled={isRewriting || conciergeStatus !== "ready"}
                            className={cn(
                              "absolute top-1.5 right-1.5 p-1 rounded transition-colors",
                              conciergeStatus === "ready"
                                ? "text-violet/40 hover:text-violet hover:bg-violet/10"
                                : "text-violet/20 cursor-not-allowed"
                            )}
                            title={conciergeStatus === "ready" ? "Rewrite with Concierge" : "Concierge is not ready"}
                          >
                            {isRewriting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                <button
                  onClick={() => setWorkflowSteps((prev) => [...prev, { sessionId: "", role: "", task: "", model: "sonnet" }])}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-white/[0.08] text-[11px] text-white/25 hover:text-white/40 hover:border-white/[0.15] transition-colors w-full justify-center"
                >
                  <Plus className="w-3 h-3" />
                  Add Step
                </button>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06]">
                <button
                  onClick={saveAsTemplate}
                  className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/50 transition-colors"
                >
                  <Save className="w-3 h-3" />
                  Save as Template
                </button>
                <Button
                  size="sm"
                  onClick={startWorkflow}
                  disabled={workflowSteps.length < 2 || workflowSteps.some((s) => !s.role.trim())}
                  className={cn(
                    "text-[12px] px-4 h-8",
                    workflowSteps.length >= 2 && workflowSteps.every((s) => s.role.trim())
                      ? "bg-emerald text-white hover:bg-emerald/90"
                      : "bg-white/[0.06] text-white/20 cursor-not-allowed"
                  )}
                >
                  <Play className="w-3 h-3 mr-1.5" />
                  Start Workflow
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Terminal panels */}
        <div ref={panelContainerRef} className="flex-1 flex min-h-0 overflow-hidden">
          {chatSessions.map((session, i) => {
            const isActive = session.id === activeSessionId;
            const width = panelWidths[i] ?? 1 / chatSessions.length;
            return (
              <div key={session.id} className="flex h-full min-h-0 overflow-hidden" style={{ width: `${width * 100}%` }}>
                <div
                  className="flex-1 h-full min-h-0 min-w-0 overflow-hidden relative cursor-pointer border-t-2 transition-colors"
                  style={{ borderTopColor: isActive ? session.color : "transparent" }}
                  onClick={() => selectPanel(session.id)}
                  onContextMenu={(e) => handlePanelRightClick(session.id, e)}
                >
                  {chatSessions.length > 1 && (
                    <div
                      className="absolute top-1 left-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] pointer-events-none"
                      style={{
                        backgroundColor: isActive ? `${session.color}20` : "rgba(255,255,255,0.02)",
                        color: isActive ? session.color : "rgba(255,255,255,0.2)",
                      }}
                    >
                      <div className="w-1 h-1 rounded-full" style={{ backgroundColor: session.color }} />
                      <span className="font-medium">{session.label}</span>
                    </div>
                  )}
                  <XtermPanel agentId={session.id} />
                </div>
                {i < chatSessions.length - 1 && (
                  <div
                    className="w-[3px] shrink-0 bg-white/[0.04] hover:bg-sky/40 cursor-col-resize transition-colors"
                    onMouseDown={(e) => startDividerDrag(i, e)}
                  />
                )}
              </div>
            );
          })}

          {/* Panel context menu */}
          {panelMenu && (
            <div
              ref={panelMenuRef}
              className="fixed w-44 p-1 bg-[#111] border border-white/[0.08] rounded-lg shadow-2xl z-50 animate-fade-in-up"
              style={{ left: panelMenu.x, top: panelMenu.y }}
            >
              <button
                onClick={handleClearContext}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[11px] text-white/50 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
              >
                <X className="w-3 h-3" />
                Clear Context
              </button>
              <button
                onClick={handleCompact}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[11px] text-white/50 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
              >
                <ArrowUp className="w-3 h-3" />
                Compact
              </button>
              <div className="h-px bg-white/[0.06] my-0.5" />
              <button
                onClick={handleCloseSession}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[11px] text-rose/70 hover:text-rose hover:bg-rose/10 transition-colors"
              >
                <X className="w-3 h-3" />
                Close Session
              </button>
            </div>
          )}
        </div>

        {/* Agent avatar strip between terminals and prompt bar */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-1">
          {/* Left — avatar + label */}
          {activeSession && (
            <div className="flex items-center gap-1.5">
              <PixelAvatar color={activeSession.color} size={14} active={activeAgents.has(activeSession.id)} />
              <span className="text-[10px] text-white/25 font-medium">{activeSession.label}</span>
            </div>
          )}

          {/* Right — action buttons */}
          <div className="ml-auto flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  onClick={() => setParallelSend((v) => !v)}
                  className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all",
                    parallelSend
                      ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                      : "text-white/20 hover:text-white/40 hover:bg-white/[0.04]"
                  )}
                >
                  <Radio className="w-3 h-3" />
                  <span>Parallel</span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {parallelSend ? "Parallel Send ON — messages go to all agents" : "Parallel Send — click to broadcast to all agents"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Permission prompts */}
        <div className="px-2.5">
          <PermissionBanner />
        </div>

        {/* Bottom prompt bar */}
        <div className="shrink-0 border-t border-white/[0.06] p-2.5">
          <div
            className={cn(
              "flex items-end gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5",
              "focus-within:border-white/[0.12]"
            )}
          >
            {/* Plus menu — prompt-bar tools (future items) */}
            <Popover>
              <PopoverTrigger
                className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition-all self-center hover:bg-white/[0.08] text-white/25 hover:text-white/60"
              >
                <Plus className="w-4 h-4" />
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                sideOffset={12}
                className="w-52 p-2 bg-zinc-900/95 backdrop-blur-md border-white/[0.08]"
              >
                <p className="text-[11px] text-white/30 px-1 py-0.5">
                  More tools coming soon
                </p>
              </PopoverContent>
            </Popover>

            <textarea
              ref={chatInputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendFollowUp();
                }
              }}
              placeholder={parallelSend && chatSessions.length > 1 ? "Message all agents..." : activeSession ? `Message ${activeSession.label}...` : "Send a message..."}
              rows={1}
              className="flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-white placeholder:text-white/20 focus:outline-none scrollbar-thin"
              style={{ minHeight: 22, maxHeight: 100 }}
            />
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Feed forward button (workflow mode) */}
              {canFeedForward && (
                <Button
                  size="sm"
                  onClick={feedForward}
                  className="h-7 px-2.5 text-[11px] bg-amber/15 text-amber hover:bg-amber/25 border border-amber/20"
                >
                  Feed Next
                  <ChevronRight className="w-3 h-3 ml-0.5" />
                </Button>
              )}
              {/* Rewrite with Concierge */}
              {input.trim() && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 transition-all",
                    conciergeStatus === "ready"
                      ? "text-violet/50 hover:text-violet hover:bg-violet/10"
                      : "text-violet/25 bg-white/[0.03] cursor-not-allowed"
                  )}
                  onClick={() => handleRewrite(input, setInput)}
                  disabled={isRewriting || conciergeStatus !== "ready"}
                  title={conciergeStatus === "ready" ? "Rewrite with Concierge" : "Concierge is not ready"}
                >
                  {isRewriting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                </Button>
              )}
              <Button
                size="sm"
                className={cn(
                  "h-7 w-7 p-0 rounded-lg transition-all",
                  input.trim()
                    ? "bg-white text-black hover:bg-white/90"
                    : "bg-white/[0.06] text-white/20 cursor-not-allowed"
                )}
                onClick={sendFollowUp}
                disabled={!input.trim()}
              >
                <ArrowUp className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ====================================================================
  // IDLE STATE — welcome text, mode toggle, prompt/node form
  // ====================================================================
  return (
    <div className="w-full h-full flex flex-col items-center bg-black relative overflow-y-auto scrollbar-thin">
      {/* Skip to orchestrator */}
      <button
        onClick={() => setCurrentView("orchestrator")}
        className="absolute top-5 right-6 flex items-center gap-1 text-[13px] text-white/20 hover:text-white/40 transition-colors z-10"
      >
        Skip to orchestrator
        <ChevronRight className="w-3.5 h-3.5" />
      </button>

      {/* Content */}
      <div className="w-full max-w-[760px] px-8 py-12 my-auto animate-fade-in-up">
        {/* Welcome */}
        <div className="mb-10 text-center">
          <h1 className="text-[32px] font-semibold text-white/90 mb-2">
            Welcome back{nickname ? `, ${nickname}` : ""}
          </h1>
          <p className="text-[15px] text-white/35">
            What would you like to work on?
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex justify-center mb-6">
          <div className="flex h-10 rounded-lg bg-white/[0.04] border border-white/[0.06] p-[3px]">
            <button
              onClick={() => setMode("chat")}
              className={cn(
                "flex items-center gap-2 px-5 rounded-md text-[14px] font-medium transition-all",
                mode === "chat"
                  ? "bg-white/[0.08] text-white shadow-sm"
                  : "text-white/35 hover:text-white/55"
              )}
            >
              <MessageSquare className="w-4 h-4" />
              Chat
            </button>
            <button
              onClick={() => setMode("node")}
              className={cn(
                "flex items-center gap-2 px-5 rounded-md text-[14px] font-medium transition-all",
                mode === "node"
                  ? "bg-white/[0.08] text-white shadow-sm"
                  : "text-white/35 hover:text-white/55"
              )}
            >
              <Hexagon className="w-4 h-4" />
              Create Node
            </button>
          </div>
        </div>

        {/* ---- CHAT MODE ---- */}
        {mode === "chat" ? (
          <>
            <div
              className={cn(
                "gradient-border rounded-2xl bg-white/[0.03] border border-white/[0.06]",
                "transition-all duration-200",
                "hover:border-white/[0.1] focus-within:border-transparent"
              )}
            >
              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    startChat();
                  }
                }}
                placeholder="Send a message to Claude..."
                rows={1}
                className={cn(
                  "w-full resize-none bg-transparent px-5 pt-3.5 pb-1 text-[15px] leading-relaxed",
                  "text-white placeholder:text-white/20",
                  "focus:outline-none",
                  "scrollbar-thin"
                )}
                style={{ minHeight: 28, maxHeight: 200 }}
              />

              {/* Bottom toolbar */}
              <div className="flex items-center justify-between px-4 pb-3 pt-0.5">
                <div className="flex items-center gap-1.5">
                  {/* Working directory picker */}
                  <button
                    onClick={() => pickFolder("chat")}
                    className={cn(
                      "flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] transition-colors",
                      chatDir
                        ? "bg-emerald/15 text-emerald"
                        : "text-white/30 hover:text-white/50 hover:bg-white/[0.04]"
                    )}
                    title={chatDir || "Choose working directory"}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    {chatDir ? (
                      <span className="max-w-[160px] truncate font-mono text-[12px]">
                        {displayPath(chatDir)}
                      </span>
                    ) : (
                      <span>Directory</span>
                    )}
                  </button>

                  {/* Divider */}
                  <div className="w-px h-4 bg-white/[0.06] mx-0.5" />

                  {/* Model picker */}
                  <div className="relative" ref={modelRef}>
                    <button
                      onClick={() => setModelOpen((v) => !v)}
                      className={cn(
                        "flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] transition-colors",
                        "text-white/30 hover:text-white/50 hover:bg-white/[0.04]",
                        modelOpen && "bg-white/[0.04] text-white/50"
                      )}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {selectedModel.label}
                      <ChevronDown
                        className={cn(
                          "w-3 h-3 opacity-50 transition-transform",
                          modelOpen && "rotate-180"
                        )}
                      />
                    </button>

                    {modelOpen && (
                      <div className="absolute bottom-full left-0 mb-1.5 w-48 p-1.5 bg-[#111] border border-white/[0.08] rounded-lg shadow-2xl z-50 animate-fade-in-up">
                        {MODELS.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => {
                              setModel(m.id);
                              setModelOpen(false);
                            }}
                            className={cn(
                              "w-full flex items-center justify-between px-3 py-2 rounded-md text-left transition-colors",
                              model === m.id
                                ? "bg-white/[0.06] text-white"
                                : "text-white/50 hover:text-white/70 hover:bg-white/[0.03]"
                            )}
                          >
                            <span className="text-[13px] font-medium">
                              {m.label}
                            </span>
                            <span className="text-[11px] text-white/25">
                              {m.desc}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Divider */}
                  <div className="w-px h-4 bg-white/[0.06] mx-0.5" />

                  {/* Swarm toggle */}
                  <button
                    onClick={() => setSwarmMode((v) => !v)}
                    className={cn(
                      "flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] transition-colors",
                      swarmMode
                        ? "bg-violet/15 text-violet"
                        : "text-white/30 hover:text-white/50 hover:bg-white/[0.04]"
                    )}
                  >
                    <Network className="w-3.5 h-3.5" />
                    Swarm
                  </button>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Rewrite with Concierge */}
                  {input.trim() && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-9 w-9 p-0 transition-all",
                        conciergeStatus === "ready"
                          ? "text-violet/50 hover:text-violet hover:bg-violet/10"
                          : "text-violet/25 bg-white/[0.03] cursor-not-allowed"
                      )}
                      onClick={() => handleRewrite(input, setInput)}
                      disabled={isRewriting || conciergeStatus !== "ready"}
                      title={conciergeStatus === "ready" ? "Rewrite with Concierge" : "Concierge is not ready"}
                    >
                      {isRewriting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  )}

                  {/* Send */}
                  <Button
                    size="sm"
                    className={cn(
                      "h-9 w-9 p-0 rounded-lg transition-all",
                      input.trim()
                        ? "bg-white text-black hover:bg-white/90"
                        : "bg-white/[0.06] text-white/20 cursor-not-allowed"
                    )}
                    onClick={() => startChat()}
                    disabled={!input.trim()}
                  >
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Suggestion chips */}
            <div className="flex gap-2.5 mt-4">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => {
                    setInput(s.prompt);
                    textareaRef.current?.focus();
                  }}
                  className={cn(
                    "flex-1 flex items-center gap-2.5 px-4 py-3 rounded-xl",
                    "bg-white/[0.02] border border-white/[0.05]",
                    "text-left text-[13px] text-white/35 leading-snug",
                    "hover:bg-white/[0.04] hover:border-white/[0.08] hover:text-white/50",
                    "transition-all"
                  )}
                >
                  <s.icon className="w-4 h-4 shrink-0 opacity-50" />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>

            {/* Recent Workspaces */}
            {recentWorkspaces.length > 0 && (
              <div className="mt-6">
                <p className="text-[11px] text-white/20 uppercase tracking-wider font-medium mb-2 px-1">
                  Recent Workspaces
                </p>
                <div className="space-y-1">
                  {recentWorkspaces.slice(0, 5).map((ws) => (
                    <button
                      key={ws.path}
                      disabled={!!loadingWorkspace}
                      onClick={async () => {
                        setLoadingWorkspace(ws.path);
                        try {
                          await loadWorkspace(ws.path);
                        } catch (err) {
                          console.error("Failed to load workspace:", err);
                        } finally {
                          setLoadingWorkspace(null);
                        }
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left bg-white/[0.02] border border-white/[0.04] transition-all",
                        loadingWorkspace === ws.path
                          ? "opacity-70 cursor-wait"
                          : loadingWorkspace
                            ? "opacity-40 cursor-not-allowed"
                            : "hover:bg-white/[0.05] hover:border-white/[0.08]"
                      )}
                    >
                      {loadingWorkspace === ws.path ? (
                        <Loader2 className="w-4 h-4 text-amber/50 shrink-0 animate-spin" />
                      ) : (
                        <FolderOpen className="w-4 h-4 text-amber/50 shrink-0" />
                      )}
                      <span className="text-[13px] text-white/50 truncate flex-1">{ws.name}</span>
                      <span className="text-[10px] text-white/15">
                        {ws.modifiedAt ? new Date(Number(ws.modifiedAt)).toLocaleDateString() : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* ---- NODE MODE ---- */
          <div
            className={cn(
              "rounded-2xl bg-white/[0.03] border border-white/[0.06]",
              "transition-all duration-200 p-6"
            )}
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[12px] font-medium text-white/30 uppercase tracking-wider">
                  Node Name
                </label>
                <input
                  ref={nodeNameRef}
                  value={nodeName}
                  onChange={(e) => setNodeName(e.target.value)}
                  placeholder="e.g. frontend-app"
                  className="flex h-10 w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 text-[15px] text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-white/[0.12]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[12px] font-medium text-white/30 uppercase tracking-wider">
                  Directory
                </label>
                <div className="flex gap-2">
                  <input
                    value={nodeDir}
                    onChange={(e) => setNodeDir(e.target.value)}
                    placeholder="/path/to/project"
                    className="flex h-10 w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 text-[15px] font-mono text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-white/[0.12]"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 px-4 shrink-0 border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] text-white/50"
                    onClick={() => pickFolder("node")}
                  >
                    <FolderOpen className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[12px] font-medium text-white/30 uppercase tracking-wider">
                  Initial Task
                  <span className="normal-case tracking-normal font-normal text-white/15 ml-1.5">
                    (optional)
                  </span>
                </label>
                <div className="relative">
                  <textarea
                    value={nodeTask}
                    onChange={(e) => setNodeTask(e.target.value)}
                    placeholder="Describe what this node should accomplish..."
                    rows={3}
                    className="flex w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 pr-9 text-[15px] text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-white/[0.12] resize-none leading-relaxed"
                  />
                  {nodeTask.trim() && (
                    <button
                      onClick={() => handleRewrite(nodeTask, setNodeTask)}
                      disabled={isRewriting || conciergeStatus !== "ready"}
                      className={cn(
                        "absolute top-2 right-2 p-1.5 rounded-md transition-colors",
                        conciergeStatus === "ready"
                          ? "text-violet/40 hover:text-violet hover:bg-violet/10"
                          : "text-violet/20 cursor-not-allowed"
                      )}
                      title={conciergeStatus === "ready" ? "Rewrite with Concierge" : "Concierge is not ready"}
                    >
                      {isRewriting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/[0.04]">
              <span className="text-[12px] text-white/20">
                {nodeTask.trim()
                  ? "A lead agent will be deployed"
                  : "Empty node — add agents later"}
              </span>
              <Button
                size="sm"
                onClick={handleNodeCreate}
                disabled={!nodeName.trim() || !nodeDir.trim()}
                className={cn(
                  "text-[14px] px-5 h-9",
                  nodeName.trim() && nodeDir.trim()
                    ? nodeTask.trim()
                      ? "bg-violet text-white hover:bg-violet/90"
                      : "bg-emerald text-white hover:bg-emerald/90"
                    : "bg-white/[0.06] text-white/20 cursor-not-allowed"
                )}
              >
                {nodeTask.trim() ? "Create & Deploy" : "Create Node"}
                <ChevronRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
