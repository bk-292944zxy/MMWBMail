import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext) {
  const { accountId } = await context.params;
  const { searchParams } = new URL(request.url);
  const initialSince = searchParams.get("since");
  const mode = searchParams.get("mode");
  let cursor = initialSince ? new Date(initialSince) : new Date(Date.now() - 60_000);

  const loadEvents = async () => {
    const events = await prisma.mailAccountEvent.findMany({
      where: {
        accountId,
        createdAt: {
          gt: cursor
        }
      },
      orderBy: [{ createdAt: "asc" }],
      take: 100
    });

    if (events.length > 0) {
      cursor = events[events.length - 1]?.createdAt ?? cursor;
    }

    return events.map((event) => ({
      id: event.id,
      type: event.type,
      folderPath: event.folderPath,
      messageUid: event.messageUid,
      payloadJson: event.payloadJson,
      createdAt: event.createdAt.toISOString()
    }));
  };

  if (mode === "poll") {
    const events = await loadEvents();
    return NextResponse.json({
      events,
      cursor: cursor.toISOString()
    });
  }

  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const pushEvents = async () => {
        const events = await loadEvents();

        if (events.length === 0) {
          controller.enqueue(encoder.encode(": ping\n\n"));
          return;
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              events,
              cursor: cursor.toISOString()
            })}\n\n`
          )
        );
      };

      interval = setInterval(() => {
        void pushEvents().catch(() => undefined);
      }, 5000);

      void pushEvents().catch(() => undefined);

      request.signal.addEventListener("abort", () => {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        controller.close();
      });
    },
    cancel() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
