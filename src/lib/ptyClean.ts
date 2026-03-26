/**
 * Shared PTY output cleaning utilities.
 *
 * Claude Code's terminal output contains ANSI escape codes, TUI widgets
 * (box-drawing, spinner lines, permission notices), and prompt artifacts.
 * This module provides a single aggressive cleaning pipeline that can be
 * used anywhere we need to extract the *semantic* text from raw PTY data.
 */

/* ------------------------------------------------------------------ */
/* Low-level helpers                                                     */
/* ------------------------------------------------------------------ */

/** Convert cursor-movement escapes into whitespace to preserve word boundaries. */
export function convertCursorMovement(text: string): string {
  return text
    .replace(/\x1b\[\d*C/g, " ")          // cursor forward → space
    .replace(/\x1b\[\d*G/g, " ")          // cursor to absolute column → space
    .replace(/\x1b\[\d+;\d+[Hf]/g, "\n"); // cursor to row;col → newline
}

/**
 * Smart cursor-movement converter that tracks the current row.
 * Same-row absolute positions become spaces (preserving inline content);
 * different-row positions become newlines.
 *
 * This is critical for TUI menus where the selected option's `>` cursor,
 * number, and label are all positioned separately on the same row.
 */
export function convertCursorMovementSmart(text: string): string {
  let lastRow = -1;
  // First handle absolute row;col positioning with row tracking
  let result = text.replace(/\x1b\[(\d+);(\d+)[Hf]/g, (_match, rowStr: string) => {
    const row = parseInt(rowStr, 10);
    if (row === lastRow) {
      return " "; // same row — space
    }
    lastRow = row;
    return "\n";  // new row — newline
  });
  // Then handle relative/column-only movements
  result = result.replace(/\x1b\[\d*C/g, " ");  // cursor forward → space
  result = result.replace(/\x1b\[\d*G/g, " ");  // cursor to column → space
  return result;
}

/** Strip ANSI escape codes and control characters. */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[?]?[0-9;]*[a-zA-Z]/g, "")   // CSI sequences
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC sequences
    .replace(/\x1b[()][AB012]/g, "")                // charset switches
    .replace(/\x1b[78]/g, "")                       // save/restore cursor
    .replace(/\x1b[>=]/g, "")                       // keypad modes
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""); // control chars (keep \t \n \r)
}

/** Resolve carriage returns: last non-empty segment per line wins. */
export function resolveCarriageReturns(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!line.includes("\r")) return line;
      const segments = line.split("\r");
      for (let i = segments.length - 1; i >= 0; i--) {
        if (segments[i].length > 0) return segments[i];
      }
      return "";
    })
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* Aggressive TUI artifact cleaner                                      */
/* ------------------------------------------------------------------ */

/**
 * Aggressively clean raw PTY output, stripping all Claude Code TUI
 * artifacts and returning only semantic text.
 *
 * Pipeline:
 *  1. Convert cursor-movement escapes into whitespace (preserve word boundaries)
 *  2. Strip remaining ANSI codes and control chars
 *  3. Collapse multi-space runs
 *  4. Resolve carriage returns
 *  5. Strip TUI widgets (prompt chars, box-drawing, permission notices, spinners, tips, status lines)
 *  6. Deduplicate terminal resize redraws
 */
export function cleanPtyOutput(raw: string): string {
  // 1. Convert cursor-movement into whitespace BEFORE stripping ANSI
  let text = convertCursorMovement(raw);

  // 2. Strip remaining ANSI + control chars
  text = stripAnsi(text);

  // 3. Collapse multiple spaces
  text = text.replace(/ {2,}/g, " ");

  // 4. Resolve carriage returns
  const lines = resolveCarriageReturns(text)
    .split("\n")
    .map((l) => l.trimEnd());

  // 5. Strip TUI artifacts line by line
  const result: string[] = [];
  for (const rawLine of lines) {
    let line = rawLine.replace(/^\s*❯\s*/, "").trimEnd();
    if (!line) continue;

    // Strip leading/trailing box-drawing characters
    line = line
      .replace(/^[\u2500-\u257F─━→←]+\s*/, "")
      .replace(/\s*[\u2500-\u257F─━→←]+$/, "")
      .trimEnd();
    if (!line) continue;

    const t = line.trim();

    // Lines that are ONLY box-drawing / separator chars
    const withoutBox = t.replace(/[\u2500-\u257F─━→←]/g, "").trim();
    if (withoutBox.length === 0 && t.length > 2) continue;

    // Bare ">" prompt
    if (/^>\s*$/.test(t)) continue;

    // "bypass permissions on (shift+tab...)" notices
    if (/bypass\s*permissions/i.test(t)) continue;
    if (/shift\+tab/i.test(t)) continue;

    // "esc to interrupt" notices
    if (/esc\s*to\s*interrupt/i.test(t)) continue;

    // Spinner animation garbage — short fragments with no real word of 4+ chars
    if (t.length < 15 && !/[a-zA-Z]{4,}/.test(t)) continue;

    // Claude Code status / thinking lines
    if (/^[●○*✢·⎿]\s*(Percolating|Thinking|Processing|Generating)/i.test(t)) continue;
    if (/^\s*Percolating/i.test(t)) continue;

    // "Tip:" helper notices
    if (/^\s*⎿?\s*Tip:/i.test(t)) continue;
    if (/^Tip:\s/i.test(t)) continue;

    // "PR #\d+" inline badge
    if (/^PR\s*#\d+\s*$/.test(t)) continue;

    // "⏵⏵" play/skip indicator lines
    if (/^[⏵⏴]+/.test(t)) continue;

    // Claude Code REPL separator (--- > ---)
    if (/^-{3,}\s*>\s*-{0,}/.test(t)) continue;
    if (/^-{5,}$/.test(t)) continue;

    result.push(line);
  }

  // 6. Deduplicate terminal resize redraws
  const firstMsgIdx = result.findIndex((l) => l.startsWith("[Message from"));
  if (firstMsgIdx >= 0) {
    const msgLine = result[firstMsgIdx];
    const lastMsgIdx = result.lastIndexOf(msgLine);
    if (lastMsgIdx > firstMsgIdx) {
      return result.slice(lastMsgIdx).join("\n").trim();
    }
  }

  return result.join("\n").trim();
}
