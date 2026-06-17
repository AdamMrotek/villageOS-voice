# Auth & Tool Integration Plan

> **Thesis:** VillageOS is a *platform with an RLS-guarded data boundary*, not a
> single app. Companion tools — starting with this voice app — plug in as
> **authenticated clients of the same Supabase project**, never as forks or
> monorepo members. This document is the plan to take the voice app from canned
> data (Level 1) to real per-user data (Level 3), and the pattern every future
> tool reuses.

---

## 1. The principle

**Supabase + Row-Level Security is the integration boundary. Not the codebase.**

Two (eventually N) independent frontends share *one Supabase project*. RLS
(`auth.uid() = user_id`) is the security contract that lets them all read the
same tables safely. A new tool is just another authenticated client — it shares
a **database with row-level security**, not React code, components, or a build.

```
            ┌───────────────── VillageOS Supabase project ─────────────────┐
            │   Postgres (events, action_items, profiles…) + Auth + RLS     │
            └───────────────────────────────────────────────────────────────┘
                 ▲                    ▲                     ▲
        ┌────────┴────────┐  ┌────────┴────────┐   ┌────────┴────────┐
        │  app.villageos  │  │ voice.villageos │   │  future tool …  │
        │  (main web app) │  │  (this repo)    │   │  (satellite)    │
        └─────────────────┘  └─────────────────┘   └─────────────────┘
              each tool: own repo · own deploy · own UI · shared boundary
```

---

## 2. Current state → target

| | Level 1 (today) | Level 3 (this plan) |
|---|---|---|
| Data | Hardcoded snapshot in `/api/schedule` | Live `events` query, RLS-scoped to the user |
| Auth | None | Supabase session (shared from VillageOS) |
| Backend | The route returns canned JSON | The route is a Supabase client as the user |

**What does *not* change** (the abstraction holds): the agent, the `get_schedule`
client tool, `voice-companion.tsx`, the orb/cards/transcript, the `ScheduleEvent`
type, and the ElevenLabs token flow. Only `/api/schedule` and the addition of
auth differ.

---

## 3. Auth strategy

### Options considered

| Option | UX | VillageOS change | Use when |
|---|---|---|---|
| **A — separate sign-in** | Log in once per app (Chrome autofills after) | none | Can't share a root domain |
| **B — subdomain SSO (recommended)** | **One login, ever** — voice inherits the session | ~2 lines | Both apps under one root domain |
| OAuth (Google / magic link) | One tap, no passwords | none | Want passwordless / no domain sharing |

**Recommendation: Option B**, with OAuth as the passwordless upgrade. B is the
"feels like one product, separate codebases" answer.

### Option B — how it works

Both apps point at the **same Supabase project** (same `NEXT_PUBLIC_SUPABASE_URL`
⇒ same cookie name `sb-<ref>-auth-token` ⇒ same JWT signer). The session cookie
is set with `domain = ".<root>"` so the browser sends it to **every subdomain**.
A user logged into `app.<root>` is automatically authenticated on `voice.<root>`.

The "shared contract" is **two strings**, each held independently via env/config
— *not* an imported module:

1. The Supabase project URL (env, already shared).
2. The cookie domain (`.<root>`).

### The one change in VillageOS

VillageOS currently sets its auth cookie **host-only**. Add the `domain` option in
both `setAll` handlers — that is the entire VillageOS-side change:

- `apps/web/src/lib/supabase/server.ts` (the `cookieStore.set(...)` call)
- `apps/web/src/proxy.ts` (the `supabaseResponse.cookies.set(...)` call)

```ts
const cookieDomain =
  process.env.NODE_ENV === "production" ? ".villageos.app" : undefined; // ← root domain

// before:  set(name, value, options)
// after:   set(name, value, { ...options, domain: cookieDomain })
```

`undefined` in dev so it falls back to host-only locally (see sharp edges).

### The voice-app side

Mirror the *same* `setAll` with the *same* `domain`, so when the voice app
refreshes the token it writes a `.<root>` cookie too (not a host-only one that
would shadow VillageOS's). Add a `proxy.ts`/middleware that calls
`supabase.auth.getUser()` to refresh, and a thin `lib/supabase/server.ts` client
— structurally identical to VillageOS's.

### Requirements
- Both deployed as subdomains of one registrable root (`app.` + `voice.<root>`).
- **Matching `@supabase/ssr` major version** in both — Supabase chunks large
  session cookies (`…auth-token.0/.1`); both ends must encode/decode the same way.
- Same Supabase project; anon key in the browser is fine (public by design; RLS
  protects rows). `service_role` never leaves a server.

### Sharp edges (the real cost is here, not the code)
1. **Local dev** — `localhost` isn't under `.<root>`, so the shared cookie won't
   apply. Develop against `*.localtest.me` / `lvh.me` subdomains (resolve to
   127.0.0.1) or `/etc/hosts` entries; hence `domain: undefined` in dev.
2. **Token-refresh race** — both apps' middleware refresh the same cookie;
   rotating refresh tokens can occasionally race → a forced re-login. Mitigate by
   giving refresh a single owner (the main app) or accepting the rare re-auth.
3. **Blast radius** — a `.<root>` cookie reaches every subdomain. It's `httpOnly`
   (XSS can't read it), but any subdomain's *server* can. Fine for first-party
   apps you control; don't park untrusted subdomains under that root.

---

## 4. Data: live query + anti-corruption mapper

The voice app must **not** import VillageOS's types (that would recouple them).
`/api/schedule` queries the real table and maps rows to the voice app's own
`ScheduleEvent`. The mapper is the only place that knows VillageOS's schema.

Real schema (verified):

```sql
-- events (RLS: "users_own_events"  USING auth.uid() = user_id)
id UUID, title TEXT, event_type public.event_type, start_time TIMESTAMPTZ,
end_time TIMESTAMPTZ, is_all_day BOOLEAN, location TEXT, description TEXT,
confidence NUMERIC, raw_text TEXT, user_id UUID, created_at TIMESTAMPTZ
-- action_items (RLS inherits from parent event): description, cost_estimate_gbp
```

New `/api/schedule/route.ts` (shape):

```ts
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const day = new URL(request.url).searchParams.get("day");
  const supabase = await createClient();        // reads the session cookie
  const { from, to } = dayRange(day);           // next-3-days window

  const { data, error } = await supabase
    .from("events")
    .select("id,title,event_type,start_time,end_time,location,description")
    .gte("start_time", from)
    .lte("start_time", to)
    .order("start_time");                        // RLS scopes to auth.uid() automatically

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ events: data.map(toScheduleEvent) });
}
```

Mapper (the anti-corruption layer):

```ts
function toScheduleEvent(row): ScheduleEvent {
  return {
    id: row.id,
    title: row.title,
    category: mapEventType(row.event_type),     // VillageOS enum → voice Category
    time: timeOf(row.start_time),
    endTime: row.end_time ? timeOf(row.end_time) : undefined,
    location: row.location ?? undefined,
    note: row.description ?? undefined,          // or fold in action_items
    date: row.start_time.slice(0, 10),
    dayLabel: labelFor(row.start_time),
  };
}
```

`ScheduleEvent` stays the stable contract; the schema can evolve behind the mapper.

---

## 5. Privacy / DPIA

With real users, the schedule surfaced gets **sent to ElevenLabs' models** to be
spoken — making ElevenLabs a **data processor / sub-processor** for family PII.

- Fine on your own account / seed data (the demo).
- For real users: needs consent + a processing agreement, and **data
  minimisation** — send only `title`/`time`/`category` to the agent, never
  free-text `description` / `raw_text`.
- Cross-references VillageOS `DPIA.md`. Every satellite tool that ships data to a
  third party (voice → ElevenLabs, parser → an LLM) is another sub-processor and
  should share one consent/minimisation story.

---

## 6. Generalising to future tools

The **boundary** (Supabase + RLS) generalises across the whole ecosystem. **How a
tool authenticates** and **how it contracts the data** evolve with the client type:

| Tool type | Auth mechanism | Same Supabase + RLS? |
|---|---|---|
| Web app on `*.<root>` | **Shared cookie (this plan)** | ✅ identical |
| Mobile / desktop native | OAuth / PKCE, tokens in secure storage | ✅ same RLS, different token flow |
| Browser extension | OAuth token flow | ✅ same RLS |
| Server-to-server (bot, cron, external) | Per-user OAuth tokens, or scoped service role | ⚠️ `auth.uid()` assumes a *user* JWT — needs explicit scoping |

**Where the pattern strains at scale (plan for it, don't pre-build it):**
- **RLS is binary** (`own it or not`). Partial access — title-only views, "share
  with co-parent", provider-facing scopes — needs column-level policies,
  security-definer views, or RPC functions.
- **No cross-repo compiler for the data contract.** Each tool's mapper can drift
  when the schema changes. Flip point: publish a versioned `@villageos/db-types`
  package (generated Supabase types) or versioned Postgres RPC as the contract.
- **Refresh race & privacy** compound with N tools (see §3 / §5).

---

## 7. Implementation phases

- [ ] **P0 — Decide** root domain + auth method (B vs OAuth); confirm VillageOS
      `@supabase/ssr` version to match.
- [ ] **P1 — VillageOS** — add `domain` to the two `setAll` handlers (prod only).
- [ ] **P2 — Voice app auth** — add `@supabase/ssr` + `@supabase/supabase-js`,
      `lib/supabase/server.ts`, middleware (`getUser` refresh), env
      (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Add `/login`
      only if Option A (B needs no sign-in screen).
- [ ] **P3 — Live data** — swap `/api/schedule` to the Supabase query + mapper;
      `mapEventType`, `dayRange`, `toScheduleEvent`. Keep `ScheduleEvent` unchanged.
- [ ] **P4 — Minimise & consent** — strip free-text before it reaches the agent;
      add a consent gate; DPIA line.
- [ ] **P5 — Subdomain deploy** — `voice.<root>` on Vercel; verify SSO end-to-end;
      sort local-dev domains (`*.localtest.me`).

## 8. Open questions
- Registrable root domain for the subdomains?
- VillageOS auth: email+password, OAuth, or magic link today? (Decides the
  smallest-lift path.)
- Is "share with co-parent" / multi-member access on the roadmap? (Decides whether
  to invest in granular RLS now vs later.)
