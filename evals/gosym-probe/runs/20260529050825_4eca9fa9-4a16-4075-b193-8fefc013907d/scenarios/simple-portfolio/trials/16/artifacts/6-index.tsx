src/pages/index.tsx [291 lines]
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion } from 'motion/react';
     3|import { Github, Linkedin, Twitter } from 'lucide-react';
     4|
     5|// ─── Animation variants ───────────────────────────────────────────────────────
     6|
     7|const fadeUp = {
     8|  hidden: { opacity: 0, y: 24 },
     9|  visible: (delay = 0) => ({
    10|    opacity: 1,
    11|    y: 0,
    12|    transition: { duration: 0.5, ease: 'easeOut' as const, delay },
    13|  }),
    14|};
    15|
    16|const staggerContainer = {
    17|  hidden: {},
    18|  visible: { transition: { staggerChildren: 0.12 } },
    19|};
    20|
    21|const wordFadeUp = {
    22|  hidden: { opacity: 0, y: 32 },
    23|  visible: {
    24|    opacity: 1,
    25|    y: 0,
    26|    transition: { duration: 0.4, ease: 'easeOut' as const },
    27|  },
    28|};
    29|
    30|// ─── Component ────────────────────────────────────────────────────────────────
    31|
    32|export default function HomePage() {
    33|  const nameWords = ['Alex', 'Morgan'];
    34|
    35|  return (
    36|    <>
    37|      <Helmet>
    38|        <title>Alex Morgan — Designer & Developer</title>
    39|        <meta
    40|          name="description"
    41|          content="Alex Morgan is a designer and developer crafting thoughtful digital experiences."
    42|        />
    43|      </Helmet>
    44|
    45|      {/* ── HERO ─────────────────────────────────────────────────────────── */}
    46|      <section className="relative min-h-screen flex flex-col justify-center px-6 md:px-10 pt-20 pb-16 max-w-6xl mx-auto">
    47|        {/* Decorative thin vertical line */}
    48|        <div className="absolute left-6 md:left-10 top-32 bottom-32 w-px bg-border hidden lg:block" />
    49|
    50|        <div className="lg:pl-12">
    51|          {/* Eyebrow */}
    52|          <motion.p
    53|            className="text-sm font-medium tracking-[0.2em] text-primary uppercase mb-8"
    54|            initial="hidden"
    55|            animate="visible"
    56|            custom={0}
    57|            variants={fadeUp}
    58|          >
    59|            Portfolio
    60|          </motion.p>
    61|
    62|          {/* Name — staggered word animation */}
    63|          <motion.h1
    64|            className="font-heading text-[clamp(4rem,14vw,11rem)] font-semibold leading-[0.9] tracking-tight text-foreground mb-8"
    65|            variants={staggerContainer}
    66|            initial="hidden"
    67|            animate="visible"
    68|          >
    69|            {nameWords.map((word) => (
    70|              <motion.span
    71|                key={word}
    72|                className="block"
    73|                variants={wordFadeUp}
    74|              >
    75|                {word}
    76|              </motion.span>
    77|            ))}
    78|          </motion.h1>
    79|
    80|          {/* Tagline */}
    81|          <motion.p
    82|            className="text-lg md:text-xl text-foreground/60 font-light max-w-md leading-relaxed"
    83|            initial="hidden"
    84|            animate="visible"
    85|            custom={0.55}
    86|            variants={fadeUp}
    87|          >
    88|            Designer &amp; Developer crafting thoughtful digital experiences.
    89|          </motion.p>
    90|
    91|          {/* Scroll indicator */}
    92|          <motion.div
    93|            className="mt-16 flex items-center gap-3 text-xs tracking-[0.15em] text-muted-foreground uppercase"
    94|            initial="hidden"
    95|            animate="visible"
    96|            custom={0.75}
    97|            variants={fadeUp}
    98|          >
    99|            <span className="block w-8 h-px bg-border" />
   100|            Scroll
   101|          </motion.div>
   102|        </div>
   103|
   104|        {/* Decorative corner mark */}
   105|        <div className="absolute bottom-16 right-10 hidden md:flex flex-col items-end gap-1 opacity-20">
   106|          <div className="w-12 h-px bg-foreground" />
   107|          <div className="w-6 h-px bg-foreground" />
   108|        </div>
   109|      </section>
   110|
   111|      {/* ── ABOUT ────────────────────────────────────────────────────────── */}
   112|      <section id="about" className="py-24 md:py-32 px-6 md:px-10 max-w-6xl mx-auto">
   113|        {/* Section label */}
   114|        <motion.p
   115|          className="text-xs tracking-[0.2em] text-muted-foreground uppercase mb-12"
   116|          initial="hidden"
   117|          whileInView="visible"
   118|          viewport={{ once: true }}
   119|          custom={0}
   120|          variants={fadeUp}
   121|        >
   122|          01 — About
   123|        </motion.p>
   124|
   125|        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
   126|          {/* Left: bold statement */}
   127|          <motion.div
   128|            className="lg:col-span-4"
   129|            initial="hidden"
   130|            whileInView="visible"
   131|            viewport={{ once: true }}
   132|            custom={0.1}
   133|            variants={fadeUp}
   134|          >
   135|            <h2 className="font-heading text-3xl md:text-4xl font-semibold leading-tight text-foreground">
   136|              Building at the intersection of design and code.
   137|            </h2>
   138|          </motion.div>
   139|
   140|          {/* Right: photo + bio */}
   141|          <motion.div
   142|            className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-10 items-start"
   143|            initial="hidden"
   144|            whileInView="visible"
   145|            viewport={{ once: true }}
   146|            custom={0.2}
   147|            variants={fadeUp}
   148|          >
   149|            {/* Portrait */}
   150|            <div className="relative aspect-[3/4] overflow-hidden bg-muted">
   151|              <img
   152|                src="/airo-assets/images/pages/about/portrait"
   153|                alt="Alex Morgan"
   154|                className="w-full h-full object-cover"
   155|                width={600}
   156|                height={700}
   157|              />
   158|              {/* Thin accent border offset */}
   159|              <div className="absolute -bottom-2 -right-2 w-full h-full border border-primary pointer-events-none" />
   160|            </div>
   161|
   162|            {/* Bio text */}
   163|            <div className="flex flex-col gap-5 text-foreground/70 leading-relaxed text-base">
   164|              <p>
   165|                I'm a multidisciplinary designer and developer with over 6 years of experience
   166|                building products that are both beautiful and functional.
   167|              </p>
   168|              <p>
   169|                My work spans brand identity, interface design, and full-stack development — I
   170|                believe the best digital experiences emerge when design and engineering think
   171|                together from the start.
   172|              </p>
   173|              <p>
   174|                Currently open to freelance projects and full-time opportunities. Based in San
   175|                Francisco, working globally.
   176|              </p>
   177|              <div className="pt-2">
   178|                <a
   179|                  href="#contact"
   180|                  onClick={(e) => {
   181|                    e.preventDefault();
   182|                    document.querySelector('#contact')?.scrollIntoView({ behavior: 'smooth' });
   183|                  }}
   184|                  className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors duration-200 group"
   185|                >
   186|                  Get in touch
   187|                  <span className="block w-6 h-px bg-current transition-all duration-200 group-hover:w-10" />
   188|                </a>
   189|              </div>
   190|            </div>
   191|          </motion.div>
   192|        </div>
   193|      </section>
   194|
   195|      {/* Thin divider */}
   196|      <div className="max-w-6xl mx-auto px-6 md:px-10">
   197|        <div className="h-px bg-border" />
   198|      </div>
   199|
   200|      {/* ── CONTACT ──────────────────────────────────────────────────────── */}
   201|      <section id="contact" className="py-24 md:py-32 px-6 md:px-10 max-w-6xl mx-auto">
   202|        {/* Section label */}
   203|        <motion.p
   204|          className="text-xs tracking-[0.2em] text-muted-foreground uppercase mb-12"
   205|          initial="hidden"
   206|          whileInView="visible"
   207|          viewport={{ once: true }}
   208|          custom={0}
   209|          variants={fadeUp}
   210|        >
   211|          02 — Contact
   212|        </motion.p>
   213|
   214|        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-end">
   215|          {/* Left: heading + email */}
   216|          <motion.div
   217|            className="lg:col-span-7"
   218|            initial="hidden"
   219|            whileInView="visible"
   220|            viewport={{ once: true }}
   221|            custom={0.1}
   222|            variants={fadeUp}
   223|          >
   224|            <h2 className="font-heading text-3xl md:text-5xl font-semibold leading-tight text-foreground mb-10">
   225|              Let's make something great together.
   226|            </h2>
   227|
   228|            <a
   229|              href="mailto:hello@alexmorgan.com"
   230|              className="group inline-flex items-center gap-3 text-xl md:text-2xl font-medium text-foreground hover:text-primary transition-colors duration-200"
   231|            >
   232|              hello@alexmorgan.com
   233|              <span className="block w-0 h-px bg-primary transition-all duration-300 group-hover:w-8 self-end mb-1" />
   234|            </a>
   235|          </motion.div>
   236|
   237|          {/* Right: social icons */}
   238|          <motion.div
   239|            className="lg:col-span-5 flex flex-col gap-6"
   240|            initial="hidden"
   241|            whileInView="visible"
   242|            viewport={{ once: true }}
   243|            custom={0.2}
   244|            variants={fadeUp}
   245|          >
   246|            <p className="text-xs tracking-[0.15em] text-muted-foreground uppercase">
   247|              Find me on
   248|            </p>
   249|            <div className="flex items-center gap-6">
   250|              {[
   251|                {
   252|                  href: 'https://github.com',
   253|                  icon: Github,
   254|                  label: 'GitHub',
   255|                },
   256|                {
   257|                  href: 'https://linkedin.com',
   258|                  icon: Linkedin,
   259|                  label: 'LinkedIn',
   260|                },
   261|                {
   262|                  href: 'https://twitter.com',
   263|                  icon: Twitter,
   264|                  label: 'Twitter / X',
   265|                },
   266|              ].map(({ href, icon: Icon, label }) => (
   267|                <a
   268|                  key={label}
   269|                  href={href}
   270|                  target="_blank"
   271|                  rel="noopener noreferrer"
   272|                  aria-label={label}
   273|                  className="group flex items-center gap-2 text-foreground/50 hover:text-primary transition-all duration-150"
   274|                >
   275|                  <Icon
   276|                    size={22}
   277|                    className="transition-transform duration-150 group-hover:scale-110"
   278|                  />
   279|                  <span className="text-sm text-foreground/40 group-hover:text-primary transition-colors duration-150 hidden sm:inline">
   280|                    {label}
   281|                  </span>
   282|                </a>
   283|              ))}
   284|            </div>
   285|          </motion.div>
   286|        </div>
   287|      </section>
   288|    </>
   289|  );
   290|}
   291|