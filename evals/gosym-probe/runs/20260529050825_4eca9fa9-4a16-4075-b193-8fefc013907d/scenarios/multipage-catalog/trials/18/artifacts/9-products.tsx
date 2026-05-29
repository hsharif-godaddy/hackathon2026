src/pages/products.tsx [101 lines]
     1|import { useState } from 'react';
     2|import { useLoaderData } from 'react-router-dom';
     3|import { Helmet } from '@dr.pogodin/react-helmet';
     4|import { motion, AnimatePresence } from 'motion/react';
     5|import ProductCard from '../components/ProductCard';
     6|import type { Product } from '../server/api/products/GET';
     7|
     8|type Category = 'all' | Product['category'];
     9|
    10|const categories: { value: Category; label: string }[] = [
    11|  { value: 'all', label: 'All' },
    12|  { value: 'pottery', label: 'Pottery' },
    13|  { value: 'textiles', label: 'Textiles' },
    14|  { value: 'woodwork', label: 'Woodwork' },
    15|  { value: 'jewelry', label: 'Jewelry' },
    16|];
    17|
    18|export default function ProductsPage() {
    19|  const { products } = useLoaderData() as { products: Product[] };
    20|  const [activeCategory, setActiveCategory] = useState<Category>('all');
    21|
    22|  const filtered = activeCategory === 'all'
    23|    ? products
    24|    : products.filter((p) => p.category === activeCategory);
    25|
    26|  return (
    27|    <>
    28|      <Helmet>
    29|        <title>Shop Handmade Goods — Artisan Goods Co.</title>
    30|        <meta name="description" content="Browse our full collection of handmade pottery, textiles, woodwork, and jewelry. Each piece crafted by skilled artisans." />
    31|      </Helmet>
    32|
    33|      <main>
    34|        {/* Page header */}
    35|        <section className="bg-muted border-b border-border py-14 px-6">
    36|          <div className="container mx-auto">
    37|            <motion.h1
    38|              initial={{ opacity: 0, y: 16 }}
    39|              animate={{ opacity: 1, y: 0 }}
    40|              transition={{ duration: 0.4, ease: 'easeOut' as const }}
    41|              className="font-heading text-4xl md:text-5xl font-bold text-foreground mb-3"
    42|            >
    43|              Our Collection
    44|            </motion.h1>
    45|            <motion.p
    46|              initial={{ opacity: 0, y: 12 }}
    47|              animate={{ opacity: 1, y: 0 }}
    48|              transition={{ duration: 0.4, delay: 0.1, ease: 'easeOut' as const }}
    49|              className="text-muted-foreground text-lg max-w-xl"
    50|            >
    51|              Every piece is made by hand, with intention. Browse by craft or explore everything we make.
    52|            </motion.p>
    53|          </div>
    54|        </section>
    55|
    56|        {/* Filters + Grid */}
    57|        <section className="container mx-auto px-6 lg:px-8 py-12">
    58|          {/* Category filter tabs */}
    59|          <div className="flex flex-wrap gap-2 mb-10" role="tablist" aria-label="Filter by category">
    60|            {categories.map((cat) => (
    61|              <button
    62|                key={cat.value}
    63|                role="tab"
    64|                aria-selected={activeCategory === cat.value}
    65|                onClick={() => setActiveCategory(cat.value)}
    66|                className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
    67|                  activeCategory === cat.value
    68|                    ? 'bg-primary text-primary-foreground shadow-sm'
    69|                    : 'bg-muted text-foreground/70 hover:bg-muted/80 hover:text-foreground'
    70|                }`}
    71|              >
    72|                {cat.label}
    73|              </button>
    74|            ))}
    75|          </div>
    76|
    77|          {/* Product grid */}
    78|          <AnimatePresence mode="wait">
    79|            <motion.div
    80|              key={activeCategory}
    81|              initial={{ opacity: 0 }}
    82|              animate={{ opacity: 1 }}
    83|              exit={{ opacity: 0 }}
    84|              transition={{ duration: 0.2 }}
    85|              className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 lg:gap-6"
    86|            >
    87|              {filtered.map((product, i) => (
    88|                <ProductCard key={product.id} product={product} index={i} />
    89|              ))}
    90|            </motion.div>
    91|          </AnimatePresence>
    92|
    93|          {filtered.length === 0 && (
    94|            <p className="text-center text-muted-foreground py-16">No products found in this category.</p>
    95|          )}
    96|        </section>
    97|      </main>
    98|    </>
    99|  );
   100|}
   101|