src/pages/products.tsx [1-30 of 221] (truncated — use startLine/numLines to read remaining)
     1|import { useEffect, useState, useCallback } from 'react';
     2|import { Link, useSearchParams } from 'react-router-dom';
     3|import { motion } from 'motion/react';
     4|import { ChevronRight } from 'lucide-react';
     5|import { Helmet } from '@dr.pogodin/react-helmet';
     6|
     7|interface Product {
     8|  id: string;
     9|  name: string;
    10|  category: string;
    11|  price: number;
    12|  image: string;
    13|  description: string;
    14|}
    15|
    16|type Category = 'all' | 'pottery' | 'textiles' | 'woodwork' | 'jewelry';
    17|
    18|const CATEGORIES: { value: Category; label: string }[] = [
    19|  { value: 'all', label: 'All' },
    20|  { value: 'pottery', label: 'Pottery' },
    21|  { value: 'textiles', label: 'Textiles' },
    22|  { value: 'woodwork', label: 'Woodwork' },
    23|  { value: 'jewelry', label: 'Jewelry' },
    24|];
    25|
    26|const categoryColors: Record<string, string> = {
    27|  pottery: 'bg-primary/10 text-primary',
    28|  textiles: 'bg-accent/10 text-accent',
    29|  woodwork: 'bg-secondary/10 text-secondary-foreground',
    30|  jewelry: 'bg-muted text-muted-foreground',