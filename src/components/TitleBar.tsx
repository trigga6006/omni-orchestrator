import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../stores/appStore";
import { cn } from "../lib/utils";
import {
  PanelLeft,
  Minus,
  Square,
  X,
} from "lucide-react";

const appWindow = getCurrentWindow();

export default function TitleBar() {
  const broker = useAppStore((s) => s.broker);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const agents = useAppStore((s) => s.agents);
  const nodes = useAppStore((s) => s.nodes);
  const activeCount = agents.filter((a) => a.status === "active").length;

  return (
    <div
      data-tauri-drag-region
      className="h-10 flex items-center justify-between bg-subtle border-b border-edge select-none shrink-0"
    >
      {/* Left: menu + brand */}
      <div className="flex items-center gap-1 pl-2">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-hover transition-colors"
        >
          <PanelLeft size={15} />
        </button>
        <div className="flex items-center gap-2 pl-1">
          <div className="w-2.5 h-2.5 rounded-full bg-accent-blue" />
          <span className="text-[13px] font-medium tracking-tight text-fg">
            Omni Orchestrator
          </span>
        </div>
      </div>

      {/* Center: status */}
      <div data-tauri-drag-region className="flex items-center gap-4 text-xs text-fg-muted">
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              broker.connected ? "bg-accent-green" : "bg-accent-red animate-pulse-dot"
            )}
          />
          <span>{broker.connected ? "Connected" : "Disconnected"}</span>
        </div>
        <span className="text-fg-dim">|</span>
        <span>{nodes.length} node{nodes.length !== 1 ? "s" : ""}</span>
        <span className="text-fg-dim">|</span>
        <span>{activeCount} active</span>
      </div>

      {/* Right: window controls */}
      <div className="flex items-center">
        <button
          onClick={() => appWindow.minimize()}
          className="h-10 w-11 flex items-center justify-center text-fg-muted hover:text-fg hover:bg-hover transition-colors"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="h-10 w-11 flex items-center justify-center text-fg-muted hover:text-fg hover:bg-hover transition-colors"
        >
          <Square size={11} />
        </button>
        <button
          onClick={() => appWindow.close()}
          className="h-10 w-11 flex items-center justify-center text-fg-muted hover:text-fg hover:bg-accent-red/90 transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
