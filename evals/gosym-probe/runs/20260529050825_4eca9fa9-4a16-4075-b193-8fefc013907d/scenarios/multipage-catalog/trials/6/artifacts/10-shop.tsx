src/pages/shop.tsx [114 lines]
     1|import { useLoaderData, useSearchParams } from 'react-router-dom';
     2|import { useState, useEffect } from 'react';
     3|import { Helmet } from '@dr.pogodin/react-helmet';
     4|import { motion } from 'motion/react';
     5|import ProductCard from '../components/ProductCard';
     6|import type { Product } from '../server/api/products/GET';
     7|
     8|const CATEGORIES = ['All', 'Pottery', 'Textiles', 'Woodwork', 'Jewelry'] as const;
     9|
    10|export default function ShopPage() {
    11|  const { products } = useLoaderData() as { products: Product[] };
    12|  const [searchParams, setSearchParams] = useSearchParams();
    13|  const initialCategory = searchParams.get('category') ?? 'all';
    14|  const [activeCategory, setActiveCategory] = useState(
    15|    initialCategory === 'all' ? 'All' : initialCategory.charAt(0).toUpperCase() + initialCategory.slice(1)
    16|  );
    17|
    18|  useEffect(() => {
    19|    const cat = searchParams.get('category');
    20|    if (!cat) {
    21|      setActiveCategory('All');
    22|    } else {
    23|      setActiveCategory(cat.charAt(0).toUpperCase() + cat.slice(1));
    24|    }
    25|  }, [searchParams]);
    26|
    27|  const filtered =
    28|    activeCategory === 'All'
    29|      ? products
    30|      : products.filter((p) => p.category === activeCategory.toLowerCase());
    31|
    32|  const handleFilter = (cat: string) => {
    33|    setActiveCategory(cat);
    34|    if (cat === 'All') {
    35|      setSearchParams({});
    36|    } else {
    37|      setSearchParams({ category: cat.toLowerCase() });
    38|    }
    39|  };
    40|
    41|  return (
    42|    <>
    43|      <Helmet>
    44|        <title>Our Collection — Artisan Goods Co.</title>
    45|        <meta
    46|          name="description"
    47|          content="Browse handcrafted pottery, textiles, woodwork, and jewelry. Every piece made with care by skilled artisans."
    48|        />
    49|      </Helmet>
    50|
    51|      {/* Page Header */}
    52|      <section className="bg-muted/50 border-b border-border py-16 px-6">
    53|        <div className="container mx-auto max-w-5xl">
    54|          <motion.div
    55|            initial={{ opacity: 0, y: 16 }}
    56|            animate={{ opacity: 1, y: 0 }}
    57|            transition={{ duration: 0.4, ease: 'easeOut' as const }}
    58|          >
    59|            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">
    60|              Handmade with intention
    61|            </p>
    62|            <h1 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight mb-4">
    63|              Our Collection
    64|            </h1>
    65|            <p className="text-muted-foreground text-lg max-w-xl leading-relaxed">
    66|              Each piece is made by hand, one at a time. Browse our full range of pottery, textiles, woodwork, and jewelry.
    67|            </p>
    68|          </motion.div>
    69|        </div>
    70|      </section>
    71|
    72|      {/* Filters + Grid */}
    73|      <section className="py-12 px-6">
    74|        <div className="container mx-auto max-w-6xl">
    75|          {/* Category Filter Pills */}
    76|          <div className="flex flex-wrap gap-2 mb-10">
    77|            {CATEGORIES.map((cat) => (
    78|              <button
    79|                key={cat}
    80|                onClick={() => handleFilter(cat)}
    81|                className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-150 border ${
    82|                  activeCategory === cat
    83|                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
    84|                    : 'bg-card text-foreground/70 border-border hover:border-primary/50 hover:text-foreground'
    85|                }`}
    86|              >
    87|                {cat}
    88|              </button>
    89|            ))}
    90|          </div>
    91|
    92|          {/* Product Count */}
    93|          <p className="text-sm text-muted-foreground mb-6">
    94|            {filtered.length} {filtered.length === 1 ? 'piece' : 'pieces'} found
    95|          </p>
    96|
    97|          {/* Product Grid */}
    98|          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
    99|            {filtered.map((product, i) => (
   100|              <ProductCard key={product.id} product={product} index={i} />
   101|            ))}
   102|          </div>
   103|
   104|          {filtered.length === 0 && (
   105|            <div className="text-center py-20">
   106|              <p className="text-muted-foreground text-lg">No pieces found in this category.</p>
   107|            </div>
   108|          )}
   109|        </div>
   110|      </section>
   111|    </>
   112|  );
   113|}
   114|