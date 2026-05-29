src/pages/products.tsx [1-20 of 167] (truncated — use startLine/numLines to read remaining)
     1|import { useLoaderData } from 'react-router-dom';
     2|import { useState, useEffect } from 'react';
     3|import { motion, AnimatePresence } from 'motion/react';
     4|import { Helmet } from '@dr.pogodin/react-helmet';
     5|import type { Product } from '../server/api/products/GET';
     6|
     7|export async function loader() {
     8|  const res = await fetch('/api/products');
     9|  if (!res.ok) throw new Response(null, { status: res.status });
    10|  const products: Product[] = await res.json();
    11|  return { products };
    12|}
    13|
    14|type Category = 'all' | 'pottery' | 'textiles' | 'woodwork' | 'jewelry';
    15|
    16|const categories: { value: Category; label: string }[] = [
    17|  { value: 'all', label: 'All' },
    18|  { value: 'pottery', label: 'Pottery' },
    19|  { value: 'textiles', label: 'Textiles' },
    20|  { value: 'woodwork', label: 'Woodwork' },