"use client";

import {
  ConversationProvider,
  useConversation,
  useConversationClientTool,
} from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { VoiceOrb } from "./voice-orb";
import { EventCard } from "./event-card";
import { Transcript, type Turn } from "./transcript";
import { STATE_COPY, type VoiceState } from "@/lib/voice-state";
import type { ScheduleEvent } from "@/lib/schedule";

/** Tools the agent can invoke, typed so the handler signature is checked. */
type AgentTools = {
  get_schedule: (params: { day?: string }) => Promise<string>;
};

export function VoiceCompanion() {
  return (
    <ConversationProvider>
      <Stage />
    </ConversationProvider>
  );
}

function Stage() {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [toolPending, setToolPending] = useState(false);
  const [amplitude, setAmplitude] = useState(0);
  const [errored, setErrored] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>();
  const thinkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const conversation = useConversation({
    onConnect: () => {
      setErrored(false);
      setErrorMsg(undefined);
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
      setTurns((prev) => [
        ...prev,
        {
          id: `${role}-${prev.length}-${Date.now()}`,
          role: role === "user" ? "user" : "agent",
          text: message,
        },
      ]);
    },
  });

  const { status, isSpeaking } = conversation;
  const getOut = conversation.getOutputByteFrequencyData;
  const getIn = conversation.getInputByteFrequencyData;

  // The voice→UI handshake: the agent calls this, we render cards AND return
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
      setEvents(data.events);
      return JSON.stringify(data.events);
    } catch {
      return JSON.stringify({ error: "Could not load the schedule." });
    }
  });

  // "thinking" ends the moment the agent starts speaking.
  useEffect(() => {
    if (isSpeaking) setToolPending(false);
  }, [isSpeaking]);

  // Audio-reactive amplitude: read live frequency data while connected.
  const speakingRef = useRef(false);
  speakingRef.current = isSpeaking;
  useEffect(() => {
    if (status !== "connected") {
      setAmplitude(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      try {
        const data = speakingRef.current ? getOut() : getIn();
        if (data && data.length) {
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          setAmplitude(Math.min(1, (sum / data.length / 255) * 2.4));
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

  const handleOrbClick = useCallback(async () => {
    if (status === "connected" || status === "connecting") {
      conversation.endSession();
      return;
    }
    setErrored(false);
    setErrorMsg(undefined);
    setEvents([]);
    setTurns([]);
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
      });
    } catch (e) {
      console.error("[voice] startSession threw:", e);
      setErrorMsg(e instanceof Error ? e.message : "Could not start the session");
      setErrored(true);
    }
  }, [status, conversation]);

  const copy = STATE_COPY[state];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center px-6 py-10">
      <header className="mb-10 text-center">
        <p className="text-eyebrow-accent">VillageOS · Voice</p>
        <h1 className="text-title mt-2 text-ink">Talk to your family&apos;s week</h1>
        <p className="text-body-soft mx-auto mt-2 max-w-md">
          A voice-first companion to{" "}
          <span className="text-ink">VillageOS</span> — the same messy
          parent-chat-into-events, now spoken back.
        </p>
      </header>

      <VoiceOrb
        state={state}
        amplitude={amplitude}
        onClick={handleOrbClick}
        disabled={false}
      />

      <motion.div
        key={state}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-6 text-center"
      >
        <p className="text-heading text-ink">{copy.label}</p>
        <p className="text-meta mt-1">{copy.hint}</p>
        {state === "error" && errorMsg && (
          <p className="text-meta mt-1 max-w-md text-destructive">{errorMsg}</p>
        )}
      </motion.div>

      {events.length > 0 && (
        <motion.section
          initial="hidden"
          animate="visible"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.07 } } }}
          className="mt-10 grid w-full grid-cols-1 gap-3"
          aria-label="Schedule"
        >
          {events.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </motion.section>
      )}

      {turns.length > 0 && (
        <section className="mt-10 w-full" aria-label="Transcript">
          <p className="text-eyebrow mb-3">Transcript</p>
          <Transcript turns={turns} />
        </section>
      )}

      <footer className="text-footer mt-auto pt-12 text-center">
        Built with Next.js, TypeScript & the ElevenLabs Conversational Agents API.
      </footer>
    </div>
  );
}
