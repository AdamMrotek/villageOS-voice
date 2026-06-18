"use client";

import { motion } from "framer-motion";
import { CATEGORY } from "./event-card";
import { cn } from "@/lib/utils";
import type { ScheduleEvent } from "@/lib/schedule";

/**
 * The "simple form" of an event, shown inline in the chat stream (as opposed to
 * the full EventCard). One compact row — category badge, title, a short
 * speakable "when" — with the outstanding to-dos surfaced as tappable chips.
 */

/** Collapse the verbose `dayLabel` + time into a short, chat-friendly phrase. */
function whenLabel(event: ScheduleEvent): string {
  const rel = event.dayLabel.split(" · ")[0].toLowerCase(); // "today" | "tomorrow" | …
  if (event.isAllDay) {
    return event.category === "deadline" ? `due ${rel}` : `${rel}, all day`;
  }
  return `${rel}, ${event.time}${event.endTime ? `–${event.endTime}` : ""}`;
}

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

export function ChatEvent({
  event,
  onAction,
}: {
  event: ScheduleEvent;
  /** Tapping a to-do chip sends it back to the agent as a follow-up. */
  onAction?: (prompt: string) => void;
}) {
  const meta = CATEGORY[event.category];
  const { Icon } = meta;
  const todos = event.actions.filter((a) => !a.done);

  return (
    <motion.div variants={rowVariants} className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5 rounded-lg border border-hairline bg-surface px-3 py-2.5 shadow-xs">
        <span
          className={cn("grid size-7 shrink-0 place-items-center rounded-md", meta.chip)}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body truncate text-ink">{event.title}</p>
          <p className="text-meta">{whenLabel(event)}</p>
        </div>
      </div>

      {todos.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-1">
          {todos.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onAction?.(`About "${event.title}": ${a.description}`)}
              disabled={!onAction}
              title={a.description}
              className={cn(
                "text-meta inline-flex items-center rounded-full border px-3 py-1 text-left transition-colors",
                a.urgent
                  ? "border-warm/40 bg-warm-surface/60 text-warm hover:bg-warm-surface"
                  : "border-hairline bg-surface text-ink-soft hover:bg-surface-alt",
                !onAction && "cursor-default opacity-80"
              )}
            >
              <span>{a.description}</span>
              {a.costEstimateGbp != null && (
                <span className="ml-1.5 shrink-0 font-medium">· £{a.costEstimateGbp}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
