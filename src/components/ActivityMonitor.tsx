import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { cn, formatTime } from "../lib/utils";
import type { ActivityEvent } from "../types";

const EVENT_STYLES: Record<string, { icon: string; color: string }> = {
  message: { icon: ">>", color: "text-accent-blue" },
  agent_spawn: { icon: "+", color: "text-accent-green" },
  agent_stop: { icon: "-", color: "text-accent-red" },
  diff: { icon: "~", color: "text-accent-violet" },
  system: { icon: "!", color: "text-accent-amber" },
  cross_speak: { icon: "<>", color: "text-accent-violet" },
};

export default function ActivityMonitor() {
  const activityLog = useAppStore((s) => s.activityLog);
  const selectAgent = useAppStore((s) => s.selectAgent);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activityLog.length]);

  return (
    <div className="flex flex-col h-full">
      {activityLog.length === 0 ? (
        <div className="text-center text-fg-dim text-xs py-8">
          No activity yet.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {activityLog.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              onClickAgent={selectAgent}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

function EventRow({
  event,
  onClickAgent,
}: {
  event: ActivityEvent;
  onClickAgent: (id: string | null) => void;
}) {
  const style = EVENT_STYLES[event.type] ?? { icon: "*", color: "text-fg-muted" };

  return (
    <div
      className={cn(
        "flex items-start gap-2 px-2 py-1 rounded text-[11px] font-mono cursor-default hover:bg-hover transition-colors",
        event.agentId && "cursor-pointer"
      )}
      onClick={() => event.agentId && onClickAgent(event.agentId)}
    >
      <span className="text-fg-dim shrink-0 w-14 text-right tabular-nums">
        {formatTime(event.timestamp)}
      </span>
      <span className={cn("shrink-0 w-4 text-center font-bold", style.color)}>
        {style.icon}
      </span>
      <span className="text-fg-secondary leading-relaxed break-all">
        {event.text}
      </span>
    </div>
  );
}
