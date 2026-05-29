src/pages/products.tsx [1-20 of 171] (truncated — use startLine/numLines to read remaining)
     1|import { useState } from 'react';
     2|import { useLoaderData } from 'react-router-dom';
     3|import { motion, AnimatePresence } from 'motion/react';
     4|import { Helmet } from '@dr.pogodin/react-helmet';
     5|import type { Product } from '@/server/api/products/GET';
     6|
     7|type Category = 'all' | 'pottery' | 'textiles' | 'woodwork' | 'jewelry';
     8|
     9|const filters: { label: string; value: Category }[] = [
    10|  { label: 'All', value: 'all' },
    11|  { label: 'Pottery', value: 'pottery' },
    12|  { label: 'Textiles', value: 'textiles' },
    13|  { label: 'Woodwork', value: 'woodwork' },
    14|  { label: 'Jewelry', value: 'jewelry' },
    15|];
    16|
    17|const categoryColors: Record<string, string> = {
    18|  pottery: 'bg-[#C4622D]/10 text-[#C4622D]',
    19|  textiles: 'bg-[#7A9E7E]/10 text-[#7A9E7E]',
    20|  woodwork: 'bg-[#5C3D2E]/10 text-[#5C3D2E]',