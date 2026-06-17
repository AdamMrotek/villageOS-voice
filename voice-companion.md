# Side project — "VillageOS Voice Companion" (the audition artifact)

> Supersedes the earlier `side-project.md` ("Read My Day", a one-afternoon TTS
> demo). This is the upgraded plan: stop *integrating a feature*, start
> *auditioning for the role*. A standalone React app that is a **voice-first
> interface over VillageOS data**, built on the **ElevenLabs Conversational
> Agents** API. Target effort: **3–5 focused days.** Do not let it gate the
> application — apply in parallel and attach the link when it lands.

---

## Why this artifact (what it proves)

The role is **Full-Stack Engineer, front-end leaning** at a voice company. This
single artifact hits the three things their reviewers screen for:

- **API literacy** — you can work their actual Agent / SDK / client-tool surface,
  not just the most-Googled TTS endpoint.
- **UX craft** — you understand a voice agent needs *visible state*
  (idle / listening / thinking / speaking) and a voice→UI handshake to feel like
  a product, not a science project.
- **Product intuition** — you took a messy real-world data problem (VillageOS)
  and reduced it to a delightful voice interaction.

It also closes the **one real domain gap** in `overview.md` (no voice/audio
experience) and reinforces the strongest matches (TypeScript/React, front-end
craft, AI-first, build-integrations). See the role/fit/chances analysis in
`overview.md`; this doc is the build spec for action item #7.

---

## The role we're applying for (one-paragraph recap)

ElevenLabs — Full-Stack Engineer (Front-End Leaning), Engineering & Product.
Remote-global (or London / NY / SF / Warsaw). One hard requirement:
**TypeScript / React**, plus familiarity with APIs / cloud infra / storage /
data structures and an interest in UI/UX. They **hire on artifacts over
credentials** ("showcase solving impressively hard problems with past projects
or GitHub contributions") and run on five values — **high-velocity, impact not
titles, AI first, excellence everywhere, global team**. The binding constraint is
funnel volume at an $11B company, so the artifact's job is to make
**TypeScript/React + AI-first + their own API** unmissable to a human fast.

---

## Where to build it — standalone repo, not the VillageOS monorepo

Build it as its **own public repo** (`villageos-voice`) with its **own Vercel
project**. Do **not** add it as `apps/voice` inside the VillageOS Turborepo. The
instinct to put it in the monorepo "to reuse the UI" is the trap — you can get
the same UI without the coupling.

**Why standalone:**

- **Legibility is the artifact's whole job.** A dedicated repo + case-study README
  is scannable in 6 seconds ("React/TS + ElevenLabs Agents, video, live link"). An
  `apps/voice` folder buried in a parenting-app monorepo is the same *buried-signal*
  problem we rejected when we chose standalone-product over feature.
- **Clean deploy + isolated env** — own live URL, `ELEVENLABS_API_KEY` scoped to one
  tiny app.
- **No coupling to VillageOS turbo/CI/build** — nothing to break or explain.
- **Velocity** — `create-next-app`, ship. No workspace wiring. Matches "days not weeks."
- **No runtime dependency** — the schedule snapshot is hardcoded, so there is zero
  data reason to live next to VillageOS.

**How to still get "the same UI" (the key insight):** a reviewer cannot tell
whether you imported a shared package or copied tokens — they just see a polished
UI that matches your other product. So copy, don't couple:

1. Copy the **Meadow tokens** (CSS custom properties + utility classes) from
   `apps/web/.../globals.css` into the new app's `globals.css`.
2. Copy only the **few shadcn components** you actually use (Button, Card, …) —
   copying is the shadcn model.
3. Same Tailwind config + font. ~20 minutes total.

A shared `packages/ui` design package is the *only* thing that would justify the
monorepo — and that is over-engineering for one screen. **When the answer flips:**
if this later becomes a permanent, maintained part of VillageOS, extract
`packages/ui` and move it into `apps/`. For a 3–5 day hiring artifact, optimize for
the legible standalone.

Frame the story in the README's first line: *"A voice-first companion to my
VillageOS product →"* with a link. That reads as a deliberate companion artifact —
a *better* two-product story than a buried folder.

---

## Core architecture

| Layer | Choice | Notes |
|---|---|---|
| **Agent** | ElevenLabs **Conversational AI / Agents** | Their flagship product — shows you get the real platform, not just TTS. |
| **Knowledge ("RAG" hack)** | A **snapshot JSON** of the next 3 days of events injected into the agent's system prompt / Knowledge Base | No vector DB. You already have structured events; a static snapshot is enough for a demo. Hardcode it if needed. |
| **Frontend** | Single-page **Next.js 16 / React 19 / TypeScript** | The 6-second stack match. |
| **SDK** | `@elevenlabs/react` (`useConversation` hook) | Use the official SDK for audio/transcription state — **do not hand-roll the WebSocket**; that wastes your best days on plumbing no reviewer sees. |
| **Tool** | One **client tool**: `get_schedule` | When the agent calls it, the React app renders a visual event card. This handshake is the whole point. |

**Why the "RAG hack" is the right call:** the reviewer wants to see your
**front-end + Agent integration**, not a database schema. A clean static snapshot
that the agent reasons over beats a half-built vector pipeline every time. If the
Knowledge Base UI gives you trouble, paste the JSON straight into the agent
prompt and move on.

---

## Auth & data access (how RLS fits — and why you skip it)

The plan hardcodes the 3-day snapshot, which means **the audition demo needs no
auth, no Supabase session, and no RLS at runtime** — and that's correct, not a
shortcut. A front-end reviewer never sees your auth flow; adding Supabase sessions
+ RLS buys zero hiring signal and costs days plus new failure modes (cookie/SSR
across a second domain, CORS, a sign-in UX). Auth is pure cost against the goal.

> Context: VillageOS uses **Supabase Auth** (email+password, `@supabase/ssr`
> cookie sessions — *not* Clerk). RLS keys off the Supabase session JWT
> (`auth.uid()` in policies).

Pick a level by intent:

**Level 1 — Audition demo (recommended): no auth.** `get_schedule` reads a static
JSON / a `/api/schedule` route that returns canned data. Ship it.

**Level 2 — Real-looking data, still no runtime auth (best middle ground).** A
one-off **seed script** runs locally *as you*, dumps your real next-3-days to a
**scrubbed JSON**, and commits it. You authenticate once, at build time, in a
terminal — never in the deployed app. Real data, zero runtime auth/RLS surface.
Do this if canned data feels too fake.

**Level 3 — Live per-user data (only if it becomes a real VillageOS feature).**
RLS flow:

```
Browser (user signed into the voice app via Supabase Auth, same Supabase project)
  → agent invokes the get_schedule CLIENT TOOL (runs in the browser)
  → tool calls the voice app's OWN /api/schedule route handler
  → route uses @supabase/ssr server client → reads the session cookie
  → queries Supabase AS THE USER → RLS enforced by auth.uid() from the JWT
  → returns events to the tool → renders the card
```

Architectural points for Level 3:

- **Client tool, not a server-side webhook tool.** Identity stays entirely on your
  side (browser session → your authed route → Supabase); you never hand a user
  token to ElevenLabs. A server webhook would force passing identity *out* to
  ElevenLabs and back — more surface, a place to leak. Client tool is simpler
  *and* more secure.
- **Anon key in the browser is fine** — it's public by design; RLS protects the
  rows. The `service_role` key must **never** leave the server; the ElevenLabs API
  key also stays server-side.
- **Standalone-repo implication:** a separate domain = its own Supabase cookie
  session, so the user signs into the voice app too (same Supabase project, same
  credentials). No cross-domain SSO needed — this does *not* force the monorepo.
- **Privacy flag (`DPIA.md`):** the snapshot injected into the agent's
  prompt/Knowledge Base is user event data **leaving to ElevenLabs' models**. Fine
  for a demo on your own/seed data; if it ever touches real users, it's a
  processor/sub-processor question worth a DPIA line. Another reason Level 1/2 is
  right for the audition.

**Recommendation: Level 2** — convincing real data, clean front-end + Agent
integration on display, no days burned on auth no one grades.

---

## Build plan (3–5 days)

| Day | Focus | Task |
|---|---|---|
| **1** | The agent | Create the agent in the ElevenLabs dashboard. Upload a 3-day schedule snapshot (text/JSON). Test in the playground until it reliably answers *"What's on my schedule tomorrow?"* |
| **2** | UI shell | Build the React UI with **shadcn/ui**. Need: (1) a state **orb/button** (pulse when speaking, spinner when thinking, calm when idle); (2) a **transcript view** (optional but impressive); (3) a **data card** that appears when the agent surfaces an event. |
| **3** | Integration | Wire the React SDK to your agent ID via `useConversation`. Handle the **client-tool call** — when the agent surfaces the schedule, reactively render the event list/card. |
| **4** | Polish & robustness | The **"excellence everywhere"** day. Snappy UI, smooth transitions (framer-motion), and **rock-solid interruption / stop (barge-in)**. This is where voice demos live or die — do not skip it. |
| **5** | The artifact docs | A **case-study `README.md`**: lead with a 30-second video, then explain architecture — latency/streaming, state-sync between agent intent and UI, and *why* you built it this way. |

**Hard cut-line (protect the demo):** orb state machine + one `get_schedule`
client tool + one beautiful event card. Transcript view, voice picker, and
elaborate motion choreography are all *below* the line — add only if Day 4 is
clean.

---

## Making the UI "crafty" (the secret sauce)

The reviewer reads "front-end lean" as: can you make an abstract AI interaction
feel like a physical product?

- **State-driven UI** — drive every visual from the agent state machine
  (`idle → listening → thinking → speaking`). Use CSS/framer-motion transitions
  so the UI *reacts* to the agent. "Thinking" should imply retrieval, not freeze.
- **Visual continuity with VillageOS** — replicate the **Meadow palette** (warm
  earth tones) and type from VillageOS exactly (`apps/web` `globals.css`). Two of
  your own products sharing a design language is a cheap, strong "I think in
  products" signal.
- **The voice→app handshake** — never dump tool output as raw text. When
  `get_schedule` returns, render a **beautiful event component** (a mini calendar
  card). Bridging voice and app UI is the exact skill the spec asks for.

---

## Differentiation (don't skip — most applicants will build a generic agent)

The moat is the **VillageOS narrative**: messy parent messages → structured
events → now *spoken back*. State it in **one line in the UI** and **one line in
the README**, or the work gets mistaken for a tutorial to-do voice app. The story
("I build AI products for families; here's the same user, voice-first") is what a
fresh hackathon demo can't replicate.

---

## Checklist to win the reviewer

- [ ] **Public repo** — `github.com/AdamMrotek/villageos-voice` (or similar), clean commits.
- [ ] **Live URL** (Vercel) with `ELEVENLABS_API_KEY` server-side only — never in the browser bundle.
- [ ] **Case-study README opens with a 30-second video** — *"What's on my schedule tomorrow?"* → app instantly surfaces the card. **The video is the artifact.**
- [ ] **Explicitly name their stack** in the README: *"Built with Next.js 16, TypeScript, and the ElevenLabs Conversational Agents API. Used the `@elevenlabs/react` hooks to manage real-time audio/transcription streaming and a client tool to bridge agent intent to reactive UI."*
- [ ] **Interruption/stop works flawlessly** — demo it in the video.
- [ ] **One line of VillageOS narrative** visible in-product and in the README.

---

## Critical risks (be honest with yourself)

1. **Latency / barge-in.** A laggy or un-interruptible agent reads as *broken* at
   a voice company — worse than no demo. If you can't make it feel instant, ship a
   smaller flawless slice.
2. **Scope creep.** 3–5 days becomes 10 without the hard cut-line above.
3. **The video gate.** No reviewer grants mic permission to try your link. If the
   README doesn't open with the video, the craft is invisible.
4. **Timing vs the application.** This is now days, not an afternoon. Apply
   first/in parallel; funnel timing at a hot company beats a perfect artifact that
   arrives two weeks late.

---

## After shipping — what to update

1. **`overview.md`** → move "voice/audio domain" from ⚠️ toward ✅ ("built a
   working Conversational-Agents integration"); tick action #7.
2. **`cover-letter.md`** → swap the relevant answer to reference the repo + live
   link + video; add a one-line mention in the body ("I built a voice agent over
   my product's data against your Conversational Agents API this week — link").
3. **Archive `side-project.md`** (the superseded "Read My Day" TTS plan) so there
   aren't two conflicting briefs in this folder.

---

## Build sketch (verify against current ElevenLabs docs before relying on it)

> The `@elevenlabs/react` SDK surface (`useConversation`, `clientTools`,
> connection auth) changes — confirm hook/prop names and the agent auth flow at
> https://elevenlabs.io/docs before wiring. Shape below is illustrative.

```tsx
"use client";
import { useConversation } from "@elevenlabs/react";
import { useState } from "react";

type Event = { title: string; day: string; time: string };

export default function VoiceCompanion() {
  const [events, setEvents] = useState<Event[]>([]);

  const conversation = useConversation({
    // client tool the agent invokes — return data to the model AND drive the UI
    clientTools: {
      get_schedule: async ({ day }: { day: string }) => {
        const data = await fetch(`/api/schedule?day=${day}`).then((r) => r.json());
        setEvents(data.events);            // reactive card render
        return JSON.stringify(data.events); // hand structured data back to the agent
      },
    },
  });

  const status = conversation.status;        // drive the orb state machine
  const speaking = conversation.isSpeaking;  // pulse vs spinner vs idle

  return (
    <main>
      {/* <Orb status={status} speaking={speaking} /> */}
      <button
        onClick={() =>
          status === "connected"
            ? conversation.endSession()
            : conversation.startSession({ agentId: process.env.NEXT_PUBLIC_AGENT_ID! })
        }
      >
        {status === "connected" ? "Stop" : "Talk to VillageOS"}
      </button>
      {/* {events.map((e) => <EventCard key={e.title} event={e} />)} */}
    </main>
  );
}
```

The server route (`app/api/schedule/route.ts`) returns the hardcoded 3-day
snapshot — that is the entire backend, by design.
