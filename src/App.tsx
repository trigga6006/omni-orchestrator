import { useWebSocket } from "@/hooks/useWebSocket";
import { useDiffPoller } from "@/hooks/useDiffPoller";
import { useAppStore } from "@/stores/appStore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import TitleBar from "@/components/TitleBar";
import Sidebar from "@/components/Sidebar";
import NodeCanvas from "@/components/NodeCanvas";
import PromptBar from "@/components/PromptBar";
import RightDrawer from "@/components/RightDrawer";

export default function App() {
  useWebSocket();
  useDiffPoller();

  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const rightDrawerOpen = useAppStore((s) => s.rightDrawerOpen);

  return (
    <div className="w-full h-full flex flex-col bg-background">
      <ErrorBoundary>
        <TitleBar />
      </ErrorBoundary>
      <div className="flex-1 flex overflow-hidden">
        {sidebarOpen && (
          <ErrorBoundary fallbackClassName="w-[260px] shrink-0 border-r border-border bg-sidebar">
            <Sidebar />
          </ErrorBoundary>
        )}

        {/* Main content */}
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
      </div>
    </div>
  );
}
