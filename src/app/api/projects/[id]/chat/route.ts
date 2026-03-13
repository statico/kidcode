import { NextResponse } from "next/server";
import {
  getProject,
  getProjectDir,
  appendChatMessage,
  getChatHistory,
  touchProject,
  updateProjectName,
} from "@/lib/projects";
import { streamClaude, StreamEvent } from "@/lib/claude-stream";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  const rawEvents = streamClaude(id, projectDir, userMessage, isFirstMessage);

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // Process events in the background
  (async () => {
    try {
      for await (const event of rawEvents) {
        // Handle title updates
        if (event.type === "title") {
          updateProjectName(id, event.content);
        }

        const data = JSON.stringify(event);
        await writer.write(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));

        if (event.type === "done") {
          // Save assistant response
          const cleanText = event.content.replace(/^TITLE:\s*.+\n*/m, "").trim();
          if (cleanText) {
            appendChatMessage(id, {
              role: "assistant",
              content: cleanText,
              timestamp: new Date().toISOString(),
            });
          }
          break;
        }
      }
    } catch (err) {
      const errorData = JSON.stringify({ type: "error", content: String(err) });
      await writer.write(encoder.encode(`event: error\ndata: ${errorData}\n\n`));
    } finally {
      await writer.close();
    }
  })();

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
