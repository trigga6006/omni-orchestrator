/**
 * Prompt Detector
 *
 * Watches raw PTY output from Claude Code agents and detects interactive
 * prompts that need user input:
 *
 * 1. Permission prompts — "Claude wants to use the Bash tool ... Allow? (y/n)"
 * 2. AskUserQuestion prompts — multi-choice menus with numbered options
 *    and an "Enter to select" footer.
 *
 * Usage: call feed() on every PTY chunk to accumulate text, then call
 * detect() after a debounce period to check for prompts.
 */

import { convertCursorMovementSmart, stripAnsi, resolveCarriageReturns } from "./ptyClean";
import type { PermissionPrompt, PromptOption } from "../types";

const MAX_BUFFER = 16_384;

// ---------------------------------------------------------------------------
// Permission prompt patterns
// ---------------------------------------------------------------------------

const TOOL_USE_RE =
  /(?:Claude|claude)\s+wants\s+to\s+use\s+(?:the\s+)?(\w[\w\s]*?)\s+tool[:\s]*\n([\s\S]*?)(?:Allow|Approve)\s*\?/;

const FILE_OP_RE =
  /(?:Claude|claude)\s+wants\s+to\s+(edit|read|write|delete|create)\s+([\s\S]*?)(?:Allow|Approve)\s*\?/;

const GENERIC_ALLOW_RE =
  /(?:Claude|claude)\s+wants\s+to\s+([\s\S]{1,500}?)(?:Allow|Approve)\s*\?/;

// ---------------------------------------------------------------------------
// AskUserQuestion patterns
// ---------------------------------------------------------------------------

const MENU_FOOTER_RE = /Enter to select|to navigate|Esc to cancel/;
const MENU_TITLE_RE = /[╔\[]\s*(.+?)[\s╗\]]*$/;
// Match numbered option lines — captures just the label text before any description
const OPTION_LINE_RE = /^\s*>?\s*(\d+)\.\s+(.+)/;
// "Type something" is handled by the prompt bar — filter it out
const TYPE_SOMETHING_RE = /^Type something\.?$/i;

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export class PermissionDetector {
  private agentId: string;
  private buffer = "";
  private lastPromptId: string | null = null;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  /** Accumulate a raw PTY chunk into the buffer. Does NOT run detection. */
  feed(rawChunk: string): void {
    const cleaned = resolveCarriageReturns(
      stripAnsi(convertCursorMovementSmart(rawChunk))
    );
    this.buffer += cleaned;
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer = this.buffer.slice(-MAX_BUFFER);
    }
  }

  /**
   * Run detection on the accumulated buffer.
   * Call this after a debounce (e.g. 800ms of output silence).
   * Returns a PermissionPrompt if one is found, null otherwise.
   */
  detect(): PermissionPrompt | null {
    // Try question/menu first
    const question = this.detectQuestion();
    if (question) return question;

    // Then permission
    return this.detectPermission();
  }

  /** Reset after a response is sent. */
  reset(): void {
    this.buffer = "";
    this.lastPromptId = null;
  }

  // -----------------------------------------------------------------------
  // AskUserQuestion
  // -----------------------------------------------------------------------

  private detectQuestion(): PermissionPrompt | null {
    if (!MENU_FOOTER_RE.test(this.buffer)) return null;

    // Work with only the tail of the buffer (last 4KB) to avoid matching
    // stale prompts from earlier in the conversation.
    const tail = this.buffer.slice(-4096);
    const lines = tail.split("\n");

    // Find the LAST footer line
    let footerIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (MENU_FOOTER_RE.test(lines[i])) {
        footerIdx = i;
        break;
      }
    }
    if (footerIdx < 0) return null;

    // Collect ALL numbered option lines in the region above the footer.
    // We scan a generous window (40 lines) to catch menus with descriptions.
    const rawOptions: { lineIdx: number; num: number; rawLabel: string }[] = [];
    for (let i = Math.max(0, footerIdx - 40); i < footerIdx; i++) {
      const stripped = lines[i].replace(/[\u2500-\u257F─━→←╔╗╚╝║│]/g, "").trim();
      if (!stripped) continue;
      const m = stripped.match(OPTION_LINE_RE);
      if (m) {
        rawOptions.push({
          lineIdx: i,
          num: parseInt(m[1], 10),
          rawLabel: m[2].trim(),
        });
      }
    }

    if (rawOptions.length === 0) return null;

    // Build final options — just label, no description (user doesn't want them shown).
    // We also clean up the label: if cursor movement collapsed the description into
    // the same line, take only the first few words before any obvious description.
    const allOptions: PromptOption[] = rawOptions.map((o) => ({
      index: o.num,
      label: o.rawLabel
        // Remove trailing period on meta-labels like "Type something."
        .replace(/\.\s*$/, "")
        // If the label looks like "Red Bold and energetic" (description got merged),
        // take only the first capitalized word/phrase before lowercase description
        .trim(),
    }));

    // Filter: "Type something" is handled by the prompt bar.
    // Keep "Chat about this" — it's a real action.
    const displayOptions = allOptions.filter(
      (o) => !TYPE_SOMETHING_RE.test(o.label + ".") && !TYPE_SOMETHING_RE.test(o.label)
    );

    if (displayOptions.length === 0) return null;

    // Extract title and question text from lines above the first option
    const firstOptLineIdx = rawOptions[0].lineIdx;
    let questionText = "";
    let titleText = "";
    for (let i = firstOptLineIdx - 1; i >= Math.max(0, firstOptLineIdx - 10); i--) {
      const line = lines[i].replace(/[\u2500-\u257F─━→←║│╔╗╚╝]/g, "").trim();
      if (!line) continue;
      const tm = line.match(MENU_TITLE_RE);
      if (tm) {
        titleText = tm[1].trim();
        break;
      }
      if (!questionText) questionText = line;
    }
    if (!questionText && titleText) questionText = titleText;

    // Dedupe — same question + same options = same prompt (don't re-emit)
    const contentKey = `${this.agentId}:q:${questionText}:${displayOptions.map((o) => `${o.index}:${o.label}`).join(",")}`;
    if (this.lastPromptId === contentKey) return null;
    this.lastPromptId = contentKey;

    return {
      id: Math.random().toString(36).slice(2, 10),
      agentId: this.agentId,
      agentName: "",
      kind: "question",
      toolName: titleText || "Question",
      action: "",
      question: questionText,
      options: displayOptions,
      rawText: lines
        .slice(Math.max(0, firstOptLineIdx - 3), footerIdx + 1)
        .join("\n")
        .slice(0, 1500),
      detectedAt: Date.now(),
    };
  }

  // -----------------------------------------------------------------------
  // Permission
  // -----------------------------------------------------------------------

  private detectPermission(): PermissionPrompt | null {
    const tail = this.buffer.slice(-4096);

    let match = TOOL_USE_RE.exec(tail);
    if (match) {
      const toolName = match[1].trim();
      const action = match[2].replace(/[\u2500-\u257F─━→←]/g, "").replace(/\s+/g, " ").trim();
      return this.emitPermission(toolName, action, match[0]);
    }

    match = FILE_OP_RE.exec(tail);
    if (match) {
      const op = match[1].trim();
      const target = match[2].replace(/[\u2500-\u257F─━→←]/g, "").replace(/\s+/g, " ").trim();
      return this.emitPermission(op.charAt(0).toUpperCase() + op.slice(1), target, match[0]);
    }

    match = GENERIC_ALLOW_RE.exec(tail);
    if (match) {
      const body = match[1].replace(/[\u2500-\u257F─━→←]/g, "").replace(/\s+/g, " ").trim();
      const tm = body.match(/^use\s+(?:the\s+)?(\w+)/i);
      const toolName = tm ? tm[1] : "Tool";
      const action = tm ? body.replace(tm[0], "").trim() : body;
      return this.emitPermission(toolName, action || body, match[0]);
    }

    return null;
  }

  private emitPermission(
    toolName: string,
    action: string,
    rawText: string,
  ): PermissionPrompt | null {
    const contentKey = `${this.agentId}:p:${toolName}:${action}`;
    if (this.lastPromptId === contentKey) return null;
    this.lastPromptId = contentKey;

    return {
      id: Math.random().toString(36).slice(2, 10),
      agentId: this.agentId,
      agentName: "",
      kind: "permission",
      toolName,
      action: action.slice(0, 500),
      question: "",
      options: [],
      rawText: rawText.slice(0, 1000),
      detectedAt: Date.now(),
    };
  }
}
