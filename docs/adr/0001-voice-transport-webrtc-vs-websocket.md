# ADR 0001: Voice transport — interruptible WebRTC over streamed WebSocket

- **Status:** Accepted
- **Date:** 2026-06-18
- **Component:** `src/components/voice-companion.tsx`, `src/app/api/conversation-token/route.ts`

## Context

The transcript text rendered seconds *after* the agent's voice played, arriving
all at once as a full message. We investigated why and whether switching the
ElevenLabs transport could make the on-screen text track the voice.

Two transports are available via the `@elevenlabs/react` / `@elevenlabs/client`
SDK (client `1.11.2`):

- **WebRTC** (LiveKit) — what we shipped originally.
- **WebSocket** (signed URL) — the alternative we trialled.

### Findings

1. **The text is sent late, not rendered late.** On the WebRTC transport the
   agent transcript arrives as a single `agent_response` event emitted at the
   *end* of the spoken turn. Instrumented timing showed `agent_response`
   landing ~10.6s after the first audio (`audio_element_ready`), while the agent
   was still speaking. There is nothing on the wire to render earlier.

2. **No streaming text events on WebRTC.** The SDK *can* surface partial LLM
   output via the `onDebug` callback (`tentative_agent_response`), but with the
   WebRTC transport the server never emits those events — `onDebug` only fired
   for `conversation_initiation_client_data` and `audio_element_ready`. So the
   "render the streaming partial, reconcile with the final" approach cannot work
   on WebRTC.

3. **WebSocket streams the transcript earlier**, so the text can track the
   voice — this is the only transport that delivers the text in step with audio.

4. **WebSocket breaks echo cancellation.** On WebRTC, LiveKit plays the agent
   audio through the pipeline the browser's echo canceller references, so it is
   removed from the mic. On WebSocket the agent audio is played via the Web Audio
   API, which browsers generally do **not** feed into the AEC reference. On
   speakers the mic re-captures the agent's own voice, the ASR transcribes it as
   "user" turns, and the agent talks to / interrupts itself in a loop. The WS mic
   capture does request `echoCancellation: true`, but that does not cover Web
   Audio playback. (Confirmed live: with no user speech the agent produced
   repeated, restarting, hallucinated turns.)

5. **WebSocket also changes session bootstrap.** `conversation_initiation_metadata`
   is consumed inside `WebSocketConnection.create()` before the message handler is
   attached, so `onConversationMetadata` never fires on WS — the seed-message
   flush (tapped example / queued text) must move to `onConnect` on WS, whereas on
   WebRTC it must stay in `onConversationMetadata` (onConnect fires before the
   agent can accept a `user_message`). The transports are not drop-in swappable.

## Decision

**Keep the interruptible WebRTC transport.** Accept that the transcript arrives
as one (late) blob rather than streaming, in exchange for reliable acoustic echo
cancellation and voice barge-in — the behaviours a voice companion is actually
graded on. A self-talking agent (the WebSocket failure mode on speakers) is a
worse user experience than text that trails the voice.

The agent transcript is still revealed word-by-word on arrival (`TypewriterText`)
so it animates in rather than popping, but this is cosmetic — it does not change
when the text data arrives.

## Options considered

| Option | Text in step with voice | Echo / barge-in | Verdict |
| --- | --- | --- | --- |
| **WebRTC (chosen)** | No — late blob | Reliable (LiveKit AEC + barge-in) | Shipped |
| WebSocket, full-duplex | Yes (streamed) | Broken on speakers (self-talk loop) | Rejected |
| WebSocket + half-duplex (mute mic while speaking) | Yes (streamed) | No self-talk, but no voice barge-in (tap orb to interrupt) | Viable fallback |
| WebRTC + LiveKit transcription tap | Possibly (synced captions) | Reliable | Unverified — not pursued |

## Consequences

- The transcript continues to trail the spoken reply; this is a known,
  accepted limitation, not a bug.
- `onConversationMetadata` (not `onConnect`) remains the seed/resume flush point.
- `/api/conversation-token` (WebRTC token) is the active auth route; the
  short-lived `/api/conversation-signed-url` route added during the WS trial was
  removed.
- If the text lag becomes the higher priority, the documented next step is
  **WebSocket + half-duplex** (stream text, mute mic while the agent speaks,
  interrupt by tapping the orb), or verifying whether ElevenLabs publishes
  synchronized LiveKit transcriptions on the WebRTC transport.
