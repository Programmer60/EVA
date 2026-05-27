export type ChatStreamFinalPayload = {
  reply: string;
  emotion: string;
  predictedUserEmotion?: string;
  emotionConfidence?: number;
  toneStrategy?: string;
  contextMessages?: number;
  memoryUsed?: number;
  historyCount?: number;
  providerUsed?: "openrouter" | null;
  contextDebug?: unknown;
  behavior?: {
    speechRate: number;
    pitch: number;
    avatarMood: string;
  };
  interactionId?: string;
};

export type ChatStreamEvent =
  | { type: "token"; delta: string }
  | { type: "final"; payload: ChatStreamFinalPayload }
  | { type: "error"; error: string };

export function formatChatStreamEvent(event: ChatStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

type StreamHandlers = {
  onToken?: (delta: string) => void;
  onFinal?: (payload: ChatStreamFinalPayload) => void;
  onError?: (error: string) => void;
};

export async function consumeChatStream(response: Response, handlers: StreamHandlers = {}): Promise<ChatStreamFinalPayload> {
  if (!response.body) {
    throw new Error("Streaming response is unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: ChatStreamFinalPayload | null = null;

  const parseEventBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    let eventType = "message";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) return;

    const dataText = dataLines.join("\n");
    let parsed: ChatStreamEvent | null = null;
    try {
      parsed = JSON.parse(dataText) as ChatStreamEvent;
    } catch {
      return;
    }

    if (eventType === "token" && parsed.type === "token") {
      handlers.onToken?.(parsed.delta);
      return;
    }

    if (eventType === "final" && parsed.type === "final") {
      finalPayload = parsed.payload;
      handlers.onFinal?.(parsed.payload);
      return;
    }

    if (eventType === "error" && parsed.type === "error") {
      handlers.onError?.(parsed.error);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const block = buffer.slice(0, separatorIndex).trim();
      buffer = buffer.slice(separatorIndex + 2);
      if (block) {
        parseEventBlock(block);
      }
      separatorIndex = buffer.indexOf("\n\n");
    }
  }

  buffer += decoder.decode();
  const trailing = buffer.trim();
  if (trailing) {
    parseEventBlock(trailing);
  }

  if (!finalPayload) {
    throw new Error("Stream ended before final payload was received.");
  }

  return finalPayload;
}
