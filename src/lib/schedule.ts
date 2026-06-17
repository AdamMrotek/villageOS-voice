/**
 * The "RAG hack": a small, structured snapshot of the next three days of family
 * events. In the real VillageOS this comes from messy parent messages parsed
 * into structured events; here it is a hardcoded, deterministic snapshot so the
 * voice demo always works.
 *
 * Events are stored with a relative `dayOffset` (0 = today, 1 = tomorrow,
 * 2 = the day after) and resolved to real calendar dates at request time, so
 * "what's on tomorrow?" is always correct no matter when the demo runs.
 */

export type Category =
  | "school"
  | "sport"
  | "birthday"
  | "fundraiser"
  | "meeting"
  | "deadline";

/** Raw snapshot entry (date-independent). */
type SeedEvent = {
  id: string;
  dayOffset: 0 | 1 | 2;
  title: string;
  /** 24h "HH:MM" start. */
  time: string;
  /** Optional 24h "HH:MM" end. */
  endTime?: string;
  category: Category;
  /** Which child / family member it concerns. */
  who?: string;
  location?: string;
  /** Short contextual note the agent can mention. */
  note?: string;
};

/** Resolved event returned to the agent and rendered as a card. */
export type ScheduleEvent = SeedEvent & {
  /** ISO date, e.g. "2026-06-18". */
  date: string;
  /** Human label, e.g. "Tomorrow · Thu 18 Jun". */
  dayLabel: string;
};

const SEED: SeedEvent[] = [
  {
    id: "e1",
    dayOffset: 0,
    title: "Maya — swimming lesson",
    time: "16:30",
    endTime: "17:15",
    category: "sport",
    who: "Maya",
    location: "Fernhill Leisure Centre",
    note: "Bring her goggles and the green towel.",
  },
  {
    id: "e2",
    dayOffset: 0,
    title: "School fundraiser — bake sale donations due",
    time: "08:45",
    category: "fundraiser",
    who: "Both kids",
    location: "St. Aidan's Primary",
    note: "Two dozen cupcakes promised to Mrs. Okafor.",
  },
  {
    id: "e3",
    dayOffset: 1,
    title: "Leo — class trip to the Natural History Museum",
    time: "09:00",
    endTime: "15:00",
    category: "school",
    who: "Leo",
    location: "Coach leaves from school gate",
    note: "Packed lunch, no nuts. Permission slip already signed.",
  },
  {
    id: "e4",
    dayOffset: 1,
    title: "Parents' evening — Leo's teacher",
    time: "18:20",
    endTime: "18:35",
    category: "meeting",
    who: "Leo",
    location: "St. Aidan's, Room 4B",
    note: "Slot is tight — arrive a few minutes early.",
  },
  {
    id: "e5",
    dayOffset: 2,
    title: "Sofia's 7th birthday party",
    time: "14:00",
    endTime: "16:30",
    category: "birthday",
    who: "Maya",
    location: "The Jump Zone, Riverside Retail Park",
    note: "Maya is invited — present idea: the unicorn LEGO set.",
  },
  {
    id: "e6",
    dayOffset: 2,
    title: "Football club fees — final payment deadline",
    time: "23:59",
    category: "deadline",
    who: "Leo",
    note: "£45 to the Saturday league before registration closes.",
  },
];

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDate(d: Date): string {
  // Format from local components, not toISOString (which shifts to UTC and can
  // land on the wrong calendar day in non-UTC timezones).
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function dayLabel(offset: number, date: Date): string {
  const rel = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : "In 2 days";
  const fmt = date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  return `${rel} · ${fmt}`;
}

/** Resolve the full 3-day snapshot against the real current date. */
export function getSnapshot(): ScheduleEvent[] {
  const base = startOfToday();
  return SEED.map((e) => {
    const date = new Date(base);
    date.setDate(base.getDate() + e.dayOffset);
    return { ...e, date: isoDate(date), dayLabel: dayLabel(e.dayOffset, date) };
  }).sort((a, b) =>
    a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)
  );
}

/**
 * Resolve a natural-language `day` argument (as the agent will pass it) to the
 * matching events. Accepts "today", "tomorrow", a weekday name, an ISO date,
 * or "all"/empty (the whole snapshot).
 */
export function resolveDay(day?: string | null): ScheduleEvent[] {
  const all = getSnapshot();
  const q = (day ?? "").trim().toLowerCase();

  if (!q || q === "all" || q === "everything" || q === "week") return all;

  const base = startOfToday();
  const offsetOf = (target: Date) =>
    Math.round((target.getTime() - base.getTime()) / 86_400_000);

  if (q === "today" || q === "tonight") return all.filter((e) => e.dayOffset === 0);
  if (q === "tomorrow") return all.filter((e) => e.dayOffset === 1);
  if (q.includes("day after")) return all.filter((e) => e.dayOffset === 2);

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return all.filter((e) => e.date === q);

  // Weekday name → map to the matching day within the 3-day window if present
  const wd = WEEKDAYS.findIndex((w) => q.includes(w));
  if (wd >= 0) {
    for (let off = 0; off <= 2; off++) {
      const d = new Date(base);
      d.setDate(base.getDate() + off);
      if (d.getDay() === wd) return all.filter((e) => e.dayOffset === off);
    }
    return [];
  }

  void offsetOf;
  return all;
}
