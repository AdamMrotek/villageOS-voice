import { NextResponse } from "next/server";

/**
 * Mints a short-lived WebRTC conversation token for the agent, server-side, so
 * the ElevenLabs API key never reaches the browser. The client passes the
 * returned token to `startSession({ conversationToken, connectionType: "webrtc" })`.
 *
 * WebRTC (vs websocket signed URL) is chosen for the lowest-latency, most
 * reliable barge-in — the thing a voice company actually grades.
 *
 * Env:
 *   ELEVENLABS_API_KEY   server-only secret
 *   ELEVENLABS_AGENT_ID  the agent to connect to (server-side preferred)
 *   NEXT_PUBLIC_AGENT_ID  fallback if you only set the public var
 */
export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId =
    process.env.ELEVENLABS_AGENT_ID ?? process.env.NEXT_PUBLIC_AGENT_ID;

  if (!apiKey || !agentId) {
    return NextResponse.json(
      {
        error:
          "Missing ELEVENLABS_API_KEY and/or agent id. Set them in .env.local (see .env.local.example).",
      },
      { status: 500 }
    );
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(
      agentId
    )}`,
    { headers: { "xi-api-key": apiKey }, cache: "no-store" }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `ElevenLabs token request failed (${res.status})`, detail },
      { status: 502 }
    );
  }

  const data = (await res.json()) as { token?: string };
  if (!data.token) {
    return NextResponse.json(
      { error: "ElevenLabs response did not include a token" },
      { status: 502 }
    );
  }

  return NextResponse.json({ conversationToken: data.token });
}
