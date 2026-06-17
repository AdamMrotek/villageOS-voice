import { NextResponse } from "next/server";
import { resolveDay } from "@/lib/schedule";

/**
 * The entire backend, by design (Level 1): returns the hardcoded 3-day snapshot,
 * optionally filtered by `?day=` ("today" | "tomorrow" | weekday | ISO date | "all").
 * Called by the `get_schedule` client tool from the browser.
 */
export function GET(request: Request) {
  const day = new URL(request.url).searchParams.get("day");
  const events = resolveDay(day);
  return NextResponse.json({ day: day ?? "all", count: events.length, events });
}
