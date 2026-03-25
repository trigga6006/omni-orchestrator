import { useState, useRef, useEffect, useCallback } from "react";
import { useAppStore } from "@/stores/appStore";
import { killAgent } from "@/lib/agentManager";
import { cn, formatRelative, truncatePath } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import XtermPanel from "@/components/XtermPanel";
import {
  X,
  FolderOpen,
  Power,
  FileCode,
  Clock,
  Hash,
  Wifi,
  Terminal as TerminalIcon,
  Radio,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Settings2,
  Cpu,
  Shield,
  ShieldCheck,
  ShieldAlert,
  RotateCcw,
  Wrench,
  MessageSquare,
  Check,
  Ban,
} from "lucide-react";
import { AgentIcon, getNodeIcon } from "@/lib/utils";
import type { AgentStatus, AgentModel, PermissionMode, AgentConfig } from "@/types";

/* ================================================================== */
/* Claude Code tool definitions                                         */
/* ================================================================== */

const CLAUDE_TOOL_CATEGORIES = [
  {
    label: "File Operations",
    tools: [
      { name: "Read", desc: "Read file contents" },
      { name: "Write", desc: "Create or overwrite files" },
      { name: "Edit", desc: "Targeted string replacements" },
      { name: "Glob", desc: "Find files by pattern" },
      { name: "Grep", desc: "Search file contents" },
    ],
  },
  {
    label: "Execution",
    tools: [
      { name: "Bash", desc: "Run shell commands" },
    ],
  },
  {
    label: "Web",
    tools: [
      { name: "WebFetch", desc: "Fetch URL content" },
      { name: "WebSearch", desc: "Search the web" },
    ],
  },
  {
    label: "Agent & Planning",
    tools: [
      { name: "Agent", desc: "Spawn sub-agents" },
      { name: "EnterPlanMode", desc: "Switch to plan mode" },
      { name: "ExitPlanMode", desc: "Present plan for approval" },
      { name: "AskUserQuestion", desc: "Ask user questions" },
    ],
  },
  {
    label: "Task Management",
    tools: [
      { name: "TodoWrite", desc: "Manage task checklist" },
    ],
  },
  {
    label: "Code Intelligence",
    tools: [
      { name: "LSP", desc: "Language server operations" },
      { name: "NotebookEdit", desc: "Edit Jupyter notebooks" },
    ],
  },
  {
    label: "Other",
    tools: [
      { name: "Skill", desc: "Execute skills" },
    ],
  },
] as const;

const STATUS_STYLE: Record<AgentStatus, { bg: string; text: string; label: string }> = {
  starting: { bg: "bg-amber/10", text: "text-amber", label: "Starting" },
  active: { bg: "bg-emerald/10", text: "text-emerald", label: "Active" },
  idle: { bg: "bg-sky/10", text: "text-sky", label: "Idle" },
  error: { bg: "bg-rose/10", text: "text-rose", label: "Error" },
  stopped: { bg: "bg-muted", text: "text-muted-foreground", label: "Stopped" },
};

export default function RightDrawer() {
  const toggleRightDrawer = useAppStore((s) => s.toggleRightDrawer);
  const panelView = useAppStore((s) => s.panelView);
  const setPanelView = useAppStore((s) => s.setPanelView);

  const node = useAppStore((s) =>
    s.nodes.find((n) => n.id === s.selectedNodeId)
  );
  const agent = useAppStore((s) =>
    s.agents.find((a) => a.id === s.selectedAgentId)
  );

  const title = agent ? agent.name : node ? node.name : "Details";

  return (
    <aside className="w-[380px] shrink-0 border-l border-border bg-sidebar flex flex-col animate-slide-right">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {agent ? (
            <AgentIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : (
            <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="text-[13px] font-medium text-foreground/90 truncate">
            {title}
          </span>
          {agent && (
            <Badge
              variant="secondary"
              className={cn(
                "h-4.5 text-[10px]",
                STATUS_STYLE[agent.status].bg,
                STATUS_STYLE[agent.status].text
              )}
            >
              {STATUS_STYLE[agent.status].label}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-6 h-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={toggleRightDrawer}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Top: Info panel */}
      <div className="h-[40%] min-h-[120px] border-b border-border overflow-y-auto scrollbar-thin">
        {agent ? (
          <AgentInfoPanel />
        ) : node ? (
          <NodeInfoPanel />
        ) : (
          <div className="flex items-center justify-center h-full text-[12px] text-muted-foreground/50">
            Select a node or agent
          </div>
        )}
      </div>

      {/* Bottom: Terminal / Diff */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <div className="px-3 pt-1.5 shrink-0">
          <div className="flex h-7 rounded-lg bg-muted p-[2px]">
            <button
              onClick={() => setPanelView("chat")}
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1 rounded-md text-[11px] font-medium transition-colors",
                panelView === "chat"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <TerminalIcon className="w-3 h-3" />
              Terminal
            </button>
            <button
              onClick={() => setPanelView("swarm")}
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1 rounded-md text-[11px] font-medium transition-colors",
                panelView === "swarm"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Radio className="w-3 h-3" />
              Swarm
            </button>
            <button
              onClick={() => setPanelView("diff")}
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1 rounded-md text-[11px] font-medium transition-colors",
                panelView === "diff"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <GitBranch className="w-3 h-3" />
              Diff
            </button>
          </div>
        </div>
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {panelView === "chat" ? (
            agent ? (
              <XtermPanel agentId={agent.id} />
            ) : (
              <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground/50">
                Select an agent to view terminal
              </div>
            )
          ) : panelView === "swarm" ? (
            <SwarmPanel />
          ) : (
            <DiffPanel />
          )}
        </div>
      </div>
    </aside>
  );
}

/* ================================================================== */
/* Info Panels                                                         */
/* ================================================================== */

function AgentInfoPanel() {
  const agent = useAppStore((s) =>
    s.agents.find((a) => a.id === s.selectedAgentId)
  );
  const removeAgent = useAppStore((s) => s.removeAgent);
  const updateAgentStatus = useAppStore((s) => s.updateAgentStatus);
  const updateAgentConfig = useAppStore((s) => s.updateAgentConfig);
  const [configOpen, setConfigOpen] = useState(true);

  if (!agent) return null;

  const isRunning = agent.status === "active" || agent.status === "idle";
  const config = agent.config;

  const handleKill = async () => {
    await killAgent(agent.id);
    updateAgentStatus(agent.id, "stopped");
  };

  const handleRemove = () => {
    removeAgent(agent.id);
  };

  const patchConfig = (patch: Partial<AgentConfig>) => {
    updateAgentConfig(agent.id, patch);
  };

  return (
    <div className="p-3 space-y-3">
      {/* Summary */}
      {agent.summary && (
        <div className="p-2.5 rounded-lg bg-secondary/30 border border-border/50">
          <p className="text-[11px] text-foreground/70 leading-relaxed">
            {agent.summary}
          </p>
        </div>
      )}

      {/* Details grid */}
      <div className="space-y-2">
        <InfoRow icon={Hash} label="ID" value={agent.id} mono />
        <InfoRow icon={Wifi} label="Peer ID" value={agent.peerId ?? "not registered"} mono />
        <InfoRow icon={FolderOpen} label="CWD" value={truncatePath(agent.cwd)} mono />
        {agent.pid && (
          <InfoRow icon={Hash} label="PID" value={String(agent.pid)} mono />
        )}
        <InfoRow icon={Clock} label="Created" value={formatRelative(agent.createdAt)} />
        <InfoRow
          icon={FileCode}
          label="Diffs"
          value={agent.diffs.length > 0 ? `${agent.diffs.length} file(s)` : "none"}
        />
      </div>

      <div className="h-px bg-border" />

      {/* Configuration Panel */}
      <div>
        <button
          onClick={() => setConfigOpen(!configOpen)}
          className="flex items-center gap-1.5 w-full text-left group"
        >
          {configOpen ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          )}
          <Settings2 className="w-3 h-3 text-muted-foreground" />
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Configuration
          </span>
          {isRunning && (
            <span className="ml-auto text-[9px] text-amber/60 font-medium">
              restart to apply
            </span>
          )}
        </button>

        {configOpen && (
          <div className="mt-2 space-y-2.5">
            {/* Model */}
            <ConfigSelect
              icon={Cpu}
              label="Model"
              value={config.model}
              options={[
                { value: "opus", label: "Opus", desc: "Most capable, reasoning-heavy" },
                { value: "sonnet", label: "Sonnet", desc: "Fast, balanced" },
                { value: "haiku", label: "Haiku", desc: "Lightweight, quick tasks" },
              ]}
              onChange={(v) => patchConfig({ model: v as AgentModel })}
            />

            {/* Role */}
            <ConfigSelect
              icon={Shield}
              label="Role"
              value={agent.role}
              options={[
                { value: "boss", label: "Boss (Lead)", desc: "Coordinates sub-agents" },
                { value: "worker", label: "Worker", desc: "Executes assigned tasks" },
              ]}
              onChange={() => {}}
              disabled
            />

            {/* Permission Mode */}
            <ConfigSelect
              icon={config.permissionMode === "auto" ? ShieldCheck : ShieldAlert}
              label="Permissions"
              value={config.permissionMode}
              options={[
                { value: "auto", label: "Auto-approve", desc: "Skip all permission prompts" },
                { value: "interactive", label: "Interactive", desc: "Prompt for each tool use" },
              ]}
              onChange={(v) => patchConfig({ permissionMode: v as PermissionMode })}
            />

            {/* Max Turns */}
            <div className="flex items-center gap-2">
              <RotateCcw className="w-3 h-3 text-muted-foreground/50 shrink-0" />
              <span className="text-[11px] text-muted-foreground w-[72px] shrink-0">Max Turns</span>
              <Input
                type="number"
                min={1}
                max={1000}
                placeholder="unlimited"
                value={config.maxTurns ?? ""}
                onChange={(e) =>
                  patchConfig({
                    maxTurns: e.target.value ? parseInt(e.target.value, 10) : null,
                  })
                }
                className="h-6 text-[11px] px-2 py-0 bg-secondary/30 border-border/50 font-mono w-20"
              />
              {config.maxTurns && (
                <button
                  onClick={() => patchConfig({ maxTurns: null })}
                  className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Allowed Tools */}
            <ToolCheckboxDropdown
              icon={Check}
              label="Allowed"
              selectedTools={config.allowedTools}
              onChange={(tools) => patchConfig({ allowedTools: tools })}
            />

            {/* Disallowed Tools */}
            <ToolCheckboxDropdown
              icon={Ban}
              label="Blocked"
              selectedTools={config.disallowedTools}
              onChange={(tools) => patchConfig({ disallowedTools: tools })}
            />

            {/* Custom System Prompt */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                <span className="text-[11px] text-muted-foreground">Custom Instructions</span>
              </div>
              <Textarea
                placeholder="Additional system prompt instructions..."
                value={config.customSystemPrompt}
                onChange={(e) => patchConfig({ customSystemPrompt: e.target.value })}
                className="min-h-[48px] text-[11px] px-2 py-1.5 bg-secondary/30 border-border/50 resize-none leading-relaxed"
                rows={2}
              />
            </div>
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Actions */}
      <div className="flex items-center gap-2">
        {isRunning ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] text-rose border-rose/20 hover:bg-rose/10"
            onClick={handleKill}
          >
            <Power className="w-3 h-3 mr-1.5" />
            Stop Agent
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] text-muted-foreground"
            onClick={handleRemove}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Config sub-components                                                */
/* ================================================================== */

function ConfigSelect({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  options: { value: string; label: string; desc?: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selected = options.find((o) => o.value === value);

  if (disabled) {
    return (
      <div className="flex items-center gap-2">
        <Icon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
        <span className="text-[11px] text-muted-foreground w-[72px] shrink-0">{label}</span>
        <span className="h-6 inline-flex items-center px-2 rounded-md bg-secondary/20 text-[11px] text-foreground/40 font-medium">
          {selected?.label ?? value}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
      <span className="text-[11px] text-muted-foreground w-[72px] shrink-0">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "h-6 inline-flex items-center gap-1.5 px-2 rounded-md",
            "bg-secondary/30 border border-border/50 ring-0",
            "text-[11px] text-foreground/80 font-medium",
            "hover:bg-secondary/50 hover:border-border transition-colors",
            "outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
            "cursor-pointer select-none"
          )}
        >
          {selected?.label ?? value}
          <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4} className="min-w-[180px]">
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(v) => onChange(v as string)}
          >
            {options.map((opt) => (
              <DropdownMenuRadioItem
                key={opt.value}
                value={opt.value}
                className="flex flex-col items-start gap-0 py-1.5 px-2"
              >
                <span className="text-[12px] font-medium">{opt.label}</span>
                {opt.desc && (
                  <span className="text-[10px] text-muted-foreground/60 leading-tight">
                    {opt.desc}
                  </span>
                )}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ToolCheckboxDropdown({
  icon: Icon,
  label,
  selectedTools,
  onChange,
}: {
  icon: typeof Check;
  label: string;
  selectedTools: string[];
  onChange: (tools: string[]) => void;
}) {
  const toggle = (tool: string) => {
    if (selectedTools.includes(tool)) {
      onChange(selectedTools.filter((t) => t !== tool));
    } else {
      onChange([...selectedTools, tool]);
    }
  };

  const count = selectedTools.length;

  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
      <span className="text-[11px] text-muted-foreground w-[72px] shrink-0">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "h-6 inline-flex items-center gap-1.5 px-2 rounded-md",
            "bg-secondary/30 border border-border/50 ring-0",
            "text-[11px] font-medium",
            count > 0 ? "text-foreground/80" : "text-muted-foreground/50",
            "hover:bg-secondary/50 hover:border-border transition-colors",
            "outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
            "cursor-pointer select-none"
          )}
        >
          {count > 0 ? (
            <span>{count} tool{count !== 1 ? "s" : ""}</span>
          ) : (
            <span>none</span>
          )}
          <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={4}
          className="min-w-[220px] max-h-[320px] overflow-y-auto"
        >
          {CLAUDE_TOOL_CATEGORIES.map((cat, catIdx) => (
            <DropdownMenuGroup key={cat.label}>
              {catIdx > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/50 px-2 py-1">
                {cat.label}
              </DropdownMenuLabel>
              {cat.tools.map((tool) => {
                const isSelected = selectedTools.includes(tool.name);
                return (
                  <DropdownMenuItem
                    key={tool.name}
                    className="py-1 px-2 cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      toggle(tool.name);
                    }}
                  >
                    <span
                      className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                        isSelected
                          ? "bg-foreground/90 border-foreground/90"
                          : "border-muted-foreground/30 bg-transparent"
                      )}
                    >
                      {isSelected && <Check className="w-3 h-3 text-background" />}
                    </span>
                    <span className="text-[11px] font-mono font-medium">{tool.name}</span>
                    <span className="text-[10px] text-muted-foreground/50 truncate ml-auto">
                      {tool.desc}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          ))}
          {count > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-muted-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  onChange([]);
                }}
              >
                <X className="w-3 h-3" />
                <span className="text-[11px]">Clear all</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function NodeInfoPanel() {
  // Select raw references (stable) — never .filter() inside a selector
  // because it creates a new array ref every call, which React 19
  // StrictMode interprets as state tearing → infinite re-render loop.
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const allNodes = useAppStore((s) => s.nodes);
  const allAgents = useAppStore((s) => s.agents);
  const allLinks = useAppStore((s) => s.crossSpeakLinks);
  const selectAgent = useAppStore((s) => s.selectAgent);

  // Derive filtered data in the render body (safe — no selector tearing)
  const node = allNodes.find((n) => n.id === selectedNodeId);
  const agents = allAgents.filter((a) => a.nodeId === selectedNodeId);
  const links = allLinks.filter(
    (l) => l.nodeA === selectedNodeId || l.nodeB === selectedNodeId
  );

  if (!node) return null;

  return (
    <div className="p-3 space-y-3">
      {/* Icon + name */}
      <div className="flex items-center gap-2.5">
        {(() => {
          const nodeIdx = allNodes.findIndex((n) => n.id === node.id);
          const NodeIcon = getNodeIcon(nodeIdx >= 0 ? nodeIdx : 0);
          return <NodeIcon className="w-4 h-4 text-zinc-400 shrink-0" />;
        })()}
        <span className="text-[14px] font-semibold">{node.name}</span>
      </div>

      {/* Details */}
      <div className="space-y-2">
        <InfoRow icon={FolderOpen} label="Directory" value={truncatePath(node.directory)} mono />
        <InfoRow icon={Clock} label="Created" value={formatRelative(node.createdAt)} />
      </div>

      {/* Agent list — click to select and view terminal */}
      {agents.length > 0 && (
        <>
          <div className="h-px bg-border" />
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Agents
            </p>
            <div className="space-y-0.5">
              {agents.map((agent) => {
                const st = STATUS_STYLE[agent.status];
                return (
                  <button
                    key={agent.id}
                    onClick={() => selectAgent(agent.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-secondary/50 transition-colors group"
                  >
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        st.bg.replace("/10", ""),
                        agent.status === "active" && "animate-pulse-dot"
                      )}
                    />
                    <AgentIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="text-[12px] text-foreground/80 truncate flex-1">
                      {agent.name}
                    </span>
                    <span className={cn("text-[10px]", st.text, "opacity-60")}>
                      {st.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Cross-speak links */}
      {links.length > 0 && (
        <>
          <div className="h-px bg-border" />
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Cross-speak Links
            </p>
            <div className="space-y-1">
              {links.map((link) => {
                const otherId = link.nodeA === node.id ? link.nodeB : link.nodeA;
                const other = allNodes.find((n) => n.id === otherId);
                return (
                  <div
                    key={link.id}
                    className="flex items-center gap-2 px-2 py-1 rounded-md bg-secondary/30 text-[11px]"
                  >
                    {(() => {
                      const otherIdx = allNodes.findIndex((n) => n.id === otherId);
                      const OtherNodeIcon = getNodeIcon(otherIdx >= 0 ? otherIdx : 0);
                      return <OtherNodeIcon className="w-3 h-3 text-zinc-400 shrink-0" />;
                    })()}
                    <span className="text-foreground/70">{other?.name ?? otherId}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof Hash;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <Icon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
      <span className="text-muted-foreground w-14 shrink-0">{label}</span>
      <span
        title={value}
        className={cn(
          "text-foreground/70 truncate text-left",
          mono && "font-mono text-[10px]"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ================================================================== */
/* Swarm Messages Panel                                                */
/* ================================================================== */

function SwarmPanel() {
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const allAgents = useAppStore((s) => s.agents);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Collect swarm messages: [SWARM], [Message from], [From] across relevant agents
  const swarmMessages: { agentName: string; msg: { id: string; text: string; sentAt: string; direction: string } }[] = [];

  const relevantAgents = selectedAgentId
    ? allAgents.filter((a) => a.id === selectedAgentId)
    : allAgents.filter((a) => a.nodeId === selectedNodeId);

  for (const agent of relevantAgents) {
    for (const msg of agent.messages) {
      // Only show peer-to-peer / swarm messages — exclude user-sent and user-targeted messages
      if (msg.fromId === "user") continue;

      if (
        msg.text.startsWith("[SWARM]") ||
        msg.text.startsWith("[Message from") ||
        msg.text.startsWith("[From") ||
        msg.text.includes("COMPLETED:")
      ) {
        swarmMessages.push({ agentName: agent.name, msg });
      }
    }
  }

  // Sort by timestamp
  swarmMessages.sort((a, b) => a.msg.sentAt.localeCompare(b.msg.sentAt));

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [swarmMessages.length]);

  if (swarmMessages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground/50">
        <div className="text-center">
          <Radio className="w-5 h-5 mx-auto mb-2 opacity-30" />
          <p>No swarm messages yet</p>
          <p className="text-[10px] mt-1 opacity-60">
            Agent-to-agent messages will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="p-3 space-y-1.5">
        {swarmMessages.map(({ agentName, msg }, i) => {
          const isInbound = msg.direction === "inbound";
          const isSystem = msg.text.startsWith("[SWARM]");
          const isCompletion = msg.text.includes("COMPLETED:");

          return (
            <div
              key={`${msg.id}-${i}`}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[11px] leading-relaxed border",
                isSystem
                  ? "bg-cyan/5 border-cyan/10 text-cyan/80"
                  : isCompletion
                    ? "bg-emerald/5 border-emerald/10 text-emerald/80"
                    : isInbound
                      ? "bg-secondary/50 border-border/30 text-foreground/70"
                      : "bg-violet/5 border-violet/10 text-violet/80"
              )}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <AgentIcon className="w-2.5 h-2.5 shrink-0 opacity-50" />
                <span className="font-medium text-[10px] opacity-70">{agentName}</span>
                <span className="text-[9px] opacity-40 ml-auto">
                  {new Date(msg.sentAt).toLocaleTimeString()}
                </span>
              </div>
              <p className="break-words whitespace-pre-wrap">
                {msg.text.length > 500 ? msg.text.slice(0, 500) + "..." : msg.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Diff Panel                                                          */
/* ================================================================== */

function DiffPanel() {
  const agent = useAppStore((s) =>
    s.agents.find((a) => a.id === s.selectedAgentId)
  );
  const [selectedFile, setSelectedFile] = useState<number>(0);

  // Reset selection when agent changes or file count changes
  const safeIndex = agent && selectedFile < agent.diffs.length ? selectedFile : 0;

  if (!agent || agent.diffs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground/50">
        <div className="text-center">
          <GitBranch className="w-5 h-5 mx-auto mb-2 opacity-30" />
          <p>No file changes</p>
        </div>
      </div>
    );
  }

  const diff = agent.diffs[safeIndex];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* File tabs */}
      <div className="shrink-0 border-b border-border/50 overflow-x-auto">
        <div className="flex items-center gap-0.5 px-2 py-1.5">
          {agent.diffs.map((d, i) => (
            <button
              key={i}
              onClick={() => setSelectedFile(i)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono whitespace-nowrap transition-colors",
                i === safeIndex
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              <FileCode className="w-3 h-3 shrink-0" />
              {d.fileName.split("/").pop()}
            </button>
          ))}
        </div>
      </div>

      {/* Diff content */}
      {diff && (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <pre className="p-3 text-[11px] font-mono leading-relaxed text-foreground/70">
            {renderSimpleDiff(diff.original, diff.modified)}
          </pre>
        </div>
      )}
    </div>
  );
}

function renderSimpleDiff(original: string, modified: string): React.ReactNode {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const maxLen = Math.max(origLines.length, modLines.length);
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < maxLen; i++) {
    const orig = origLines[i];
    const mod = modLines[i];

    if (orig === undefined && mod !== undefined) {
      elements.push(
        <div key={`+${i}`} className="bg-emerald/5 text-emerald/80 px-2 -mx-2">
          + {mod}
        </div>
      );
    } else if (mod === undefined && orig !== undefined) {
      elements.push(
        <div key={`-${i}`} className="bg-rose/5 text-rose/80 px-2 -mx-2">
          - {orig}
        </div>
      );
    } else if (orig !== mod) {
      elements.push(
        <div key={`d-${i}`} className="bg-rose/5 text-rose/80 px-2 -mx-2">
          - {orig}
        </div>
      );
      elements.push(
        <div key={`a-${i}`} className="bg-emerald/5 text-emerald/80 px-2 -mx-2">
          + {mod}
        </div>
      );
    } else {
      elements.push(
        <div key={i} className="text-muted-foreground/50 px-2 -mx-2">
          {"  "}{orig}
        </div>
      );
    }
  }

  return elements;
}
