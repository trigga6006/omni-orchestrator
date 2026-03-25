import { useState, useRef, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Zap } from "lucide-react";
import { AgentIcon } from "@/lib/utils";
import { cn } from "@/lib/utils";
import logoSvg from "@/assets/OI_svg.svg";

const appWindow = getCurrentWindow();

export default function TitleBar() {
  const broker = useAppStore((s) => s.broker);
  const agents = useAppStore((s) => s.agents);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const activeCount = agents.filter((a) => a.status === "active").length;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  return (
    <header
      data-tauri-drag-region
      className="h-10 flex items-center justify-between border-b border-border bg-sidebar px-3 shrink-0 select-none"
    >
      {/* Left: brand */}
      <div className="flex items-center gap-2 min-w-0">
        <img src={logoSvg} alt="Omni Orchestrator" className="w-6 h-6" />
        <span className="text-[13px] font-semibold tracking-tight text-foreground/90">
          Omni Orchestrator
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

        {activeCount > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-sky animate-pulse-dot" />
            <span>{activeCount} active agent{activeCount !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>

      {/* Right: agent settings + window controls */}
      <div className="flex items-center gap-0.5" data-no-drag>
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
          onClick={() => appWindow.minimize()}
          className="w-8 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="w-8 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => appWindow.close()}
          className="w-8 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-rose/20 hover:text-rose transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}
