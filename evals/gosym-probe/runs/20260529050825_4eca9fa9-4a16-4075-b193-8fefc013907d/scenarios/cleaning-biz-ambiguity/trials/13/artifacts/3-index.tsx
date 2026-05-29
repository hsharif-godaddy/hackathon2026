src/pages/index.tsx [1-20 of 379] (truncated — use startLine/numLines to read remaining)
     1|import { Link } from 'react-router-dom';
     2|import { motion } from 'motion/react';
     3|import { Helmet } from '@dr.pogodin/react-helmet';
     4|import { Star, Phone, ShieldCheck, Leaf, BadgeCheck, ArrowRight, Sparkles } from 'lucide-react';
     5|import { Button } from '@/components/ui/button';
     6|
     7|// ─── Animation helpers ────────────────────────────────────────────────────────
     8|const fadeUp = {
     9|  hidden: { opacity: 0, y: 28 },
    10|  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
    11|};
    12|
    13|const stagger = {
    14|  hidden: {},
    15|  visible: { transition: { staggerChildren: 0.12 } },
    16|};
    17|
    18|// ─── Data ─────────────────────────────────────────────────────────────────────
    19|const services = [
    20|  {