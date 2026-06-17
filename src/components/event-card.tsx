"use client";

import { motion } from "framer-motion";
import {
  GraduationCap,
  Trophy,
  Cake,
  HandHeart,
  Users,
  AlarmClock,
  MapPin,
  User,
  type LucideIcon,
} from "lucide-react";
import type { Category, ScheduleEvent } from "@/lib/schedule";

/**
 * Static (Tailwind-scannable) per-category styling. Colors come from the Meadow
 * `--cat-*` tokens exposed as `cat-*` utilities in globals.css.
 */
const CATEGORY: Record<
  Category,
  { label: string; Icon: LucideIcon; border: string; chip: string }
> = {
  school: {
    label: "School",
    Icon: GraduationCap,
    border: "border-l-cat-school",
    chip: "bg-cat-school/10 text-cat-school",
  },
  sport: {
    label: "Sport",
    Icon: Trophy,
    border: "border-l-cat-sport",
    chip: "bg-cat-sport/10 text-cat-sport",
  },
  birthday: {
    label: "Birthday",
    Icon: Cake,
    border: "border-l-cat-birthday",
    chip: "bg-cat-birthday/10 text-cat-birthday",
  },
  fundraiser: {
    label: "Fundraiser",
    Icon: HandHeart,
    border: "border-l-cat-fundraiser",
    chip: "bg-cat-fundraiser/10 text-cat-fundraiser",
  },
  meeting: {
    label: "Meeting",
    Icon: Users,
    border: "border-l-cat-meeting",
    chip: "bg-cat-meeting/10 text-cat-meeting",
  },
  deadline: {
    label: "Deadline",
    Icon: AlarmClock,
    border: "border-l-cat-deadline",
    chip: "bg-cat-deadline/10 text-cat-deadline",
  },
};

function formatTime(time: string, endTime?: string) {
  return endTime ? `${time}–${endTime}` : time;
}

const cardVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1 },
};

export function EventCard({ event }: { event: ScheduleEvent }) {
  const meta = CATEGORY[event.category];
  const { Icon } = meta;

  return (
    <motion.article
      layout
      variants={cardVariants}
      className={`rounded-lg border border-hairline border-l-[6px] ${meta.border} bg-surface p-4 shadow-xs`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-date-label text-ink-mute">{event.dayLabel}</div>
          <h3 className="text-heading mt-1 text-ink">{event.title}</h3>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-eyebrow ${meta.chip}`}
        >
          <Icon className="size-3" />
          {meta.label}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-time text-ink">{formatTime(event.time, event.endTime)}</span>
        {event.who && (
          <span className="text-meta inline-flex items-center gap-1">
            <User className="size-3" />
            {event.who}
          </span>
        )}
        {event.location && (
          <span className="text-meta inline-flex items-center gap-1">
            <MapPin className="size-3" />
            {event.location}
          </span>
        )}
      </div>

      {event.note && <p className="text-body-soft mt-2">{event.note}</p>}
    </motion.article>
  );
}

export { CATEGORY };
