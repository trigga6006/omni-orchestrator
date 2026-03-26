/**
 * React hook that manages the Concierge agent lifecycle.
 * Mount at the App root so the concierge persists across view switches.
 */

import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import {
  spawnConcierge,
  killConcierge,
  sendToConcierge,
  requestRewrite as doRewrite,
  getConciergeOutputSince,
  getConciergeOutputCounter,
  CONCIERGE_AGENT_ID,
} from "../lib/concierge";
import { getContextProvider } from "../lib/conciergeContextProvider";

export function useConcierge() {
  const status = useAppStore((s) => s.conciergeStatus);
  const cwdRef = useRef(".");

  useEffect(() => {
    // Spawn on mount — context is injected on-demand by actions, not on a timer
    spawnConcierge(cwdRef.current).then(() => {
      getContextProvider().startKnowledgeWatcherOnly();
    });

    return () => {
      getContextProvider().stop();
      killConcierge();
    };
  }, []);

  return {
    status,

    /** Send a free-form message to the concierge and poll for response. */
    async sendMessage(text: string) {
      const store = useAppStore.getState();
      store.addConciergeMessage({ role: "user", text });

      const counter = getConciergeOutputCounter();
      await sendToConcierge(text);

      // Poll for response
      return new Promise<string>((resolve) => {
        let lastOutput = "";
        let lastChangeTime = Date.now();

        const timer = setInterval(() => {
          const current = getConciergeOutputSince(counter);
          if (current !== lastOutput) {
            lastOutput = current;
            lastChangeTime = Date.now();
          }

          const silent = Date.now() - lastChangeTime >= 3_000;
          const timedOut = Date.now() - lastChangeTime >= 60_000;

          if ((silent && lastOutput.trim()) || timedOut) {
            clearInterval(timer);
            const response = lastOutput.trim();
            store.addConciergeMessage({ role: "concierge", text: response });
            resolve(response);
          }
        }, 400);
      });
    },

    /** Request a prompt rewrite. */
    requestRewrite: doRewrite,
  };
}
