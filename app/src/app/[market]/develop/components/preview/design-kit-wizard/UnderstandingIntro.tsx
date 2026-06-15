'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { JSX } from 'react';
import text from '@ux/text';

/**
 * Step-1 "Understanding" intro.
 *
 * A calm, animated invitation telling the user Airo will ask a few questions in
 * the chat, then start assembling their brand kit. The "Coming up" row mirrors
 * the pieces step 2 actually assembles (kept in sync with `AssemblingKit`).
 * Same width + Airo-purple wash as the step-2 card so the two steps feel like
 * one flow. Chrome is Airo-branded via the `--color-ai` token, not the user's
 * generated brand colour.
 */

const AIRO = 'var(--color-ai)';

// Mirrors every row AssemblingKit fills in step 2 (Design kit, Color, Fonts,
// Logo, Imagery, Voice, Summary) so the teaser matches what gets built. Keep in
// sync with the `assets` list in AssemblingKit.tsx.
const COMING_UP = ['Design kit', 'Color', 'Fonts', 'Logo', 'Imagery', 'Voice', 'Summary'];

export function UnderstandingIntro(): JSX.Element {
  const reduce = useReducedMotion();

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
  };
  const item = {
    hidden: reduce ? {} : { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 320, damping: 26 } },
  };

  return (
    <motion.div
      data-testid="design-kit-understanding"
      variants={container}
      initial="hidden"
      animate="show"
      className="relative mx-auto flex w-full max-w-5xl flex-col items-center overflow-hidden rounded-2xl px-8 py-12 text-center"
      style={{
        backgroundImage:
          'radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--color-ai) 12%, transparent), transparent 65%)',
      }}
    >
      <motion.div variants={item}>
        <text.h2 as="heading" size={1}>
          Let&rsquo;s design your brand
        </text.h2>
      </motion.div>

      <motion.div variants={item} className="mt-3 max-w-lg">
        <text.p emphasis="passive">
          Answer a few quick questions in the chat — your idea, who it&rsquo;s for, and the vibe
          you&rsquo;re after. The moment we&rsquo;ve got the essentials, I&rsquo;ll start assembling
          your kit.
        </text.p>
      </motion.div>

      {/* What's coming — mirrors the step-2 assembly pieces */}
      <motion.div variants={item} className="mt-8 flex flex-col items-center gap-2.5">
        <text.span as="caption" emphasis="passive" className="uppercase tracking-[0.18em]">
          Coming up
        </text.span>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {COMING_UP.map((label, i) => (
            <motion.span
              key={label}
              animate={reduce ? undefined : { opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.3, ease: 'easeInOut' }}
              className="rounded-full border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-2.5 py-1"
            >
              <text.span as="caption">{label}</text.span>
            </motion.span>
          ))}
        </div>
      </motion.div>

      {/* Nudge toward the chat */}
      <motion.div
        variants={item}
        className="mt-9 flex items-center gap-2 text-sm font-medium"
        style={{ color: AIRO }}
      >
        <motion.span
          aria-hidden
          animate={reduce ? undefined : { x: [0, -5, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          ←
        </motion.span>
        Answer in the chat to begin
      </motion.div>
    </motion.div>
  );
}
