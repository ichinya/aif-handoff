/**
 * Attachment persistence pipeline: converts incoming attachment payloads
 * (with inline content) into file-backed metadata (with storage paths).
 */

import { logger } from "@aif/shared";
import { saveAttachment, deleteAttachment } from "./attachmentStorage.js";

const log = logger("attachmentPersistence");

interface IncomingAttachment {
  name: string;
  mimeType: string;
  size: number;
  content: string | null;
  path?: string;
}

interface PersistedAttachment {
  name: string;
  mimeType: string;
  size: number;
  content: string | null;
  path?: string;
}

/**
 * Persist incoming attachments to storage and return DB-ready metadata.
 *
 * For each attachment:
 * - If it already has a `path` (re-sent from a previous save), keep it as-is.
 * - If it has inline `content`, write to disk and replace with path reference.
 *   For text files, a small content excerpt is preserved for agent prompts.
 * - If no content and no path, store as metadata-only.
 */
export async function persistAttachments(
  attachments: IncomingAttachment[],
  entityContext: { projectId: string; taskId: string; commentId?: string },
): Promise<PersistedAttachment[]> {
  if (attachments.length === 0) return [];

  log.info(
    {
      taskId: entityContext.taskId,
      commentId: entityContext.commentId,
      count: attachments.length,
      totalBytes: attachments.reduce((sum, a) => sum + a.size, 0),
    },
    "Persisting attachments to storage",
  );

  const persisted: PersistedAttachment[] = [];

  for (const attachment of attachments) {
    // Already file-backed — keep as-is
    if (attachment.path) {
      log.debug(
        { name: attachment.name, path: attachment.path },
        "Attachment already file-backed, skipping write",
      );
      persisted.push({
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        content: null,
        path: attachment.path,
      });
      continue;
    }

    // No content — metadata-only
    if (attachment.content === null) {
      log.debug({ name: attachment.name }, "Metadata-only attachment, no content to persist");
      persisted.push({
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        content: null,
      });
      continue;
    }

    // Has content — write to disk
    try {
      const buffer = decodeContent(attachment.content, attachment.mimeType);
      const result = await saveAttachment({
        projectId: entityContext.projectId,
        taskId: entityContext.taskId,
        commentId: entityContext.commentId,
        filename: attachment.name,
        content: buffer,
      });

      log.debug(
        { name: attachment.name, relativePath: result.relativePath, size: result.size },
        "Attachment written to storage",
      );

      persisted.push({
        name: result.sanitizedName,
        mimeType: attachment.mimeType,
        size: result.size,
        content: null,
        path: result.relativePath,
      });
    } catch (err) {
      log.error(
        { name: attachment.name, taskId: entityContext.taskId, err },
        "Failed to persist attachment — storing as metadata-only",
      );
      persisted.push({
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        content: null,
      });
    }
  }

  return persisted;
}

/**
 * Clean up storage files for attachments that are being replaced.
 * Call this before persisting the new set when updating.
 */
export function cleanupReplacedAttachments(
  oldAttachments: PersistedAttachment[],
  newAttachments: IncomingAttachment[],
): void {
  const newPaths = new Set(newAttachments.filter((a) => a.path).map((a) => a.path!));

  for (const old of oldAttachments) {
    if (old.path && !newPaths.has(old.path)) {
      log.debug({ path: old.path }, "Cleaning up replaced attachment");
      deleteAttachment(old.path);
    }
  }
}

/**
 * Decode content string to buffer.
 * Handles base64 data URIs and plain text.
 */
function decodeContent(content: string, mimeType: string): Buffer {
  // data URI: "data:<mime>;base64,<data>"
  const dataUriMatch = content.match(/^data:[^;]+;base64,(.+)$/s);
  if (dataUriMatch) {
    return Buffer.from(dataUriMatch[1], "base64");
  }

  // Plain base64 for binary MIME types
  if (
    mimeType.startsWith("image/") ||
    mimeType.startsWith("audio/") ||
    mimeType.startsWith("video/") ||
    mimeType === "application/pdf" ||
    mimeType === "application/octet-stream"
  ) {
    try {
      const buf = Buffer.from(content, "base64");
      // Sanity check: if re-encoding matches, it was valid base64
      if (buf.toString("base64") === content.replace(/\s/g, "")) {
        return buf;
      }
    } catch {
      // Fall through to text
    }
  }

  // Text content
  return Buffer.from(content, "utf-8");
}
