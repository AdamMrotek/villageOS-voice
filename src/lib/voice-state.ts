/**
 * The agent's visible state machine. Every visual in the app is driven from
 * this union so the UI *reacts* to the agent rather than just logging it.
 */
export type VoiceState =
  | "idle" // disconnected, calm
  | "connecting" // establishing the WebRTC session
  | "listening" // connected, waiting for / hearing the user
  | "thinking" // a tool call is in flight (retrieval)
  | "speaking" // the agent is talking
  | "error";

export const STATE_COPY: Record<VoiceState, { label: string; hint: string }> = {
  idle: { label: "Tap to start talking", hint: "Ask about today, tomorrow, or the week" },
  connecting: { label: "Connecting…", hint: "Setting up the conversation" },
  listening: { label: "Listening — go ahead", hint: "Speak now; tap to stop" },
  thinking: { label: "Checking the schedule…", hint: "Pulling up the events" },
  speaking: { label: "Speaking", hint: "Tap stop to interrupt any time" },
  error: { label: "Something went wrong", hint: "Tap to try again" },
};
