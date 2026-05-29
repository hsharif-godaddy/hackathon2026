src/pages/products.tsx [134 lines]
     1|import { useLoaderData, useSearchParams } from 'react-router-dom';
     2|import { Helmet } from '@dr.pogodin/react-helmet';
     3|import { motion, AnimatePresence } from 'motion/react';
     4|import ProductCard, { type Product } from '../components/ProductCard';
     5|
     6|export async function loader() {
     7|  const res = await fetch('/api/products');
     8|  if (!res.ok) throw new Response(null, { status: res.status });
     9|  const products: Product[] = await res.json();
    10|  return { products };
    11|}
    12|
    13|const CATEGORIES = [
    14|  { value: 'all', label: 'All' },
    15|  { value: 'pottery', label: 'Pottery' },
    16|  { value: 'textiles', label: 'Textiles' },
    17|  { value: 'woodwork', label: 'Woodwork' },
    18|  { value: 'jewelry', label: 'Jewelry' },
    19|];
    20|
    21|export default function ProductsPage() {
    22|  const { products } = useLoaderData() as { products: Product[] };
    23|  const [searchParams, setSearchParams] = useSearchParams();
    24|  const activeCategory = searchParams.get('category') ?? 'all';
    25|
    26|  const filtered =
    27|    activeCategory === 'all'
    28|      ? products
    29|      : products.filter((p) => p.category === activeCategory);
    30|
    31|  const handleCategory = (cat: string) => {
    32|    if (cat === 'all') {
    33|      setSearchParams({});
    34|    } else {
    35|      setSearchParams({ category: cat });
    36|    }
    37|  };
    38|
    39|  return (
    40|    <>
    41|      <Helmet>
    42|        <title>Shop — Artisan Goods Co.</title>
    43|        <meta
    44|          name="description"
    45|          content="Browse handmade pottery, textiles, woodwork, and jewelry from independent artisans. Filter by category and find your perfect piece."
    46|        />
    47|      </Helmet>
    48|
    49|      {/* Page Header */}
    50|      <section className="py-16 bg-muted border-b border-border" aria-label="Shop header">
    51|        <div className="container mx-auto px-6 lg:px-8">
    52|          <motion.div
    53|            initial={{ opacity: 0, y: 16 }}
    54|            animate={{ opacity: 1, y: 0 }}
    55|            transition={{ duration: 0.5, ease: 'easeOut' as const }}
    56|          >
    57|            <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-2">
    58|              Our Collection
    59|            </p>
    60|            <h1
    61|              className="text-4xl md:text-5xl font-bold text-foreground"
    62|              style={{ fontFamily: 'var(--font-heading)' }}
    63|            >
    64|              Shop All Goods
    65|            </h1>
    66|            <p className="text-muted-foreground mt-3 max-w-xl">
    67|              Every piece is handmade by an independent artisan. Browse by category or explore the full collection.
    68|            </p>
    69|          </motion.div>
    70|        </div>
    71|      </section>
    72|
    73|      {/* Category Filters */}
    74|      <section className="sticky top-20 md:top-24 z-40 bg-background border-b border-border py-4 shadow-sm">
    75|        <div className="container mx-auto px-6 lg:px-8">
    76|          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide" role="tablist" aria-label="Filter by category">
    77|            {CATEGORIES.map((cat) => {
    78|              const isActive = activeCategory === cat.value;
    79|              return (
    80|                <button
    81|                  key={cat.value}
    82|                  role="tab"
    83|                  aria-selected={isActive}
    84|                  onClick={() => handleCategory(cat.value)}
    85|                  className={`shrink-0 px-5 py-2 text-sm font-medium rounded-full border transition-all duration-200 ${
    86|                    isActive
    87|                      ? 'bg-primary text-primary-foreground border-primary'
    88|                      : 'bg-background text-foreground border-border hover:border-primary hover:text-primary'
    89|                  }`}
    90|                >
    91|                  {cat.label}
    92|                </button>
    93|              );
    94|            })}
    95|          </div>
    96|        </div>
    97|      </section>
    98|
    99|      {/* Product Grid */}
   100|      <section className="py-14 bg-background" aria-label="Products">
   101|        <div className="container mx-auto px-6 lg:px-8">
   102|          <p className="text-sm text-muted-foreground mb-8">
   103|            {filtered.length} {filtered.length === 1 ? 'piece' : 'pieces'}{' '}
   104|            {activeCategory !== 'all' && (
   105|              <span className="capitalize">in {activeCategory}</span>
   106|            )}
   107|          </p>
   108|
   109|          <AnimatePresence mode="wait">
   110|            <motion.div
   111|              key={activeCategory}
   112|              initial={{ opacity: 0 }}
   113|              animate={{ opacity: 1 }}
   114|              exit={{ opacity: 0 }}
   115|              transition={{ duration: 0.25 }}
   116|              className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 lg:gap-6"
   117|            >
   118|              {filtered.map((product, i) => (
   119|                <ProductCard key={product.id} product={product} index={i} />
   120|              ))}
   121|            </motion.div>
   122|          </AnimatePresence>
   123|
   124|          {filtered.length === 0 && (
   125|            <div className="text-center py-20">
   126|              <p className="text-muted-foreground">No pieces found in this category.</p>
   127|            </div>
   128|          )}
   129|        </div>
   130|      </section>
   131|    </>
   132|  );
   133|}
   134|