src/pages/index.tsx [1-10 of 329] (truncated — use startLine/numLines to read remaining)
     1|import { Link } from 'react-router-dom';
     2|import { motion } from 'motion/react';
     3|import { Helmet } from '@dr.pogodin/react-helmet';
     4|import { Button } from '@/components/ui/button';
     5|import { ShieldCheck, Leaf, ThumbsUp, Star, ArrowRight, CheckCircle } from 'lucide-react';
     6|
     7|// ─── Animation Variants ───────────────────────────────────────────────────────
     8|
     9|const fadeUp = {
    10|  hidden: { opacity: 0, y: 28 },