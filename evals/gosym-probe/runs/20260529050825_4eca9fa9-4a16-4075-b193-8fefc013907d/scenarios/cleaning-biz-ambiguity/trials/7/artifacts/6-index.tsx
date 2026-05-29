src/pages/index.tsx [1-20 of 358] (truncated — use startLine/numLines to read remaining)
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion } from 'motion/react';
     3|import { Phone, Star, CheckCircle, ArrowRight } from 'lucide-react';
     4|import { Link } from 'react-router-dom';
     5|
     6|// ─── Animation Variants ───────────────────────────────────────────────────────
     7|const fadeUp = {
     8|  hidden: { opacity: 0, y: 28 },
     9|  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
    10|};
    11|
    12|const stagger = {
    13|  hidden: {},
    14|  visible: { transition: { staggerChildren: 0.12 } },
    15|};
    16|
    17|// ─── Data ─────────────────────────────────────────────────────────────────────
    18|const services = [
    19|  {
    20|    title: 'Standard Clean',