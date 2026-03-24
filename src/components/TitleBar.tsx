import { useAppStore } from "../stores/appStore";

export default function TitleBar() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const broker = useAppStore((s) => s.broker);

  return (
    <div
      data-tauri-drag-region
      className="h-11 flex items-center justify-between px-3 bg-bg-secondary border-b border-border-subtle select-none shrink-0"
    >
      {/* Left: sidebar toggle + logo */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleSidebar}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-bg-hover transition-colors text-text-secondary hover:text-text-primary"
          title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="3" width="14" height="1.5" rx="0.75" fill="currentColor" />
            <rect x="1" y="7.25" width="14" height="1.5" rx="0.75" fill="currentColor" />
            <rect x="1" y="11.5" width="14" height="1.5" rx="0.75" fill="currentColor" />
          </svg>
        </button>

        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-gradient-to-br from-accent-cyan to-accent-violet flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="2" fill="white" />
              <circle cx="6" cy="6" r="5" stroke="white" strokeWidth="1" opacity="0.5" />
            </svg>
          </div>
          <span className="text-sm font-semibold tracking-tight text-text-primary">
            Claude Swarm
          </span>
        </div>
      </div>

      {/* Center: spacer for drag */}
      <div className="flex-1" />

      {/* Right: status + window controls */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-primary/50 text-xs">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              broker.connected
                ? "bg-accent-emerald status-pulse"
                : "bg-accent-red"
            }`}
          />
          <span className="text-text-muted">
            {broker.connected ? "Online" : "Offline"}
          </span>
        </div>

        <WindowControls />
      </div>
    </div>
  );
}

function WindowControls() {
  const handleMinimize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().minimize();
  };
  const handleMaximize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().toggleMaximize();
  };
  const handleClose = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().close();
  };

  return (
    <div className="flex items-center ml-2">
      <button
        onClick={handleMinimize}
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-text-primary"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        onClick={handleMaximize}
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-text-primary"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" />
        </svg>
      </button>
      <button
        onClick={handleClose}
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-500/20 transition-colors text-text-muted hover:text-accent-red"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" />
          <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}
