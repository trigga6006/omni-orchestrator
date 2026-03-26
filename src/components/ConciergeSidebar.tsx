/**
 * ConciergeSidebar — independent right-hand sidebar containing a raw embedded
 * Claude Code terminal session connected to the concierge agent PTY.
 *
 * Slides in from the right edge. The terminal handles all I/O directly —
 * keyboard input goes to PTY stdin, output streams via Tauri events.
 */

import { useState, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { CONCIERGE_AGENT_ID } from "@/lib/concierge";
import { cn } from "@/lib/utils";
import XtermPanel from "@/components/XtermPanel";
import { X, Sparkles, Loader2 } from "lucide-react";

export default function ConciergeSidebar() {
  const status = useAppStore((s) => s.conciergeStatus);
  const close = useAppStore((s) => s.closeConciergeSidebar);

  // Increment a key each time the concierge transitions through "starting"
  // so XtermPanel remounts with a fresh terminal (clears stale output from
  // a previous session that died and respawned).
  const [sessionKey, setSessionKey] = useState(0);
  useEffect(() => {
    if (status === "starting") {
      setSessionKey((k) => k + 1);
    }
  }, [status]);

  const isReady = status === "ready" || status === "processing";

  return (
    <aside className="w-[400px] shrink-0 flex flex-col border-l border-border bg-sidebar overflow-hidden animate-slide-right">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-violet" />
          <span className="text-[12px] font-medium text-foreground/80">Concierge</span>
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              status === "ready"
                ? "bg-emerald animate-pulse-dot"
                : status === "processing"
                  ? "bg-amber animate-pulse-dot"
                  : status === "starting"
                    ? "bg-sky animate-pulse-dot"
                    : "bg-zinc-600"
            )}
          />
        </div>
        <button
          onClick={close}
          className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-secondary/50 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Terminal or status fallback */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isReady ? (
          <XtermPanel key={sessionKey} agentId={CONCIERGE_AGENT_ID} />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#09090b]">
            {status === "starting" ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-violet/50" />
                <p className="text-[11px] text-muted-foreground/50">Starting concierge...</p>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 text-violet/30" />
                <p className="text-[11px] text-muted-foreground/40">Concierge unavailable</p>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
