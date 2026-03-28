import { existsSync, mkdirSync, unlinkSync, readdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, normalize, basename, extname } from "node:path";
import { logger } from "@aif/shared";

const log = logger("attachmentStorage");

/** Root directory for all attachment files (relative to project root) */
const STORAGE_ROOT = join(process.cwd(), "storage");

/** Max filename length after sanitization */
const MAX_FILENAME_LENGTH = 200;

/**
 * Sanitize a filename: strip path separators, collapse whitespace,
 * replace dangerous characters, and truncate.
 */
export function sanitizeFilename(raw: string): string {
  let name = basename(raw);
  // Remove null bytes and control characters
  name = name.replace(/[\x00-\x1f]/g, "");
  // Replace path separators and other dangerous characters
  name = name.replace(/[/\\:*?"<>|]/g, "_");
  // Collapse whitespace
  name = name.replace(/\s+/g, " ").trim();
  // Ensure non-empty
  if (!name || name === "." || name === "..") {
    name = "unnamed";
  }
  // Truncate preserving extension
  if (name.length > MAX_FILENAME_LENGTH) {
    const ext = extname(name);
    const stem = name.slice(0, MAX_FILENAME_LENGTH - ext.length);
    name = stem + ext;
  }
  return name;
}

/**
 * Build the deterministic directory path for a task's attachments.
 */
function taskAttachmentDir(projectId: string, taskId: string): string {
  return join(STORAGE_ROOT, "projects", projectId, "tasks", taskId);
}

/**
 * Build the deterministic directory path for a comment's attachments.
 */
function commentAttachmentDir(projectId: string, taskId: string, commentId: string): string {
  return join(STORAGE_ROOT, "projects", projectId, "tasks", taskId, "comments", commentId);
}

/**
 * Validate that a resolved path stays within the expected base directory.
 * Prevents path traversal attacks.
 */
function assertWithinBase(resolvedPath: string, baseDir: string): void {
  const normalizedResolved = normalize(resolvedPath);
  const normalizedBase = normalize(baseDir);
  if (!normalizedResolved.startsWith(normalizedBase)) {
    log.error(
      { resolvedPath: normalizedResolved, baseDir: normalizedBase },
      "Path traversal attempt blocked",
    );
    throw new Error("Path traversal detected");
  }
}

/**
 * Resolve a relative attachment path to an absolute filesystem path.
 * Validates that the resolved path stays within STORAGE_ROOT.
 *
 * @param relativePath - e.g. "projects/<pid>/tasks/<tid>/file.png"
 * @returns Absolute path on disk
 */
export function resolveAttachmentPath(relativePath: string): string {
  const resolved = join(STORAGE_ROOT, relativePath);
  assertWithinBase(resolved, STORAGE_ROOT);
  log.debug({ relativePath, resolved }, "Resolved attachment path");
  return resolved;
}

export interface SaveAttachmentInput {
  projectId: string;
  taskId: string;
  commentId?: string;
  filename: string;
  content: Buffer;
}

export interface SaveAttachmentResult {
  /** Relative path from storage root (stored in DB) */
  relativePath: string;
  /** Sanitized filename */
  sanitizedName: string;
  /** Bytes written */
  size: number;
}

/**
 * Save an attachment file to disk.
 * Creates directories as needed. Returns the relative path for DB storage.
 */
export async function saveAttachment(input: SaveAttachmentInput): Promise<SaveAttachmentResult> {
  const sanitizedName = sanitizeFilename(input.filename);
  const dir = input.commentId
    ? commentAttachmentDir(input.projectId, input.taskId, input.commentId)
    : taskAttachmentDir(input.projectId, input.taskId);

  const absolutePath = join(dir, sanitizedName);
  assertWithinBase(absolutePath, STORAGE_ROOT);

  log.debug(
    {
      projectId: input.projectId,
      taskId: input.taskId,
      commentId: input.commentId,
      filename: sanitizedName,
      dir,
    },
    "Planning attachment save path and directory creation",
  );

  mkdirSync(dir, { recursive: true });
  await writeFile(absolutePath, input.content);

  const relativePath = absolutePath.slice(STORAGE_ROOT.length + 1);

  log.info(
    {
      taskId: input.taskId,
      commentId: input.commentId,
      filename: sanitizedName,
      size: input.content.length,
      relativePath,
    },
    "Attachment saved to storage",
  );

  return {
    relativePath,
    sanitizedName,
    size: input.content.length,
  };
}

/**
 * Read an attachment file from disk.
 *
 * @param relativePath - Relative path as stored in DB
 * @returns File buffer
 */
export async function readAttachment(relativePath: string): Promise<Buffer> {
  const absolutePath = resolveAttachmentPath(relativePath);
  log.debug({ relativePath }, "Reading attachment from storage");
  return readFile(absolutePath);
}

/**
 * Delete a single attachment file from disk.
 *
 * @param relativePath - Relative path as stored in DB
 * @returns true if deleted, false if file did not exist
 */
export function deleteAttachment(relativePath: string): boolean {
  const absolutePath = resolveAttachmentPath(relativePath);
  try {
    unlinkSync(absolutePath);
    log.info({ relativePath }, "Attachment deleted from storage");
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      log.warn({ relativePath }, "Attachment file not found during delete (already removed)");
      return false;
    }
    log.error({ relativePath, err }, "Failed to delete attachment file");
    throw err;
  }
}

/**
 * Clean up all attachment files for a task (including comment attachments).
 * Removes the entire task directory under storage/.
 *
 * @returns Number of files removed, or -1 if directory didn't exist
 */
export function cleanupTaskAttachmentFiles(projectId: string, taskId: string): number {
  const dir = taskAttachmentDir(projectId, taskId);
  if (!existsSync(dir)) {
    log.warn({ projectId, taskId, dir }, "Task attachment directory not found during cleanup");
    return -1;
  }

  let count = 0;
  try {
    count = countFiles(dir);
    rmSync(dir, { recursive: true, force: true });
    log.info({ projectId, taskId, filesRemoved: count }, "Task attachment directory cleaned up");
  } catch (err) {
    log.error({ projectId, taskId, err }, "Failed to clean up task attachment directory");
    throw err;
  }
  return count;
}

/**
 * Count files recursively in a directory.
 */
function countFiles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}

/**
 * Check if an attachment file exists on disk.
 */
export function attachmentFileExists(relativePath: string): boolean {
  const absolutePath = resolveAttachmentPath(relativePath);
  return existsSync(absolutePath);
}
