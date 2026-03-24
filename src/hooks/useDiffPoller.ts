/**
 * Polls the broker for git diffs of active agents.
 * Updates the store so the DiffView tab reflects real changes.
 */

import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { getAgentDiff } from "../lib/broker";

const POLL_INTERVAL = 10_000; // 10 seconds

export function useDiffPoller() {
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    async function pollDiffs() {
      const { agents, setAgentDiffs, broker } = useAppStore.getState();
      if (!broker.connected) return;

      // Only poll for agents that have a peerId and are active/idle
      const eligible = agents.filter(
        (a) => a.peerId && (a.status === "active" || a.status === "idle")
      );

      for (const agent of eligible) {
        try {
          const { files } = await getAgentDiff(agent.peerId!);

          if (files.length > 0) {
            const diffs = files.map((f) => {
              // Detect language from file extension
              const ext = f.fileName.split(".").pop() ?? "";
              const langMap: Record<string, string> = {
                ts: "typescript",
                tsx: "typescript",
                js: "javascript",
                jsx: "javascript",
                py: "python",
                rs: "rust",
                go: "go",
                json: "json",
                css: "css",
                html: "html",
                md: "markdown",
                yaml: "yaml",
                yml: "yaml",
                toml: "toml",
                sql: "sql",
                sh: "shell",
                bash: "shell",
              };

              return {
                fileName: f.fileName,
                language: langMap[ext] ?? "plaintext",
                original: f.original,
                modified: f.modified,
                timestamp: new Date().toISOString(),
              };
            });

            setAgentDiffs(agent.id, diffs);
          }
        } catch {
          // Silently skip — broker might be down or agent disconnected
        }
      }
    }

    // Initial poll
    pollDiffs();

    // Set up interval
    timerRef.current = setInterval(pollDiffs, POLL_INTERVAL);

    return () => {
      clearInterval(timerRef.current);
    };
  }, []);
}
