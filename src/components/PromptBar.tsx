import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { writeToAgent, triggerImmediatePoll } from "@/lib/agentManager";
import { sendMessage as brokerSendMessage } from "@/lib/broker";
import { listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowUp, ChevronDown, FolderOpen, Globe, X, Loader2 } from "lucide-react";
import { AgentIcon, getNodeIcon } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

type Target =
  | { type: "broadcast" }
  | { type: "node"; id: string; name: string }
  | { type: "agent"; id: string; name: string };

const MAX_PANELS = 4;
const STALE_MS = 3000; // output unchanged for this long → "done streaming"

/* ------------------------------------------------------------------ */
/* Inline PTY output cleaner (no dependency on agentManager internals) */
/* ------------------------------------------------------------------ */

function cleanPtyOutput(raw: string): string {
  // 1. BEFORE stripping ANSI, convert cursor-movement sequences into spaces.
  //    This preserves word boundaries that would otherwise be lost.
  let text = raw
    .replace(/\x1b\[\d*C/g, " ")       // cursor forward → space
    .replace(/\x1b\[\d*G/g, " ")       // cursor to absolute column → space
    .replace(/\x1b\[\d+;\d+[Hf]/g, "\n"); // cursor to row;col → newline

  // 2. Strip remaining ANSI escape sequences and control chars
  text = text
    .replace(/\x1b\[[?]?[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[()][AB012]/g, "")
    .replace(/\x1b[78]/g, "")
    .replace(/\x1b[>=]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");

  // 3. Collapse runs of spaces into a single space
  text = text.replace(/ {2,}/g, " ");

  // 4. Resolve carriage returns (keep last visible segment per line)
  const lines = text.split("\n").map((line) => {
    if (!line.includes("\r")) return line.trimEnd();
    const segments = line.split("\r");
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].length > 0) return segments[i].trimEnd();
    }
    return "";
  });

  // 5. Strip Claude Code's input box and permission notices.
  const result: string[] = [];
  for (const rawLine of lines) {
    let line = rawLine.replace(/^\s*❯\s*/, "").trimEnd();
    if (!line) continue;

    // Strip leading/trailing box-drawing chars from each line
    line = line.replace(/^[\u2500-\u257F─━→←]+\s*/, "")
               .replace(/\s*[\u2500-\u257F─━→←]+$/, "")
               .trimEnd();
    if (!line) continue;

    const t = line.trim();

    // Strip: lines that are ONLY box-drawing / separator chars
    const withoutBox = t.replace(/[\u2500-\u257F─━→←]/g, "").trim();
    if (withoutBox.length === 0 && t.length > 2) continue;

    // Strip: bare ">" prompt
    if (/^>\s*$/.test(t)) continue;

    // Strip: "bypass permissions on (shift+tab...)" notices
    if (/bypass\s*permissions/i.test(t)) continue;
    if (/shift\+tab/i.test(t)) continue;

    // Strip: spinner animation garbage — short fragments from TUI cursor overwrites
    // e.g. "· d", "Wa dl", "✢ d n", "* in …" — no real word of 4+ letters
    if (t.length < 15 && !/[a-zA-Z]{4,}/.test(t)) continue;

    result.push(line);
  }

  // Deduplicate: terminal resize redraws repeat the entire content.
  // Detect by finding the same [Message from ...] line appearing twice.
  const firstMsgIdx = result.findIndex((l) => l.startsWith("[Message from"));
  if (firstMsgIdx >= 0) {
    const msgLine = result[firstMsgIdx];
    const lastMsgIdx = result.lastIndexOf(msgLine);
    if (lastMsgIdx > firstMsgIdx) {
      // Same message line appears again — take from the last occurrence
      return result.slice(lastMsgIdx).join("\n").trim();
    }
  }

  return result.join("\n").trim();
}

/* ------------------------------------------------------------------ */
/* PromptBar                                                            */
/* ------------------------------------------------------------------ */

export default function PromptBar() {
  const nodes = useAppStore((s) => s.nodes);
  const agents = useAppStore((s) => s.agents);
  const addAgentMessage = useAppStore((s) => s.addAgentMessage);

  const [input, setInput] = useState("");
  const [target, setTarget] = useState<Target>({ type: "broadcast" });
  const [targetOpen, setTargetOpen] = useState(false);
  const [panels, setPanels] = useState<{ agentId: string; resumeSignal: number }[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ---------- Helpers ----------

  const addPanel = useCallback((agentId: string) => {
    setPanels((prev) => {
      const idx = prev.findIndex((p) => p.agentId === agentId);
      if (idx >= 0) {
        // Agent already has a panel — bump signal to unfreeze and resume accumulating
        const updated = [...prev];
        updated[idx] = { agentId, resumeSignal: prev[idx].resumeSignal + 1 };
        return updated;
      }
      const next = [...prev, { agentId, resumeSignal: 0 }];
      return next.length > MAX_PANELS ? next.slice(-MAX_PANELS) : next;
    });
  }, []);

  const dismissPanel = useCallback((agentId: string) => {
    setPanels((prev) => prev.filter((p) => p.agentId !== agentId));
  }, []);

  const selectPanelAgent = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      if (agent) {
        setTarget({ type: "agent", id: agent.id, name: agent.name });
      }
    },
    [agents]
  );

  // ---------- Auto-resize textarea ----------
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [input]);

  // ---------- Close dropdown on outside click ----------
  useEffect(() => {
    if (!targetOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTargetOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [targetOpen]);

  // ---------- Send ----------
  const handleSend = useCallback(async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");

    const isAlive = (a: typeof agents[0]) =>
      (a.status === "active" || a.status === "idle") && a.peerId;

    // Helper: send to a single agent via broker + immediate poll
    const sendToAgent = async (agent: typeof agents[0]) => {
      addPanel(agent.id);
      addAgentMessage(agent.id, {
        id: Math.random().toString(36).slice(2),
        fromId: "user",
        toId: agent.peerId ?? agent.id,
        text,
        sentAt: new Date().toISOString(),
        direction: "outbound",
      });

      if (agent.peerId) {
        // Send via broker — the agent's poll loop injects it into the PTY
        await brokerSendMessage("user", agent.peerId, text).catch(() => {});
        // Trigger immediate poll so the agent gets it now, not in 5s
        triggerImmediatePoll(agent.id);
      } else {
        // Fallback: direct PTY write if no broker peer ID yet
        await writeToAgent(agent.id, text);
      }
    };

    if (target.type === "broadcast") {
      const aliveAgents = agents.filter(isAlive);
      for (const agent of aliveAgents) {
        await sendToAgent(agent);
      }
    } else if (target.type === "node") {
      const nodeAgents = agents.filter(
        (a) => a.nodeId === target.id && isAlive(a)
      );
      for (const agent of nodeAgents) {
        await sendToAgent(agent);
      }
    } else if (target.type === "agent") {
      const agent = agents.find((a) => a.id === target.id);
      if (!agent) return;
      await sendToAgent(agent);
    }
  }, [input, target, nodes, agents, addAgentMessage, addPanel]);

  // ---------- Derived ----------

  const targetLabel =
    target.type === "broadcast"
      ? "All Agents"
      : target.type === "node"
        ? target.name
        : target.name;

  const TargetIcon =
    target.type === "broadcast"
      ? Globe
      : target.type === "node"
        ? FolderOpen
        : AgentIcon;

  const selectedAgentId = target.type === "agent" ? target.id : null;

  // ---------- Render ----------
  return (
    <div className="shrink-0 px-4 pb-3 pt-1.5">
      <div className="max-w-[960px] mx-auto">
        {/* Response preview panels — horizontal row */}
        {panels.length > 0 && (
          <div className="flex gap-2 mb-2 overflow-x-auto scrollbar-thin pb-1">
            {panels.map((panel) => {
              const agent = agents.find((a) => a.id === panel.agentId);
              if (!agent) return null;
              return (
                <ResponsePreview
                  key={panel.agentId}
                  agentId={panel.agentId}
                  agent={agent}
                  resumeSignal={panel.resumeSignal}
                  isSelected={selectedAgentId === panel.agentId}
                  onSelect={() => selectPanelAgent(panel.agentId)}
                  onDismiss={() => dismissPanel(panel.agentId)}
                  panelCount={panels.length}
                />
              );
            })}
          </div>
        )}

        <div
          className={cn(
            "gradient-border rounded-xl bg-card border border-border/60",
            "transition-all duration-200",
            "hover:border-border focus-within:border-transparent"
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
                handleSend();
              }
            }}
            placeholder="Message your agents..."
            rows={1}
            className={cn(
              "w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[13px] leading-relaxed",
              "text-foreground placeholder:text-muted-foreground/40",
              "focus:outline-none",
              "scrollbar-thin"
            )}
            style={{ minHeight: 24, maxHeight: 120 }}
          />

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
            {/* Target selector */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setTargetOpen((v) => !v)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                <TargetIcon className="w-3 h-3" />
                <span>{targetLabel}</span>
                <ChevronDown className={cn("w-3 h-3 opacity-50 transition-transform", targetOpen && "rotate-180")} />
              </button>

              {targetOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-56 p-1.5 bg-popover border border-border rounded-lg shadow-xl z-50 animate-fade-in-up max-h-60 overflow-y-auto scrollbar-thin">
                  {/* Broadcast option */}
                  <TargetOption
                    icon={Globe}
                    label="All Agents"
                    sublabel="Broadcast to everyone"
                    selected={target.type === "broadcast"}
                    onClick={() => {
                      setTarget({ type: "broadcast" });
                      setTargetOpen(false);
                    }}
                  />

                  {/* Nodes */}
                  {nodes.length > 0 && (
                    <div className="mt-1 pt-1 border-t border-border/50">
                      <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider px-2 py-1">
                        Nodes
                      </p>
                      {nodes.map((node, i) => (
                        <TargetOption
                          key={node.id}
                          icon={getNodeIcon(i)}
                          label={node.name}
                          sublabel={`${agents.filter((a) => a.nodeId === node.id).length} agents`}
                          selected={target.type === "node" && target.id === node.id}
                          onClick={() => {
                            setTarget({ type: "node", id: node.id, name: node.name });
                            setTargetOpen(false);
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {/* Active agents */}
                  {agents.filter((a) => a.status === "active" || a.status === "idle").length > 0 && (
                    <div className="mt-1 pt-1 border-t border-border/50">
                      <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider px-2 py-1">
                        Agents
                      </p>
                      {agents
                        .filter((a) => a.status === "active" || a.status === "idle")
                        .map((agent) => (
                          <TargetOption
                            key={agent.id}
                            icon={AgentIcon}
                            label={agent.name}
                            sublabel={
                              nodes.find((n) => n.id === agent.nodeId)?.name ?? ""
                            }
                            selected={
                              target.type === "agent" && target.id === agent.id
                            }
                            onClick={() => {
                              setTarget({
                                type: "agent",
                                id: agent.id,
                                name: agent.name,
                              });
                              setTargetOpen(false);
                            }}
                          />
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Send button */}
            <Button
              size="sm"
              className={cn(
                "h-7 w-7 p-0 rounded-lg transition-all",
                input.trim()
                  ? "bg-foreground text-background hover:bg-foreground/90"
                  : "bg-secondary text-muted-foreground cursor-not-allowed"
              )}
              onClick={handleSend}
              disabled={!input.trim()}
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Response Preview Panel                                               */
/* ------------------------------------------------------------------ */

function ResponsePreview({
  agentId,
  agent,
  resumeSignal,
  isSelected,
  onSelect,
  onDismiss,
  panelCount,
}: {
  agentId: string;
  agent: { id: string; name: string; status: string };
  resumeSignal: number;
  isSelected: boolean;
  onSelect: () => void;
  onDismiss: () => void;
  panelCount: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const chunksRef = useRef<string[]>([]);
  const lastCleanedRef = useRef("");
  const lastCleanChangeRef = useRef(Date.now());
  const doneRef = useRef(false);
  const [outputText, setOutputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(true);

  // Set up the Tauri listener once (stable key = agentId, no remount).
  // Always accumulate chunks — never gate on doneRef in the listener,
  // because React effects (resumeSignal) run after render, so chunks
  // from a new message would be dropped if gated here.
  useEffect(() => {
    const MAX_BUF = 200_000; // cap buffer at 200KB

    const unlistenPromise = listen<string>(
      `pty-output-${agentId}`,
      (event) => {
        chunksRef.current.push(event.payload);
        // Trim from front if buffer gets too large
        let total = chunksRef.current.reduce((s, c) => s + c.length, 0);
        while (total > MAX_BUF && chunksRef.current.length > 1) {
          total -= chunksRef.current.shift()!.length;
        }
      }
    );

    const timer = setInterval(() => {
      // When frozen, skip processing (but chunks still accumulate)
      if (doneRef.current || chunksRef.current.length === 0) return;

      const raw = chunksRef.current.join("");
      const cleaned = cleanPtyOutput(raw);
      if (cleaned && cleaned !== lastCleanedRef.current) {
        lastCleanedRef.current = cleaned;
        lastCleanChangeRef.current = Date.now();
        setOutputText(cleaned);
        setIsStreaming(true);
      } else if (cleaned && Date.now() - lastCleanChangeRef.current >= STALE_MS) {
        setIsStreaming(false);
        doneRef.current = true;
      }
    }, 400);

    return () => {
      unlistenPromise.then((fn) => fn());
      clearInterval(timer);
    };
  }, [agentId]);

  // When a new message is sent to this agent, unfreeze so the timer
  // resumes processing the already-accumulated chunks.
  useEffect(() => {
    if (resumeSignal > 0) {
      doneRef.current = false;
      lastCleanChangeRef.current = Date.now();
      setIsStreaming(true);
    }
  }, [resumeSignal]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [outputText]);

  const isAlive = agent.status === "active" || agent.status === "idle";

  // Resizable panel height — drag from top edge
  const [panelHeight, setPanelHeight] = useState(220);
  const resizeDragRef = useRef<{ startY: number; startH: number } | null>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeDragRef.current = { startY: e.clientY, startH: panelHeight };

    const handleMove = (ev: MouseEvent) => {
      if (!resizeDragRef.current) return;
      // Dragging UP increases height
      const delta = resizeDragRef.current.startY - ev.clientY;
      setPanelHeight(Math.max(80, Math.min(600, resizeDragRef.current.startH + delta)));
    };
    const handleUp = () => {
      resizeDragRef.current = null;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [panelHeight]);

  return (
    <div
      onClick={onSelect}
      className={cn(
        "flex-1 min-w-[280px] rounded-lg border bg-card/95 backdrop-blur-sm shadow-lg overflow-hidden animate-fade-in-up cursor-pointer transition-colors flex flex-col",
        panelCount > 1 && "max-w-[50%]",
        isSelected
          ? "border-emerald-500/50 ring-1 ring-emerald-500/30"
          : "border-border/60 hover:border-border"
      )}
    >
      {/* Resize handle — top center */}
      <div
        onMouseDown={handleResizeStart}
        className="h-1.5 cursor-ns-resize flex items-center justify-center shrink-0 hover:bg-secondary/40 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-8 h-0.5 rounded-full bg-muted-foreground/20" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border/40 bg-secondary/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <AgentIcon className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium text-foreground/80 truncate">
            {agent.name}
          </span>
          {!outputText ? (
            <Loader2 className="w-3 h-3 text-muted-foreground/50 animate-spin shrink-0" />
          ) : isStreaming ? (
            <Loader2 className="w-3 h-3 text-emerald-500 animate-spin shrink-0" />
          ) : isAlive ? (
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-zinc-500 shrink-0" />
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-secondary/50 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Streamed output — resizable, scrollbar appears only when needed */}
      <div
        ref={scrollRef}
        className="overflow-y-auto scrollbar-thin px-3 py-2"
        style={{ height: panelHeight }}
      >
        {!outputText ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/50">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Processing...</span>
          </div>
        ) : (
          <pre className="text-[11px] leading-relaxed text-foreground/70 whitespace-pre-wrap font-mono break-words">
            {outputText}
          </pre>
        )}
      </div>

    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Target option                                                       */
/* ------------------------------------------------------------------ */

function TargetOption({
  icon: Icon,
  label,
  sublabel,
  selected,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sublabel: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors",
        selected
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
      )}
    >
      <div className="w-5 h-5 rounded-md bg-secondary/80 flex items-center justify-center shrink-0">
        <Icon className="w-3 h-3" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium truncate">{label}</p>
        <p className="text-[10px] text-muted-foreground/60 truncate">{sublabel}</p>
      </div>
    </button>
  );
}
