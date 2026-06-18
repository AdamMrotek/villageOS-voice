/**
 * The "RAG hack": a small, structured snapshot of the next few days of family
 * events. In the real VillageOS this comes from messy parent messages parsed
 * into structured events; here it is a hardcoded, deterministic snapshot so the
 * voice demo always works.
 *
 * The SOURCE data below mirrors the real VillageOS API payload exactly
 * (snake_case `event_type` / `start_time` / `action_items[]` with
 * `urgent`/`done`/`cost_estimate_gbp`) — see AUTH_TOOL_INTEGRATION_PLAN.md §4.
 * `toScheduleEvent` is the anti-corruption mapper to the voice app's own stable
 * `ScheduleEvent` contract, so when this swaps to a live Supabase query only the
 * mapper has to know VillageOS's schema.
 *
 * Events are seeded with a relative `dayOffset` (0 = today, 1 = tomorrow,
 * 2 = the day after) and resolved to real `start_time`s at request time, so
 * "what do I need to do today?" always has something to say.
 */

/** VillageOS `public.event_type` enum (the values this demo uses). */
export type EventType =
  | "school"
  | "sport"
  | "birthday"
  | "fundraiser"
  | "meeting"
  | "deadline";

/** Kept as an alias so the card styling map keys stay `Category`-keyed. */
export type Category = EventType;

/** A VillageOS `action_items` row — the thing a parent actually has to DO. */
export type ActionItem = {
  id: string;
  description: string;
  cost_estimate_gbp: number | null;
  urgent: boolean;
  done: boolean;
};

/** A VillageOS `events` row, as the API returns it (with nested action_items). */
export type VillageEvent = {
  id: string;
  title: string;
  event_type: EventType;
  /** ISO 8601, UTC. */
  start_time: string;
  end_time: string | null;
  is_all_day: boolean;
  location: string | null;
  description: string | null;
  action_items: ActionItem[];
  confidence: number;
};

/** Date-independent seed: a VillageEvent minus the resolved timestamps. */
type SeedEvent = Omit<VillageEvent, "start_time" | "end_time"> & {
  dayOffset: 0 | 1 | 2;
  /** 24h "HH:MM" start; ignored when `is_all_day`. */
  start: string;
  /** Optional 24h "HH:MM" end. */
  end?: string;
};

/** The voice app's own action shape (camelCase contract, schema can drift behind it). */
export type Action = {
  id: string;
  description: string;
  costEstimateGbp?: number;
  urgent: boolean;
  done: boolean;
};

/** Resolved event returned to the agent and rendered as a card. */
export type ScheduleEvent = {
  id: string;
  title: string;
  category: Category;
  /** "HH:MM" start, or "All day". */
  time: string;
  /** "HH:MM" end, when present. */
  endTime?: string;
  isAllDay: boolean;
  location?: string;
  /** Short contextual note (VillageOS `description`). */
  note?: string;
  /** Things the parent has to do for this event. */
  actions: Action[];
  /** ISO date, e.g. "2026-06-18". */
  date: string;
  /** Human label, e.g. "Tomorrow · Thu 18 Jun". */
  dayLabel: string;
};

/** An action lifted out of its event, carrying just enough context to speak/render it. */
export type ActionWithContext = Action & {
  eventId: string;
  eventTitle: string;
  category: Category;
  date: string;
  dayLabel: string;
  /** The parent event's time, for ordering/announcing. */
  time: string;
};

const SEED: SeedEvent[] = [
  {
    id: "145b1714-b9e9-473f-bad9-3d886f1c2160",
    dayOffset: 0,
    title: "School photo order deadline",
    event_type: "deadline",
    is_all_day: true,
    start: "",
    location: null,
    description: "Last day to order school photos online before prices rise.",
    action_items: [
      {
        id: "82de5943-aac4-4510-9229-fe6bf087c996",
        description: "Order photos using the code on the proof sheet",
        cost_estimate_gbp: null,
        urgent: true,
        done: false,
      },
    ],
    confidence: 1,
  },
  {
    id: "ff8c336e-a1b4-46d2-933a-d73310ebe965",
    dayOffset: 1,
    title: "Year 4 trip to the Science Museum",
    event_type: "school",
    is_all_day: false,
    start: "08:45",
    end: "15:30",
    location: "Science Museum, Exhibition Road",
    description:
      "Coach leaves school at 8:45am sharp. Packed lunch needed, no nuts. Wear school uniform.",
    action_items: [
      {
        id: "f99b39aa-1235-44f9-a0da-43b9fbda8e33",
        description: "Return signed permission slip",
        cost_estimate_gbp: null,
        urgent: true,
        done: false,
      },
      {
        id: "900e8068-ab79-49ce-a255-d8a5880efa11",
        description: "Pay £12 trip contribution",
        cost_estimate_gbp: 12,
        urgent: false,
        done: false,
      },
    ],
    confidence: 1,
  },
  {
    id: "612b57b8-e4a6-43ac-b2e1-23f11860dd26",
    dayOffset: 2,
    title: "Mia's 7th birthday party",
    event_type: "birthday",
    is_all_day: false,
    start: "14:00",
    end: "16:00",
    location: "Jungle Play, Riverside Retail Park",
    description: "Drop-off party. RSVP to Mia's mum by text.",
    action_items: [
      {
        id: "beb935fc-0595-460b-beda-d3872998d4fe",
        description: "Buy birthday present",
        cost_estimate_gbp: 15,
        urgent: false,
        done: false,
      },
      {
        id: "531e85b4-d5e2-454e-9686-ba784f724368",
        description: "Reply to RSVP",
        cost_estimate_gbp: null,
        urgent: false,
        done: false,
      },
    ],
    confidence: 1,
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

/** "HH:MM" out of an ISO timestamp's UTC clock (matches how the demo seeds it). */
function clockOf(iso: string): string {
  return iso.slice(11, 16);
}

/** Resolve the seed into VillageOS-shaped events against the real current date. */
function resolveVillage(): (VillageEvent & { dayOffset: number; date: string })[] {
  const base = startOfToday();
  return SEED.map((e) => {
    const d = new Date(base);
    d.setDate(base.getDate() + e.dayOffset);
    const date = isoDate(d);
    const start_time = `${date}T${e.is_all_day ? "00:00" : e.start}:00Z`;
    const end_time = e.end ? `${date}T${e.end}:00Z` : null;
    const { dayOffset, start, end, ...rest } = e;
    void start;
    void end;
    return { ...rest, start_time, end_time, dayOffset, date };
  });
}

/** The anti-corruption mapper: VillageOS row → the voice app's ScheduleEvent. */
function toScheduleEvent(
  e: VillageEvent & { dayOffset: number; date: string }
): ScheduleEvent {
  return {
    id: e.id,
    title: e.title,
    category: e.event_type,
    time: e.is_all_day ? "All day" : clockOf(e.start_time),
    endTime: e.end_time ? clockOf(e.end_time) : undefined,
    isAllDay: e.is_all_day,
    location: e.location ?? undefined,
    note: e.description ?? undefined,
    actions: e.action_items.map((a) => ({
      id: a.id,
      description: a.description,
      costEstimateGbp: a.cost_estimate_gbp ?? undefined,
      urgent: a.urgent,
      done: a.done,
    })),
    date: e.date,
    dayLabel: dayLabel(e.dayOffset, new Date(`${e.date}T00:00:00`)),
  };
}

/** Sort key within a day: all-day/deadlines first, then by clock. */
function sortKey(e: ScheduleEvent): string {
  return e.isAllDay ? "00:00" : e.time;
}

/** Resolve the full snapshot against the real current date, chronologically. */
export function getSnapshot(): ScheduleEvent[] {
  return resolveVillage()
    .map(toScheduleEvent)
    .sort((a, b) =>
      a.date === b.date
        ? sortKey(a).localeCompare(sortKey(b))
        : a.date.localeCompare(b.date)
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
  const dateOf = (offset: number) => {
    const d = new Date(base);
    d.setDate(base.getDate() + offset);
    return isoDate(d);
  };

  if (q === "today" || q === "tonight") return all.filter((e) => e.date === dateOf(0));
  if (q === "tomorrow") return all.filter((e) => e.date === dateOf(1));
  if (q.includes("day after")) return all.filter((e) => e.date === dateOf(2));

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return all.filter((e) => e.date === q);

  // Weekday name → map to the matching day within the window if present
  const wd = WEEKDAYS.findIndex((w) => q.includes(w));
  if (wd >= 0) {
    for (let off = 0; off <= 2; off++) {
      const d = new Date(base);
      d.setDate(base.getDate() + off);
      if (d.getDay() === wd) return all.filter((e) => e.date === dateOf(off));
    }
    return [];
  }

  return all;
}

/**
 * Token-lean projection for the **agent's tool result** (not the UI).
 *
 * The `get_schedule` tool result is pinned into the conversation and re-sent to
 * the LLM on every subsequent turn, so anything the model won't speak is pure,
 * recurring token waste. This drops UUIDs (`id`s), the `category` enum, the
 * `isAllDay` flag, the redundant ISO `date` (`dayLabel` already reads it back),
 * and already-`done` actions — collapsing time fields into one speakable `when`.
 * Omitted keys are left `undefined` so `JSON.stringify` strips them entirely.
 *
 * The UI still gets the full `ScheduleEvent[]`; only the model gets this.
 */
export function toAgentSchedule(events: ScheduleEvent[]): string {
  return JSON.stringify(
    events.map((e) => ({
      title: e.title,
      when: e.isAllDay
        ? `${e.dayLabel}, all day`
        : `${e.dayLabel}, ${e.time}${e.endTime ? `–${e.endTime}` : ""}`,
      where: e.location,
      note: e.note,
      todo: e.actions
        .filter((a) => !a.done)
        .map((a) => ({
          task: a.description,
          urgent: a.urgent || undefined,
          costGbp: a.costEstimateGbp,
        })),
    }))
  );
}

/**
 * The "what do I need to do?" query: every outstanding action for the requested
 * day(s), flattened out of its event and sorted **urgent first**, then by time.
 * Done items are dropped — they're not things left to do.
 */
export function getActions(day?: string | null): ActionWithContext[] {
  return resolveDay(day)
    .flatMap((e) =>
      e.actions.map((a) => ({
        ...a,
        eventId: e.id,
        eventTitle: e.title,
        category: e.category,
        date: e.date,
        dayLabel: e.dayLabel,
        time: e.time,
      }))
    )
    .filter((a) => !a.done)
    .sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1; // urgent first
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.time.localeCompare(b.time);
    });
}
