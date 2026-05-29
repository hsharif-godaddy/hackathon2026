src/pages/index.tsx [1-15 of 323] (truncated — use startLine/numLines to read remaining)
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion, useScroll, useTransform } from 'motion/react';
     3|import { useRef } from 'react';
     4|import { Github, Linkedin, Twitter, Mail, ArrowDown } from 'lucide-react';
     5|
     6|// ─── Accent line that draws in ───────────────────────────────────────────────
     7|function AccentLine({ className = '' }: { className?: string }) {
     8|  return (
     9|    <motion.div
    10|      className={`h-px bg-primary ${className}`}
    11|      initial={{ scaleX: 0, originX: 0 }}
    12|      animate={{ scaleX: 1 }}
    13|      transition={{ duration: 0.8, delay: 0.9, ease: 'easeOut' as const }}
    14|      style={{ transformOrigin: 'left center' }}
    15|    />