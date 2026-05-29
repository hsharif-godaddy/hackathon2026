src/pages/products.tsx [1-15 of 201] (truncated — use startLine/numLines to read remaining)
     1|import { useState } from 'react';
     2|import { useLoaderData } from 'react-router-dom';
     3|import { motion, AnimatePresence } from 'motion/react';
     4|import { ShoppingBag } from 'lucide-react';
     5|import { Helmet } from '@dr.pogodin/react-helmet';
     6|
     7|interface Product {
     8|  id: string;
     9|  name: string;
    10|  category: 'pottery' | 'textiles' | 'woodwork' | 'jewelry';
    11|  price: number;
    12|  description: string;
    13|  imageUrl: string;
    14|}
    15|