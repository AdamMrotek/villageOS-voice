# VillageOS Voice

A voice-first companion to my [VillageOS](#) product — ask about your family's
week out loud and hear it back, with the schedule surfacing as live event cards
in a conversation stream as the agent speaks.

> Built with **Next.js 16**, **TypeScript**, and the **ElevenLabs Conversational
> Agents API**. Uses the `@elevenlabs/react` hooks for real-time audio /
> transcription streaming and a **client tool** to bridge agent intent to
> reactive UI.

## 🎥 Demo

<!-- TODO: drop a 30-second screen recording here. "What's on my schedule
tomorrow?" → orb goes listening → thinking → speaking, and the event cards
appear in the stream. The video is the artifact. -->

_30-second video coming here._

## Why this exists

VillageOS turns messy parent-chat ("don't forget swimming kit Thursday!") into
structured family events. This is the same data, **spoken**: the same user, now
voice-first. A real product problem reduced to a delightful voice interaction —
not a generic tutorial agent.

## How it works

### The integration, end to end

One full round trip of "What's on tomorrow?" — from spoken words to spoken
answer — colour-coded by **where the code runs** (browser · our server ·
ElevenLabs). The full interactive version (state machine, two-payload split, and
the anti-corruption mapper) lives in [`how-it-works.html`](./how-it-works.html).

![The request flow: tap the orb → server mints a WebRTC token → ElevenLabs agent calls the get_schedule client tool → the tool fetches /api/schedule and does double duty, rendering event cards in the browser while returning a token-lean projection to the model to speak](./docs/how-it-works.png)

```
You speak ─▶ ElevenLabs agent (WebRTC) ─▶ calls get_schedule client tool
                                               │
  chat stream renders event cards ◀── tool fetches /api/schedule
                                               │
  agent speaks + transcribes  ◀── tool returns a token-lean JSON projection
```

- **A conversation stream, not a single card view.** Spoken turns render as
  message bubbles and tool results render as inline event rows, all in one
  scrolling timeline beneath a floating mic dock.
- **Tap to nudge the conversation.** Voice is the input; alongside it, tappable
  chips (empty-state example prompts and the to-do chips on event rows) send a
  message into the same stream, starting or resuming the session as needed.
- **Works when the mic doesn't.** If the mic is blocked (in-app browsers, denied
  permission, locked-down devices), the app falls back to a **text-only session
  that still speaks** — you type, and the agent's reply is read back in its own
  voice. See [ADR 0002](./docs/adr/0002-text-fallback-with-tts-readout.md).
- **State-driven UI.** Every visual is driven from one agent state machine
  (`idle → connecting → listening → thinking → speaking`). Each state has a
  distinct glyph + motion so it's obvious what the app wants (Mic + "tap me" ring
  to connect, a waveform with sonar ripples while listening, a stop square while
  speaking). The orb is audio-reactive — it breathes with the live mic/agent
  loudness via the SDK's frequency data (`getOutput/InputByteFrequencyData`).
- **The voice→UI handshake.** The `get_schedule` client tool does double duty:
  it renders event rows _and_ returns a structured projection to the model so it
  can speak them. Tool output is never dumped as raw text.
- **Low-latency, secure connection.** A server route mints a short-lived **WebRTC
  conversation token**; the ElevenLabs API key never reaches the browser.
  WebRTC is chosen for the snappiest barge-in.
- **Shared design language.** Reuses VillageOS's "Meadow" palette and type, so
  the two products read as a family.

## Architecture

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) · React 19 · TypeScript |
| Voice | ElevenLabs Conversational Agents · `@elevenlabs/react` v1 |
| Connection | WebRTC, server-minted conversation token (`/api/conversation-token`); text fallback over a WebSocket signed URL (`/api/signed-url`) |
| Input | Voice, plus tappable prompt / to-do chips and a text composer (mic-blocked fallback) — all post into the same stream |
| Readout | Live voice on WebRTC; in text mode, agent replies are spoken via server-side TTS in the agent's voice (`/api/tts`) |
| Data | VillageOS-shaped 3-day snapshot behind an anti-corruption mapper (`/api/schedule`, `src/lib/schedule.ts`) |
| UI | Tailwind v4, shadcn/ui, framer-motion, the Meadow design system |

## Engineering decisions

> **What the SDK does vs. what I built.** `@elevenlabs/react` handles the genuinely
> hard real-time voice work — audio streaming, VAD, turn-taking, barge-in,
> STT/TTS. This project is the layer *around* that: the integration architecture,
> the security boundary, and the UX that turns an audio stream into a product.
> The decisions below are where the actual work is.

### 1. Read the SDK from its types, not its docs
The published docs lagged a major (`v1.0`) release, so the real surface was
derived from the package's `.d.ts` files: the `ConversationProvider` + granular
hooks model, the `SessionConfig` union (`agentId` vs `signedUrl` vs
`conversationToken`), the `onMessage` payload shape, and the
`getOutput/InputByteFrequencyData` accessors.
**Why it matters:** integrating an evolving API means treating the type surface
as the source of truth.

### 2. Client tool, not a server webhook
`get_schedule` is registered as a **client tool** (`useConversationClientTool`),
so it runs in the browser and calls this app's own `/api/schedule`.
**Why:** identity and data access stay entirely on our side — no user context is
handed out to ElevenLabs and back. A server webhook would push that boundary
outward and add a place to leak. The client tool is both simpler *and* tighter.
**Tradeoff:** the data fetch depends on the browser session; fine here, and the
right default for per-user data later.

### 3. WebRTC with a server-minted token
The browser never sees the API key. `/api/conversation-token` mints a short-lived
WebRTC token server-side, and the client connects with
`startSession({ conversationToken, connectionType: "webrtc" })`.
**Why WebRTC over the WebSocket signed-URL path:** lower, more consistent latency
— which is what makes barge-in (interrupting the agent mid-sentence) feel instant
instead of broken. At a voice company, that's the difference that's graded.

### 4. One state machine drives every pixel
`status` + `isSpeaking` + a tool-pending flag collapse into a single
`VoiceState` (`idle → connecting → listening → thinking → speaking → error`),
and the whole UI renders from it.
**The non-obvious bit:** the SDK exposes no "thinking" state. It's *inferred* —
set true while a `get_schedule` call is in flight, cleared the moment the agent
starts speaking (with a timeout fallback). That inferred state is what makes the
retrieval feel like the agent is *doing* something rather than freezing.

### 5. The voice→UI handshake
The client tool does double duty: it pushes events into the timeline to render
inline cards **and** returns a structured projection to the model so it can speak
the answer. Tool output is never dumped as raw text — voice and UI stay in sync
from one source. The rendered rows carry tappable to-do chips that send a
follow-up straight back to the agent, so the UI feeds the conversation too.
This is the exact "bridge agent intent to reactive UI" skill the role asks for.

### 6. Taps feed the same conversation as voice
Voice is the primary input, but tappable chips (empty-state example prompts and
the to-do chips on event rows) post a text message into the same stream via
`sendUserMessage`. That message renders optimistically, then de-dupes against the
SDK echo; if no session is live, it **starts or queues** one and is flushed on
connect. The agent's transcript is also sanitised (`stripMarkers`) so stray
markers like `[urgent]` never reach the screen — belt-and-braces alongside the
prompt instruction not to verbalise them.

### 7. Stateless resume + a silence watchdog
Each `startSession` mints a brand-new conversation with no server-side memory, so
on reconnect the recent transcript is re-fed via `sendContextualUpdate` (capped
at the last N turns) — the agent continues instead of re-greeting. The same
`requestAnimationFrame` loop that drives the orb doubles as a silence watchdog:
after a few seconds of no voice / no tool activity it auto-hangs-up to free the
mic, and the visible transcript survives so the next turn resumes cleanly. Text
sessions have no mic to watch, so they use a typed-activity idle timer instead
(re-armed on each send) — otherwise the agent fills the silence with nudges.

### 8. A token-lean tool result, separate from the UI payload
The tool result is pinned into the conversation and re-sent to the model every
turn, so anything it won't speak is recurring token waste. `toAgentSchedule`
projects the events down to just what's speakable (dropping UUIDs, the category
enum, redundant ISO dates, done to-dos; collapsing time fields into one `when`).
**The UI still gets the full `ScheduleEvent[]`; only the model gets the lean
projection.**

### 9. An anti-corruption mapper around VillageOS's schema
The source snapshot mirrors the **real VillageOS API payload** exactly
(snake_case `event_type` / `start_time` / `action_items[]`), and `toScheduleEvent`
maps it to the voice app's own stable `ScheduleEvent` contract. When this swaps
to a live query, only the mapper has to learn VillageOS's schema. Seeds carry a
relative `dayOffset` resolved against the real date at request time, so "what's on
today?" always has something to say.

### 10. Audio-reactive orb without re-render thrash
The orb breathes with live loudness by reading frequency data in a
`requestAnimationFrame` loop. The hook returns a new object each render, so the
loop reads through **stable function refs** and a `speakingRef`, keeping the
effect from re-subscribing every frame.

### 11. A text fallback that still speaks
A blocked mic shouldn't end the conversation. When `getUserMedia` throws (in-app
browsers, denied permission, gesture loss), the app drops to a **text-only
WebSocket session** that never requests the mic — and because that mode is
otherwise *silent*, each agent reply is sent to `/api/tts` and read back in the
**agent's own voice**. The non-obvious bits: the WebRTC token doesn't work for the
text path (it needs a signed URL); the TTS endpoint needs a real TTS model, not
the agent's conversational one; `voice_settings` are clamped with a
retry-without-settings fallback so a bad value degrades delivery instead of going
silent; and iOS autoplay is unlocked inside the send gesture so the
async-fetched audio can play. Full rationale in
[ADR 0002](./docs/adr/0002-text-fallback-with-tts-readout.md).

### Honest limitations
- Data is a hardcoded snapshot (Level 1) — deliberately, to keep the focus on the
  front-end + agent integration. The seed already mirrors VillageOS's schema; the
  seed-from-real-data path is scoped in [`AUTH_TOOL_INTEGRATION_PLAN.md`](./AUTH_TOOL_INTEGRATION_PLAN.md).
- One tool (read-only). A write-back tool ("add an event") would round-trip the
  loop. No automated tests yet.

## Run it

```bash
cp .env.local.example .env.local   # add ELEVENLABS_API_KEY + ELEVENLABS_AGENT_ID
npm install
npm run dev
```

**Optional env** (text-mode readout — all default to the agent's own voice/config):

| Var | Purpose |
|---|---|
| `ELEVENLABS_VOICE_ID` | Override the readout voice (default: the agent's voice) |
| `ELEVENLABS_TTS_MODEL` | TTS model (default `eleven_flash_v2_5`) |
| `ELEVENLABS_TTS_SPEED` | Readout pace, 0.7–1.2 (1.0 = normal) |
| `ELEVENLABS_TTS_STABILITY` | 0–1, lower = more expressive |
| `ELEVENLABS_TTS_STYLE` | 0–1, higher = more stylistic |

Create the agent first — see [`AGENT.md`](./AGENT.md) for the dashboard setup and
the `get_schedule` client-tool definition. The canonical system prompt lives in
[`agent-prompt.md`](./agent-prompt.md) (kept in git so prompt changes are
reviewable — update it and the dashboard together).

## Key files

- `src/components/voice-companion.tsx` — SDK wiring, state machine, client tool, timeline
- `src/components/voice-orb.tsx` — the audio-reactive state orb
- `src/components/chat-event.tsx` — inline event row with tappable to-dos
- `src/components/event-card.tsx` — Meadow schedule card + category styling
- `src/lib/voice-state.ts` — the `VoiceState` machine and its copy
- `src/lib/schedule.ts` — snapshot, anti-corruption mapper, token-lean projection
- `src/app/api/conversation-token/route.ts` — server-side WebRTC token
- `src/app/api/signed-url/route.ts` — WebSocket signed URL for the text fallback
- `src/app/api/tts/route.ts` — server-side TTS readout (agent's voice) for text mode
- `src/app/api/schedule/route.ts` — the snapshot endpoint
