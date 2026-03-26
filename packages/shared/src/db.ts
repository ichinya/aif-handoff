import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { logger } from "./logger.js";

const log = logger("db");

let _db: BetterSQLite3Database<typeof schema> | null = null;
let _sqlite: Database.Database | null = null;

/** Find monorepo root by walking up from this file (packages/shared/src/db.ts → root). */
function findMonorepoRoot(): string {
  // db.ts lives at packages/shared/src/db.ts — root is 3 levels up
  const thisFile = fileURLToPath(import.meta.url);
  let dir = dirname(thisFile);

  for (let i = 0; i < 10; i++) {
    const pkgPath = resolve(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) return dir;
      } catch {}
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback: 3 levels up from this file
  return resolve(dirname(thisFile), "../../..");
}

const MONOREPO_ROOT = findMonorepoRoot();

/** Resolve DB path relative to the monorepo root. */
function resolveDbPath(raw: string): string {
  if (raw === ":memory:" || raw.startsWith("/")) return raw;
  return resolve(MONOREPO_ROOT, raw);
}

export function getDb(
  url?: string
): BetterSQLite3Database<typeof schema> {
  if (_db) return _db;

  const dbPath = resolveDbPath(url ?? process.env.DATABASE_URL ?? "./data/aif.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });
  log.debug({ dbPath }, "Opening database connection");

  _sqlite = new Database(dbPath);
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  ensureTables(_sqlite);

  _db = drizzle(_sqlite, { schema });
  log.info({ dbPath }, "Database connected");

  return _db;
}

/** Create tables if they don't exist. */
function ensureTables(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      attachments TEXT NOT NULL DEFAULT '[]',
      auto_mode INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'backlog',
      priority INTEGER NOT NULL DEFAULT 0,
      position REAL NOT NULL DEFAULT 1000.0,
      plan TEXT,
      implementation_log TEXT,
      review_comments TEXT,
      agent_activity_log TEXT,
      blocked_reason TEXT,
      blocked_from_status TEXT,
      retry_after TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT 'human',
      message TEXT NOT NULL,
      attachments TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  ensureColumn(sqlite, "tasks", "blocked_reason", "blocked_reason TEXT");
  ensureColumn(sqlite, "tasks", "blocked_from_status", "blocked_from_status TEXT");
  ensureColumn(sqlite, "tasks", "retry_after", "retry_after TEXT");
  ensureColumn(sqlite, "tasks", "retry_count", "retry_count INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "tasks", "auto_mode", "auto_mode INTEGER NOT NULL DEFAULT 1");
  ensureColumn(sqlite, "tasks", "attachments", "attachments TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(sqlite, "task_comments", "author", "author TEXT NOT NULL DEFAULT 'human'");
  ensureColumn(sqlite, "task_comments", "attachments", "attachments TEXT NOT NULL DEFAULT '[]'");
}

function ensureColumn(
  sqlite: Database.Database,
  table: string,
  columnName: string,
  columnDefinition: string
): void {
  const columns = sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition}`);
  }
}

/** Create a fresh in-memory DB — useful for testing */
export function createTestDb(): BetterSQLite3Database<typeof schema> {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  ensureTables(sqlite);

  const db = drizzle(sqlite, { schema });
  log.debug("Created in-memory test database");

  return db;
}

export function closeDb(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
    log.debug("Database connection closed");
  }
}
