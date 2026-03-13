"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ActivityEvent {
  content: string;
  detail?: string;
}

interface UseChatOptions {
  projectId: string;
  onTitle?: (title: string) => void;
  onFileChange?: (fileName: string) => void;
}

function log(prefix: string, ...args: unknown[]) {
  console.log(`[useChat:${prefix}]`, ...args);
}

export function useChat({ projectId, onTitle, onFileChange }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activity, setActivity] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const projectIdRef = useRef(projectId);

  // Reset state when projectId changes to prevent showing stale data
  useEffect(() => {
    if (projectIdRef.current !== projectId) {
      log("reset", `project changed: ${projectIdRef.current} -> ${projectId}`);
      projectIdRef.current = projectId;
      abortRef.current?.abort();
      abortRef.current = null;
      setMessages([]);
      setIsLoading(false);
      setActivity("");
    }
  }, [projectId]);

  const processSSEStream = useCallback(
    async (reader: ReadableStreamDefaultReader<Uint8Array>, forProjectId: string) => {
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let gotTitle = false;

      log("stream", `starting SSE processing for project=${forProjectId}`);

      // Add placeholder assistant message
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", timestamp: new Date().toISOString() },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          log("stream", "reader done");
          break;
        }

        // Guard against stale project
        if (projectIdRef.current !== forProjectId) {
          log("stream", `stale stream for ${forProjectId}, current is ${projectIdRef.current} — dropping`);
          reader.cancel();
          return;
        }

        buffer += decoder.decode(value as BufferSource, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              log("event", event.type, event.type === "text" ? `(${(event.content as string).length} chars)` : event.content || "");

              switch (event.type) {
                case "text": {
                  let text = event.content as string;
                  if (!gotTitle) {
                    const titleMatch = text.match(/^TITLE:\s*.+\n*/m);
                    if (titleMatch) {
                      text = text.replace(/^TITLE:\s*.+\n*/m, "");
                      gotTitle = true;
                    }
                  }
                  assistantText += text;
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      content: assistantText,
                    };
                    return updated;
                  });
                  break;
                }
                case "title":
                  gotTitle = true;
                  onTitle?.(event.content);
                  break;
                case "activity":
                  log("activity", event.content);
                  setActivity(event.content);
                  break;
                case "file-change":
                  log("file-change", event.content, event.detail);
                  onFileChange?.(event.content);
                  setActivity(`Updated ${event.content}`);
                  break;
                case "error":
                  log("error", event.content);
                  assistantText += `\n\nError: ${event.content}`;
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      content: assistantText,
                    };
                    return updated;
                  });
                  break;
                case "done":
                  log("done", `total text length: ${assistantText.length}`);
                  break;
              }
            } catch (e) {
              log("parse-error", line.slice(0, 200), e);
            }
          }
        }
      }
    },
    [onTitle, onFileChange]
  );

  const loadHistory = useCallback(async () => {
    const loadForId = projectId;
    log("loadHistory", `starting for project=${loadForId}`);

    try {
      // First check for active session to reconnect to
      const reconnectRes = await fetch(`/api/projects/${loadForId}/chat?reconnect=1`);

      if (projectIdRef.current !== loadForId) {
        log("loadHistory", `stale after reconnect check — aborting`);
        return;
      }

      if (reconnectRes.headers.get("Content-Type")?.includes("text/event-stream")) {
        log("loadHistory", "active session found, reconnecting...");
        // Active session found — load saved history first, then stream remaining
        const historyRes = await fetch(`/api/projects/${loadForId}/chat`);
        if (historyRes.ok && projectIdRef.current === loadForId) {
          const data = await historyRes.json();
          log("loadHistory", `loaded ${data.length} history messages before reconnect`);
          setMessages(data);
        }

        setIsLoading(true);
        setActivity("Reconnecting...");

        const reader = reconnectRes.body!.getReader();
        await processSSEStream(reader, loadForId);

        if (projectIdRef.current !== loadForId) return;

        setIsLoading(false);
        setActivity("");

        // Reload history to get the final saved state
        const finalRes = await fetch(`/api/projects/${loadForId}/chat`);
        if (finalRes.ok && projectIdRef.current === loadForId) {
          const data = await finalRes.json();
          log("loadHistory", `reloaded ${data.length} messages after reconnect`);
          setMessages(data);
        }
        return;
      }

      // No active session — just load history normally
      const res = await fetch(`/api/projects/${loadForId}/chat`);
      if (res.ok && projectIdRef.current === loadForId) {
        const data = await res.json();
        log("loadHistory", `loaded ${data.length} history messages`);
        setMessages(data);
      } else if (projectIdRef.current !== loadForId) {
        log("loadHistory", `stale after history fetch — dropping`);
      }
    } catch (e) {
      log("loadHistory", "error:", e);
      setIsLoading(false);
      setActivity("");
    }
  }, [projectId, processSSEStream]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      const sendForId = projectId;
      log("send", `message to project=${sendForId}: "${content.slice(0, 50)}..."`);

      const userMsg: ChatMessage = {
        role: "user",
        content,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setActivity("Thinking...");

      try {
        abortRef.current = new AbortController();
        const res = await fetch(`/api/projects/${sendForId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: content }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        log("send", `POST response ok, reading stream...`);
        const reader = res.body!.getReader();
        await processSSEStream(reader, sendForId);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          log("send", "error:", err);
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content: last.content + `\n\nSorry, something went wrong. Please try again!`,
              };
            }
            return updated;
          });
        }
      } finally {
        setIsLoading(false);
        setActivity("");
        abortRef.current = null;
      }
    },
    [projectId, isLoading, processSSEStream]
  );

  const stop = useCallback(() => {
    log("stop", "aborting");
    abortRef.current?.abort();
  }, []);

  return { messages, setMessages, isLoading, activity, sendMessage, stop, loadHistory };
}
