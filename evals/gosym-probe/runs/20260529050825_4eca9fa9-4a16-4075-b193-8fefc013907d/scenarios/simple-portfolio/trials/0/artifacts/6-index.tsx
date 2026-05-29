src/pages/index.tsx [1-30 of 463] (truncated — use startLine/numLines to read remaining)
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion } from 'motion/react';
     3|import { Github, Linkedin, Twitter, Mail, ArrowDown } from 'lucide-react';
     4|
     5|// ─── Dot-grid background SVG pattern ───────────────────────────────────────
     6|function DotGrid() {
     7|  return (
     8|    <svg
     9|      className="absolute inset-0 w-full h-full pointer-events-none"
    10|      xmlns="http://www.w3.org/2000/svg"
    11|    >
    12|      <defs>
    13|        <pattern id="dot-grid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
    14|          <circle cx="1" cy="1" r="1" fill="rgba(0,212,255,0.18)" />
    15|        </pattern>
    16|      </defs>
    17|      <rect width="100%" height="100%" fill="url(#dot-grid)" />
    18|    </svg>
    19|  );
    20|}
    21|
    22|// ─── Decorative corner marks ────────────────────────────────────────────────
    23|function CornerMark({ className }: { className?: string }) {
    24|  return (
    25|    <svg
    26|      width="32"
    27|      height="32"
    28|      viewBox="0 0 32 32"
    29|      fill="none"
    30|      className={className}