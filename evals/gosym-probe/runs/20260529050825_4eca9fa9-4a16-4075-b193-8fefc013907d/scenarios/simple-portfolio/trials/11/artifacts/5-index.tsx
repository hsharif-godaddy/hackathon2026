src/pages/index.tsx [280 lines]
     1|import { motion } from 'motion/react';
     2|import { Github, Linkedin, Twitter, Dribbble, ArrowDown } from 'lucide-react';
     3|import { Helmet } from '@dr.pogodin/react-helmet';
     4|
     5|// ─── Animation Variants ───────────────────────────────────────────────────────
     6|
     7|const fadeUp = {
     8|  hidden: { opacity: 0, y: 32 },
     9|  visible: { opacity: 1, y: 0 },
    10|} as const;
    11|
    12|const fadeIn = {
    13|  hidden: { opacity: 0 },
    14|  visible: { opacity: 1 },
    15|} as const;
    16|
    17|// ─── Social Links ─────────────────────────────────────────────────────────────
    18|
    19|const socials = [
    20|  { label: 'GitHub', href: 'https://github.com', Icon: Github },
    21|  { label: 'LinkedIn', href: 'https://linkedin.com', Icon: Linkedin },
    22|  { label: 'Twitter / X', href: 'https://twitter.com', Icon: Twitter },
    23|  { label: 'Dribbble', href: 'https://dribbble.com', Icon: Dribbble },
    24|];
    25|
    26|// ─── Page ─────────────────────────────────────────────────────────────────────
    27|
    28|export default function HomePage() {
    29|  return (
    30|    <>
    31|      <Helmet>
    32|        <title>Alex Morgan — Designer & Developer</title>
    33|        <meta
    34|          name="description"
    35|          content="Personal portfolio of Alex Morgan, a designer and developer crafting thoughtful digital experiences."
    36|        />
    37|      </Helmet>
    38|
    39|      {/* ── HERO ─────────────────────────────────────────────────────────── */}
    40|      <section
    41|        id="top"
    42|        className="relative min-h-screen flex flex-col justify-center overflow-hidden bg-background"
    43|      >
    44|        {/* Decorative oversized initial — background layer */}
    45|        <div
    46|          aria-hidden="true"
    47|          className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 select-none leading-none font-serif text-[28vw] font-bold text-foreground/[0.03] pr-4 md:pr-8"
    48|          style={{ fontFamily: 'var(--font-heading)' }}
    49|        >
    50|          AM
    51|        </div>
    52|
    53|        {/* Thin vertical accent line */}
    54|        <div
    55|          aria-hidden="true"
    56|          className="pointer-events-none absolute left-6 md:left-12 top-1/4 bottom-1/4 w-px bg-primary/30"
    57|        />
    58|
    59|        <div className="relative max-w-6xl mx-auto px-6 md:px-12 pt-32 pb-24">
    60|          {/* Label */}
    61|          <motion.p
    62|            variants={fadeIn}
    63|            initial="hidden"
    64|            animate="visible"
    65|            transition={{ duration: 0.4, ease: 'easeOut' }}
    66|            className="text-xs tracking-[0.3em] uppercase text-primary mb-8"
    67|          >
    68|            Portfolio
    69|          </motion.p>
    70|
    71|          {/* Name */}
    72|          <motion.h1
    73|            variants={fadeUp}
    74|            initial="hidden"
    75|            animate="visible"
    76|            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.1 }}
    77|            className="font-serif text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.9] tracking-tight text-foreground mb-8"
    78|            style={{ fontFamily: 'var(--font-heading)' }}
    79|          >
    80|            Alex
    81|            <br />
    82|            Morgan
    83|          </motion.h1>
    84|
    85|          {/* Tagline */}
    86|          <motion.p
    87|            variants={fadeUp}
    88|            initial="hidden"
    89|            animate="visible"
    90|            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.3 }}
    91|            className="text-base md:text-lg text-muted-foreground max-w-md leading-relaxed"
    92|          >
    93|            Designer &amp; Developer crafting thoughtful
    94|            <br className="hidden md:block" /> digital experiences.
    95|          </motion.p>
    96|
    97|          {/* Scroll indicator */}
    98|          <motion.a
    99|            href="#about"
   100|            variants={fadeIn}
   101|            initial="hidden"
   102|            animate="visible"
   103|            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.6 }}
   104|            className="inline-flex items-center gap-3 mt-16 text-xs tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors duration-200 group"
   105|          >
   106|            <span>Scroll</span>
   107|            <ArrowDown
   108|              size={14}
   109|              className="transition-transform duration-300 group-hover:translate-y-1"
   110|            />
   111|          </motion.a>
   112|        </div>
   113|
   114|        {/* Bottom thin rule */}
   115|        <div className="absolute bottom-0 left-6 md:left-12 right-6 md:right-12 h-px bg-border" />
   116|      </section>
   117|
   118|      {/* ── ABOUT ────────────────────────────────────────────────────────── */}
   119|      <section id="about" className="bg-[#f5f0e8] text-[#0f0f0f]">
   120|        <div className="max-w-6xl mx-auto px-6 md:px-12 py-24 md:py-36">
   121|          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-24 items-center">
   122|            {/* Left — text */}
   123|            <motion.div
   124|              variants={fadeUp}
   125|              initial="hidden"
   126|              whileInView="visible"
   127|              viewport={{ once: true }}
   128|              transition={{ duration: 0.4, ease: 'easeOut' }}
   129|            >
   130|              <p className="text-xs tracking-[0.3em] uppercase text-[#D4A853] mb-6">
   131|                About Me
   132|              </p>
   133|              <h2
   134|                className="font-serif text-4xl md:text-5xl font-semibold leading-tight mb-8 text-[#0f0f0f]"
   135|                style={{ fontFamily: 'var(--font-heading)' }}
   136|              >
   137|                Craft over
   138|                <br />
   139|                convention.
   140|              </h2>
   141|              <div className="space-y-5 text-[#3a3a3a] leading-relaxed text-base">
   142|                <p>
   143|                  I'm a multidisciplinary designer and developer with over eight years of
   144|                  experience building products that sit at the intersection of aesthetics
   145|                  and engineering. My work spans brand identity, interface design, and
   146|                  full-stack development.
   147|                </p>
   148|                <p>
   149|                  I believe the best digital experiences are invisible — they guide users
   150|                  effortlessly without calling attention to themselves. I bring that
   151|                  philosophy to every project, from early concept sketches to production
   152|                  code.
   153|                </p>
   154|                <p>
   155|                  Previously at Figma, Stripe, and a handful of early-stage startups.
   156|                  Currently available for select freelance projects and collaborations.
   157|                </p>
   158|              </div>
   159|
   160|              {/* Thin rule + availability note */}
   161|              <div className="mt-10 pt-8 border-t border-[#0f0f0f]/10 flex items-center gap-3">
   162|                <span className="inline-block w-2 h-2 rounded-full bg-[#D4A853]" />
   163|                <span className="text-xs tracking-widest uppercase text-[#3a3a3a]">
   164|                  Available for projects
   165|                </span>
   166|              </div>
   167|            </motion.div>
   168|
   169|            {/* Right — image / decorative */}
   170|            <motion.div
   171|              variants={fadeIn}
   172|              initial="hidden"
   173|              whileInView="visible"
   174|              viewport={{ once: true }}
   175|              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.15 }}
   176|              className="relative"
   177|            >
   178|              {/* Profile image */}
   179|              <div className="relative overflow-hidden aspect-[3/4] max-w-sm mx-auto md:mx-0 md:ml-auto">
   180|                <img
   181|                  src="/airo-assets/images/pages/about/profile-placeholder"
   182|                  alt="Alex Morgan"
   183|                  className="w-full h-full object-cover"
   184|                />
   185|                {/* Subtle overlay */}
   186|                <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f0f]/20 to-transparent" />
   187|              </div>
   188|
   189|              {/* Decorative accent square */}
   190|              <div
   191|                aria-hidden="true"
   192|                className="absolute -bottom-4 -right-4 w-24 h-24 border-2 border-[#D4A853]/40 pointer-events-none"
   193|              />
   194|              {/* Second offset square */}
   195|              <div
   196|                aria-hidden="true"
   197|                className="absolute -top-4 -left-4 w-16 h-16 border border-[#0f0f0f]/10 pointer-events-none"
   198|              />
   199|            </motion.div>
   200|          </div>
   201|        </div>
   202|      </section>
   203|
   204|      {/* ── CONTACT ──────────────────────────────────────────────────────── */}
   205|      <section id="contact" className="bg-background">
   206|        <div className="max-w-6xl mx-auto px-6 md:px-12 py-24 md:py-36">
   207|          <motion.div
   208|            variants={fadeUp}
   209|            initial="hidden"
   210|            whileInView="visible"
   211|            viewport={{ once: true }}
   212|            transition={{ duration: 0.4, ease: 'easeOut' }}
   213|          >
   214|            {/* Label */}
   215|            <p className="text-xs tracking-[0.3em] uppercase text-primary mb-8">
   216|              Get in touch
   217|            </p>
   218|
   219|            {/* Heading */}
   220|            <h2
   221|              className="font-serif text-4xl md:text-6xl font-semibold leading-tight text-foreground mb-6 max-w-2xl"
   222|              style={{ fontFamily: 'var(--font-heading)' }}
   223|            >
   224|              Let's build something
   225|              <br />
   226|              worth remembering.
   227|            </h2>
   228|
   229|            <p className="text-muted-foreground text-base max-w-md leading-relaxed mb-12">
   230|              Whether you have a project in mind or just want to say hello — my inbox
   231|              is always open.
   232|            </p>
   233|
   234|            {/* Email link */}
   235|            <a
   236|              href="mailto:hello@alexmorgan.design"
   237|              className="group inline-flex items-center gap-4 text-2xl md:text-3xl font-serif font-semibold text-foreground hover:text-primary transition-colors duration-300"
   238|              style={{ fontFamily: 'var(--font-heading)' }}
   239|            >
   240|              hello@alexmorgan.design
   241|              <span className="text-primary opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-xl">
   242|                →
   243|              </span>
   244|            </a>
   245|
   246|            {/* Divider */}
   247|            <div className="my-12 h-px bg-border max-w-md" />
   248|
   249|            {/* Social icons */}
   250|            <div className="flex items-center gap-6">
   251|              {socials.map(({ label, href, Icon }) => (
   252|                <a
   253|                  key={label}
   254|                  href={href}
   255|                  target="_blank"
   256|                  rel="noopener noreferrer"
   257|                  aria-label={label}
   258|                  className="text-muted-foreground hover:text-primary transition-colors duration-150"
   259|                  style={{ display: 'inline-flex' }}
   260|                >
   261|                  <motion.span
   262|                    whileHover={{ scale: 1.1 }}
   263|                    transition={{ duration: 0.15, ease: 'easeOut' }}
   264|                    className="inline-flex"
   265|                  >
   266|                    <Icon size={22} strokeWidth={1.5} />
   267|                  </motion.span>
   268|                </a>
   269|              ))}
   270|            </div>
   271|          </motion.div>
   272|        </div>
   273|
   274|        {/* Bottom thin rule */}
   275|        <div className="border-t border-border" />
   276|      </section>
   277|    </>
   278|  );
   279|}
   280|