import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/stores/appStore";
import { listWorkspaces, loadWorkspace, deleteWorkspace, saveAppSettings, type WorkspaceInfo } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  FolderOpen,
  Trash2,
  Zap,
  Settings,
  HardDrive,
  Loader2,
  User,
} from "lucide-react";
import logoSvg from "@/assets/OI_svg.svg";

type Page = "workspaces" | "settings";

const NAV_ITEMS: { id: Page; label: string; icon: typeof Settings }[] = [
  { id: "workspaces", label: "Workspaces", icon: HardDrive },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function SettingsScreen() {
  const [page, setPage] = useState<Page>("workspaces");
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  return (
    <div className="w-full h-full flex bg-black">
      {/* ---- Sidebar ---- */}
      <aside className="w-[220px] shrink-0 flex flex-col border-r border-white/[0.06] bg-white/[0.01]">
        {/* Back + title */}
        <div className="px-4 pt-5 pb-3">
          <button
            onClick={() => setCurrentView("welcome")}
            className="flex items-center gap-1.5 text-[12px] text-white/25 hover:text-white/50 transition-colors mb-4"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
          <h1 className="text-[18px] font-semibold text-white/85 tracking-tight">Settings</h1>
        </div>

        <Separator className="bg-white/[0.06]" />

        {/* Nav items */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setPage(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors",
                  active
                    ? "bg-white/[0.08] text-white"
                    : "text-white/35 hover:text-white/55 hover:bg-white/[0.03]"
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Version + branding */}
        <div className="px-4 pb-5 pt-3 border-t border-white/[0.06]">
          <p className="text-[11px] text-white/20 mb-2">v0.1.0</p>
          <div className="flex items-center gap-1.5">
            <img src={logoSvg} alt="Omni Impact" className="w-3.5 h-3.5" />
            <span className="text-[11px] text-white/25">Omni Impact</span>
          </div>
        </div>
      </aside>

      {/* ---- Content ---- */}
      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-[640px] px-10 py-8">
          {page === "workspaces" ? <WorkspacesPage /> : <SettingsPage />}
        </div>
      </main>
    </div>
  );
}

/* ================================================================== */
/* Workspaces Page                                                     */
/* ================================================================== */

function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listWorkspaces();
      setWorkspaces(list);
    } catch (err) {
      console.error("Failed to list workspaces:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDelete = useCallback(async (path: string) => {
    setDeletingPath(path);
    try {
      await deleteWorkspace(path);
      setWorkspaces((prev) => prev.filter((ws) => ws.path !== path));
    } catch (err) {
      console.error("Failed to delete workspace:", err);
    } finally {
      setDeletingPath(null);
    }
  }, []);

  const handleLoad = useCallback(async (path: string) => {
    setLoadingPath(path);
    try {
      await loadWorkspace(path);
    } catch (err) {
      console.error("Failed to load workspace:", err);
    } finally {
      setLoadingPath(null);
    }
  }, []);

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-white/80 mb-1">Workspaces</h2>
      <p className="text-[13px] text-white/25 mb-6">
        Manage your saved workspaces. Load to restore agents and nodes, or delete to clean up.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 text-white/20 animate-spin" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <HardDrive className="w-8 h-8 text-white/10 mb-3" />
          <p className="text-[14px] text-white/30 mb-1">No saved workspaces</p>
          <p className="text-[12px] text-white/15">
            Save a workspace from the orchestrator or chat view to see it here
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {workspaces.map((ws) => {
            const isDeleting = deletingPath === ws.path;
            const isLoading = loadingPath === ws.path;
            const dateStr = ws.modifiedAt
              ? new Date(Number(ws.modifiedAt)).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "";

            return (
              <div
                key={ws.path}
                className="flex items-center gap-4 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] transition-all group"
              >
                <FolderOpen className="w-5 h-5 text-amber/40 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-white/70 font-medium truncate">{ws.name}</p>
                  <p className="text-[11px] text-white/20">{dateStr}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleLoad(ws.path)}
                    disabled={isLoading || !!loadingPath}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors",
                      isLoading
                        ? "bg-emerald/20 text-emerald cursor-wait"
                        : "bg-white/[0.04] text-white/40 hover:bg-emerald/15 hover:text-emerald"
                    )}
                  >
                    {isLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      "Load"
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(ws.path)}
                    disabled={isDeleting}
                    className={cn(
                      "p-1.5 rounded-md transition-colors",
                      isDeleting
                        ? "text-rose/50 cursor-wait"
                        : "text-white/15 hover:text-rose hover:bg-rose/10 opacity-0 group-hover:opacity-100"
                    )}
                    title="Delete workspace"
                  >
                    {isDeleting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* Settings Page                                                       */
/* ================================================================== */

function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [nickname, setNickname] = useState(settings.nickname || "");

  const saveNickname = useCallback((value: string) => {
    updateSettings({ nickname: value });
    saveAppSettings();
  }, [updateSettings]);

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-white/80 mb-1">Settings</h2>
      <p className="text-[13px] text-white/25 mb-6">
        Configure your profile and swarm behavior.
      </p>

      <div className="space-y-6">
        {/* Profile */}
        <section>
          <h3 className="text-[11px] text-white/20 uppercase tracking-wider font-medium mb-3">
            Profile
          </h3>
          <div className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04] text-left">
            <div className="shrink-0 text-white/20">
              <User className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] text-white/70 font-medium mb-1">Nickname</p>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                onBlur={() => saveNickname(nickname)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    saveNickname(nickname);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="Enter a nickname..."
                className="w-full h-8 rounded-md border border-white/[0.06] bg-white/[0.03] px-3 text-[13px] text-white placeholder:text-white/15 focus:outline-none focus:ring-1 focus:ring-white/[0.15]"
              />
              <p className="text-[11px] text-white/15 mt-1">Shown on the welcome screen</p>
            </div>
          </div>
        </section>

        {/* Swarm Communication */}
        <section>
          <h3 className="text-[11px] text-white/20 uppercase tracking-wider font-medium mb-3">
            Swarm Communication
          </h3>
          <ToggleRow
            icon={<Zap className="w-4 h-4" />}
            iconColor={settings.autoSendMessages ? "text-emerald" : "text-white/20"}
            title="Auto-send Messages"
            description="Automatically deliver peer messages to agents without manual confirmation"
            enabled={settings.autoSendMessages}
            onToggle={() => {
              updateSettings({ autoSendMessages: !settings.autoSendMessages });
              // Persist after a tick so the store has updated
              setTimeout(() => saveAppSettings(), 0);
            }}
          />
        </section>

        {/* Placeholder */}
        <section>
          <h3 className="text-[11px] text-white/20 uppercase tracking-wider font-medium mb-3">
            Defaults
          </h3>
          <div className="px-4 py-8 rounded-xl bg-white/[0.02] border border-white/[0.04] text-center">
            <p className="text-[12px] text-white/15">
              More settings coming soon — model defaults, appearance, keybindings
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Toggle Row                                                          */
/* ================================================================== */

function ToggleRow({
  icon,
  iconColor,
  title,
  description,
  enabled,
  onToggle,
}: {
  icon: React.ReactNode;
  iconColor: string;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] transition-all text-left"
    >
      <div className={cn("shrink-0", iconColor)}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] text-white/70 font-medium">{title}</p>
        <p className="text-[11px] text-white/25 leading-relaxed">{description}</p>
      </div>
      <div
        className={cn(
          "w-10 h-5.5 rounded-full p-0.5 transition-colors shrink-0",
          enabled ? "bg-emerald" : "bg-white/[0.08]"
        )}
      >
        <div
          className={cn(
            "w-4.5 h-4.5 rounded-full bg-white shadow-sm transition-transform",
            enabled ? "translate-x-[18px]" : "translate-x-0"
          )}
        />
      </div>
    </button>
  );
}
