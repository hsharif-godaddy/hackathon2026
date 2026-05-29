src/pages/index.tsx [1-20 of 353] (truncated — use startLine/numLines to read remaining)
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion } from 'motion/react';
     3|import { Phone, Star, CheckCircle, ArrowRight } from 'lucide-react';
     4|import { Link } from 'react-router-dom';
     5|
     6|const fadeUp = {
     7|  hidden: { opacity: 0, y: 28 },
     8|  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' as const } },
     9|};
    10|
    11|const stagger = {
    12|  hidden: {},
    13|  visible: { transition: { staggerChildren: 0.12 } },
    14|};
    15|
    16|const services = [
    17|  {
    18|    title: 'Regular Cleaning',
    19|    description:
    20|      'Keep your home consistently fresh with our recurring cleaning service. We handle dusting, vacuuming, mopping, kitchen surfaces, and bathrooms — so you can come home to a space that feels like a deep breath.',