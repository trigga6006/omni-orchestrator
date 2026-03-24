import { useWebSocket } from "./hooks/useWebSocket";
import { useDiffPoller } from "./hooks/useDiffPoller";
import { useAppStore } from "./stores/appStore";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import NodeMap from "./components/NodeMap";
import PromptBar from "./components/PromptBar";
import RightDrawer from "./components/RightDrawer";

export default function App() {
  useWebSocket();
  useDiffPoller();

  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const rightDrawerOpen = useAppStore((s) => s.rightDrawerOpen);

  return (
    <div className="w-full h-full flex flex-col bg-base">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        {sidebarOpen && <Sidebar />}

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <NodeMap />
          <PromptBar />
        </main>

        {/* Right drawer */}
        {rightDrawerOpen && <RightDrawer />}
      </div>
    </div>
  );
}
