import { useState, useCallback, useEffect, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import { spawnAgent } from "@/lib/agentManager";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type WelcomeMode = "chat" | "node";
type ModelId = "opus" | "sonnet" | "haiku";

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

/* ------------------------------------------------------------------ */
/* WelcomeScreen                                                       */
/* ------------------------------------------------------------------ */

export default function WelcomeScreen() {
  const [mode, setMode] = useState<WelcomeMode>("chat");
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ModelId>("opus");
  const [swarmMode, setSwarmMode] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  // Node creation fields
  const [nodeName, setNodeName] = useState("");
  const [nodeDir, setNodeDir] = useState("");
  const [nodeTask, setNodeTask] = useState("");
  const nodeNameRef = useRef<HTMLInputElement>(null);

  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const createNode = useAppStore((s) => s.createNode);
  const addAgent = useAppStore((s) => s.addAgent);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  // Focus appropriate input on mode switch
  useEffect(() => {
    if (mode === "chat") {
      textareaRef.current?.focus();
    } else {
      nodeNameRef.current?.focus();
    }
  }, [mode]);

  // Close model dropdown on outside click
  useEffect(() => {
    if (!modelOpen) return;
    const handle = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [modelOpen]);

  // Chat mode: spawn a solo agent and switch to orchestrator
  const handleChatSend = useCallback(
    async (text?: string) => {
      const msg = (text ?? input).trim();
      if (!msg) return;

      if (swarmMode) {
        // Swarm mode → jump to orchestrator with a pre-created node
        const node = createNode("swarm", ".");
        const bossName = "swarm-lead";
        const agent = addAgent(node.id, bossName, ".", "boss");
        try {
          await spawnAgent(agent.id, node.id, bossName, ".", msg, "boss", model);
        } catch (err) {
          console.error("Failed to spawn agent:", err);
        }
      } else {
        const node = createNode("solo-chat", ".");
        const agent = addAgent(node.id, "claude", ".", "boss");
        try {
          await spawnAgent(agent.id, node.id, "claude", ".", msg, "boss", model);
        } catch (err) {
          console.error("Failed to spawn agent:", err);
        }
      }

      setCurrentView("orchestrator");
    },
    [input, model, swarmMode, createNode, addAgent, setCurrentView]
  );

  // Node mode: create node + optional agent, switch to orchestrator
  const handleNodeCreate = useCallback(async () => {
    if (!nodeName.trim() || !nodeDir.trim()) return;
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
  }, [nodeName, nodeDir, nodeTask, createNode, addAgent, setCurrentView]);

  const pickFolder = useCallback(async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({ directory: true });
      if (selected) setNodeDir(selected as string);
    } catch {
      // Dialog not available in dev
    }
  }, []);

  const selectedModel = MODELS.find((m) => m.id === model)!;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-black relative">
      {/* Skip to orchestrator */}
      <button
        onClick={() => setCurrentView("orchestrator")}
        className="absolute top-5 right-6 flex items-center gap-1 text-[11px] text-white/20 hover:text-white/40 transition-colors"
      >
        Skip to orchestrator
        <ChevronRight className="w-3 h-3" />
      </button>

      {/* Content */}
      <div className="w-full max-w-[580px] px-6 animate-fade-in-up">
        {/* Welcome */}
        <div className="mb-8 text-center">
          <h1 className="text-[22px] font-medium text-white/90 mb-1.5">
            Welcome back
          </h1>
          <p className="text-[13px] text-white/35">
            What would you like to work on?
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex justify-center mb-5">
          <div className="flex h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] p-[3px]">
            <button
              onClick={() => setMode("chat")}
              className={cn(
                "flex items-center gap-1.5 px-3.5 rounded-md text-[12px] font-medium transition-all",
                mode === "chat"
                  ? "bg-white/[0.08] text-white shadow-sm"
                  : "text-white/35 hover:text-white/55"
              )}
            >
              <MessageSquare className="w-3 h-3" />
              Chat
            </button>
            <button
              onClick={() => setMode("node")}
              className={cn(
                "flex items-center gap-1.5 px-3.5 rounded-md text-[12px] font-medium transition-all",
                mode === "node"
                  ? "bg-white/[0.08] text-white shadow-sm"
                  : "text-white/35 hover:text-white/55"
              )}
            >
              <Hexagon className="w-3 h-3" />
              Create Node
            </button>
          </div>
        </div>

        {/* ---- CHAT MODE ---- */}
        {mode === "chat" ? (
          <>
            <div
              className={cn(
                "gradient-border rounded-xl bg-white/[0.03] border border-white/[0.06]",
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
                    handleChatSend();
                  }
                }}
                placeholder="Send a message to Claude..."
                rows={1}
                className={cn(
                  "w-full resize-none bg-transparent px-4 pt-4 pb-1.5 text-[13px] leading-relaxed",
                  "text-white placeholder:text-white/20",
                  "focus:outline-none",
                  "scrollbar-thin"
                )}
                style={{ minHeight: 28, maxHeight: 160 }}
              />

              {/* Bottom toolbar */}
              <div className="flex items-center justify-between px-3 pb-3 pt-0.5">
                <div className="flex items-center gap-1">
                  {/* Model picker */}
                  <div className="relative" ref={modelRef}>
                    <button
                      onClick={() => setModelOpen((v) => !v)}
                      className={cn(
                        "flex items-center gap-1.5 h-6 px-2 rounded-md text-[11px] transition-colors",
                        "text-white/30 hover:text-white/50 hover:bg-white/[0.04]",
                        modelOpen && "bg-white/[0.04] text-white/50"
                      )}
                    >
                      <Sparkles className="w-3 h-3" />
                      {selectedModel.label}
                      <ChevronDown
                        className={cn(
                          "w-2.5 h-2.5 opacity-50 transition-transform",
                          modelOpen && "rotate-180"
                        )}
                      />
                    </button>

                    {modelOpen && (
                      <div className="absolute bottom-full left-0 mb-1.5 w-44 p-1 bg-[#111] border border-white/[0.08] rounded-lg shadow-2xl z-50 animate-fade-in-up">
                        {MODELS.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => {
                              setModel(m.id);
                              setModelOpen(false);
                            }}
                            className={cn(
                              "w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left transition-colors",
                              model === m.id
                                ? "bg-white/[0.06] text-white"
                                : "text-white/50 hover:text-white/70 hover:bg-white/[0.03]"
                            )}
                          >
                            <span className="text-[12px] font-medium">
                              {m.label}
                            </span>
                            <span className="text-[10px] text-white/25">
                              {m.desc}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Divider */}
                  <div className="w-px h-3 bg-white/[0.06] mx-0.5" />

                  {/* Swarm toggle */}
                  <button
                    onClick={() => setSwarmMode((v) => !v)}
                    className={cn(
                      "flex items-center gap-1.5 h-6 px-2 rounded-md text-[11px] transition-colors",
                      swarmMode
                        ? "bg-violet/15 text-violet"
                        : "text-white/30 hover:text-white/50 hover:bg-white/[0.04]"
                    )}
                  >
                    <Network className="w-3 h-3" />
                    Swarm
                  </button>
                </div>

                {/* Send */}
                <Button
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-lg transition-all",
                    input.trim()
                      ? "bg-white text-black hover:bg-white/90"
                      : "bg-white/[0.06] text-white/20 cursor-not-allowed"
                  )}
                  onClick={() => handleChatSend()}
                  disabled={!input.trim()}
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Suggestion chips */}
            <div className="flex gap-2 mt-3">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => {
                    setInput(s.prompt);
                    textareaRef.current?.focus();
                  }}
                  className={cn(
                    "flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg",
                    "bg-white/[0.02] border border-white/[0.05]",
                    "text-left text-[11px] text-white/35 leading-snug",
                    "hover:bg-white/[0.04] hover:border-white/[0.08] hover:text-white/50",
                    "transition-all"
                  )}
                >
                  <s.icon className="w-3.5 h-3.5 shrink-0 opacity-50" />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          /* ---- NODE MODE ---- */
          <div
            className={cn(
              "rounded-xl bg-white/[0.03] border border-white/[0.06]",
              "transition-all duration-200 p-4"
            )}
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-white/30 uppercase tracking-wider">
                  Node Name
                </label>
                <input
                  ref={nodeNameRef}
                  value={nodeName}
                  onChange={(e) => setNodeName(e.target.value)}
                  placeholder="e.g. frontend-app"
                  className="flex h-8 w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-white/[0.12]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-white/30 uppercase tracking-wider">
                  Directory
                </label>
                <div className="flex gap-2">
                  <input
                    value={nodeDir}
                    onChange={(e) => setNodeDir(e.target.value)}
                    placeholder="/path/to/project"
                    className="flex h-8 w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 text-[13px] font-mono text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-white/[0.12]"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 shrink-0 border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] text-white/50"
                    onClick={pickFolder}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-white/30 uppercase tracking-wider">
                  Initial Task
                  <span className="normal-case tracking-normal font-normal text-white/15 ml-1">
                    (optional)
                  </span>
                </label>
                <textarea
                  value={nodeTask}
                  onChange={(e) => setNodeTask(e.target.value)}
                  placeholder="Describe what this node should accomplish..."
                  rows={3}
                  className="flex w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-white/[0.12] resize-none leading-relaxed"
                />
              </div>
            </div>

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.04]">
              <span className="text-[10px] text-white/20">
                {nodeTask.trim()
                  ? "A lead agent will be deployed"
                  : "Empty node — add agents later"}
              </span>
              <Button
                size="sm"
                onClick={handleNodeCreate}
                disabled={!nodeName.trim() || !nodeDir.trim()}
                className={cn(
                  "text-[12px] px-4",
                  nodeName.trim() && nodeDir.trim()
                    ? nodeTask.trim()
                      ? "bg-violet text-white hover:bg-violet/90"
                      : "bg-emerald text-white hover:bg-emerald/90"
                    : "bg-white/[0.06] text-white/20 cursor-not-allowed"
                )}
              >
                {nodeTask.trim() ? "Create & Deploy" : "Create Node"}
                <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
