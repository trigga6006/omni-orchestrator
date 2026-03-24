import { useWebSocket } from "./hooks/useWebSocket";
import { useDiffPoller } from "./hooks/useDiffPoller";
import { useAppStore } from "./stores/appStore";
import Scene3D from "./components/Scene3D";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import AgentPanel from "./components/AgentPanel";
import ActivityFeed from "./components/ActivityFeed";

export default function App() {
  useWebSocket();
  useDiffPoller();

  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const activityFeedOpen = useAppStore((s) => s.activityFeedOpen);
  const toggleActivityFeed = useAppStore((s) => s.toggleActivityFeed);
  const activityCount = useAppStore((s) => s.activityLog.length);

  return (
    <div className="w-full h-full flex flex-col bg-bg-primary">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar */}
        {sidebarOpen && <Sidebar />}

        {/* 3D Canvas */}
        <div className="flex-1 relative">
          <Scene3D />

          {/* Activity feed toggle button */}
          <button
            onClick={toggleActivityFeed}
            className={`absolute bottom-9 right-3 z-20 px-2.5 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1.5 ${
              activityFeedOpen
                ? "glass-strong text-accent-cyan"
                : "glass text-text-muted hover:text-text-primary"
            }`}
            title="Toggle activity feed"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 3h10M1 6h7M1 9h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            Feed
            {activityCount > 0 && (
              <span className="px-1 py-0 text-[9px] rounded bg-accent-cyan/20 text-accent-cyan">
                {activityCount}
              </span>
            )}
          </button>

          {/* Activity feed panel */}
          {activityFeedOpen && <ActivityFeed />}

          {/* Bottom status bar */}
          <StatusBar />
        </div>

        {/* Agent detail panel */}
        {selectedAgentId && <AgentPanel />}
      </div>
    </div>
  );
}

function StatusBar() {
  const broker = useAppStore((s) => s.broker);
  const agents = useAppStore((s) => s.agents);
  const nodes = useAppStore((s) => s.nodes);

  return (
    <div className="absolute bottom-0 left-0 right-0 h-7 glass flex items-center px-3 gap-4 text-xs z-10">
      <div className="flex items-center gap-1.5">
        <div
          className={`w-1.5 h-1.5 rounded-full ${
            broker.connected ? "bg-accent-emerald" : "bg-accent-red"
          }`}
        />
        <span className="text-text-muted">
          {broker.connected ? "Broker connected" : "Broker disconnected"}
        </span>
      </div>
      <span className="text-text-muted">
        {nodes.length} node{nodes.length !== 1 ? "s" : ""}
      </span>
      <span className="text-text-muted">
        {agents.length} agent{agents.length !== 1 ? "s" : ""}
      </span>
      <span className="text-text-muted">
        {agents.filter((a) => a.status === "active").length} active
      </span>
    </div>
  );
}
