src/pages/catalog.tsx [1-20 of 274] (truncated — use startLine/numLines to read remaining)
     1|import { useState, useEffect } from 'react';
     2|import { useLoaderData, useSearchParams, Link } from 'react-router-dom';
     3|import { Helmet } from '@dr.pogodin/react-helmet';
     4|import { motion, AnimatePresence } from 'motion/react';
     5|
     6|export interface Product {
     7|  id: string;
     8|  name: string;
     9|  category: 'pottery' | 'textiles' | 'woodwork' | 'jewelry';
    10|  price: number;
    11|  image: string;
    12|  featured: boolean;
    13|  description: string;
    14|}
    15|
    16|export async function catalogLoader(): Promise<{ products: Product[] }> {
    17|  const res = await fetch('/api/products');
    18|  if (!res.ok) throw new Response(null, { status: res.status });
    19|  const products: Product[] = await res.json();
    20|  return { products };