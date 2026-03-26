import type { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import type { WsEvent } from "@aif/shared";
import { logger } from "@aif/shared";
import type { WebSocket } from "ws";

const log = logger("ws");

let clients: Set<WebSocket> = new Set();
let injectWebSocketFn: ReturnType<typeof createNodeWebSocket>["injectWebSocket"];

export function setupWebSocket(app: Hono) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  injectWebSocketFn = injectWebSocket;

  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen(_event: Event, ws: any) {
        const raw = ws.raw as WebSocket;
        clients.add(raw);
        log.debug({ clientCount: clients.size }, "WebSocket client connected");
      },
      onClose(_event: Event, ws: any) {
        const raw = ws.raw as WebSocket;
        clients.delete(raw);
        log.debug({ clientCount: clients.size }, "WebSocket client disconnected");
      },
      onError(error: Event) {
        log.error({ error }, "WebSocket error");
      },
    }))
  );

  return { injectWebSocket, upgradeWebSocket };
}

export function getInjectWebSocket() {
  return injectWebSocketFn;
}

export function broadcast(event: WsEvent): void {
  const data = JSON.stringify(event);
  let sent = 0;
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(data);
      sent++;
    }
  }
  log.debug({ event: event.type, clientsSent: sent }, "Broadcast WS event");
}
