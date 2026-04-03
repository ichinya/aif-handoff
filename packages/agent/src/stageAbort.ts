/**
 * Shared AbortController for the active coordinator stage.
 * Extracted to avoid circular dependency between coordinator and subagentQuery.
 */

let _activeAbort: AbortController | null = null;

export function setActiveStageAbortController(abort: AbortController | null): void {
  _activeAbort = abort;
}

export function getActiveStageAbortController(): AbortController | null {
  return _activeAbort;
}
