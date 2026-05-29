src/pages/index.tsx [1-12 of 238] (truncated — use startLine/numLines to read remaining)
     1|import { useLoaderData, Link } from 'react-router-dom';
     2|import { motion } from 'motion/react';
     3|import { ArrowRight } from 'lucide-react';
     4|import { Helmet } from '@dr.pogodin/react-helmet';
     5|import { useState } from 'react';
     6|import ProductCard, { type Product } from '../components/ProductCard';
     7|
     8|export async function loader() {
     9|  const res = await fetch('/api/products?featured=true');
    10|  if (!res.ok) throw new Response(null, { status: res.status });
    11|  const featured: Product[] = await res.json();
    12|  return { featured };