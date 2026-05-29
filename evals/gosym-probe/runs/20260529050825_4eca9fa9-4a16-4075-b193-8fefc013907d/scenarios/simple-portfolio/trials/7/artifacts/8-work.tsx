src/pages/work.tsx [212 lines]
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion, AnimatePresence } from 'motion/react';
     3|import { useState } from 'react';
     4|import { Link } from 'react-router-dom';
     5|
     6|const categories = ['All', 'Brand Identity', 'Typography', 'Packaging', 'Print', 'Art Direction'] as const;
     7|type Category = (typeof categories)[number];
     8|
     9|interface Project {
    10|  id: string;
    11|  title: string;
    12|  client: string;
    13|  year: string;
    14|  category: Exclude<Category, 'All'>;
    15|  slot: string;
    16|  index: number;
    17|}
    18|
    19|const projects: Project[] = [
    20|  {
    21|    id: 'maison-arc',
    22|    title: 'Maison Arc',
    23|    client: 'Maison Arc',
    24|    year: '2024',
    25|    category: 'Brand Identity',
    26|    slot: '/airo-assets/images/portfolio/brand-identity-1',
    27|    index: 1,
    28|  },
    29|  {
    30|    id: 'forma-editorial',
    31|    title: 'Forma Editorial',
    32|    client: 'Forma Magazine',
    33|    year: '2024',
    34|    category: 'Typography',
    35|    slot: '/airo-assets/images/portfolio/typography-2',
    36|    index: 2,
    37|  },
    38|  {
    39|    id: 'sable-skincare',
    40|    title: 'Sable Skincare',
    41|    client: 'Sable',
    42|    year: '2023',
    43|    category: 'Packaging',
    44|    slot: '/airo-assets/images/portfolio/packaging-3',
    45|    index: 3,
    46|  },
    47|  {
    48|    id: 'grove-annual',
    49|    title: 'Grove Annual Report',
    50|    client: 'Grove Collective',
    51|    year: '2023',
    52|    category: 'Print',
    53|    slot: '/airo-assets/images/portfolio/print-4',
    54|    index: 4,
    55|  },
    56|  {
    57|    id: 'lune-campaign',
    58|    title: 'Lune Campaign',
    59|    client: 'Lune Studio',
    60|    year: '2023',
    61|    category: 'Art Direction',
    62|    slot: '/airo-assets/images/portfolio/art-direction-5',
    63|    index: 5,
    64|  },
    65|  {
    66|    id: 'atlas-identity',
    67|    title: 'Atlas Visual System',
    68|    client: 'Atlas Agency',
    69|    year: '2022',
    70|    category: 'Brand Identity',
    71|    slot: '/airo-assets/images/portfolio/visual-system-6',
    72|    index: 6,
    73|  },
    74|];
    75|
    76|const fadeIn = {
    77|  hidden: { opacity: 0, y: 16 },
    78|  visible: (i: number) => ({
    79|    opacity: 1,
    80|    y: 0,
    81|    transition: { duration: 0.45, delay: i * 0.07, ease: 'easeOut' as const },
    82|  }),
    83|};
    84|
    85|export default function WorkPage() {
    86|  const [activeCategory, setActiveCategory] = useState<Category>('All');
    87|
    88|  const filtered =
    89|    activeCategory === 'All'
    90|      ? projects
    91|      : projects.filter((p) => p.category === activeCategory);
    92|
    93|  return (
    94|    <>
    95|      <Helmet>
    96|        <title>Work — Marcus Webb</title>
    97|        <meta
    98|          name="description"
    99|          content="Selected projects by Marcus Webb — brand identities, typography, packaging, print, and art direction."
   100|        />
   101|      </Helmet>
   102|
   103|      <div className="min-h-screen bg-background pt-32 pb-28 px-8 md:px-16">
   104|        <div className="max-w-7xl mx-auto">
   105|
   106|          {/* Page header */}
   107|          <motion.div
   108|            initial={{ opacity: 0, y: 20 }}
   109|            animate={{ opacity: 1, y: 0 }}
   110|            transition={{ duration: 0.5, ease: 'easeOut' as const }}
   111|            className="mb-16 md:mb-20"
   112|          >
   113|            <div className="w-8 h-px bg-accent mb-6" />
   114|            <h1 className="font-heading text-5xl md:text-7xl text-foreground leading-none mb-6">
   115|              Selected Work
   116|            </h1>
   117|            <p className="text-muted-foreground text-base md:text-lg max-w-md">
   118|              A curated collection of projects across brand, print, and visual systems.
   119|            </p>
   120|          </motion.div>
   121|
   122|          {/* Filter bar */}
   123|          <motion.div
   124|            initial={{ opacity: 0 }}
   125|            animate={{ opacity: 1 }}
   126|            transition={{ duration: 0.4, delay: 0.2 }}
   127|            className="flex flex-wrap gap-x-8 gap-y-3 mb-14 border-b border-border pb-8"
   128|          >
   129|            {categories.map((cat) => (
   130|              <button
   131|                key={cat}
   132|                onClick={() => setActiveCategory(cat)}
   133|                className={`text-xs tracking-widest uppercase font-medium transition-colors duration-200 relative group pb-1 ${
   134|                  activeCategory === cat
   135|                    ? 'text-foreground'
   136|                    : 'text-muted-foreground hover:text-foreground'
   137|                }`}
   138|              >
   139|                {cat}
   140|                <span
   141|                  className={`absolute -bottom-0 left-0 h-px bg-accent transition-all duration-300 ease-out ${
   142|                    activeCategory === cat ? 'w-full' : 'w-0 group-hover:w-full'
   143|                  }`}
   144|                />
   145|              </button>
   146|            ))}
   147|          </motion.div>
   148|
   149|          {/* Grid */}
   150|          <motion.div
   151|            layout
   152|            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14"
   153|          >
   154|            <AnimatePresence mode="popLayout">
   155|              {filtered.map((project, i) => (
   156|                <motion.div
   157|                  key={project.id}
   158|                  layout
   159|                  variants={fadeIn}
   160|                  initial="hidden"
   161|                  animate="visible"
   162|                  exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
   163|                  custom={i}
   164|                >
   165|                  <Link to={`/work/${project.id}`} className="group block">
   166|                    {/* Image */}
   167|                    <div className="relative overflow-hidden bg-muted aspect-[4/3] mb-5">
   168|                      <img
   169|                        src={project.slot}
   170|                        alt={project.title}
   171|                        className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
   172|                      />
   173|                      {/* Hover overlay */}
   174|                      <div className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/10 transition-colors duration-400" />
   175|                      {/* Category badge */}
   176|                      <div className="absolute top-4 left-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
   177|                        <span className="text-xs tracking-widest uppercase bg-background/90 text-foreground px-3 py-1.5">
   178|                          {project.category}
   179|                        </span>
   180|                      </div>
   181|                    </div>
   182|
   183|                    {/* Meta */}
   184|                    <div className="flex items-start justify-between">
   185|                      <div>
   186|                        <h2 className="font-heading text-xl text-foreground leading-tight mb-1 group-hover:text-accent transition-colors duration-200">
   187|                          {project.title}
   188|                        </h2>
   189|                        <p className="text-sm text-muted-foreground">{project.client}</p>
   190|                      </div>
   191|                      <span className="text-xs text-muted-foreground mt-1 shrink-0 ml-4">
   192|                        {project.year}
   193|                      </span>
   194|                    </div>
   195|                  </Link>
   196|                </motion.div>
   197|              ))}
   198|            </AnimatePresence>
   199|          </motion.div>
   200|
   201|          {/* Empty state */}
   202|          {filtered.length === 0 && (
   203|            <div className="py-24 text-center text-muted-foreground text-sm tracking-widest uppercase">
   204|              No projects in this category yet.
   205|            </div>
   206|          )}
   207|        </div>
   208|      </div>
   209|    </>
   210|  );
   211|}
   212|