import { StreamEvent } from "./claude-stream";

export function createSSEStream(
  events: AsyncGenerator<StreamEvent>,
  onDone?: (fullText: string) => void
): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of events) {
          const data = JSON.stringify(event);
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`)
          );

          if (event.type === "done") {
            onDone?.(event.content);
            break;
          }
          if (event.type === "error") {
            // Still continue — errors might be non-fatal
          }
        }
      } catch (err) {
        const errorData = JSON.stringify({
          type: "error",
          content: String(err),
        });
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${errorData}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });
}
