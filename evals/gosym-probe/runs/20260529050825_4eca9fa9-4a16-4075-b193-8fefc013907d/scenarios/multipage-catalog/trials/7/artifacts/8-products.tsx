src/pages/products.tsx [1-30 of 211] (truncated — use startLine/numLines to read remaining)
     1|import { useLoaderData, useSearchParams, Link } from 'react-router-dom';
     2|import { useState, useEffect } from 'react';
     3|import { motion } from 'motion/react';
     4|import { Helmet } from '@dr.pogodin/react-helmet';
     5|import { SlidersHorizontal } from 'lucide-react';
     6|import ProductCard from '../components/ProductCard';
     7|import type { Product } from '../server/api/products/GET';
     8|
     9|type Category = 'all' | 'pottery' | 'textiles' | 'woodwork' | 'jewelry';
    10|
    11|const CATEGORIES: { value: Category; label: string }[] = [
    12|  { value: 'all', label: 'All' },
    13|  { value: 'pottery', label: 'Pottery' },
    14|  { value: 'textiles', label: 'Textiles' },
    15|  { value: 'woodwork', label: 'Woodwork' },
    16|  { value: 'jewelry', label: 'Jewelry' },
    17|];
    18|
    19|interface LoaderData {
    20|  products: Product[];
    21|  initialCategory: string;
    22|}
    23|
    24|export async function productsLoader({ request }: { request: Request }): Promise<LoaderData> {
    25|  const url = new URL(request.url);
    26|  const category = url.searchParams.get('category') ?? '';
    27|  const apiUrl = category
    28|    ? `/api/products?category=${encodeURIComponent(category)}`
    29|    : '/api/products';
    30|  const res = await fetch(apiUrl);