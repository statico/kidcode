"use client";

import { useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Undo2 } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { ChatInput } from "./chat-input";
import { ActivityIndicator } from "./activity-indicator";
import { ChatMessage } from "@/hooks/use-chat";

interface ChatPanelProps {
  messages: ChatMessage[];
  isLoading: boolean;
  activity: string;
  hasVersions: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
  onUndo: () => void;
}

export function ChatPanel({
  messages,
  isLoading,
  activity,
  hasVersions,
  onSend,
  onStop,
  onUndo,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom on new messages
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activity]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ScrollArea className="min-h-0 flex-1 p-4" ref={scrollRef}>
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <h2 className="text-2xl font-bold mb-2">Welcome to KidCode!</h2>
              <p className="text-muted-foreground max-w-md">
                Tell me what you want to build! I can make games, websites,
                tools, and more. Just describe what you want and I&apos;ll build it
                for you.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}
          {isLoading && activity && <ActivityIndicator activity={activity} />}
        </div>
      </ScrollArea>
      <div className="border-t p-4">
        <div className="mx-auto max-w-2xl">
          <ChatInput
            onSend={onSend}
            onStop={onStop}
            isLoading={isLoading}
            hasMessages={messages.length > 0}
          />
          {/* TODO: re-enable undo button once we have a good UX for it
          {hasVersions && !isLoading && (
            <div className="mt-2 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={onUndo}
              >
                <Undo2 className="h-3 w-3 mr-1" />
                Undo last change
              </Button>
            </div>
          )}
          */}
        </div>
      </div>
    </div>
  );
}
