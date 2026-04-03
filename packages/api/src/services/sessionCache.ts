/**
 * TTL cache for SDK session listings to avoid repeated filesystem scans.
 * Each project directory gets its own cache entry.
 */

import { logger } from "@aif/shared";

const log = logger("session-cache");

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 10_000; // 10 seconds

const cache = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    log.debug({ key }, "Session cache expired");
    return undefined;
  }

  log.debug({ key }, "Session cache hit");
  return entry.data as T;
}

export function setCached<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  log.debug({ key, ttlMs }, "Session cache set");
}

export function invalidateCache(key: string): void {
  cache.delete(key);
}

export function invalidateAllSessionCaches(): void {
  cache.clear();
}

/** Cache key for SDK session listings by project directory. */
export function sessionCacheKey(dir: string): string {
  return `sdk-sessions:${dir}`;
}
