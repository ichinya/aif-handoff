/**
 * Event-driven wake channel — subscribes to API WebSocket for coordinator wake signals.
 * Extracted from notifier.ts for single responsibility.
 */

import { logger, getEnv } from "@aif/shared";

const log = logger("wake-channel");

/** Events that should trigger a coordinator wake. */
const WAKE_EVENTS = new Set(["task:created", "task:moved", "agent:wake"]);

type WakeCallback = (reason: string) => void;

let _ws: WebSocket | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _wakeCallback: WakeCallback | null = null;
let _lastWakeTime = 0;

const DEBOUNCE_MS = 2000;
const RECONNECT_DELAY_MS = 5000;

function getWsUrl(): string {
  const env = getEnv();
  const httpBase = env.API_BASE_URL;
  return httpBase.replace(/^http/, "ws") + "/ws";
}

function handleMessage(data: string): void {
  try {
    const parsed = JSON.parse(data);
    const eventType = parsed?.type as string | undefined;

    if (!eventType || !WAKE_EVENTS.has(eventType)) return;

    const now = Date.now();
    if (now - _lastWakeTime < DEBOUNCE_MS) {
      log.debug({ eventType, debounceMs: DEBOUNCE_MS }, "Wake debounced");
      return;
    }

    _lastWakeTime = now;
    log.info({ reason: eventType }, "Wake signal received");
    _wakeCallback?.(eventType);
  } catch {
    log.debug("Failed to parse WS message for wake channel");
  }
}

function scheduleReconnect(): void {
  if (_reconnectTimer) return;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    connectWakeChannel(_wakeCallback!);
  }, RECONNECT_DELAY_MS);
  if (typeof _reconnectTimer === "object" && "unref" in _reconnectTimer) {
    _reconnectTimer.unref();
  }
}

/**
 * Connect to the API WebSocket to receive wake signals.
 * Returns true if the connection was initiated (not necessarily open yet).
 */
export function connectWakeChannel(onWake: WakeCallback): boolean {
  _wakeCallback = onWake;
  const wsUrl = getWsUrl();

  try {
    _ws = new WebSocket(wsUrl);

    _ws.addEventListener("open", () => {
      log.info({ wsUrl }, "Wake channel connected");
    });

    _ws.addEventListener("message", (event) => {
      handleMessage(typeof event.data === "string" ? event.data : String(event.data));
    });

    _ws.addEventListener("close", () => {
      log.warn("Wake channel disconnected — scheduling reconnect");
      _ws = null;
      scheduleReconnect();
    });

    _ws.addEventListener("error", (err) => {
      log.error({ err }, "Wake channel error");
    });

    return true;
  } catch (err) {
    log.error({ err, wsUrl }, "Failed to initiate wake channel connection");
    scheduleReconnect();
    return false;
  }
}

/** Close the wake channel cleanly. */
export function closeWakeChannel(): void {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_ws) {
    _ws.close();
    _ws = null;
  }
  _wakeCallback = null;
  log.debug("Wake channel closed");
}

/** Returns true if the wake WS is currently connected (OPEN). */
export function isWakeChannelConnected(): boolean {
  return _ws?.readyState === WebSocket.OPEN;
}
