# Setting up the ElevenLabs agent

The app connects to a Conversational AI agent you create in the ElevenLabs
dashboard. Everything below is the dashboard-side configuration; the app side is
already wired (WebRTC token route + `get_schedule` client tool).

## 1. Create the agent

1. Dashboard → **Agents** → **Create agent** (blank template).
2. **Voice:** pick a warm, natural voice (e.g. a calm conversational preset).
3. Copy the **Agent ID** into `.env.local` as `ELEVENLABS_AGENT_ID`, and put your
   API key in `ELEVENLABS_API_KEY` (see `.env.local.example`).

> Keep the agent **private**. The app mints a short-lived WebRTC conversation
> token server-side (`/api/conversation-token`), so the API key never reaches the
> browser. WebRTC is chosen for the lowest-latency barge-in.

## 2. System prompt

Paste something like:

```
You are the VillageOS voice companion — a warm, concise assistant that helps a
busy parent stay on top of their family's schedule. Speak naturally, like a
helpful partner, not a robot. Keep answers short and skimmable out loud.

When the user asks about their schedule — today, tomorrow, a specific day, or the
whole week — ALWAYS call the `get_schedule` tool to fetch the real events before
answering. Pass the `day` they asked about ("today", "tomorrow", a weekday name,
or "all"). Then summarise the events conversationally: lead with the time and
what it is, mention who it's for and anything they need to bring or do. If there
is nothing, say the day looks clear.

Never invent events. If the tool returns nothing, say so.
```

## 3. Client tool: `get_schedule`

Add a **Client tool** (runs in the browser — the app handles it):

| Field | Value |
|---|---|
| **Name** | `get_schedule` |
| **Description** | Get the family's events for a given day. Call this before answering any schedule question. |
| **Wait for response** | **Yes** (the agent needs the returned events to speak them) |

Parameter:

| Name | Type | Required | Description |
|---|---|---|---|
| `day` | string | no | Which day: `today`, `tomorrow`, a weekday name, an ISO date (`YYYY-MM-DD`), or `all` for the whole snapshot. |

The app returns the matching events as JSON and simultaneously renders them as
cards (the voice→UI handshake).

## 4. (Optional) Knowledge

You can also paste the snapshot JSON (from `GET /api/schedule?day=all`) into the
agent's Knowledge Base so it has ambient context, but the tool is the source of
truth and is what drives the UI.

## 5. Test

In the playground (or the running app): _"What's on my schedule tomorrow?"_ →
the agent should call `get_schedule`, then speak the events. In the app the orb
goes listening → thinking → speaking and the event cards appear.
