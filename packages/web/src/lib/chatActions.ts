import type { ChatAction, ChatActionCreateTask } from "@aif/shared/browser";

const ACTION_REGEX = /<!--ACTION:CREATE_TASK-->\s*(\{[\s\S]*?\})\s*<!--\/ACTION-->/g;

export interface ParsedMessage {
  /** Message text with action blocks removed */
  text: string;
  actions: ChatAction[];
}

export function parseChatActions(content: string): ParsedMessage {
  const actions: ChatAction[] = [];
  const text = content.replace(ACTION_REGEX, (_match, json: string) => {
    try {
      const parsed = JSON.parse(json) as { title?: string; description?: string };
      if (parsed.title) {
        const action: ChatActionCreateTask = {
          type: "create_task",
          title: String(parsed.title).slice(0, 500),
          description: String(parsed.description ?? "").slice(0, 10_000),
        };
        actions.push(action);
      }
    } catch {
      // Malformed JSON — skip
    }
    return "";
  });

  return { text: text.trim(), actions };
}
