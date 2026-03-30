import { useState, useCallback, useEffect, useRef } from "react";
import type {
  ChatMessage,
  ChatStreamTokenPayload,
  ChatDonePayload,
  ChatErrorPayload,
} from "@aif/shared/browser";
import { api } from "@/lib/api";
import { getWsClientId } from "./useWebSocket";

export function useChat(projectId: string | null, taskId: string | null = null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [explore, setExplore] = useState(false);
  const [chatErrorCode, setChatErrorCode] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const accumulatorRef = useRef("");
  const streamErrorHandledRef = useRef(false);
  const mountedRef = useRef(false);

  // Reset messages when project changes (skip initial mount)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    queueMicrotask(() => {
      setMessages([]);
      setIsStreaming(false);
      conversationIdRef.current = null;
      accumulatorRef.current = "";
      streamErrorHandledRef.current = false;
      setChatErrorCode(null);
    });
  }, [projectId]);

  // Listen for chat stream events dispatched by useWebSocket
  useEffect(() => {
    const handleToken = (e: Event) => {
      const { conversationId, token } = (e as CustomEvent<ChatStreamTokenPayload>).detail;
      if (conversationId !== conversationIdRef.current) return;
      accumulatorRef.current += token;
      const accumulated = accumulatorRef.current;
      console.debug("[useChat] Token accumulated, length:", accumulated.length);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return [...prev.slice(0, -1), { role: "assistant", content: accumulated }];
        }
        return [...prev, { role: "assistant", content: accumulated }];
      });
    };

    const handleDone = (e: Event) => {
      const { conversationId } = (e as CustomEvent<ChatDonePayload>).detail;
      if (conversationId !== conversationIdRef.current) return;
      accumulatorRef.current = "";
      setIsStreaming(false);
      console.debug("[useChat] Stream done for conversation:", conversationId);
    };

    const handleError = (e: Event) => {
      const { conversationId, message, code } = (e as CustomEvent<ChatErrorPayload>).detail;
      if (conversationId !== conversationIdRef.current) return;
      streamErrorHandledRef.current = true;
      accumulatorRef.current = "";
      setIsStreaming(false);
      setChatErrorCode(code ?? null);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: message || "Chat request failed" },
      ]);
      console.debug("[useChat] Stream error for conversation:", conversationId);
    };

    window.addEventListener("chat:token", handleToken);
    window.addEventListener("chat:done", handleDone);
    window.addEventListener("chat:error", handleError);
    return () => {
      window.removeEventListener("chat:token", handleToken);
      window.removeEventListener("chat:done", handleDone);
      window.removeEventListener("chat:error", handleError);
    };
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!projectId || !text.trim() || isStreaming) return;

      const clientId = getWsClientId();
      if (!clientId) {
        console.debug("[useChat] No clientId available, WebSocket not connected");
        return;
      }

      // Generate conversationId on client BEFORE sending so WS tokens
      // arriving during the POST can be matched immediately.
      const newConversationId = conversationIdRef.current ?? crypto.randomUUID();
      conversationIdRef.current = newConversationId;

      const userMessage: ChatMessage = { role: "user", content: text.trim() };
      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      setChatErrorCode(null);
      accumulatorRef.current = "";
      streamErrorHandledRef.current = false;

      console.debug("[useChat] Sending message:", {
        projectId,
        conversationId: newConversationId,
        explore,
      });

      try {
        await api.sendChatMessage({
          projectId,
          message: text.trim(),
          clientId,
          conversationId: newConversationId,
          explore,
          ...(taskId ? { taskId } : {}),
        });
      } catch (err) {
        console.error("[useChat] Failed to send message:", err);
        setIsStreaming(false);
        if (!streamErrorHandledRef.current) {
          const message =
            err instanceof Error ? err.message : "Failed to get a response. Please try again.";
          setChatErrorCode(null);
          setMessages((prev) => [...prev, { role: "assistant", content: message }]);
        }
      }
    },
    [projectId, isStreaming, explore, taskId],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    conversationIdRef.current = null;
    accumulatorRef.current = "";
    streamErrorHandledRef.current = false;
    setChatErrorCode(null);
  }, []);

  return {
    messages,
    isStreaming,
    chatErrorCode,
    explore,
    setExplore,
    sendMessage,
    clearMessages,
  };
}
