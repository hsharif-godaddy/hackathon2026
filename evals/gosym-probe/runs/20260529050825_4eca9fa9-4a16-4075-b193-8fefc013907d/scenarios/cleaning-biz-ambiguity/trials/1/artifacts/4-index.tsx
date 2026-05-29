src/pages/index.tsx [1-20 of 472] (truncated — use startLine/numLines to read remaining)
     1|import { Link } from 'react-router-dom';
     2|import { Helmet } from '@dr.pogodin/react-helmet';
     3|import { motion } from 'motion/react';
     4|import { Star, CheckCircle2, Leaf, ShieldCheck, ArrowRight, Phone } from 'lucide-react';
     5|import { Button } from '@/components/ui/button';
     6|
     7|const fadeUp = {
     8|  hidden: { opacity: 0, y: 24 },
     9|  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
    10|};
    11|
    12|const stagger = {
    13|  hidden: {},
    14|  visible: { transition: { staggerChildren: 0.1 } },
    15|};
    16|
    17|// Services data
    18|const services = [
    19|  {
    20|    title: 'Kitchen Deep Clean',