"use client";

import { motion } from "framer-motion";
import { Mic, Square } from "lucide-react";
import type { VoiceState } from "@/lib/voice-state";

/**
 * The single most important visual: an orb that *is* the agent's state.
 * Driven entirely by `state` (the machine) plus a live `amplitude` (0–1) read
 * from the SDK's frequency data so it breathes with the actual audio.
 */
export function VoiceOrb({
  state,
  amplitude,
  onClick,
  disabled,
}: {
  state: VoiceState;
  amplitude: number; // 0–1, live mic/agent loudness
  onClick: () => void;
  disabled?: boolean;
}) {
  const active = state === "speaking" || state === "listening";
  // Live scale only while there's audio to react to; otherwise idle breathing.
  const liveScale = 1 + (active ? amplitude * 0.28 : 0);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={state === "idle" || state === "error" ? "Start talking" : "Stop"}
      className="relative grid size-56 place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/40 disabled:opacity-60"
    >
      {/* Outer halo — pulses on listening, glows on speaking */}
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full bg-accent/15"
        animate={
          state === "listening"
            ? { scale: [1, 1.18, 1], opacity: [0.5, 0.15, 0.5] }
            : state === "speaking"
            ? { scale: liveScale * 1.12, opacity: 0.35 }
            : { scale: 1, opacity: 0.18 }
        }
        transition={
          state === "listening"
            ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
            : { type: "spring", stiffness: 200, damping: 20 }
        }
      />

      {/* Thinking ring — a slow rotating dashed retrieval cue */}
      {state === "thinking" && (
        <motion.span
          aria-hidden
          className="absolute inset-4 rounded-full border-2 border-dashed border-warm/70"
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />
      )}

      {/* Core */}
      <motion.span
        aria-hidden
        className={[
          "absolute inset-8 rounded-full shadow-md",
          state === "error"
            ? "bg-destructive"
            : state === "speaking"
            ? "bg-warm"
            : "bg-accent",
        ].join(" ")}
        animate={{ scale: state === "idle" ? [1, 1.04, 1] : liveScale }}
        transition={
          state === "idle"
            ? { duration: 3.2, repeat: Infinity, ease: "easeInOut" }
            : { type: "spring", stiffness: 320, damping: 18 }
        }
      />

      {/* Glyph */}
      <span className="relative z-10 text-surface">
        {state === "speaking" || state === "listening" || state === "thinking" ? (
          <Square className="size-7 fill-current" />
        ) : (
          <Mic className="size-8" />
        )}
      </span>
    </button>
  );
}
