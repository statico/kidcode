import { spawn, ChildProcess } from "child_process";
import path from "path";
import { SYSTEM_PROMPT } from "./constants";

function log(prefix: string, ...args: unknown[]) {
  console.log(`[claude-stream:${prefix}]`, ...args);
}

export interface StreamEvent {
  type: "text" | "activity" | "file-change" | "title" | "done" | "error";
  content: string;
  detail?: string;
}

type Subscriber = (event: StreamEvent) => void;

interface ActiveSession {
  process: ChildProcess;
  eventBuffer: StreamEvent[];
  subscribers: Set<Subscriber>;
  fullText: string;
  finished: boolean;
}

const activeSessions = new Map<string, ActiveSession>();

export function isSessionActive(projectId: string): boolean {
  const session = activeSessions.get(projectId);
  return !!session && !session.finished;
}

export function killProcess(projectId: string): void {
  const session = activeSessions.get(projectId);
  if (session) {
    session.process.kill("SIGTERM");
    activeSessions.delete(projectId);
  }
}

export function subscribe(
  projectId: string,
  callback: Subscriber,
  replay: boolean = true
): (() => void) | null {
  const session = activeSessions.get(projectId);
  if (!session) return null;

  // Replay buffered events
  if (replay) {
    for (const event of session.eventBuffer) {
      callback(event);
    }
  }

  // If already finished, no need to subscribe for future events
  if (session.finished) return () => {};

  session.subscribers.add(callback);
  return () => {
    session.subscribers.delete(callback);
  };
}

export function startClaude(
  projectId: string,
  projectDir: string,
  prompt: string,
  isFirstMessage: boolean,
  onEvent?: Subscriber
): void {
  const fs = require("fs") as typeof import("fs");
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
    "--disable-slash-commands",
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

  const session: ActiveSession = {
    process: claudeProcess,
    eventBuffer: [],
    subscribers: new Set(),
    fullText: "",
    finished: false,
  };

  if (onEvent) {
    session.subscribers.add(onEvent);
  }

  activeSessions.set(projectId, session);

  let buffer = "";
  let seenTitle = false;

  function emit(event: StreamEvent) {
    log("emit", `[${projectId}] ${event.type}: ${event.content?.slice(0, 100)}`);
    session.eventBuffer.push(event);
    for (const sub of session.subscribers) {
      sub(event);
    }
  }

  function processJsonLine(line: string) {
    if (!line.trim()) return;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(line);
    } catch {
      log("parse", `[${projectId}] failed to parse: ${line.slice(0, 200)}`);
      return;
    }

    const type = data.type as string;
    log("json", `[${projectId}] type=${type}`);

    if (type === "assistant") {
      const message = data.message as Record<string, unknown> | undefined;
      if (message?.content) {
        const contentBlocks = message.content as Array<Record<string, unknown>>;
        for (const block of contentBlocks) {
          if (block.type === "text") {
            let text = block.text as string;

            if (!seenTitle) {
              const titleMatch = text.match(/^TITLE:\s*(.+)$/m);
              if (titleMatch) {
                seenTitle = true;
                emit({ type: "title", content: titleMatch[1].trim() });
                text = text.replace(/^TITLE:\s*.+\n*/m, "");
              }
            }

            if (text) {
              session.fullText += text;
              emit({ type: "text", content: text });
            }
          } else if (block.type === "tool_use") {
            const toolName = block.name as string;
            const toolInput = block.input as Record<string, unknown> | undefined;

            emit({ type: "activity", content: `Using ${toolName}...` });

            if (toolName === "Write" || toolName === "Edit") {
              const filePath = (toolInput?.file_path || "") as string;
              if (filePath) {
                const fileName = path.basename(filePath);
                emit({ type: "file-change", content: fileName, detail: filePath });
              }
            }
          }
        }
      }
      return;
    }

    if (type === "result") {
      const resultText = data.result as string | undefined;
      if (resultText && !session.fullText) {
        let text = resultText;
        if (!seenTitle) {
          const titleMatch = text.match(/^TITLE:\s*(.+)$/m);
          if (titleMatch) {
            seenTitle = true;
            emit({ type: "title", content: titleMatch[1].trim() });
            text = text.replace(/^TITLE:\s*.+\n*/m, "");
          }
        }
        if (text) {
          session.fullText = text;
          emit({ type: "text", content: text });
        }
      }
      return;
    }
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
    log("stderr", `[${projectId}] ${text.slice(0, 500)}`);
    if (text.includes("Error") || text.includes("error")) {
      emit({ type: "error", content: text.trim() });
    }
  });

  log("start", `[${projectId}] Claude process started, pid=${claudeProcess.pid}`);

  claudeProcess.on("close", (code) => {
    log("close", `[${projectId}] Claude process exited code=${code}`);
    if (buffer.trim()) {
      processJsonLine(buffer);
    }

    if (code !== 0 && code !== null) {
      emit({ type: "error", content: `Claude process exited with code ${code}` });
    }
    emit({ type: "done", content: session.fullText });
    session.finished = true;
    session.subscribers.clear();
  });
}
