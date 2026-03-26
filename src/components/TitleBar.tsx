import { useState, useRef, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Zap, MoreVertical, LogOut, Sparkles, Save, FolderOpen, FilePlus, Settings } from "lucide-react";
import { AgentIcon } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { saveWorkspace, listWorkspaces, loadWorkspace, type WorkspaceInfo } from "@/lib/workspace";
import logoSvg from "@/assets/OI_svg.svg";

let appWindow: ReturnType<typeof getCurrentWindow> | null = null;
try { appWindow = getCurrentWindow(); } catch { /* not in Tauri */ }

export default function TitleBar() {
  const broker = useAppStore((s) => s.broker);
  const agents = useAppStore((s) => s.agents);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const conciergeStatus = useAppStore((s) => s.conciergeStatus);
  const toggleConciergeSidebar = useAppStore((s) => s.toggleConciergeSidebar);
  const currentWorkspaceName = useAppStore((s) => s.currentWorkspaceName);
  const workspaceDirty = useAppStore((s) => s.workspaceDirty);
  const currentView = useAppStore((s) => s.currentView);
  const activeCount = agents.filter((a) => a.status === "active").length;

  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [savingAs, setSavingAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [workspaceList, setWorkspaceList] = useState<WorkspaceInfo[]>([]);
  const [showOpenMenu, setShowOpenMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  // Close menus on outside click
  useEffect(() => {
    if (!menuOpen && !moreOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (moreOpen && moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen, moreOpen]);

  return (
    <header
      data-tauri-drag-region
      className="h-10 flex items-center justify-between border-b border-border bg-sidebar px-3 shrink-0 select-none"
    >
      {/* Left: brand */}
      <div className="flex items-center gap-2 min-w-0">
        <img src={logoSvg} alt="Omniforge" className="w-6 h-6" />
        <span className="text-[13px] font-semibold tracking-tight text-foreground/90">
          Omniforge
        </span>
      </div>

      {/* Center: status indicators */}
      <div data-tauri-drag-region className="flex-1 flex items-center justify-center gap-4">
        <div
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-default"
          title={`Broker: ${broker.url}`}
        >
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              broker.connected
                ? "bg-emerald animate-pulse-dot"
                : "bg-rose"
            )}
          />
          <span>{broker.connected ? "Connected" : "Disconnected"}</span>
        </div>

        {currentView === "orchestrator" && currentWorkspaceName && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/70">{currentWorkspaceName}</span>
            {workspaceDirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber" title="Unsaved changes" />
            )}
          </div>
        )}

        {activeCount > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-sky animate-pulse-dot" />
            <span>{activeCount} active agent{activeCount !== 1 ? "s" : ""}</span>
          </div>
        )}

        {conciergeStatus !== "off" && (
          <button
            onClick={() => toggleConciergeSidebar()}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Open Concierge panel"
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                conciergeStatus === "ready"
                  ? "bg-violet animate-pulse-dot"
                  : conciergeStatus === "processing"
                    ? "bg-amber animate-pulse-dot"
                    : conciergeStatus === "starting"
                      ? "bg-sky animate-pulse-dot"
                      : "bg-zinc-600"
              )}
            />
            <Sparkles className="w-3 h-3" />
            <span>Concierge</span>
          </button>
        )}
      </div>

      {/* Right: more menu + agent settings + window controls */}
      <div className="flex items-center gap-0.5" data-no-drag>
        {/* More menu (three dots) */}
        <div className="relative" ref={moreRef}>
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={cn(
              "w-8 h-7 flex items-center justify-center rounded-md transition-colors",
              moreOpen
                ? "text-foreground bg-secondary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            )}
            title="More options"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>

          {moreOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 p-1 bg-popover border border-border rounded-lg shadow-xl z-50 animate-fade-in-up">
              <div className="h-px bg-border/50 my-1" />
              <button
                onClick={async () => {
                  setMoreOpen(false);
                  if (currentWorkspaceName) {
                    await saveWorkspace(currentWorkspaceName);
                  } else {
                    setSavingAs(true);
                  }
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left hover:bg-secondary/50 transition-colors"
              >
                <Save className="w-3.5 h-3.5 text-emerald" />
                <span className="text-[12px] font-medium text-foreground/90">
                  Save Workspace
                </span>
              </button>
              <button
                onClick={() => {
                  setMoreOpen(false);
                  setSavingAs(true);
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left hover:bg-secondary/50 transition-colors"
              >
                <FilePlus className="w-3.5 h-3.5 text-sky" />
                <span className="text-[12px] font-medium text-foreground/90">
                  Save As...
                </span>
              </button>
              <button
                onClick={async () => {
                  const list = await listWorkspaces();
                  setWorkspaceList(list);
                  setShowOpenMenu(true);
                  setMoreOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left hover:bg-secondary/50 transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber" />
                <span className="text-[12px] font-medium text-foreground/90">
                  Open Workspace
                </span>
              </button>
              <div className="h-px bg-border/50 my-1" />
              <button
                onClick={() => {
                  setMoreOpen(false);
                  setCurrentView("settings");
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left hover:bg-secondary/50 transition-colors"
              >
                <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[12px] font-medium text-foreground/90">
                  Settings
                </span>
              </button>
              <button
                onClick={() => {
                  setMoreOpen(false);
                  setCurrentView("welcome");
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left hover:bg-secondary/50 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[12px] font-medium text-foreground/90">
                  Exit Network
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Agent Settings Button */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              "w-8 h-7 flex items-center justify-center rounded-md transition-colors",
              menuOpen
                ? "text-foreground bg-secondary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            )}
            title="Swarm Settings"
          >
            <AgentIcon className="w-3.5 h-3.5" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-64 p-1.5 bg-popover border border-border rounded-lg shadow-xl z-50 animate-fade-in-up">
              <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider px-2 py-1.5 font-medium">
                Swarm Settings
              </p>

              {/* Auto-send toggle */}
              <button
                onClick={() => updateSettings({ autoSendMessages: !settings.autoSendMessages })}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left hover:bg-secondary/50 transition-colors"
              >
                <div className={cn(
                  "w-5 h-5 rounded-md flex items-center justify-center shrink-0",
                  settings.autoSendMessages ? "bg-emerald/15" : "bg-secondary/80"
                )}>
                  <Zap className={cn(
                    "w-3 h-3",
                    settings.autoSendMessages ? "text-emerald" : "text-muted-foreground/50"
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-foreground/90">
                    Auto-send Messages
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                    Automatically deliver peer messages without manual confirmation
                  </p>
                </div>
                <div className={cn(
                  "w-8 h-4.5 rounded-full p-0.5 transition-colors shrink-0",
                  settings.autoSendMessages ? "bg-emerald" : "bg-muted"
                )}>
                  <div className={cn(
                    "w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform",
                    settings.autoSendMessages ? "translate-x-3.5" : "translate-x-0"
                  )} />
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="w-px h-4 bg-border/50 mx-0.5" />

        {/* Window controls */}
        <button
          onClick={() => appWindow?.minimize()}
          className="w-8 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => appWindow?.toggleMaximize()}
          className="w-8 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => appWindow?.close()}
          className="w-8 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-rose/20 hover:text-rose transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Save As Dialog */}
      {savingAs && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSavingAs(false)} />
          <div className="relative z-10 w-80 bg-popover border border-border rounded-xl p-4 shadow-2xl animate-fade-in-up">
            <h3 className="text-sm font-semibold mb-3">Save Workspace</h3>
            <input
              autoFocus
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              placeholder="Workspace name"
              className="w-full h-8 rounded-md border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring mb-3"
              onKeyDown={async (e) => {
                if (e.key === "Enter" && saveAsName.trim()) {
                  await saveWorkspace(saveAsName.trim());
                  setSaveAsName("");
                  setSavingAs(false);
                }
                if (e.key === "Escape") setSavingAs(false);
              }}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setSavingAs(false)} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/50">Cancel</button>
              <button
                onClick={async () => {
                  if (saveAsName.trim()) {
                    await saveWorkspace(saveAsName.trim());
                    setSaveAsName("");
                    setSavingAs(false);
                  }
                }}
                disabled={!saveAsName.trim()}
                className="text-xs text-white bg-emerald hover:bg-emerald/90 px-3 py-1.5 rounded-md disabled:opacity-40"
              >Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Open Workspace Dialog */}
      {showOpenMenu && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowOpenMenu(false)} />
          <div className="relative z-10 w-96 bg-popover border border-border rounded-xl p-4 shadow-2xl animate-fade-in-up max-h-[60vh] flex flex-col">
            <h3 className="text-sm font-semibold mb-3">Open Workspace</h3>
            {workspaceList.length === 0 ? (
              <p className="text-[12px] text-muted-foreground/60 py-6 text-center">No saved workspaces</p>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-1">
                {workspaceList.map((ws) => (
                  <button
                    key={ws.path}
                    onClick={async () => {
                      setShowOpenMenu(false);
                      await loadWorkspace(ws.path);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-secondary/50 transition-colors"
                  >
                    <FolderOpen className="w-4 h-4 text-amber shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground/90 truncate">{ws.name}</p>
                      <p className="text-[10px] text-muted-foreground/50">
                        {ws.modifiedAt ? new Date(Number(ws.modifiedAt)).toLocaleDateString() : ""}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-3 pt-3 border-t border-border/50">
              <button onClick={() => setShowOpenMenu(false)} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/50">Close</button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
