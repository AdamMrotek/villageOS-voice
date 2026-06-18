"use client";

import {
  ConversationProvider,
  useConversation,
  useConversationClientTool,
} from "@elevenlabs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { VoiceOrb } from "./voice-orb";
import { ChatEvent } from "./chat-event";
import { STATE_COPY, type VoiceState } from "@/lib/voice-state";
import { toAgentSchedule, type ScheduleEvent } from "@/lib/schedule";
import { cn } from "@/lib/utils";

/** Tools the agent can invoke, typed so the handler signature is checked. */
type AgentTools = {
  get_schedule: (params: { day?: string }) => Promise<string>;
};

/** Auto-hang-up after this much continuous silence (no voice, no tool). */
const SILENCE_TIMEOUT_MS = 5_000;
/** Amplitude below this counts as "silence" (above the mic noise floor). */
const SILENCE_LEVEL = 0.04;

/**
 * Phantom-turn filter. The ASR sometimes transcribes the agent's own audio (or
 * room noise) into tiny "user" turns — e.g. a stray "Good." right after the
 * greeting. We drop user transcripts this short that arrive while the agent is
 * speaking or within ECHO_WINDOW_MS of it finishing, where genuine barge-in
 * answers almost never land. Raise the word cap if it ever eats a real "yes".
 */
const PHANTOM_MAX_WORDS = 2;
const PHANTOM_ECHO_WINDOW_MS = 1_200;

/** One entry in the conversation stream — a spoken/typed message or a set of events. */
type TimelineItem =
  | { kind: "msg"; id: string; role: "user" | "agent"; text: string }
  | { kind: "events"; id: string; events: ScheduleEvent[] };

/**
 * Strip stray bracket markers the agent occasionally emits — e.g. "[urgent]" —
 * so they never show in the transcript. Belt-and-braces alongside the prompt
 * instruction not to verbalise the `urgent` flag. Collapses the leftover gap.
 */
function stripMarkers(text: string): string {
  return text.replace(/\s*\[[^\]\n]*\]\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

/** How many recent turns to replay to the agent when resuming a session. */
const RESUME_TURNS = 12;

/**
 * Build a contextual-update string from the visible transcript so a reconnected
 * agent "remembers" the conversation. Each `startSession` mints a brand-new
 * conversation with no server-side memory, so on resume we re-feed the recent
 * turns via `sendContextualUpdate` (background context the agent reads but does
 * not speak). Capped at RESUME_TURNS to bound token cost.
 */
function buildResumeContext(items: TimelineItem[]): string {
  const lines = items
    .filter((i): i is Extract<TimelineItem, { kind: "msg" }> => i.kind === "msg")
    .slice(-RESUME_TURNS)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`);
  if (lines.length === 0) return "";
  return (
    "The user is resuming an earlier conversation. Recent transcript for your " +
    "context — do not greet again or repeat it, just continue naturally:\n" +
    lines.join("\n")
  );
}

const EXAMPLE_PROMPTS = [
  "What's on tomorrow afternoon?",
  "What do I need to do today?",
  "Anything urgent this week?",
];

export function VoiceCompanion() {
  return (
    <ConversationProvider>
      <Stage />
    </ConversationProvider>
  );
}

function Stage() {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [toolPending, setToolPending] = useState(false);
  const [amplitude, setAmplitude] = useState(0);
  const [errored, setErrored] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>();
  const thinkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(0);
  // Text typed before the session is live; flushed once we connect.
  const pendingTextRef = useRef<string[]>([]);

  const appendMsg = useCallback((role: "user" | "agent", text: string) => {
    setTimeline((prev) => {
      // Drop the echo of a text message we already rendered optimistically.
      if (role === "user") {
        const lastMsg = [...prev].reverse().find((i) => i.kind === "msg");
        if (lastMsg && lastMsg.kind === "msg" && lastMsg.role === "user" && lastMsg.text === text) {
          return prev;
        }
      }
      return [...prev, { kind: "msg", id: `${role}-${prev.length}-${Date.now()}`, role, text }];
    });
  }, []);

  const conversation = useConversation({
    onConnect: () => {
      setErrored(false);
      setErrorMsg(undefined);
    },
    // Flush the seed (a tapped example / text that started the session) and the
    // resume transcript HERE, not in onConnect. On the WebRTC transport onConnect
    // fires the instant the LiveKit room connects — before the agent has processed
    // conversation_initiation and can accept a `user_message`, so anything sent
    // then is silently dropped. conversation_initiation_metadata is the first thing
    // the agent sends back, so receiving it proves the data channel is open both
    // ways and the agent is ready. (This regressed when the dashboard "First
    // message" was blanked: the greeting used to mask the dropped first turn.)
    onConversationMetadata: () => {
      // Resuming a prior session? Re-feed the recent transcript as context so the
      // agent continues where we left off (it has no server-side memory). Sent
      // before any queued text so the agent answers it already in context.
      const resume = buildResumeContext(timelineRef.current);
      if (resume) conversationRef.current?.sendContextualUpdate(resume);
      // Flush anything typed/tapped before the data channel was ready.
      const queued = pendingTextRef.current;
      pendingTextRef.current = [];
      queued.forEach((t) => conversationRef.current?.sendUserMessage(t));
    },
    onDisconnect: (details) => {
      console.log("[voice] disconnect", details);
      setAmplitude(0);
      setToolPending(false);
    },
    onError: (message, context) => {
      console.error("[voice] error:", message, context);
      setErrorMsg(typeof message === "string" ? message : "Connection error");
      setErrored(true);
    },
    onMessage: ({ message, role }) => {
      if (!message) return;
      // Sanitise the agent's text only; user text is echoed back verbatim so the
      // optimistic-render dedupe in appendMsg still matches.
      if (role === "user") {
        // Drop phantom user turns the ASR picks up from the agent's own audio /
        // room noise (see PHANTOM_*). Typed messages bypass this path entirely.
        const words = message.trim().split(/\s+/).filter(Boolean).length;
        const nearAgentSpeech =
          speakingRef.current ||
          Date.now() - spokeEndedAtRef.current < PHANTOM_ECHO_WINDOW_MS;
        if (words <= PHANTOM_MAX_WORDS && nearAgentSpeech) {
          console.log("[voice] dropped phantom user turn:", message);
          return;
        }
        appendMsg("user", message);
      } else {
        // The agent transcript arrives as one `agent_response` blob (no
        // streaming events on this transport) while the agent is still speaking.
        // We append it and let the bubble reveal it word-by-word (TypewriterText)
        // so it shows immediately and animates in step with the voice.
        const clean = stripMarkers(message);
        if (clean) appendMsg("agent", clean);
      }
    },
  });

  const { status, isSpeaking } = conversation;
  const getOut = conversation.getOutputByteFrequencyData;
  const getIn = conversation.getInputByteFrequencyData;
  // Stable handle so onConnect (created once) can reach the latest methods.
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  // Latest transcript, so onConnect can replay it as context on a resume.
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  // The voice→UI handshake: the agent calls this, we render events AND return
  // the structured data back to the model so it can speak it.
  useConversationClientTool<AgentTools>("get_schedule", async ({ day }) => {
    setToolPending(true);
    if (thinkingTimer.current) clearTimeout(thinkingTimer.current);
    thinkingTimer.current = setTimeout(() => setToolPending(false), 10_000);
    try {
      const res = await fetch(
        `/api/schedule?day=${encodeURIComponent(day ?? "all")}`
      );
      const data = (await res.json()) as { events: ScheduleEvent[] };
      if (data.events.length > 0) {
        setTimeline((prev) => [
          ...prev,
          { kind: "events", id: `events-${prev.length}-${Date.now()}`, events: data.events },
        ]);
      }
      // UI gets the full objects above; the model gets a token-lean projection.
      return toAgentSchedule(data.events);
    } catch {
      return JSON.stringify({ error: "Could not load the schedule." });
    }
  });

  // "thinking" ends the moment the agent starts speaking; note when it stops so
  // the phantom-turn filter knows how recently the agent was talking.
  useEffect(() => {
    if (isSpeaking) setToolPending(false);
    else spokeEndedAtRef.current = Date.now();
  }, [isSpeaking]);

  // The ElevenLabs SDK (client 1.6.x) crashes on server "error" events whose
  // payload lacks the expected `error_event` envelope: handleErrorEvent reads
  // `event.error_event.error_type` with no null-check, throwing an *uncaught*
  // promise rejection (not catchable by an error boundary). The session has
  // already been torn down by the server at that point, so swallow this one
  // specific rejection and fall back to our normal error UI; the user reconnects
  // by tapping the orb. Remove once the SDK guards that read.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "");
      if (!msg.includes("error_type")) return;
      e.preventDefault();
      console.warn("[voice] swallowed ElevenLabs error-event crash:", e.reason);
      setAmplitude(0);
      setToolPending(false);
      setErrorMsg("The session ended unexpectedly. Tap the orb to reconnect.");
      setErrored(true);
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  // The whole page scrolls; keep the newest item above the floating dock.
  useEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  }, [timeline]);

  // Measure the floating dock so the chat reserves matching bottom padding
  // (its height differs between the orb and the text input).
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDockHeight(el.offsetHeight));
    ro.observe(el);
    setDockHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  // Audio-reactive amplitude: read live frequency data while connected.
  // The same loop doubles as a silence watchdog (see SILENCE_TIMEOUT_MS).
  const speakingRef = useRef(false);
  speakingRef.current = isSpeaking;
  const toolPendingRef = useRef(false);
  toolPendingRef.current = toolPending;
  // When the agent last stopped speaking, for the phantom-turn echo window.
  const spokeEndedAtRef = useRef(0);
  const endSessionRef = useRef(conversation.endSession);
  endSessionRef.current = conversation.endSession;
  useEffect(() => {
    if (status !== "connected") {
      setAmplitude(0);
      return;
    }
    let raf = 0;
    let lastActivity = Date.now(); // reset on each fresh connection
    const tick = () => {
      try {
        const data = speakingRef.current ? getOut() : getIn();
        if (data && data.length) {
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const level = Math.min(1, (sum / data.length / 255) * 2.4);
          setAmplitude(level);
          // Voice, an agent reply, or a tool in flight all count as activity.
          if (level > SILENCE_LEVEL || speakingRef.current || toolPendingRef.current) {
            lastActivity = Date.now();
          } else if (Date.now() - lastActivity > SILENCE_TIMEOUT_MS) {
            endSessionRef.current();
            return; // stop the loop; the status-change effect will clean up
          }
        }
      } catch {
        /* getters throw before audio graph is ready — ignore */
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, getOut, getIn]);

  const state: VoiceState = errored
    ? "error"
    : status === "connecting"
    ? "connecting"
    : status === "connected"
    ? toolPending
      ? "thinking"
      : isSpeaking
      ? "speaking"
      : "listening"
    : "idle";

  const startSession = useCallback(async () => {
    setErrored(false);
    setErrorMsg(undefined);
    try {
      const res = await fetch("/api/conversation-token");
      if (!res.ok) throw new Error(`token request failed (${res.status})`);
      const { conversationToken } = (await res.json()) as {
        conversationToken: string;
      };
      console.log("[voice] starting session (webrtc)…");
      await conversation.startSession({
        conversationToken,
        connectionType: "webrtc",
        // WebRTC transport: LiveKit handles audio with integrated echo
        // cancellation and reliable barge-in. (The websocket transport streams
        // the transcript earlier but plays audio via Web Audio, which browsers
        // don't echo-cancel — on speakers the agent hears itself and loops.)
        // NOTE: the agent's greeting is suppressed by blanking "First message" in
        // the agent's dashboard config — NOT via a conversation override here.
        // Sending an un-allowlisted `overrides.agent.firstMessage` makes the
        // server reject the session with an error event that crashes the SDK.
      });
    } catch (e) {
      console.error("[voice] startSession threw:", e);
      setErrorMsg(e instanceof Error ? e.message : "Could not start the session");
      setErrored(true);
    }
  }, [conversation]);

  const handleOrbClick = useCallback(() => {
    if (status === "connected" || status === "connecting") {
      conversation.endSession();
      return;
    }
    // Resume after an auto-hang-up without wiping the visible transcript.
    void startSession();
  }, [status, conversation, startSession]);

  // Start fresh: hang up and wipe the transcript. Clearing the timeline also
  // means the next connect replays no context (buildResumeContext → ""), so it
  // really is a new conversation, not a resumed one.
  const handleNewConversation = useCallback(() => {
    if (status === "connected" || status === "connecting") {
      conversation.endSession();
    }
    pendingTextRef.current = [];
    setTimeline([]);
    setToolPending(false);
    setErrored(false);
    setErrorMsg(undefined);
  }, [status, conversation]);

  // Send a typed message (or a tapped to-do chip). Starts/queues if offline.
  const handleSendText = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      appendMsg("user", text);
      if (status === "connected") {
        conversation.sendUserMessage(text);
      } else {
        pendingTextRef.current.push(text);
        if (status !== "connecting") void startSession();
      }
    },
    [appendMsg, conversation, status, startSession]
  );

  const copy = STATE_COPY[state];

  return (
    <>
      {/* Top bar — stays pinned as the page scrolls underneath.
          Brand lockup mirrors the VillageOS main site nav (logo tile + wordmark). */}
      <header className="sticky top-0 z-20 h-[76px] border-b border-hairline bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-sm bg-ink font-display text-base leading-none text-surface">
              V
            </span>
            <span className="font-display text-lg tracking-tight text-ink">
              VillageOS
            </span>
            <span className="text-eyebrow-accent">Voice</span>
          </div>
          <div className="flex items-center gap-3">
            {timeline.length > 0 && (
              <button
                type="button"
                onClick={handleNewConversation}
                className="text-meta inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1.5 text-ink-soft transition-colors hover:bg-surface-alt"
              >
                Reset chat
              </button>
            )}
            <span className="text-date-label hidden text-ink-mute sm:inline">
              Today ·{" "}
              {new Date().toLocaleDateString("en-GB", {
                weekday: "short",
                day: "2-digit",
                month: "short",
              })}
            </span>
          </div>
        </div>
      </header>

      {/* Conversation stream — flows in the normal document, scrolls the page.
          Bottom padding reserves room for the floating dock. */}
      <div
        className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 lg:px-10"
        style={{ paddingBottom: dockHeight + 24 }}
      >
        {timeline.length === 0 ? (
          // Presets seed the conversation but keep the voice-first flow —
          // they don't flip the dock into the text box.
          <EmptyState onPick={handleSendText} />
        ) : (
          <div className="flex flex-col gap-4">
            <AnimatePresence initial={false}>
              {timeline.map((item) =>
                item.kind === "msg" ? (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn("flex", item.role === "user" ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-3.5 py-2 text-body",
                        item.role === "user"
                          ? "bg-accent text-accent-foreground"
                          : "bg-surface-alt text-ink"
                      )}
                    >
                      {item.role === "agent" ? (
                        <TypewriterText text={item.text} />
                      ) : (
                        item.text
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={item.id}
                    layout
                    initial="hidden"
                    animate="visible"
                    variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.07 } } }}
                    className="flex flex-col gap-3"
                  >
                    {item.events.map((e) => (
                      <ChatEvent key={e.id} event={e} onAction={handleSendText} />
                    ))}
                  </motion.div>
                )
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Floating dock — mic or text input, pinned to the bottom of the viewport.
          The chat scrolls beneath it; a gradient fades content into the dock. */}
      <div
        ref={dockRef}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-background from-55% via-background/85 to-transparent pt-16"
      >
        <div className="pointer-events-auto mx-auto w-full max-w-6xl px-4 pb-5 sm:px-6 lg:px-10">
          <motion.p
            key={state}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center"
          >
            <span className="text-meta">{copy.label}</span>
            {state === "error" && errorMsg && (
              <span className="text-meta ml-1 text-destructive">— {errorMsg}</span>
            )}
          </motion.p>

          <div className="mt-2 flex flex-col items-center gap-2">
            <VoiceOrb state={state} amplitude={amplitude} onClick={handleOrbClick} compact />
          </div>
        </div>
      </div>
    </>
  );
}

/** Per-word reveal delay (ms) for the agent's streamed-in transcript. */
const REVEAL_MS_PER_WORD = 45;

/**
 * Reveals text word-by-word on mount. The agent transcript arrives as a single
 * `agent_response` blob while the agent is still speaking, so animating it in
 * makes it show immediately and stream like live captions rather than popping in
 * all at once. Only new agent bubbles mount, so existing messages don't replay.
 */
function TypewriterText({ text }: { text: string }) {
  const words = useMemo(() => text.split(" "), [text]);
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    const id = setInterval(() => {
      setCount((c) => {
        if (c >= words.length) {
          clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, REVEAL_MS_PER_WORD);
    return () => clearInterval(id);
  }, [words]);
  return <>{words.slice(0, count).join(" ")}</>;
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
      <h1 className="text-title text-ink">Talk to your family&apos;s week</h1>
      <p className="text-body-soft mx-auto mt-2 max-w-sm">
        Ask what&apos;s on today, tomorrow, or the week ahead.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="text-meta rounded-full border border-hairline bg-surface px-3 py-1.5 text-ink-soft transition-colors hover:bg-surface-alt"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
