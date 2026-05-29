src/pages/index.tsx [1-20 of 374] (truncated — use startLine/numLines to read remaining)
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion } from 'motion/react';
     3|import { Link } from 'react-router-dom';
     4|import { ShieldCheck, Leaf, Star, ArrowRight, Phone } from 'lucide-react';
     5|
     6|const fadeInUp = {
     7|  hidden: { opacity: 0, y: 28 },
     8|  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
     9|};
    10|
    11|const stagger = {
    12|  hidden: {},
    13|  visible: { transition: { staggerChildren: 0.12 } },
    14|};
    15|
    16|const testimonials = [
    17|  {
    18|    name: 'Sarah M.',
    19|    quote: 'My home has never looked this good. I come home to a spotless house every week — it's such a relief.',
    20|    rating: 5,