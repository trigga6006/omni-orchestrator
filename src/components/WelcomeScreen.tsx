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
  X,
  ChevronRight,
} from "lucide-react";

type WelcomeMode = "chat" | "node";

export default function WelcomeScreen() {
  const [mode, setMode] = useState<WelcomeMode>("chat");
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Chat mode: spawn a solo agent and switch to orchestrator
  const handleChatSend = useCallback(async () => {
    if (!input.trim()) return;
    const text = input.trim();

    // Create a default node for the solo agent
    const node = createNode("solo-chat", ".");
    const agent = addAgent(node.id, "claude", ".", "boss");

    try {
      await spawnAgent(agent.id, node.id, "claude", ".", text, "boss", "opus");
    } catch (err) {
      console.error("Failed to spawn agent:", err);
    }

    setCurrentView("orchestrator");
  }, [input, createNode, addAgent, setCurrentView]);

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

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-black relative">
      {/* Skip to orchestrator link */}
      <button
        onClick={() => setCurrentView("orchestrator")}
        className="absolute top-5 right-6 flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        Skip to orchestrator
        <ChevronRight className="w-3 h-3" />
      </button>

      {/* Content container */}
      <div className="w-full max-w-[580px] px-6 animate-fade-in-up">
        {/* Welcome message */}
        <div className="mb-8 text-center">
          <h1 className="text-[22px] font-medium text-foreground/90 mb-1.5">
            Welcome back
          </h1>
          <p className="text-[13px] text-muted-foreground/60">
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
                  ? "bg-white/[0.08] text-foreground shadow-sm"
                  : "text-muted-foreground/60 hover:text-muted-foreground"
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
                  ? "bg-white/[0.08] text-foreground shadow-sm"
                  : "text-muted-foreground/60 hover:text-muted-foreground"
              )}
            >
              <Hexagon className="w-3 h-3" />
              Create Node
            </button>
          </div>
        </div>

        {/* Prompt bubble */}
        {mode === "chat" ? (
          <div
            className={cn(
              "gradient-border rounded-xl bg-white/[0.03] border border-white/[0.06]",
              "transition-all duration-200",
              "hover:border-white/[0.1] focus-within:border-transparent"
            )}
          >
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
                "text-foreground placeholder:text-muted-foreground/30",
                "focus:outline-none",
                "scrollbar-thin"
              )}
              style={{ minHeight: 28, maxHeight: 160 }}
            />

            <div className="flex items-center justify-between px-3 pb-3 pt-0.5">
              <span className="text-[10px] text-muted-foreground/30 px-1">
                Solo agent mode
              </span>
              <Button
                size="sm"
                className={cn(
                  "h-7 w-7 p-0 rounded-lg transition-all",
                  input.trim()
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : "bg-white/[0.06] text-muted-foreground/30 cursor-not-allowed"
                )}
                onClick={handleChatSend}
                disabled={!input.trim()}
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "rounded-xl bg-white/[0.03] border border-white/[0.06]",
              "transition-all duration-200 p-4"
            )}
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                  Node Name
                </label>
                <input
                  ref={nodeNameRef}
                  value={nodeName}
                  onChange={(e) => setNodeName(e.target.value)}
                  placeholder="e.g. frontend-app"
                  className="flex h-8 w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 text-[13px] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-white/[0.12]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                  Directory
                </label>
                <div className="flex gap-2">
                  <input
                    value={nodeDir}
                    onChange={(e) => setNodeDir(e.target.value)}
                    placeholder="/path/to/project"
                    className="flex h-8 w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 text-[13px] font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-white/[0.12]"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 shrink-0 border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06]"
                    onClick={pickFolder}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                  Initial Task
                  <span className="normal-case tracking-normal font-normal text-muted-foreground/25 ml-1">
                    (optional)
                  </span>
                </label>
                <textarea
                  value={nodeTask}
                  onChange={(e) => setNodeTask(e.target.value)}
                  placeholder="Describe what this node should accomplish..."
                  rows={3}
                  className="flex w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-white/[0.12] resize-none leading-relaxed"
                />
              </div>
            </div>

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.04]">
              <span className="text-[10px] text-muted-foreground/30">
                {nodeTask.trim()
                  ? "A lead agent will be deployed"
                  : "Empty node - add agents later"}
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
                    : "bg-white/[0.06] text-muted-foreground/30 cursor-not-allowed"
                )}
              >
                {nodeTask.trim() ? "Create & Deploy" : "Create Node"}
                <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Hint */}
        <p className="text-center text-[10px] text-muted-foreground/25 mt-4">
          {mode === "chat"
            ? "Start a quick conversation, or switch to Create Node for the full orchestrator"
            : "Set up a node to coordinate multiple agents on a project"}
        </p>
      </div>
    </div>
  );
}
