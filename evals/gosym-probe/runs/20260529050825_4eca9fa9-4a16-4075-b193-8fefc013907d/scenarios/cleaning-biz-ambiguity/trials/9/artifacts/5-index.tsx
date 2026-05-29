src/pages/index.tsx [320 lines]
     1|import { motion } from 'motion/react';
     2|import { Link } from 'react-router-dom';
     3|import { Star, Phone } from 'lucide-react';
     4|import { Helmet } from '@dr.pogodin/react-helmet';
     5|
     6|const fadeUp = {
     7|  hidden: { opacity: 0, y: 24 },
     8|  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
     9|} as const;
    10|
    11|const stagger = {
    12|  hidden: {},
    13|  visible: { transition: { staggerChildren: 0.12 } },
    14|} as const;
    15|
    16|const services = [
    17|  {
    18|    title: 'Standard Clean',
    19|    description:
    20|      'A thorough top-to-bottom clean of your home — kitchens, bathrooms, living areas, and bedrooms. Perfect for regular upkeep.',
    21|    image: '/airo-assets/images/pages/home/service-standard-clean',
    22|    tag: 'Most Popular',
    23|  },
    24|  {
    25|    title: 'Deep Clean',
    26|    description:
    27|      'A detailed, intensive clean that reaches every corner — baseboards, inside appliances, grout, and more. Ideal for a fresh start.',
    28|    image: '/airo-assets/images/pages/home/service-deep-clean',
    29|    tag: 'Recommended First Visit',
    30|  },
    31|  {
    32|    title: 'Move-In / Move-Out',
    33|    description:
    34|      'Get your home spotless before moving in or leaving. We handle the scrubbing so you can focus on the move.',
    35|    image: '/airo-assets/images/pages/home/service-standard-clean',
    36|    tag: null,
    37|  },
    38|  {
    39|    title: 'Recurring Service',
    40|    description:
    41|      'Weekly, bi-weekly, or monthly visits to keep your home consistently clean. Set it and forget it.',
    42|    image: '/airo-assets/images/pages/home/service-deep-clean',
    43|    tag: 'Save with a Plan',
    44|  },
    45|];
    46|
    47|const testimonials = [
    48|  {
    49|    name: 'Sarah M.',
    50|    rating: 5,
    51|    text: 'My house has never looked this clean. She pays attention to every little detail and is so easy to work with. Highly recommend!',
    52|  },
    53|  {
    54|    name: 'James T.',
    55|    rating: 5,
    56|    text: 'Booked a deep clean before a family visit and was blown away. The bathroom and kitchen were absolutely spotless.',
    57|  },
    58|  {
    59|    name: 'Priya K.',
    60|    rating: 5,
    61|    text: 'I've tried a few cleaning services and Sparkle Clean is by far the best. Reliable, thorough, and genuinely cares about the work.',
    62|  },
    63|];
    64|
    65|export default function HomePage() {
    66|  return (
    67|    <>
    68|      <Helmet>
    69|        <title>Sparkle Clean — Professional House Cleaning</title>
    70|        <meta
    71|          name="description"
    72|          content="Reliable, personal house cleaning services. A spotless home, every time. Get a free quote today."
    73|        />
    74|      </Helmet>
    75|
    76|      {/* ── HERO ── */}
    77|      <section className="relative min-h-[90vh] flex items-center overflow-hidden">
    78|        {/* Background image */}
    79|        <div className="absolute inset-0">
    80|          <img
    81|            src="/airo-assets/images/pages/home/hero"
    82|            alt="Clean bright kitchen interior"
    83|            className="w-full h-full object-cover"
    84|            fetchPriority="high"
    85|          />
    86|          <div className="absolute inset-0 bg-gradient-to-r from-gray-900/70 via-gray-900/40 to-transparent" />
    87|        </div>
    88|
    89|        {/* Content */}
    90|        <div className="relative z-10 max-w-6xl mx-auto px-6 py-24">
    91|          <motion.div
    92|            variants={stagger}
    93|            initial="hidden"
    94|            animate="visible"
    95|            className="max-w-xl"
    96|          >
    97|            <motion.p
    98|              variants={fadeUp}
    99|              className="text-primary font-semibold text-sm uppercase tracking-widest mb-4"
   100|            >
   101|              Residential Cleaning Services
   102|            </motion.p>
   103|            <motion.h1
   104|              variants={fadeUp}
   105|              className="font-heading text-5xl md:text-6xl lg:text-7xl font-bold text-white leading-tight mb-6"
   106|            >
   107|              A spotless home,{' '}
   108|              <span className="text-primary">every time.</span>
   109|            </motion.h1>
   110|            <motion.p
   111|              variants={fadeUp}
   112|              className="text-white/80 text-lg leading-relaxed mb-8"
   113|            >
   114|              Professional, personal house cleaning you can count on. I bring the care and attention your home deserves — so you can enjoy it.
   115|            </motion.p>
   116|            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4">
   117|              <Link
   118|                to="/contact"
   119|                className="bg-primary text-primary-foreground font-semibold px-8 py-4 rounded-full text-center transition-all duration-200 hover:opacity-90 hover:shadow-lg hover:-translate-y-0.5"
   120|              >
   121|                Get a Free Quote
   122|              </Link>
   123|              <a
   124|                href="tel:+15550000000"
   125|                className="flex items-center justify-center gap-2 bg-white/15 backdrop-blur-sm text-white font-semibold px-8 py-4 rounded-full border border-white/30 transition-all duration-200 hover:bg-white/25"
   126|              >
   127|                <Phone size={16} />
   128|                (555) 000-0000
   129|              </a>
   130|            </motion.div>
   131|          </motion.div>
   132|        </div>
   133|      </section>
   134|
   135|      {/* ── SERVICES ── */}
   136|      <section className="py-24 bg-background">
   137|        <div className="max-w-6xl mx-auto px-6">
   138|          <motion.div
   139|            variants={stagger}
   140|            initial="hidden"
   141|            whileInView="visible"
   142|            viewport={{ once: true }}
   143|            className="mb-14"
   144|          >
   145|            <motion.p
   146|              variants={fadeUp}
   147|              className="text-primary font-semibold text-sm uppercase tracking-widest mb-3"
   148|            >
   149|              What I Offer
   150|            </motion.p>
   151|            <motion.h2
   152|              variants={fadeUp}
   153|              className="font-heading text-4xl md:text-5xl font-bold text-foreground"
   154|            >
   155|              Services built around your home
   156|            </motion.h2>
   157|          </motion.div>
   158|
   159|          {/* Staggered two-column grid */}
   160|          <motion.div
   161|            variants={stagger}
   162|            initial="hidden"
   163|            whileInView="visible"
   164|            viewport={{ once: true }}
   165|            className="grid grid-cols-1 md:grid-cols-2 gap-6"
   166|          >
   167|            {services.map((service, i) => (
   168|              <motion.div
   169|                key={service.title}
   170|                variants={fadeUp}
   171|                className={`group relative overflow-hidden rounded-2xl bg-card border border-border/40 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 ${
   172|                  i % 2 === 1 ? 'md:mt-8' : ''
   173|                }`}
   174|              >
   175|                <div className="h-48 overflow-hidden">
   176|                  <img
   177|                    src={service.image}
   178|                    alt={service.title}
   179|                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
   180|                  />
   181|                </div>
   182|                <div className="p-6">
   183|                  <div className="flex items-start justify-between gap-3 mb-2">
   184|                    <h3 className="font-heading text-xl font-bold text-foreground">{service.title}</h3>
   185|                    {service.tag && (
   186|                      <span className="shrink-0 text-xs font-semibold bg-primary/10 text-primary px-3 py-1 rounded-full">
   187|                        {service.tag}
   188|                      </span>
   189|                    )}
   190|                  </div>
   191|                  <p className="text-muted-foreground text-sm leading-relaxed">{service.description}</p>
   192|                </div>
   193|              </motion.div>
   194|            ))}
   195|          </motion.div>
   196|        </div>
   197|      </section>
   198|
   199|      {/* ── TESTIMONIALS ── */}
   200|      <section className="py-24 bg-muted">
   201|        <div className="max-w-6xl mx-auto px-6">
   202|          <motion.div
   203|            variants={stagger}
   204|            initial="hidden"
   205|            whileInView="visible"
   206|            viewport={{ once: true }}
   207|            className="mb-14 text-center"
   208|          >
   209|            <motion.p
   210|              variants={fadeUp}
   211|              className="text-primary font-semibold text-sm uppercase tracking-widest mb-3"
   212|            >
   213|              Happy Customers
   214|            </motion.p>
   215|            <motion.h2
   216|              variants={fadeUp}
   217|              className="font-heading text-4xl md:text-5xl font-bold text-foreground"
   218|            >
   219|              What my clients say
   220|            </motion.h2>
   221|          </motion.div>
   222|
   223|          <motion.div
   224|            variants={stagger}
   225|            initial="hidden"
   226|            whileInView="visible"
   227|            viewport={{ once: true }}
   228|            className="grid grid-cols-1 md:grid-cols-3 gap-6"
   229|          >
   230|            {testimonials.map((t) => (
   231|              <motion.div
   232|                key={t.name}
   233|                variants={fadeUp}
   234|                className="bg-background rounded-2xl p-7 border border-border/40 shadow-sm"
   235|              >
   236|                <div className="flex gap-0.5 mb-4">
   237|                  {Array.from({ length: t.rating }).map((_, i) => (
   238|                    <Star key={i} size={16} className="fill-primary text-primary" />
   239|                  ))}
   240|                </div>
   241|                <p className="text-foreground/80 text-sm leading-relaxed mb-5 italic">"{t.text}"</p>
   242|                <p className="text-sm font-semibold text-foreground">{t.name}</p>
   243|              </motion.div>
   244|            ))}
   245|          </motion.div>
   246|        </div>
   247|      </section>
   248|
   249|      {/* ── CTA ── */}
   250|      <section className="py-24 bg-background overflow-hidden">
   251|        <div className="max-w-6xl mx-auto px-6">
   252|          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
   253|            {/* Text side */}
   254|            <motion.div
   255|              variants={stagger}
   256|              initial="hidden"
   257|              whileInView="visible"
   258|              viewport={{ once: true }}
   259|            >
   260|              <motion.p
   261|                variants={fadeUp}
   262|                className="text-primary font-semibold text-sm uppercase tracking-widest mb-3"
   263|              >
   264|                Ready to Get Started?
   265|              </motion.p>
   266|              <motion.h2
   267|                variants={fadeUp}
   268|                className="font-heading text-4xl md:text-5xl font-bold text-foreground mb-5"
   269|              >
   270|                Ready for a cleaner home?
   271|              </motion.h2>
   272|              <motion.p
   273|                variants={fadeUp}
   274|                className="text-muted-foreground text-lg leading-relaxed mb-8"
   275|              >
   276|                Getting started is easy. Reach out for a free, no-obligation quote and I'll get your home sparkling in no time.
   277|              </motion.p>
   278|              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4">
   279|                <Link
   280|                  to="/contact"
   281|                  className="bg-primary text-primary-foreground font-semibold px-8 py-4 rounded-full text-center transition-all duration-200 hover:opacity-90 hover:shadow-lg hover:-translate-y-0.5"
   282|                >
   283|                  Request a Free Quote
   284|                </Link>
   285|                <a
   286|                  href="tel:+15550000000"
   287|                  className="flex items-center justify-center gap-2 border border-primary text-primary font-semibold px-8 py-4 rounded-full transition-all duration-200 hover:bg-primary/5"
   288|                >
   289|                  <Phone size={16} />
   290|                  Call Now
   291|                </a>
   292|              </motion.div>
   293|            </motion.div>
   294|
   295|            {/* Photo side */}
   296|            <motion.div
   297|              initial={{ opacity: 0, x: 40 }}
   298|              whileInView={{ opacity: 1, x: 0 }}
   299|              viewport={{ once: true }}
   300|              transition={{ duration: 0.5, ease: 'easeOut' as const }}
   301|              className="relative"
   302|            >
   303|              <div className="rounded-3xl overflow-hidden shadow-2xl aspect-[4/5]">
   304|                <img
   305|                  src="/airo-assets/images/pages/home/cta-photo"
   306|                  alt="Clean bright living room"
   307|                  className="w-full h-full object-cover"
   308|                />
   309|              </div>
   310|              {/* Decorative accent */}
   311|              <div className="absolute -bottom-6 -left-6 w-32 h-32 rounded-full bg-primary/15 -z-10" />
   312|              <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-secondary/20 -z-10" />
   313|            </motion.div>
   314|          </div>
   315|        </div>
   316|      </section>
   317|    </>
   318|  );
   319|}
   320|