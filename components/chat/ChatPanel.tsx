"use client";

import { FormEvent, useMemo, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatApiResponse = {
  reply: string;
};

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    role: "assistant",
    content: "Hi, I am EVA. Tell me how you are feeling today.",
  },
];

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !isLoading, [input, isLoading]);

  async function fetchAssistantReply(
    message: string,
    nextMessages: ChatMessage[],
  ): Promise<void> {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          history: nextMessages.map((item) => ({
            role: item.role,
            content: item.content,
          })),
        }),
      });

      const data = (await response.json()) as ChatApiResponse | { error?: string };

      if (!response.ok || !("reply" in data)) {
        const errorMessage = "error" in data ? data.error : undefined;
        throw new Error(errorMessage || "Request failed.");
      }

      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setFailedMessage(null);
    } catch (requestError) {
      const messageText =
        requestError instanceof Error
          ? requestError.message
          : "Could not reach EVA right now.";
      setError(messageText);
      setFailedMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const message = input.trim();
    if (!message || isLoading) {
      return;
    }

    const nextMessages = [...messages, { role: "user" as const, content: message }];
    setMessages(nextMessages);
    setInput("");

    await fetchAssistantReply(message, nextMessages);
  }

  async function retryLastMessage(): Promise<void> {
    if (!failedMessage || isLoading) {
      return;
    }

    await fetchAssistantReply(failedMessage, messages);
  }

  return (
    <section className="eva-card">
      <div className="eva-section-header">
        <h2>Conversation</h2>
        <span className="eva-pill">Phase 1</span>
      </div>
      <div className="eva-chat-box">
        {messages.map((item, index) => (
          <p
            key={`${item.role}-${index}`}
            className={`eva-message ${item.role === "user" ? "eva-user" : "eva-assistant"}`}
          >
            {item.role === "user" ? "You" : "EVA"}: {item.content}
          </p>
        ))}

        {isLoading && <p className="eva-note">EVA is thinking...</p>}
      </div>

      <form className="eva-chat-form" onSubmit={onSubmit}>
        <label className="eva-chat-label" htmlFor="eva-message-input">
          Message
        </label>
        <div className="eva-chat-actions">
          <input
            id="eva-message-input"
            className="eva-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="How are you feeling today?"
            maxLength={1500}
            autoComplete="off"
          />
          <button className="eva-btn" type="submit" disabled={!canSend}>
            Send
          </button>
        </div>
      </form>

      {error && (
        <div className="eva-row">
          <p className="eva-error">{error}</p>
          <button
            className="eva-btn eva-btn-secondary"
            type="button"
            disabled={!failedMessage || isLoading}
            onClick={retryLastMessage}
          >
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
