"use client";

import { motion } from "framer-motion";
import { Mic, Square, Loader2, AudioLines } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceState } from "@/lib/voice-state";

/**
 * The single most important visual: an orb that *is* the agent's state.
 * Driven entirely by `state` (the machine) plus a live `amplitude` (0–1) read
 * from the SDK's frequency data so it breathes with the actual audio.
 *
 * Each state has a distinct glyph + motion so it's obvious at a glance what the
 * app wants from you:
 *   idle      Mic + slow outward "tap me" ring  → tap to connect
 *   connecting spinner                          → wait
 *   listening AudioLines + sonar ripples        → speak now, it's hearing you
 *   speaking  Stop square, warm + audio-reactive → it's talking; tap to interrupt
 *   thinking  Stop square + rotating dashed ring → retrieving
 *   error     Mic, red                          → tap to retry
 *
 * `compact` shrinks it for the bottom control dock; the full size is kept for
 * any hero placement.
 */
export function VoiceOrb({
  state,
  amplitude,
  onClick,
  disabled,
  compact = false,
}: {
  state: VoiceState;
  amplitude: number; // 0–1, live mic/agent loudness
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const active = state === "speaking" || state === "listening";
  // Live scale only while there's audio to react to; otherwise idle breathing.
  // Capped so the orb breathes (max 1.2×) rather than ballooning at loud peaks.
  // Clamp amplitude to [0,1] and guard against NaN before scaling.
  const amp = Number.isFinite(amplitude) ? Math.min(Math.max(amplitude, 0), 1) : 0;
  const liveScale = 1 + (active ? amp * 0.2 : 0);

  // The audio-reactive scale is re-targeted every animation frame from a noisy
  // mic signal. A spring carries velocity between those re-targets and rings up,
  // overshooting far past 1.2 ("ballooning"). A short tween can't overshoot its
  // target, so the orb stays hard-capped at the 1.2× ceiling while still feeling
  // live. Idle/listening keyframe breathing keeps its own transitions below.
  const liveTransition = { type: "tween", duration: 0.12, ease: "easeOut" } as const;

  const dims = compact
    ? { size: "size-36", core: "inset-5", thinking: "inset-3", mic: "size-6", stop: "size-5" }
    : { size: "size-56", core: "inset-8", thinking: "inset-4", mic: "size-8", stop: "size-7" };

  const isConnected = state === "speaking" || state === "listening" || state === "thinking";
  const ariaLabel =
    state === "connecting"
      ? "Connecting"
      : isConnected
      ? "Stop"
      : "Tap to talk";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || state === "connecting"}
      aria-label={ariaLabel}
      className={cn(
        "relative grid place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/40 disabled:opacity-60",
        dims.size
      )}
    >
      {/* Idle invite — a slow outward ring that says "tap me" without nagging. */}
      {state === "idle" && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full border-2 border-accent/40"
          animate={{ scale: [1, 1.28], opacity: [0.55, 0] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeOut" }}
        />
      )}

      {/* Listening — sonar ripples: an unmistakable "I'm hearing you, go ahead". */}
      {state === "listening" &&
        [0, 0.6, 1.2].map((delay) => (
          <motion.span
            key={delay}
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-accent/50"
            initial={{ scale: 0.85, opacity: 0.6 }}
            animate={{ scale: 1.55, opacity: 0 }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay }}
          />
        ))}

      {/* Outer halo — pulses on listening, glows on speaking */}
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full bg-accent/15"
        animate={
          state === "listening"
            ? { scale: [1, 1.12, 1], opacity: [0.5, 0.2, 0.5] }
            : state === "speaking"
            ? { scale: liveScale, opacity: 0.35 }
            : { scale: 1, opacity: 0.18 }
        }
        transition={
          state === "listening"
            ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
            : liveTransition
        }
      />

      {/* Thinking ring — a slow rotating dashed retrieval cue */}
      {state === "thinking" && (
        <motion.span
          aria-hidden
          className={cn("absolute rounded-full border-2 border-dashed border-warm/70", dims.thinking)}
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />
      )}

      {/* Core */}
      <motion.span
        aria-hidden
        className={cn(
          "absolute rounded-full shadow-md",
          dims.core,
          state === "error"
            ? "bg-destructive"
            : state === "speaking"
            ? "bg-warm"
            : "bg-accent"
        )}
        animate={{ scale: state === "idle" ? [1, 1.04, 1] : liveScale }}
        transition={
          state === "idle"
            ? { duration: 3.2, repeat: Infinity, ease: "easeInOut" }
            : liveTransition
        }
      />

      {/* Glyph — distinct per state so the affordance reads instantly. */}
      <span className="relative z-10 text-surface">
        {state === "connecting" ? (
          <Loader2 className={cn(dims.mic, "animate-spin")} />
        ) : state === "listening" ? (
          <AudioLines className={dims.mic} />
        ) : state === "speaking" || state === "thinking" ? (
          <Square className={cn("fill-current", dims.stop)} />
        ) : (
          <Mic className={dims.mic} />
        )}
      </span>
    </button>
  );
}
