src/pages/shop.tsx [1-10 of 176] (truncated — use startLine/numLines to read remaining)
     1|import { useState, useRef } from 'react';
     2|import { useLoaderData } from 'react-router-dom';
     3|import { motion, AnimatePresence, useInView } from 'motion/react';
     4|import { Helmet } from '@dr.pogodin/react-helmet';
     5|import { ArrowRight } from 'lucide-react';
     6|
     7|interface Product {
     8|  id: string;
     9|  name: string;
    10|  category: string;