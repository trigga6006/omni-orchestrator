import { useCallback } from "react";
import { useAppStore } from "@/stores/appStore";
import { respondToPermission, respondToQuestion } from "@/lib/agentManager";
import { cn } from "@/lib/utils";
import { Check, X, MessageSquare } from "lucide-react";
import type { PermissionPrompt } from "@/types";

/* ------------------------------------------------------------------ */
/* PermissionBanner                                                     */
/* ------------------------------------------------------------------ */

export default function PermissionBanner() {
  const permissions = useAppStore((s) => s.pendingPermissions);

  if (permissions.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 mb-2">
      {permissions.map((p) =>
        p.kind === "question" ? (
          <QuestionRow key={p.id} prompt={p} />
        ) : (
          <PermissionRow key={p.id} permission={p} />
        )
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* QuestionRow — compact inline chips for AskUserQuestion              */
/* ------------------------------------------------------------------ */

function QuestionRow({ prompt }: { prompt: PermissionPrompt }) {
  const handleSelect = useCallback(
    (optionIndex: number) => {
      respondToQuestion(prompt.agentId, prompt.id, optionIndex);
    },
    [prompt.agentId, prompt.id]
  );

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Header — question text */}
      <div className="px-3 py-1.5 border-b border-white/[0.04]">
        <span className="text-[11px] text-white/50 font-medium">
          {prompt.question || prompt.toolName}
        </span>
      </div>

      {/* Option chips — compact row */}
      <div className="flex items-center gap-1.5 flex-wrap px-3 py-2">
        {prompt.options.map((opt) => {
          const isChatAbout = /^chat about this$/i.test(opt.label);

          return (
            <button
              key={opt.index}
              onClick={() => handleSelect(opt.index)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                isChatAbout
                  ? "text-white/30 hover:text-white/50 hover:bg-white/[0.04]"
                  : "bg-white/[0.05] text-white/60 border border-white/[0.08] hover:bg-white/[0.10] hover:text-white/80 hover:border-white/[0.15]"
              )}
            >
              {isChatAbout && (
                <MessageSquare className="w-3 h-3 inline-block mr-1 -mt-px" />
              )}
              {opt.label}
            </button>
          );
        })}

        {/* Hint: prompt bar = "Type something" */}
        <span className="text-[10px] text-white/20 ml-auto">
          or type below
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PermissionRow — slim inline Allow / Deny bar                        */
/* ------------------------------------------------------------------ */

function PermissionRow({ permission }: { permission: PermissionPrompt }) {
  const handleAllow = useCallback(() => {
    respondToPermission(permission.agentId, permission.id, true);
  }, [permission.agentId, permission.id]);

  const handleDeny = useCallback(() => {
    respondToPermission(permission.agentId, permission.id, false);
  }, [permission.agentId, permission.id]);

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 bg-white/[0.02] border border-white/[0.06]">
      {/* Tool + action */}
      <span className="text-[11px] text-white/40 shrink-0">
        {permission.toolName}
      </span>
      {permission.action && (
        <>
          <div className="w-px h-3 bg-white/[0.08]" />
          <span className="text-[11px] text-white/25 font-mono truncate min-w-0">
            {permission.action}
          </span>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Buttons */}
      <button
        onClick={handleDeny}
        className={cn(
          "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
          "text-white/30 hover:text-red-400 hover:bg-red-500/10"
        )}
      >
        <X className="w-2.5 h-2.5" />
        Deny
      </button>
      <button
        onClick={handleAllow}
        className={cn(
          "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
          "text-white/40 hover:text-emerald-400 hover:bg-emerald-500/10"
        )}
      >
        <Check className="w-2.5 h-2.5" />
        Allow
      </button>
    </div>
  );
}
