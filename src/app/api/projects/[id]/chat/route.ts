import { NextRequest, NextResponse } from "next/server";
import {
  getProject,
  getProjectDir,
  appendChatMessage,
  getChatHistory,
  touchProject,
  updateProjectName,
  snapshotProject,
} from "@/lib/projects";
import { startClaude, isSessionActive, subscribe, StreamEvent } from "@/lib/claude-stream";

export const dynamic = "force-dynamic";

function log(prefix: string, ...args: unknown[]) {
  console.log(`[chat-api:${prefix}]`, ...args);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const reconnect = request.nextUrl.searchParams.get("reconnect");
  log("GET", `id=${id} reconnect=${reconnect}`);

  // Check for active session and stream events
  if (reconnect === "1") {
    if (!isSessionActive(id)) {
      return NextResponse.json({ active: false });
    }

    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    const unsubscribe = subscribe(id, async (event: StreamEvent) => {
      try {
        const data = JSON.stringify(event);
        await writer.write(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
        if (event.type === "done") {
          await writer.close();
        }
      } catch {
        // Connection closed
      }
    }, true); // replay buffered events

    if (!unsubscribe) {
      return NextResponse.json({ active: false });
    }

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Content-Encoding": "none",
      },
    });
  }

  // Default: return chat history
  const messages = getChatHistory(id);
  return NextResponse.json(messages);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const userMessage = body.message as string;
  log("POST", `id=${id} message="${userMessage?.slice(0, 80)}"`);

  if (!userMessage?.trim()) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  // Save user message
  appendChatMessage(id, {
    role: "user",
    content: userMessage,
    timestamp: new Date().toISOString(),
  });

  touchProject(id);

  const projectDir = getProjectDir(id);
  const history = getChatHistory(id);
  const isFirstMessage = history.filter((m) => m.role === "user").length === 1;

  // Snapshot current files before Claude makes changes
  if (!isFirstMessage) {
    snapshotProject(id);
  }

  // Build prompt with conversation history so Claude has context
  let prompt = userMessage;
  // History includes the user message we just appended, so grab everything before it
  const priorMessages = history.slice(0, -1);
  if (priorMessages.length > 0) {
    const historyText = priorMessages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    prompt = `Here is our conversation so far:\n\n${historyText}\n\nUser: ${userMessage}`;
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // Track text for incremental saving
  let assistantText = "";
  let savedAssistant = false;

  // Start claude process with event callback
  startClaude(id, projectDir, prompt, isFirstMessage, (event: StreamEvent) => {
    // Handle title updates
    if (event.type === "title") {
      updateProjectName(id, event.content);
    }

    // Track assistant text for saving
    if (event.type === "text") {
      assistantText += event.content;
    }

    // Save assistant message on done
    if (event.type === "done" && !savedAssistant) {
      savedAssistant = true;
      const cleanText = assistantText.replace(/^TITLE:\s*.+\n*/m, "").trim();
      if (cleanText) {
        appendChatMessage(id, {
          role: "assistant",
          content: cleanText,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Write SSE to the current connection
    const data = JSON.stringify(event);
    writer.write(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`)).catch(() => {});

    if (event.type === "done") {
      writer.close().catch(() => {});
    }
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "none",
    },
  });
}
