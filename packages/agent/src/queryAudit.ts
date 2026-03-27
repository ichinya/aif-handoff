import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { getEnv } from "@aif/shared";

interface QueryAuditRecord {
  timestamp: string;
  taskId: string;
  agentName: string;
  projectRoot: string;
  prompt: string;
  options: Record<string, unknown>;
}

const MAX_AUDIT_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_AUDIT_ROTATIONS = 5;

function getAuditFilePath(agentName: string): string {
  const safeName = agentName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dir = resolve(process.cwd(), "logs");
  mkdirSync(dir, { recursive: true });
  return resolve(dir, `${safeName}.log`);
}

function rotateAuditFileIfNeeded(filePath: string): void {
  if (!existsSync(filePath)) return;

  const size = statSync(filePath).size;
  if (size < MAX_AUDIT_FILE_BYTES) return;

  const oldest = `${filePath}.${MAX_AUDIT_ROTATIONS}`;
  if (existsSync(oldest)) {
    // Drop the oldest archive to keep a bounded number of log files.
    unlinkSync(oldest);
  }

  for (let i = MAX_AUDIT_ROTATIONS - 1; i >= 1; i -= 1) {
    const from = `${filePath}.${i}`;
    const to = `${filePath}.${i + 1}`;
    if (existsSync(from)) {
      renameSync(from, to);
    }
  }

  renameSync(filePath, `${filePath}.1`);
}

export function writeQueryAudit(record: QueryAuditRecord): void {
  try {
    if (!getEnv().AGENT_QUERY_AUDIT_ENABLED) return;
    const filePath = getAuditFilePath(record.agentName);
    rotateAuditFileIfNeeded(filePath);
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // Best-effort logging only; never break agent execution due to audit write errors.
  }
}
