# VillageOS Voice

A voice-first companion to my [VillageOS](#) product — ask about your family's
week out loud and hear it back, with the schedule surfacing as live cards as the
agent speaks.

> Built with **Next.js 16**, **TypeScript**, and the **ElevenLabs Conversational
> Agents API**. Uses the `@elevenlabs/react` hooks for real-time audio /
> transcription streaming and a **client tool** to bridge agent intent to
> reactive UI.

## 🎥 Demo

<!-- TODO: drop a 30-second screen recording here. "What's on my schedule
tomorrow?" → orb goes listening → thinking → speaking, and the event cards
appear. The video is the artifact. -->

_30-second video coming here._

## Why this exists

VillageOS turns messy parent-chat ("don't forget swimming kit Thursday!") into
structured family events. This is the same data, **spoken**: the same user, now
voice-first. A real product problem reduced to a delightful voice interaction —
not a generic tutorial agent.

## How it works

```
You speak ──▶ ElevenLabs agent (WebRTC) ──▶ calls get_schedule client tool
                                                   │
   browser renders event cards  ◀──────── tool fetches /api/schedule
                                                   │
   agent speaks the answer  ◀──── tool returns the same JSON to the model
```

- **State-driven UI.** Every visual is driven from one agent state machine
  (`idle → connecting → listening → thinking → speaking`). The orb is
  audio-reactive — it breathes with the live mic/agent loudness via the SDK's
  frequency data (`getOutput/InputByteFrequencyData`).
- **The voice→UI handshake.** The `get_schedule` client tool does double duty:
  it renders Meadow event cards _and_ returns the structured events to the model
  so it can speak them. Tool output is never dumped as raw text.
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
| Connection | WebRTC, server-minted conversation token (`/api/conversation-token`) |
| Data | Hardcoded 3-day snapshot (`/api/schedule`) — the whole backend, by design |
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
The client tool does double duty: it `setEvents(...)` to render cards **and**
returns the same JSON to the model so it can speak the answer. Tool output is
never dumped as raw text — voice and UI stay in sync from one source.
This is the exact "bridge agent intent to reactive UI" skill the role asks for.

### 6. Audio-reactive orb without re-render thrash
The orb breathes with live loudness by reading frequency data in a
`requestAnimationFrame` loop. The hook returns a new object each render, so the
loop reads through **stable function refs** and a `speakingRef`, keeping the
effect from re-subscribing every frame.

### Honest limitations
- Data is a hardcoded snapshot (Level 1) — deliberately, to keep the focus on the
  front-end + agent integration. A seed-from-real-data path is the next step.
- One tool (read-only). A write-back tool ("add an event") would round-trip the
  loop. No automated tests yet.

## Run it

```bash
cp .env.local.example .env.local   # add ELEVENLABS_API_KEY + ELEVENLABS_AGENT_ID
npm install
npm run dev
```

Create the agent first — see [`AGENT.md`](./AGENT.md) for the system prompt and
the `get_schedule` client-tool definition.

## Key files

- `src/components/voice-companion.tsx` — SDK wiring, state machine, client tool
- `src/components/voice-orb.tsx` — the audio-reactive state orb
- `src/components/event-card.tsx` — Meadow schedule card
- `src/app/api/conversation-token/route.ts` — server-side WebRTC token
- `src/app/api/schedule/route.ts` + `src/lib/schedule.ts` — the snapshot
