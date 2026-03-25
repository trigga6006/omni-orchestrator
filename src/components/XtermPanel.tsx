import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getPtyOutputBuffer } from "@/lib/agentManager";
import "@xterm/xterm/css/xterm.css";

interface XtermPanelProps {
  agentId: string;
}

export default function XtermPanel({ agentId }: XtermPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily:
        "'Geist Mono Variable', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: "#09090b",
        foreground: "#d4d4d8",
        cursor: "#10b981",
        selectionBackground: "#3f3f4680",
        black: "#09090b",
        red: "#ef4444",
        green: "#10b981",
        yellow: "#f59e0b",
        blue: "#3b82f6",
        magenta: "#8b5cf6",
        cyan: "#06b6d4",
        white: "#d4d4d8",
        brightBlack: "#52525b",
        brightRed: "#f87171",
        brightGreen: "#34d399",
        brightYellow: "#fbbf24",
        brightBlue: "#60a5fa",
        brightMagenta: "#a78bfa",
        brightCyan: "#22d3ee",
        brightWhite: "#fafafa",
      },
      scrollback: 10000,
      convertEol: false,
      allowTransparency: true,
      rightClickSelectsWord: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    // ---- Clipboard handling ----
    // Ctrl+V / paste: let xterm handle it natively — it reads the clipboard
    // and emits through onData (which writes to PTY). Do NOT also write
    // explicitly here, or the paste will be sent twice.
    term.attachCustomKeyEventHandler((event) => {
      const isMod = event.ctrlKey || event.metaKey;

      // Ctrl+C with selected text → copy to clipboard (don't send ^C to PTY)
      if (isMod && event.key === "c" && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection()).catch(() => {});
        return false;
      }

      // Ctrl+V → let xterm handle natively (paste event → onData → PTY)
      if (isMod && event.key === "v") {
        return true; // allow xterm to process the paste
      }

      // Ctrl+A → select all terminal text
      if (isMod && event.key === "a") {
        term.selectAll();
        return false;
      }

      return true;
    });

    // Fit after the DOM has settled
    requestAnimationFrame(() => fit.fit());

    // Replay any buffered output from before this panel mounted
    const buffer = getPtyOutputBuffer(agentId);
    for (const chunk of buffer) {
      term.write(chunk);
    }

    // Stream new PTY output into the terminal
    const unlistenOutput = listen<string>(
      `pty-output-${agentId}`,
      (event) => {
        term.write(event.payload);
      }
    );

    // Forward keystrokes from xterm to the PTY stdin
    const onDataDispose = term.onData((data) => {
      invoke("write_pty", { id: agentId, data }).catch(() => {});
    });

    // When xterm detects a size change, tell the PTY backend
    const onResizeDispose = term.onResize(({ cols, rows }) => {
      invoke("resize_pty", { id: agentId, cols, rows }).catch(() => {});
    });

    // Refit whenever the container resizes
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => fit.fit());
    });
    observer.observe(el);

    return () => {
      unlistenOutput.then((fn) => fn());
      onDataDispose.dispose();
      onResizeDispose.dispose();
      observer.disconnect();
      term.dispose();
    };
  }, [agentId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-0"
      style={{ padding: 4, background: "#09090b" }}
    />
  );
}
