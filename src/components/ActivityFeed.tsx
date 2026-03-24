import { useRef, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import type { ActivityEvent } from "../types";

const TYPE_STYLES: Record<ActivityEvent["type"], { icon: string; color: string }> = {
  message: { icon: ">>", color: "text-accent-cyan" },
  agent_spawn: { icon: "+", color: "text-accent-emerald" },
  agent_stop: { icon: "-", color: "text-accent-red" },
  diff: { icon: "~", color: "text-accent-violet" },
  system: { icon: "!", color: "text-accent-amber" },
  cross_speak: { icon: "<>", color: "text-accent-violet" },
};

export default function ActivityFeed() {
  const activityLog = useAppStore((s) => s.activityLog);
  const toggleActivityFeed = useAppStore((s) => s.toggleActivityFeed);
  const selectAgent = useAppStore((s) => s.selectAgent);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activityLog.length]);

  return (
    <div className="absolute bottom-7 left-0 right-0 h-52 z-20 glass-strong flex flex-col animate-fade-in">
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-border-subtle flex items-center justify-between shrink-0">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
          Activity Feed
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted">
            {activityLog.length} events
          </span>
          <button
            onClick={toggleActivityFeed}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-text-primary"
          >
            <svg width="8" height="8" viewBox="0 0 10 10">
              <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" />
              <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Events */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-1 font-mono">
        {activityLog.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <span className="text-xs text-text-muted">
              No activity yet. Events will appear as agents work.
            </span>
          </div>
        ) : (
          activityLog.map((event) => {
            const style = TYPE_STYLES[event.type];
            return (
              <div
                key={event.id}
                className="flex items-start gap-2 py-0.5 text-[11px] leading-relaxed group"
              >
                <span className="text-[10px] text-text-muted shrink-0 w-16">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
                <span className={`shrink-0 w-5 text-center ${style.color}`}>
                  {style.icon}
                </span>
                <span
                  className="text-text-secondary flex-1 cursor-default hover:text-text-primary transition-colors"
                  onClick={() => {
                    if (event.agentId) selectAgent(event.agentId);
                  }}
                >
                  {event.text}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
