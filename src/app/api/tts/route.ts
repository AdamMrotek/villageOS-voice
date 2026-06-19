import { NextResponse } from "next/server";

/**
 * Text-to-speech for the *text-only* fallback. When the mic is blocked we run a
 * text conversation (no audio output of its own), so to still give a spoken
 * reply we send the agent's text here and stream back ElevenLabs audio. The API
 * key stays server-side.
 *
 * Voice & delivery: we reuse the agent's configured voice AND its tts settings
 * (speed/stability/style) so the readout matches the live voice call rather than
 * the voice's slow, monotone raw defaults. Resolved once from the agent config
 * and cached for the process.
 *
 * Env:
 *   ELEVENLABS_API_KEY    server-only secret
 *   ELEVENLABS_AGENT_ID / NEXT_PUBLIC_AGENT_ID   agent to read the voice from
 *   ELEVENLABS_VOICE_ID   optional explicit voice override
 *   ELEVENLABS_TTS_MODEL      optional model (default eleven_flash_v2_5, low latency)
 *   ELEVENLABS_TTS_SPEED      optional speed override, 0.7–1.2 (1.0 = normal)
 *   ELEVENLABS_TTS_STABILITY  optional, 0–1 (lower = more expressive/varied)
 *   ELEVENLABS_TTS_STYLE      optional, 0–1 (higher = more stylistic exaggeration)
 */
type VoiceSettings = {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
};
type VoiceConfig = {
  voiceId?: string;
  modelId?: string;
  voiceSettings?: VoiceSettings;
};

let cachedConfig: VoiceConfig | undefined;

async function resolveVoiceConfig(apiKey: string): Promise<VoiceConfig> {
  if (cachedConfig) return cachedConfig;
  const agentId =
    process.env.ELEVENLABS_AGENT_ID ?? process.env.NEXT_PUBLIC_AGENT_ID;
  let agentTts:
    | (VoiceSettings & { voice_id?: string; model_id?: string })
    | undefined;
  if (agentId) {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": apiKey }, cache: "no-store" }
    );
    if (res.ok) {
      const data = (await res.json()) as {
        conversation_config?: {
          tts?: VoiceSettings & { voice_id?: string; model_id?: string };
        };
      };
      agentTts = data.conversation_config?.tts;
    } else {
      console.error("[api/tts] agent config fetch failed", res.status);
    }
  }

  // Build voice settings from the agent's, with the "feel" knobs (speed,
  // stability, style) overridable via env. Values are clamped to the API's valid
  // ranges so a stray env value (e.g. speed 2) can't make the TTS request 4xx.
  // Out-of-range / non-numeric fields drop out and fall back to voice defaults.
  const clamp = (
    raw: number | undefined,
    min: number,
    max: number
  ): number | undefined =>
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(Math.max(raw, min), max)
      : undefined;
  const envNum = (key: string): number | undefined =>
    process.env[key] !== undefined && process.env[key] !== ""
      ? Number(process.env[key])
      : undefined;
  const voiceSettings: VoiceSettings = {
    stability: clamp(envNum("ELEVENLABS_TTS_STABILITY") ?? agentTts?.stability, 0, 1),
    similarity_boost: clamp(agentTts?.similarity_boost, 0, 1),
    style: clamp(envNum("ELEVENLABS_TTS_STYLE") ?? agentTts?.style, 0, 1),
    use_speaker_boost: agentTts?.use_speaker_boost,
    speed: clamp(envNum("ELEVENLABS_TTS_SPEED") ?? agentTts?.speed, 0.7, 1.2),
  };

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? agentTts?.voice_id;
  const config: VoiceConfig = {
    voiceId,
    // The agent's model_id is a *conversational* model and isn't always valid for
    // the text-to-speech endpoint, so default to a known-good TTS model unless an
    // explicit TTS model is set.
    modelId: process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5",
    voiceSettings,
  };
  // Only cache once we actually resolved a voice — otherwise a transient agent
  // fetch failure would stick a broken config for the whole process.
  if (voiceId) cachedConfig = config;
  return config;
}

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ELEVENLABS_API_KEY." },
      { status: 500 }
    );
  }

  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "Missing text." }, { status: 400 });
  }

  const { voiceId, modelId, voiceSettings } = await resolveVoiceConfig(apiKey);
  console.log("[api/tts] text len", text.length, "voiceId", voiceId, "settings", voiceSettings);
  if (!voiceId) {
    return NextResponse.json(
      { error: "Could not resolve a voice id (set ELEVENLABS_VOICE_ID)." },
      { status: 500 }
    );
  }

  // Drop undefined fields so we don't override voice defaults with null.
  const cleanSettings = Object.fromEntries(
    Object.entries(voiceSettings ?? {}).filter(([, v]) => v !== undefined)
  );

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    voiceId
  )}?output_format=mp3_44100_128`;
  const speak = (withSettings: boolean) =>
    fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: modelId ?? "eleven_flash_v2_5",
        ...(withSettings && Object.keys(cleanSettings).length
          ? { voice_settings: cleanSettings }
          : {}),
      }),
      cache: "no-store",
    });

  let res = await speak(true);
  // If voice_settings tripped a 4xx, retry once without them so the readout
  // still plays (just with the voice's default delivery) rather than going silent.
  if (!res.ok && Object.keys(cleanSettings).length) {
    const detail = await res.text().catch(() => "");
    console.error("[api/tts] TTS failed with settings", res.status, detail, "— retrying without");
    res = await speak(false);
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.error("[api/tts] ElevenLabs TTS error", res.status, detail);
    return NextResponse.json(
      { error: `ElevenLabs TTS failed (${res.status})`, detail },
      { status: 502 }
    );
  }

  // Stream the MP3 straight through to the browser.
  return new NextResponse(res.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
