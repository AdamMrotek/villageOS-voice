import { NextResponse } from "next/server";

/**
 * Mints a short-lived websocket signed URL for the agent, server-side, so the
 * ElevenLabs API key never reaches the browser. Used by the *text-only* fallback
 * (`startSession({ signedUrl, textOnly: true })`) — a websocket connection that
 * never requests the microphone, for devices/browsers where mic access is
 * blocked. The voice path uses /api/conversation-token (WebRTC) instead.
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

  console.log("[api/signed-url] requesting signed url for agent", agentId);
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(
      agentId
    )}`,
    { headers: { "xi-api-key": apiKey }, cache: "no-store" }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[api/signed-url] ElevenLabs error", res.status, detail);
    return NextResponse.json(
      { error: `ElevenLabs signed-url request failed (${res.status})`, detail },
      { status: 502 }
    );
  }

  const data = (await res.json()) as { signed_url?: string };
  console.log("[api/signed-url] ok, got signed_url:", Boolean(data.signed_url));
  if (!data.signed_url) {
    return NextResponse.json(
      { error: "ElevenLabs response did not include a signed_url" },
      { status: 502 }
    );
  }

  return NextResponse.json({ signedUrl: data.signed_url });
}
