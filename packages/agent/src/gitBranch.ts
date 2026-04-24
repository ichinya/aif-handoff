import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getProjectConfig, logger, type AifProjectGit } from "@aif/shared";

const log = logger("git-branch");

/**
 * Typed error for branch/worktree isolation failures.
 *
 * Thrown by `ensureFeatureBranch`, `assertCurrentBranch`, and
 * `assertWorkingTreeClean`. The coordinator's stage-error handler treats
 * this as `blocked_external` with no retry — operator intervention is
 * required (dirty worktree, branch drift, missing branch) and a silent
 * retry would corrupt repo state further.
 */
export class BranchIsolationError extends Error {
  readonly kind:
    | "dirty_worktree"
    | "branch_missing"
    | "branch_drift"
    | "base_branch_unavailable"
    | "checkout_failed"
    | "create_failed";
  readonly branchName: string | null;
  readonly projectRoot: string;
  constructor(
    kind: BranchIsolationError["kind"],
    message: string,
    projectRoot: string,
    branchName: string | null,
  ) {
    super(message);
    this.name = "BranchIsolationError";
    this.kind = kind;
    this.projectRoot = projectRoot;
    this.branchName = branchName;
  }
}

export function isBranchIsolationError(err: unknown): err is BranchIsolationError {
  return err instanceof BranchIsolationError;
}

export interface EnsureFeatureBranchInput {
  projectRoot: string;
  taskId: string;
  /** Task title used to derive a slug when `explicitBranchName` is not provided. */
  title: string;
  /** If set (e.g. persisted on the task), skip slug derivation and use this name. */
  explicitBranchName?: string | null;
  /**
   * If true, NEVER create the branch — only switch to an existing one.
   * Used by implementer/plan-checker/reviewer to restore the planner-prepared
   * branch. Throws `BranchIsolationError` if the branch is missing.
   */
  switchOnly?: boolean;
}

export interface EnsureFeatureBranchResult {
  /** `"skipped"` when git is disabled, repo missing, or create_branches=false. */
  action: "skipped" | "created" | "switched";
  /** Resolved branch name. `null` when action === "skipped". */
  branchName: string | null;
  /** Short human-readable reason when skipped. */
  reason?: string;
}

const BRANCH_SLUG_MAX = 40;

export function slugifyTitle(title: string): string {
  const normalized = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = normalized.slice(0, BRANCH_SLUG_MAX).replace(/-+$/, "");
  return trimmed || "task";
}

export function buildBranchName(prefix: string, title: string, taskId: string): string {
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const slug = slugifyTitle(title);
  const shortId = taskId.replace(/-/g, "").slice(0, 6);
  return `${normalizedPrefix}${slug}-${shortId}`;
}

function runGit(
  cwd: string,
  args: string[],
  opts: { ignoreExit?: boolean } = {},
): { stdout: string; stderr: string; status: number } {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  };
  try {
    const stdout = execFileSync("git", args, options);
    return { stdout: stdout.toString().trim(), stderr: "", status: 0 };
  } catch (err) {
    const error = err as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number;
    };
    const stdout = error.stdout ? error.stdout.toString().trim() : "";
    const stderr = error.stderr ? error.stderr.toString().trim() : String(err);
    const status = typeof error.status === "number" ? error.status : 1;
    if (!opts.ignoreExit) {
      log.debug({ cwd, args, status, stderr }, "git command failed");
    }
    return { stdout, stderr, status };
  }
}

export function isGitRepo(projectRoot: string): boolean {
  if (!existsSync(join(projectRoot, ".git"))) {
    const { status } = runGit(projectRoot, ["rev-parse", "--is-inside-work-tree"], {
      ignoreExit: true,
    });
    return status === 0;
  }
  return true;
}

export function getCurrentBranch(projectRoot: string): string | null {
  const { stdout, status } = runGit(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"], {
    ignoreExit: true,
  });
  if (status !== 0 || !stdout || stdout === "HEAD") return null;
  return stdout;
}

export function branchExists(projectRoot: string, branchName: string): boolean {
  const { status } = runGit(
    projectRoot,
    ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
    { ignoreExit: true },
  );
  return status === 0;
}

export function workingTreeClean(projectRoot: string): boolean {
  const { stdout, status } = runGit(projectRoot, ["status", "--porcelain"], { ignoreExit: true });
  return status === 0 && stdout.length === 0;
}

export function describeDirtyWorkingTree(projectRoot: string): string | null {
  const { stdout, status } = runGit(projectRoot, ["status", "--porcelain"], { ignoreExit: true });
  if (status !== 0 || stdout.length === 0) return null;
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  const summary = lines.slice(0, 5).join(", ");
  return lines.length > 5 ? `${summary}, +${lines.length - 5} more` : summary;
}

/**
 * Hard gate: refuse to touch branch state when the work tree has uncommitted
 * changes. Called before any branch create/switch.
 */
export function assertWorkingTreeClean(projectRoot: string, branchName: string | null): void {
  const dirty = describeDirtyWorkingTree(projectRoot);
  if (dirty) {
    throw new BranchIsolationError(
      "dirty_worktree",
      `Working tree at ${projectRoot} has uncommitted changes (${dirty}). Commit, stash, or discard them before continuing.`,
      projectRoot,
      branchName,
    );
  }
}

/**
 * Assert HEAD matches the expected branch. Throws `branch_drift` when not —
 * used after the planner subagent returns to detect cases where the skill or
 * plan-polisher silently switched branches mid-run.
 */
export function assertCurrentBranch(projectRoot: string, expected: string): void {
  const current = getCurrentBranch(projectRoot);
  if (current !== expected) {
    throw new BranchIsolationError(
      "branch_drift",
      `Branch drift detected: expected HEAD=${expected}, actual HEAD=${current ?? "detached"}.`,
      projectRoot,
      expected,
    );
  }
}

function resolveGitConfig(projectRoot: string): AifProjectGit {
  return getProjectConfig(projectRoot).git;
}

/**
 * Create or switch to the task's feature branch.
 *
 * Returns `action: "skipped"` when `git.enabled=false`, the project isn't a
 * git repo, or `git.create_branches=false` — a legitimate no-op. Throws
 * `BranchIsolationError` on any other failure (dirty work tree, missing
 * branch in switchOnly mode, failed checkout, base-branch unavailable). The
 * coordinator classifies the typed error as `blocked_external` so operators
 * can inspect the work tree instead of silently retrying into bad state.
 */
export function ensureFeatureBranch(input: EnsureFeatureBranchInput): EnsureFeatureBranchResult {
  const { projectRoot, title, explicitBranchName, taskId, switchOnly } = input;
  const config = resolveGitConfig(projectRoot);

  if (!config.enabled) {
    return { action: "skipped", branchName: null, reason: "git.enabled=false" };
  }
  if (!isGitRepo(projectRoot)) {
    return { action: "skipped", branchName: null, reason: "not a git work tree" };
  }
  // switchOnly ignores create_branches (we're only restoring a
  // previously-created branch, not provisioning a new one). Outside
  // switchOnly, respect create_branches as an opt-out.
  if (!config.create_branches && !switchOnly) {
    return { action: "skipped", branchName: null, reason: "git.create_branches=false" };
  }

  const branchName = explicitBranchName?.trim()
    ? explicitBranchName.trim()
    : buildBranchName(config.branch_prefix, title, taskId);

  const current = getCurrentBranch(projectRoot);
  if (current === branchName) {
    return { action: "switched", branchName };
  }

  // Any branch transition MUST start from a clean work tree. Otherwise git
  // either refuses with a cryptic error or silently carries dirty changes
  // onto the new branch.
  assertWorkingTreeClean(projectRoot, branchName);

  if (branchExists(projectRoot, branchName)) {
    const { status, stderr } = runGit(projectRoot, ["checkout", branchName], {
      ignoreExit: true,
    });
    if (status !== 0) {
      throw new BranchIsolationError(
        "checkout_failed",
        `git checkout ${branchName} failed: ${stderr || "unknown error"}`,
        projectRoot,
        branchName,
      );
    }
    log.info(
      { projectRoot, branchName, previous: current, taskId },
      "Switched to existing feature branch",
    );
    return { action: "switched", branchName };
  }

  // switchOnly contract: branch must exist. Missing = drift/cleanup incident;
  // silently recreating on top of some other HEAD would compound the bug.
  if (switchOnly) {
    throw new BranchIsolationError(
      "branch_missing",
      `Expected feature branch ${branchName} is missing from ${projectRoot}. Planner did not prepare it, or it was deleted between stages.`,
      projectRoot,
      branchName,
    );
  }

  // Strict base-branch handling. If config says create from base, the base
  // MUST exist locally — otherwise creating from current HEAD is a silent
  // correctness bug in autonomous mode.
  if (current !== config.base_branch) {
    if (!branchExists(projectRoot, config.base_branch)) {
      throw new BranchIsolationError(
        "base_branch_unavailable",
        `Base branch ${config.base_branch} does not exist in ${projectRoot}. Cannot create ${branchName} from a known base.`,
        projectRoot,
        branchName,
      );
    }
    const { status: checkoutStatus, stderr: checkoutErr } = runGit(
      projectRoot,
      ["checkout", config.base_branch],
      { ignoreExit: true },
    );
    if (checkoutStatus !== 0) {
      throw new BranchIsolationError(
        "base_branch_unavailable",
        `Could not checkout base branch ${config.base_branch}: ${checkoutErr || "unknown error"}`,
        projectRoot,
        branchName,
      );
    }
    // pull is best-effort — offline runs are tolerated.
    runGit(projectRoot, ["pull", "--ff-only", "origin", config.base_branch], {
      ignoreExit: true,
    });
  }

  const { status, stderr } = runGit(projectRoot, ["checkout", "-b", branchName], {
    ignoreExit: true,
  });
  if (status !== 0) {
    throw new BranchIsolationError(
      "create_failed",
      `git checkout -b ${branchName} failed: ${stderr || "unknown error"}`,
      projectRoot,
      branchName,
    );
  }

  log.info({ projectRoot, branchName, previous: current, taskId }, "Created feature branch");
  return { action: "created", branchName };
}
