import { spawn, ChildProcess } from "child_process";
import path from "path";
import { SYSTEM_PROMPT } from "./constants";

export interface StreamEvent {
  type: "text" | "activity" | "file-change" | "title" | "done" | "error";
  content: string;
  detail?: string;
}

const activeProcesses = new Map<string, ChildProcess>();

export function killProcess(projectId: string): void {
  const proc = activeProcesses.get(projectId);
  if (proc) {
    proc.kill("SIGTERM");
    activeProcesses.delete(projectId);
  }
}

export async function* streamClaude(
  projectId: string,
  projectDir: string,
  prompt: string,
  isFirstMessage: boolean
): AsyncGenerator<StreamEvent> {
  const fs = await import("fs");
  fs.mkdirSync(projectDir, { recursive: true });

  const systemPrompt = isFirstMessage
    ? SYSTEM_PROMPT
    : SYSTEM_PROMPT.replace(
        /When the user sends their FIRST message[\s\S]*?Then continue with your normal response.\n\n/,
        ""
      );

  const args = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
    "--verbose",
    "--system-prompt", systemPrompt,
    "--model", "sonnet",
    "--no-session-persistence",
  ];

  // Remove Claude env vars to allow nested invocation
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const claudeProcess = spawn("claude", args, {
    cwd: projectDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  activeProcesses.set(projectId, claudeProcess);

  // Event queue for async generator pattern
  const eventQueue: StreamEvent[] = [];
  let resolveWait: (() => void) | null = null;
  let done = false;
  let buffer = "";
  let fullText = "";
  let seenTitle = false;

  function enqueue(event: StreamEvent) {
    eventQueue.push(event);
    if (resolveWait) {
      resolveWait();
      resolveWait = null;
    }
  }

  function processJsonLine(line: string) {
    if (!line.trim()) return;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(line);
    } catch {
      return;
    }

    const type = data.type as string;

    // Handle assistant messages (contains full content blocks)
    if (type === "assistant") {
      const message = data.message as Record<string, unknown> | undefined;
      if (message?.content) {
        const contentBlocks = message.content as Array<Record<string, unknown>>;
        for (const block of contentBlocks) {
          if (block.type === "text") {
            let text = block.text as string;

            // Check for and extract title
            if (!seenTitle) {
              const titleMatch = text.match(/^TITLE:\s*(.+)$/m);
              if (titleMatch) {
                seenTitle = true;
                enqueue({ type: "title", content: titleMatch[1].trim() });
                text = text.replace(/^TITLE:\s*.+\n*/m, "");
              }
            }

            if (text) {
              fullText += text;
              enqueue({ type: "text", content: text });
            }
          } else if (block.type === "tool_use") {
            const toolName = block.name as string;
            const toolInput = block.input as Record<string, unknown> | undefined;

            enqueue({ type: "activity", content: `Using ${toolName}...` });

            // Detect file changes from Write/Edit tool use
            if (toolName === "Write" || toolName === "Edit") {
              const filePath = (toolInput?.file_path || "") as string;
              if (filePath) {
                const fileName = path.basename(filePath);
                enqueue({ type: "file-change", content: fileName, detail: filePath });
              }
            }
          }
        }
      }
      return;
    }

    // Handle result (final message)
    if (type === "result") {
      const resultText = data.result as string | undefined;
      if (resultText && !fullText) {
        // If we haven't seen any text yet, use the result
        let text = resultText;
        if (!seenTitle) {
          const titleMatch = text.match(/^TITLE:\s*(.+)$/m);
          if (titleMatch) {
            seenTitle = true;
            enqueue({ type: "title", content: titleMatch[1].trim() });
            text = text.replace(/^TITLE:\s*.+\n*/m, "");
          }
        }
        if (text) {
          fullText = text;
          enqueue({ type: "text", content: text });
        }
      }
      return;
    }

    // Skip system, rate_limit_event, etc.
  }

  claudeProcess.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      processJsonLine(line);
    }
  });

  claudeProcess.stderr!.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes("Error") || text.includes("error")) {
      enqueue({ type: "error", content: text.trim() });
    }
  });

  claudeProcess.on("close", (code) => {
    // Process any remaining buffer
    if (buffer.trim()) {
      processJsonLine(buffer);
    }

    done = true;
    if (code !== 0 && code !== null) {
      enqueue({ type: "error", content: `Claude process exited with code ${code}` });
    }
    enqueue({ type: "done", content: fullText });
    activeProcesses.delete(projectId);
  });

  // Yield events as they arrive
  while (!done || eventQueue.length > 0) {
    if (eventQueue.length > 0) {
      const event = eventQueue.shift()!;
      yield event;
      if (event.type === "done") return;
    } else if (!done) {
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
      });
    }
  }
}
