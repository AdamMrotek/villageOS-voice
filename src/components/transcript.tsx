"use client";

import { AnimatePresence, motion } from "framer-motion";

export type Turn = { id: string; role: "user" | "agent"; text: string };

/**
 * A lightweight running transcript. Below the brief's hard cut-line, but cheap
 * and it makes the demo read as a real product.
 */
export function Transcript({ turns }: { turns: Turn[] }) {
  if (turns.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {turns.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={t.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={[
                "max-w-[80%] rounded-lg px-3 py-2 text-body",
                t.role === "user"
                  ? "bg-accent text-accent-foreground"
                  : "bg-surface-alt text-ink",
              ].join(" ")}
            >
              {t.text}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
