src/pages/contact.tsx [1-30 of 281] (truncated — use startLine/numLines to read remaining)
     1|import { motion } from 'motion/react';
     2|import { useState } from 'react';
     3|import { Button } from '@/components/ui/button';
     4|import { Input } from '@/components/ui/input';
     5|import { Textarea } from '@/components/ui/textarea';
     6|import { Label } from '@/components/ui/label';
     7|import { Phone, Mail, MapPin, Clock, CheckCircle2 } from 'lucide-react';
     8|import { Helmet } from '@dr.pogodin/react-helmet';
     9|
    10|const fadeUp = {
    11|  hidden: { opacity: 0, y: 24 },
    12|  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
    13|};
    14|
    15|const stagger = {
    16|  hidden: {},
    17|  visible: { transition: { staggerChildren: 0.1 } },
    18|};
    19|
    20|const services = [
    21|  'Regular Cleaning',
    22|  'Deep Cleaning',
    23|  'Move-In / Move-Out',
    24|  'Not sure yet',
    25|];
    26|
    27|export default function ContactPage() {
    28|  const [submitted, setSubmitted] = useState(false);
    29|  const [loading, setLoading] = useState(false);
    30|  const [form, setForm] = useState({