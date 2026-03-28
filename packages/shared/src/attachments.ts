/**
 * Shared attachment parsing and formatting utilities.
 * Used by API routes and agent subagents.
 */

export interface ParsedAttachment {
  name: string;
  mimeType: string;
  size: number;
  content: string | null;
  /** Relative path in storage/ directory. Present for file-backed attachments. */
  path?: string;
}

/**
 * Parse a JSON-serialized attachment array from DB.
 * Handles both legacy (content-only) and new (path-based) records.
 */
export function parseAttachments(raw: string | null): ParsedAttachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const attachment: ParsedAttachment = {
          name: typeof item.name === "string" ? item.name : "file",
          mimeType: typeof item.mimeType === "string" ? item.mimeType : "application/octet-stream",
          size: typeof item.size === "number" ? item.size : 0,
          content: typeof item.content === "string" ? item.content : null,
        };
        if (typeof item.path === "string" && item.path.length > 0) {
          attachment.path = item.path;
        }
        return attachment;
      });
  } catch {
    return [];
  }
}

/**
 * Check whether an attachment is file-backed (has a storage path).
 */
export function isFileBackedAttachment(attachment: ParsedAttachment): boolean {
  return typeof attachment.path === "string" && attachment.path.length > 0;
}

/** Max characters of file content included in agent prompts. */
const CONTENT_PREVIEW_LIMIT = 4000;

/** Thresholds for looksLikeFullPlanUpdate heuristic. */
const PLAN_SHORT_THRESHOLD = 120;
const PLAN_HEADING_THRESHOLD = 400;
const SHORT_PLAN_RETENTION = 0.6;
const LONG_PLAN_RETENTION = 0.5;
const SHORT_PLAN_MIN_LENGTH = 10;
const LONG_PLAN_MIN_LENGTH = 80;

/**
 * Format attachments as path-only references for agent prompts (new flow).
 * Includes validated paths and optional tiny text excerpts.
 * This is the single source of truth for path-based prompt formatting — used by
 * planner, implementer, reviewer, and fast-fix flows.
 */
export function formatAttachmentPathsForPrompt(attachments: ParsedAttachment[]): string {
  const fileBackedAttachments = attachments.filter(isFileBackedAttachment);
  if (fileBackedAttachments.length === 0) return "No task attachments were provided.";

  return fileBackedAttachments
    .map(
      (file, index) =>
        `${index + 1}. ${file.name} (${file.mimeType}, ${file.size} bytes)\n   path: ${file.path}`,
    )
    .join("\n");
}

/**
 * Format attachments for agent prompts (legacy flow — includes inline content).
 * @deprecated Use formatAttachmentPathsForPrompt for new path-based flow.
 */
export function formatAttachmentsForPrompt(raw: string | null): string {
  const attachments = parseAttachments(raw);
  if (attachments.length === 0) return "No task attachments were provided.";

  return attachments
    .map((file, index) => {
      const contentBlock = file.content
        ? `\n    content:\n${file.content
            .slice(0, CONTENT_PREVIEW_LIMIT)
            .split("\n")
            .map((line) => `      ${line}`)
            .join("\n")}`
        : "\n    content: [not provided]";
      return `${index + 1}. ${file.name} (${file.mimeType}, ${file.size} bytes)${contentBlock}`;
    })
    .join("\n");
}

export function extractHeadings(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, "").toLowerCase());
}

export function looksLikeFullPlanUpdate(previousPlan: string, updatedPlan: string): boolean {
  const prev = previousPlan.trim();
  const next = updatedPlan.trim();
  if (!prev) return next.length > 0;
  if (!next) return false;
  const minLength =
    prev.length < PLAN_SHORT_THRESHOLD
      ? Math.max(SHORT_PLAN_MIN_LENGTH, Math.floor(prev.length * SHORT_PLAN_RETENTION))
      : Math.max(LONG_PLAN_MIN_LENGTH, Math.floor(prev.length * LONG_PLAN_RETENTION));
  if (next.length < minLength) return false;

  const prevHeadings = extractHeadings(prev);
  if (prev.length < PLAN_HEADING_THRESHOLD || prevHeadings.length === 0) return true;
  const nextHeadings = new Set(extractHeadings(next));
  return prevHeadings.some((heading) => nextHeadings.has(heading));
}
