import { useEffect } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useDiffPoller } from "@/hooks/useDiffPoller";
import { useConcierge } from "@/hooks/useConcierge";
import { useAppStore } from "@/stores/appStore";
import { killAllAgents } from "@/lib/agentManager";
import { saveWorkspace, loadAppSettings } from "@/lib/workspace";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import TitleBar from "@/components/TitleBar";
import Sidebar from "@/components/Sidebar";
import NodeCanvas from "@/components/NodeCanvas";
import PromptBar from "@/components/PromptBar";
import RightDrawer from "@/components/RightDrawer";
import ConciergeSidebar from "@/components/ConciergeSidebar";
import WelcomeScreen from "@/components/WelcomeScreen";
import SettingsScreen from "@/components/SettingsScreen";

export default function App() {
  useWebSocket();
  useDiffPoller();
  useConcierge();

  // Load persisted settings (nickname, etc.) on app startup
  useEffect(() => { loadAppSettings(); }, []);

  // Kill all agent PTY sessions on app teardown so Claude Code
  // processes don't linger as orphans (broker unregister + timer cleanup).
  // Also autosave workspace if there are unsaved changes.
  useEffect(() => {
    const cleanup = () => {
      const { workspaceDirty, currentWorkspaceName } = useAppStore.getState();
      if (workspaceDirty && currentWorkspaceName) {
        saveWorkspace(currentWorkspaceName).catch(() => {});
      }
      killAllAgents();
    };
    window.addEventListener("beforeunload", cleanup);
    return () => {
      window.removeEventListener("beforeunload", cleanup);
      killAllAgents();
    };
  }, []);

  // Mark workspace dirty when meaningful state changes
  useEffect(() => {
    let prevNodes = useAppStore.getState().nodes.length;
    let prevAgents = useAppStore.getState().agents.length;
    let prevLinks = useAppStore.getState().crossSpeakLinks.length;

    return useAppStore.subscribe((state) => {
      const nodesChanged = state.nodes.length !== prevNodes;
      const agentsChanged = state.agents.length !== prevAgents;
      const linksChanged = state.crossSpeakLinks.length !== prevLinks;

      if (nodesChanged || agentsChanged || linksChanged) {
        prevNodes = state.nodes.length;
        prevAgents = state.agents.length;
        prevLinks = state.crossSpeakLinks.length;
        if (state.currentWorkspaceName && !state.workspaceDirty) {
          state.markWorkspaceDirty();
        }
      }
    });
  }, []);

  const currentView = useAppStore((s) => s.currentView);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const rightDrawerOpen = useAppStore((s) => s.rightDrawerOpen);
  const conciergeSidebarOpen = useAppStore((s) => s.conciergeSidebarOpen);

  return (
    <div className="w-full h-full flex flex-col bg-background">
      <ErrorBoundary>
        <TitleBar />
      </ErrorBoundary>
      <div className="flex-1 flex overflow-hidden">
        {/* Main content area — switches based on currentView */}
        {currentView === "settings" ? (
          <div className="flex-1 overflow-hidden bg-black">
            <SettingsScreen />
          </div>
        ) : currentView === "welcome" ? (
          <div className="flex-1 overflow-hidden bg-black">
            <WelcomeScreen />
          </div>
        ) : (
          <>
            {sidebarOpen && (
              <ErrorBoundary fallbackClassName="w-[260px] shrink-0 border-r border-border bg-sidebar">
                <Sidebar />
              </ErrorBoundary>
            )}
            <main className="flex-1 flex flex-col overflow-hidden min-w-0 dot-grid">
              <ErrorBoundary>
                <NodeCanvas />
              </ErrorBoundary>
              <PromptBar />
            </main>
            {rightDrawerOpen && (
              <ErrorBoundary fallbackClassName="w-[380px] shrink-0 border-l border-border bg-sidebar">
                <RightDrawer />
              </ErrorBoundary>
            )}
          </>
        )}

        {/* Concierge sidebar — persists across all views */}
        {conciergeSidebarOpen && (
          <ErrorBoundary fallbackClassName="w-[400px] shrink-0 border-l border-border bg-sidebar">
            <ConciergeSidebar />
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}
