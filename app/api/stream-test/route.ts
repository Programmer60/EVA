import { NextResponse } from "next/server";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let i = 0;
      const sendToken = (delta: string) => {
        const event = `event: token\ndata: ${JSON.stringify({ type: "token", delta })}\n\n`;
        controller.enqueue(encoder.encode(event));
      };

      const sendFinal = (payload: any) => {
        const event = `event: final\ndata: ${JSON.stringify({ type: "final", payload })}\n\n`;
        controller.enqueue(encoder.encode(event));
      };

      const iv = setInterval(() => {
        i += 1;
        sendToken(`debug-chunk-${i}`);
        if (i >= 8) {
          clearInterval(iv);
          sendFinal({ reply: `Debug final reply after ${i} tokens`, emotion: "neutral" });
          controller.close();
        }
      }, 150);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
