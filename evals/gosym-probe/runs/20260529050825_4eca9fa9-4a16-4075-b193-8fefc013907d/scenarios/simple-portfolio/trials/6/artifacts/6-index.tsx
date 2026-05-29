src/pages/index.tsx [348 lines]
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion } from 'motion/react';
     3|import { Github, Linkedin, Twitter, Mail, ArrowRight } from 'lucide-react';
     4|
     5|// ─── Animation variants ───────────────────────────────────────────────────────
     6|
     7|const fadeUp = {
     8|  hidden: { opacity: 0, y: 28 },
     9|  visible: {
    10|    opacity: 1,
    11|    y: 0,
    12|    transition: { duration: 0.55, ease: 'easeOut' as const },
    13|  },
    14|};
    15|
    16|const staggerContainer = {
    17|  hidden: {},
    18|  visible: { transition: { staggerChildren: 0.12 } },
    19|};
    20|
    21|const wordFade = {
    22|  hidden: { opacity: 0, y: 20 },
    23|  visible: {
    24|    opacity: 1,
    25|    y: 0,
    26|    transition: { duration: 0.4, ease: 'easeOut' as const },
    27|  },
    28|};
    29|
    30|// ─── Decorative dot-grid background ──────────────────────────────────────────
    31|
    32|function DotGrid() {
    33|  return (
    34|    <div
    35|      className="absolute inset-0 pointer-events-none"
    36|      style={{
    37|        backgroundImage:
    38|          'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
    39|        backgroundSize: '28px 28px',
    40|        opacity: 0.45,
    41|      }}
    42|    />
    43|  );
    44|}
    45|
    46|// ─── Geometric accent shapes ──────────────────────────────────────────────────
    47|
    48|function AccentSquare({ className = '' }: { className?: string }) {
    49|  return (
    50|    <span
    51|      className={`inline-block w-2 h-2 border border-primary ${className}`}
    52|      aria-hidden="true"
    53|    />
    54|  );
    55|}
    56|
    57|function AccentLine({ className = '' }: { className?: string }) {
    58|  return (
    59|    <span
    60|      className={`inline-block h-px bg-primary ${className}`}
    61|      aria-hidden="true"
    62|    />
    63|  );
    64|}
    65|
    66|// ─── Hero Section ─────────────────────────────────────────────────────────────
    67|
    68|function HeroSection() {
    69|  const nameWords = ['Alex', 'Morgan'];
    70|
    71|  return (
    72|    <section className="relative min-h-screen flex items-center overflow-hidden bg-background pt-20">
    73|      <DotGrid />
    74|
    75|      {/* Decorative right-side geometric cluster */}
    76|      <div className="absolute right-8 md:right-16 top-1/2 -translate-y-1/2 hidden md:flex flex-col items-center gap-5 opacity-60">
    77|        <AccentLine className="w-px h-24" />
    78|        <AccentSquare />
    79|        <AccentLine className="w-px h-16" />
    80|        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
    81|        <AccentLine className="w-px h-32" />
    82|        <AccentSquare />
    83|        <AccentLine className="w-px h-12" />
    84|      </div>
    85|
    86|      <div className="relative max-w-6xl mx-auto px-6 md:px-12 w-full">
    87|        <div className="max-w-4xl">
    88|          {/* Eyebrow */}
    89|          <motion.div
    90|            initial={{ opacity: 0, x: -16 }}
    91|            animate={{ opacity: 1, x: 0 }}
    92|            transition={{ duration: 0.4, ease: 'easeOut' }}
    93|            className="flex items-center gap-3 mb-10"
    94|          >
    95|            <AccentLine className="w-8" />
    96|            <span className="text-xs tracking-widest uppercase text-primary font-medium">
    97|              Portfolio
    98|            </span>
    99|          </motion.div>
   100|
   101|          {/* Name — staggered word entrance */}
   102|          <motion.h1
   103|            variants={staggerContainer}
   104|            initial="hidden"
   105|            animate="visible"
   106|            className="font-heading text-7xl sm:text-8xl md:text-[9rem] lg:text-[11rem] leading-none tracking-tight text-foreground mb-8"
   107|          >
   108|            {nameWords.map((word) => (
   109|              <motion.span
   110|                key={word}
   111|                variants={wordFade}
   112|                className="block"
   113|              >
   114|                {word}
   115|              </motion.span>
   116|            ))}
   117|          </motion.h1>
   118|
   119|          {/* Tagline */}
   120|          <motion.p
   121|            initial={{ opacity: 0, y: 16 }}
   122|            animate={{ opacity: 1, y: 0 }}
   123|            transition={{ duration: 0.5, delay: 0.55, ease: 'easeOut' }}
   124|            className="text-lg md:text-xl text-foreground/60 font-light max-w-md leading-relaxed"
   125|          >
   126|            Designer &amp; developer crafting thoughtful digital experiences
   127|            that balance form with function.
   128|          </motion.p>
   129|
   130|          {/* CTA */}
   131|          <motion.div
   132|            initial={{ opacity: 0 }}
   133|            animate={{ opacity: 1 }}
   134|            transition={{ duration: 0.4, delay: 0.8 }}
   135|            className="mt-12"
   136|          >
   137|            <button
   138|              onClick={() => {
   139|                document.querySelector('#contact')?.scrollIntoView({ behavior: 'smooth' });
   140|              }}
   141|              className="group inline-flex items-center gap-3 text-sm tracking-widest uppercase font-medium text-foreground hover:text-primary transition-colors duration-200"
   142|            >
   143|              Get in touch
   144|              <ArrowRight
   145|                size={14}
   146|                className="transition-transform duration-200 group-hover:translate-x-1"
   147|              />
   148|            </button>
   149|          </motion.div>
   150|        </div>
   151|      </div>
   152|    </section>
   153|  );
   154|}
   155|
   156|// ─── About Section ────────────────────────────────────────────────────────────
   157|
   158|const skills = [
   159|  'Design Systems',
   160|  'Frontend Dev',
   161|  'UX Strategy',
   162|  'Typography',
   163|  'Motion',
   164|  'Branding',
   165|];
   166|
   167|function AboutSection() {
   168|  return (
   169|    <section id="about" className="py-32 bg-background">
   170|      <div className="max-w-6xl mx-auto px-6 md:px-12">
   171|        <motion.div
   172|          variants={staggerContainer}
   173|          initial="hidden"
   174|          whileInView="visible"
   175|          viewport={{ once: true, margin: '-80px' }}
   176|          className="grid md:grid-cols-2 gap-16 md:gap-24 items-start"
   177|        >
   178|          {/* Left — headline */}
   179|          <motion.div variants={fadeUp}>
   180|            <div className="flex items-center gap-3 mb-6">
   181|              <AccentSquare />
   182|              <span className="text-xs tracking-widest uppercase text-primary font-medium">
   183|                About
   184|              </span>
   185|            </div>
   186|            <h2 className="font-heading text-5xl md:text-6xl leading-tight text-foreground">
   187|              Craft over
   188|              <br />
   189|              <em className="not-italic text-primary">convention.</em>
   190|            </h2>
   191|            <AccentLine className="w-12 mt-8" />
   192|          </motion.div>
   193|
   194|          {/* Right — bio + skills */}
   195|          <motion.div variants={fadeUp} className="space-y-8">
   196|            <p className="text-base md:text-lg text-foreground/70 leading-relaxed">
   197|              I'm a multidisciplinary designer and developer with a passion for
   198|              building products that feel as good as they look. With over a
   199|              decade of experience across agencies, startups, and in-house
   200|              teams, I bring a systems-thinking approach to every project.
   201|            </p>
   202|            <p className="text-base md:text-lg text-foreground/70 leading-relaxed">
   203|              My work lives at the intersection of visual design and engineering
   204|              — where pixel-perfect interfaces meet clean, maintainable code.
   205|              I believe the best digital experiences are invisible: they just
   206|              work, beautifully.
   207|            </p>
   208|
   209|            {/* Skill chips */}
   210|            <div className="flex flex-wrap gap-2 pt-2">
   211|              {skills.map((skill) => (
   212|                <span
   213|                  key={skill}
   214|                  className="px-3 py-1.5 text-xs tracking-wider uppercase border border-foreground/20 text-foreground/60 hover:border-primary hover:text-primary transition-colors duration-200 cursor-default"
   215|                >
   216|                  {skill}
   217|                </span>
   218|              ))}
   219|            </div>
   220|          </motion.div>
   221|        </motion.div>
   222|      </div>
   223|    </section>
   224|  );
   225|}
   226|
   227|// ─── Contact Section ──────────────────────────────────────────────────────────
   228|
   229|const socials = [
   230|  {
   231|    label: 'GitHub',
   232|    href: 'https://github.com',
   233|    icon: Github,
   234|  },
   235|  {
   236|    label: 'LinkedIn',
   237|    href: 'https://linkedin.com',
   238|    icon: Linkedin,
   239|  },
   240|  {
   241|    label: 'Twitter / X',
   242|    href: 'https://twitter.com',
   243|    icon: Twitter,
   244|  },
   245|];
   246|
   247|function ContactSection() {
   248|  return (
   249|    <section id="contact" className="py-32 bg-muted/30">
   250|      <div className="max-w-6xl mx-auto px-6 md:px-12">
   251|        <motion.div
   252|          variants={staggerContainer}
   253|          initial="hidden"
   254|          whileInView="visible"
   255|          viewport={{ once: true, margin: '-80px' }}
   256|          className="grid md:grid-cols-2 gap-16 md:gap-24 items-end"
   257|        >
   258|          {/* Left — heading */}
   259|          <motion.div variants={fadeUp}>
   260|            <div className="flex items-center gap-3 mb-6">
   261|              <AccentSquare />
   262|              <span className="text-xs tracking-widest uppercase text-primary font-medium">
   263|                Contact
   264|              </span>
   265|            </div>
   266|            <h2 className="font-heading text-5xl md:text-6xl lg:text-7xl leading-tight text-foreground">
   267|              Let's
   268|              <br />
   269|              <em className="not-italic text-primary">talk.</em>
   270|            </h2>
   271|            <p className="mt-6 text-base text-foreground/60 leading-relaxed max-w-xs">
   272|              Have a project in mind or just want to say hello? My inbox is
   273|              always open.
   274|            </p>
   275|          </motion.div>
   276|
   277|          {/* Right — email + socials */}
   278|          <motion.div variants={fadeUp} className="space-y-10">
   279|            {/* Email link */}
   280|            <div>
   281|              <p className="text-xs tracking-widest uppercase text-foreground/40 mb-3">
   282|                Email
   283|              </p>
   284|              <a
   285|                href="mailto:hello@alexmorgan.co"
   286|                className="group inline-flex items-center gap-3 text-xl md:text-2xl font-medium text-foreground hover:text-primary transition-colors duration-200"
   287|              >
   288|                <Mail size={20} className="text-primary shrink-0" />
   289|                hello@alexmorgan.co
   290|                <ArrowRight
   291|                  size={16}
   292|                  className="opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200"
   293|                />
   294|              </a>
   295|            </div>
   296|
   297|            {/* Divider */}
   298|            <AccentLine className="w-full opacity-30" />
   299|
   300|            {/* Social icons */}
   301|            <div>
   302|              <p className="text-xs tracking-widest uppercase text-foreground/40 mb-5">
   303|                Find me on
   304|              </p>
   305|              <div className="flex items-center gap-4">
   306|                {socials.map(({ label, href, icon: Icon }) => (
   307|                  <a
   308|                    key={label}
   309|                    href={href}
   310|                    target="_blank"
   311|                    rel="noopener noreferrer"
   312|                    aria-label={label}
   313|                    className="group flex items-center justify-center w-11 h-11 border border-foreground/20 text-foreground/50 hover:border-primary hover:text-primary hover:scale-105 transition-all duration-200"
   314|                  >
   315|                    <Icon size={18} />
   316|                  </a>
   317|                ))}
   318|              </div>
   319|            </div>
   320|          </motion.div>
   321|        </motion.div>
   322|      </div>
   323|    </section>
   324|  );
   325|}
   326|
   327|// ─── Page ─────────────────────────────────────────────────────────────────────
   328|
   329|export default function HomePage() {
   330|  return (
   331|    <>
   332|      <Helmet>
   333|        <title>Alex Morgan — Designer &amp; Developer</title>
   334|        <meta
   335|          name="description"
   336|          content="Personal portfolio of Alex Morgan — a multidisciplinary designer and developer crafting thoughtful digital experiences."
   337|        />
   338|      </Helmet>
   339|
   340|      <main>
   341|        <HeroSection />
   342|        <AboutSection />
   343|        <ContactSection />
   344|      </main>
   345|    </>
   346|  );
   347|}
   348|