# ADR 0002: Text-input fallback that still speaks (mic-blocked devices)

- **Status:** Accepted
- **Date:** 2026-06-19
- **Component:** `src/components/voice-companion.tsx`, `src/app/api/signed-url/route.ts`, `src/app/api/tts/route.ts`
- **Relates to:** [ADR 0001](./0001-voice-transport-webrtc-vs-websocket.md) (which removed the WS signed-URL route; this re-introduces one for a different purpose)

## Context

On some devices the microphone is simply unavailable, and the WebRTC voice path
(which calls `getUserMedia`) fails before the user can do anything:

- **In-app / webview browsers** (links opened inside WhatsApp, Messages,
  Instagram, etc.) block mic access and never prompt.
- **Previously-denied permission** — the browser remembers and throws
  `NotAllowedError` with no prompt.
- **iOS Safari user-gesture loss** — `getUserMedia` must be called synchronously
  inside the tap; an awaited `fetch` before it consumes the gesture and the
  request is rejected silently.

The symptom is a bare `NotAllowedError` ("not allowed by the user agent…") and no
permission popup. A voice-first product that becomes unusable here is a dead end
on exactly the devices families use most.

### Findings

1. **Gesture timing is fixable in code.** Requesting the mic *before* any `await`
   (inside the tap) restores the prompt on mobile Safari. Done, but it doesn't
   help when the mic is genuinely blocked.
2. **The SDK has a `textOnly` mode, but it is silent.** `startSession({ textOnly:
   true })` runs a WebSocket conversation that never touches `getUserMedia` — but
   `TextConversation` emits **no audio** (`getOutputByteFrequencyData` returns
   empty). For a voice product, a text reply with no voice defeats the point.
3. **`textOnly` needs a signed URL, not the WebRTC token.** The SDK types tie
   `conversationToken` to `connectionType: "webrtc"`; the WebSocket/text path
   needs `signedUrl` (or a public `agentId`).
4. **The TTS endpoint needs a TTS model.** Reusing the agent's *conversational*
   `model_id` for `/v1/text-to-speech` returns 4xx. Out-of-range `voice_settings`
   do the same.

## Decision

**Keep WebRTC as the primary voice path; fall back to a text-only WebSocket
session whose replies are spoken via a separate TTS call.**

When the mic throws (`NotAllowedError` / `SecurityError`), or the user taps "Type
instead":

1. Start a **text-only WebSocket session** (`/api/signed-url` → `startSession({
   signedUrl, textOnly: true })`) — no mic, runs the full conversation (tools
   included).
2. On each agent reply, POST the text to **`/api/tts`**, which synthesises it with
   the **agent's own voice** and streams MP3 back to play in the browser — so the
   readout still sounds like the agent.

This is the only way to get *typed input + spoken reply* given that the built-in
text mode is silent and the voice mode requires a mic.

## Supporting decisions

- **Gate TTS on the live session, not the UI mode.** `liveSessionIsTextRef` is
  true only while the active session is a `TextConversation`, so a text session
  gets TTS and a voice session (which plays its own audio) never doubles up.
- **Flush on `onConnect` for text sessions.** Consistent with ADR 0001 finding
  #5: WebSocket fires `onConnect` *after* the init handshake, so queued/seed text
  is flushed there; WebRTC still flushes on `onConversationMetadata`. A once-guard
  (`sessionFlushedRef`) keeps either transport from double-sending.
- **Idle hang-up for text sessions.** The voice silence watchdog reads the mic, so
  it can't apply to text. Instead a 25s timer (`TEXT_IDLE_TIMEOUT_MS`), re-armed
  on each send, hangs up after a lull — otherwise the agent fills the silence with
  "are you still there?" nudges forever. It defers while a readout/tool is in
  flight so it never cuts a real reply.
- **TTS robustness.** Always use a known-good TTS model (`eleven_flash_v2_5`,
  override via `ELEVENLABS_TTS_MODEL`); clamp `voice_settings` to valid ranges;
  and if a request with settings still fails, retry once **without** them so the
  readout degrades to default delivery rather than going silent.
- **iOS autoplay unlock.** The TTS audio arrives after an async fetch, so the
  `<audio>` element is primed with a silent clip inside the send gesture; later
  programmatic playback is then allowed.
- **Voice match.** `/api/tts` resolves the agent's `voice_id` + tts settings from
  the agent config (cached per process) so the readout matches the live call;
  `ELEVENLABS_TTS_SPEED` / `_STABILITY` / `_STYLE` override the "feel".

## Consequences

- Two new routes: `/api/signed-url` (text-session auth) and `/api/tts` (readout).
  The signed-URL route returns to the codebase — for the text fallback, not the
  full-duplex WS transport rejected in ADR 0001.
- New optional env: `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL`,
  `ELEVENLABS_TTS_SPEED`, `ELEVENLABS_TTS_STABILITY`, `ELEVENLABS_TTS_STYLE`.
- The text readout is a **separate synthesis** from the live call, so delivery can
  differ subtly (settings reuse minimises this) and adds one TTS round-trip of
  latency per reply.
- The agent must allow WebSocket connections / signed URLs for the fallback to
  work; if not, `/api/signed-url` returns non-200 and the UI surfaces an error.
- The orb is bypassed in text mode (a composer replaces it), so the text path has
  its own affordances ("Type instead" / "Use voice instead").
