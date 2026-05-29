src/pages/index.tsx [410 lines]
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion } from 'motion/react';
     3|import { Github, Linkedin, Twitter, Dribbble, ArrowDown, Mail } from 'lucide-react';
     4|
     5|// ─── Animation Variants ───────────────────────────────────────────────────────
     6|
     7|const fadeUp = {
     8|  hidden: { opacity: 0, y: 28 },
     9|  visible: (delay = 0) => ({
    10|    opacity: 1,
    11|    y: 0,
    12|    transition: { duration: 0.6, delay, ease: 'easeOut' as const },
    13|  }),
    14|};
    15|
    16|const fadeIn = {
    17|  hidden: { opacity: 0, y: 16 },
    18|  visible: {
    19|    opacity: 1,
    20|    y: 0,
    21|    transition: { duration: 0.5, ease: 'easeOut' as const },
    22|  },
    23|};
    24|
    25|// ─── Decorative SVG Elements ──────────────────────────────────────────────────
    26|
    27|function GeometricLines() {
    28|  return (
    29|    <svg
    30|      className="absolute right-0 top-1/2 -translate-y-1/2 w-[480px] h-[480px] opacity-20 pointer-events-none select-none hidden lg:block"
    31|      viewBox="0 0 480 480"
    32|      fill="none"
    33|      xmlns="http://www.w3.org/2000/svg"
    34|      aria-hidden="true"
    35|    >
    36|      {/* Outer circle */}
    37|      <circle cx="240" cy="240" r="200" stroke="#D4A847" strokeWidth="0.5" />
    38|      {/* Inner circle */}
    39|      <circle cx="240" cy="240" r="140" stroke="#D4A847" strokeWidth="0.5" />
    40|      {/* Cross lines */}
    41|      <line x1="40" y1="240" x2="440" y2="240" stroke="#D4A847" strokeWidth="0.5" />
    42|      <line x1="240" y1="40" x2="240" y2="440" stroke="#D4A847" strokeWidth="0.5" />
    43|      {/* Diagonal lines */}
    44|      <line x1="98" y1="98" x2="382" y2="382" stroke="#D4A847" strokeWidth="0.5" />
    45|      <line x1="382" y1="98" x2="98" y2="382" stroke="#D4A847" strokeWidth="0.5" />
    46|      {/* Dots at intersections */}
    47|      <circle cx="240" cy="40" r="3" fill="#D4A847" />
    48|      <circle cx="240" cy="440" r="3" fill="#D4A847" />
    49|      <circle cx="40" cy="240" r="3" fill="#D4A847" />
    50|      <circle cx="440" cy="240" r="3" fill="#D4A847" />
    51|      <circle cx="98" cy="98" r="3" fill="#D4A847" />
    52|      <circle cx="382" cy="98" r="3" fill="#D4A847" />
    53|      <circle cx="98" cy="382" r="3" fill="#D4A847" />
    54|      <circle cx="382" cy="382" r="3" fill="#D4A847" />
    55|      {/* Center dot */}
    56|      <circle cx="240" cy="240" r="4" fill="#D4A847" />
    57|      {/* Small square */}
    58|      <rect x="220" y="220" width="40" height="40" stroke="#D4A847" strokeWidth="0.5" />
    59|    </svg>
    60|  );
    61|}
    62|
    63|function AboutDecoration() {
    64|  return (
    65|    <svg
    66|      className="w-full max-w-xs opacity-25 mx-auto"
    67|      viewBox="0 0 300 400"
    68|      fill="none"
    69|      xmlns="http://www.w3.org/2000/svg"
    70|      aria-hidden="true"
    71|    >
    72|      {/* Portrait frame */}
    73|      <rect x="20" y="20" width="260" height="360" stroke="#D4A847" strokeWidth="0.8" />
    74|      <rect x="35" y="35" width="230" height="330" stroke="#D4A847" strokeWidth="0.4" />
    75|      {/* Corner accents */}
    76|      <line x1="20" y1="60" x2="50" y2="60" stroke="#D4A847" strokeWidth="1.5" />
    77|      <line x1="20" y1="20" x2="20" y2="60" stroke="#D4A847" strokeWidth="1.5" />
    78|      <line x1="250" y1="20" x2="280" y2="20" stroke="#D4A847" strokeWidth="1.5" />
    79|      <line x1="280" y1="20" x2="280" y2="60" stroke="#D4A847" strokeWidth="1.5" />
    80|      <line x1="20" y1="340" x2="20" y2="380" stroke="#D4A847" strokeWidth="1.5" />
    81|      <line x1="20" y1="380" x2="50" y2="380" stroke="#D4A847" strokeWidth="1.5" />
    82|      <line x1="280" y1="340" x2="280" y2="380" stroke="#D4A847" strokeWidth="1.5" />
    83|      <line x1="250" y1="380" x2="280" y2="380" stroke="#D4A847" strokeWidth="1.5" />
    84|      {/* Inner geometric */}
    85|      <circle cx="150" cy="200" r="80" stroke="#D4A847" strokeWidth="0.4" />
    86|      <circle cx="150" cy="200" r="40" stroke="#D4A847" strokeWidth="0.4" />
    87|      <line x1="70" y1="200" x2="230" y2="200" stroke="#D4A847" strokeWidth="0.4" />
    88|      <line x1="150" y1="120" x2="150" y2="280" stroke="#D4A847" strokeWidth="0.4" />
    89|      {/* Dots */}
    90|      <circle cx="150" cy="120" r="2.5" fill="#D4A847" />
    91|      <circle cx="150" cy="280" r="2.5" fill="#D4A847" />
    92|      <circle cx="70" cy="200" r="2.5" fill="#D4A847" />
    93|      <circle cx="230" cy="200" r="2.5" fill="#D4A847" />
    94|      <circle cx="150" cy="200" r="4" fill="#D4A847" />
    95|    </svg>
    96|  );
    97|}
    98|
    99|// ─── Dot Grid Background ──────────────────────────────────────────────────────
   100|
   101|function DotGrid() {
   102|  return (
   103|    <div
   104|      className="absolute inset-0 pointer-events-none select-none"
   105|      style={{
   106|        backgroundImage: 'radial-gradient(circle, rgba(212,168,71,0.15) 1px, transparent 1px)',
   107|        backgroundSize: '32px 32px',
   108|      }}
   109|      aria-hidden="true"
   110|    />
   111|  );
   112|}
   113|
   114|// ─── Social Links ─────────────────────────────────────────────────────────────
   115|
   116|const socialLinks = [
   117|  { icon: Github, href: 'https://github.com', label: 'GitHub' },
   118|  { icon: Linkedin, href: 'https://linkedin.com', label: 'LinkedIn' },
   119|  { icon: Twitter, href: 'https://twitter.com', label: 'Twitter / X' },
   120|  { icon: Dribbble, href: 'https://dribbble.com', label: 'Dribbble' },
   121|];
   122|
   123|// ─── Page ─────────────────────────────────────────────────────────────────────
   124|
   125|export default function HomePage() {
   126|  const scrollTo = (id: string) => {
   127|    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
   128|  };
   129|
   130|  return (
   131|    <>
   132|      <Helmet>
   133|        <title>Alex Morgan — Designer & Developer</title>
   134|        <meta
   135|          name="description"
   136|          content="Personal portfolio of Alex Morgan — a designer and developer crafting thoughtful digital experiences."
   137|        />
   138|      </Helmet>
   139|
   140|      {/* ── HERO ─────────────────────────────────────────────────────────── */}
   141|      <section
   142|        className="relative min-h-screen flex items-center overflow-hidden bg-background"
   143|        style={{
   144|          backgroundImage: `url('/airo-assets/images/pages/home/hero-bg')`,
   145|          backgroundSize: 'cover',
   146|          backgroundPosition: 'center',
   147|        }}
   148|      >
   149|        {/* Dark overlay */}
   150|        <div className="absolute inset-0 bg-background/85" aria-hidden="true" />
   151|        {/* Dot grid texture */}
   152|        <DotGrid />
   153|        {/* Geometric accent */}
   154|        <GeometricLines />
   155|
   156|        <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 w-full pt-24 pb-20">
   157|          {/* Eyebrow */}
   158|          <motion.p
   159|            className="text-primary text-sm font-medium tracking-[0.2em] uppercase mb-6"
   160|            variants={fadeUp}
   161|            initial="hidden"
   162|            animate="visible"
   163|            custom={0.1}
   164|          >
   165|            Designer & Developer
   166|          </motion.p>
   167|
   168|          {/* Name — oversized display */}
   169|          <motion.h1
   170|            className="font-heading text-[clamp(3.5rem,10vw,9rem)] leading-[0.92] tracking-tight text-foreground mb-8 max-w-4xl"
   171|            variants={fadeUp}
   172|            initial="hidden"
   173|            animate="visible"
   174|            custom={0.25}
   175|          >
   176|            Alex
   177|            <br />
   178|            <span className="text-primary">Morgan.</span>
   179|          </motion.h1>
   180|
   181|          {/* Tagline */}
   182|          <motion.p
   183|            className="text-lg md:text-xl text-muted-foreground font-light max-w-md leading-relaxed mb-12"
   184|            variants={fadeUp}
   185|            initial="hidden"
   186|            animate="visible"
   187|            custom={0.4}
   188|          >
   189|            I craft thoughtful digital experiences — where precision meets creativity and every
   190|            pixel has a purpose.
   191|          </motion.p>
   192|
   193|          {/* CTAs */}
   194|          <motion.div
   195|            className="flex flex-wrap items-center gap-6"
   196|            variants={fadeUp}
   197|            initial="hidden"
   198|            animate="visible"
   199|            custom={0.55}
   200|          >
   201|            <button
   202|              onClick={() => scrollTo('work')}
   203|              className="inline-flex items-center gap-2 bg-primary text-background px-7 py-3.5 text-sm font-medium tracking-wide hover:bg-primary/90 transition-colors duration-200"
   204|            >
   205|              View Work
   206|            </button>
   207|            <button
   208|              onClick={() => scrollTo('contact')}
   209|              className="relative text-sm font-medium tracking-wide text-foreground group"
   210|            >
   211|              Get in touch
   212|              <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-foreground transition-all duration-200 group-hover:w-full" />
   213|            </button>
   214|          </motion.div>
   215|        </div>
   216|
   217|        {/* Scroll indicator */}
   218|        <motion.button
   219|          onClick={() => scrollTo('about')}
   220|          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-muted-foreground hover:text-primary transition-colors duration-200"
   221|          initial={{ opacity: 0 }}
   222|          animate={{ opacity: 1, transition: { delay: 1, duration: 0.6 } }}
   223|          aria-label="Scroll to about"
   224|        >
   225|          <span className="text-xs tracking-[0.15em] uppercase">Scroll</span>
   226|          <motion.div
   227|            animate={{ y: [0, 6, 0] }}
   228|            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
   229|          >
   230|            <ArrowDown size={16} />
   231|          </motion.div>
   232|        </motion.button>
   233|      </section>
   234|
   235|      {/* ── ABOUT ────────────────────────────────────────────────────────── */}
   236|      <section id="about" className="py-28 md:py-36 bg-muted/30">
   237|        <div className="max-w-7xl mx-auto px-6 md:px-12">
   238|          <motion.div
   239|            className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center"
   240|            variants={fadeIn}
   241|            initial="hidden"
   242|            whileInView="visible"
   243|            viewport={{ once: true, margin: '-80px' }}
   244|          >
   245|            {/* Left — Text */}
   246|            <div>
   247|              {/* Section label */}
   248|              <p className="text-primary text-xs font-medium tracking-[0.2em] uppercase mb-6">
   249|                About
   250|              </p>
   251|              <h2 className="font-heading text-4xl md:text-5xl text-foreground leading-tight mb-10">
   252|                Building with intention,
   253|                <br />
   254|                <span className="text-primary">designing with care.</span>
   255|              </h2>
   256|
   257|              <div className="space-y-8">
   258|                <div>
   259|                  <h3 className="text-xs font-medium tracking-[0.15em] uppercase text-muted-foreground mb-3">
   260|                    Background
   261|                  </h3>
   262|                  <p className="text-muted-foreground leading-relaxed">
   263|                    I'm a multidisciplinary designer and developer with over 8 years of experience
   264|                    building products for startups and established brands alike. My work lives at
   265|                    the intersection of visual design and engineering — I care deeply about both
   266|                    how things look and how they work.
   267|                  </p>
   268|                </div>
   269|
   270|                <div>
   271|                  <h3 className="text-xs font-medium tracking-[0.15em] uppercase text-muted-foreground mb-3">
   272|                    Currently working on
   273|                  </h3>
   274|                  <p className="text-muted-foreground leading-relaxed">
   275|                    Exploring the boundaries of generative design systems and building tools that
   276|                    help creative teams move faster without sacrificing quality. Open to select
   277|                    freelance projects and collaborations.
   278|                  </p>
   279|                </div>
   280|
   281|                {/* Skills row */}
   282|                <div className="flex flex-wrap gap-3 pt-2">
   283|                  {['UI/UX Design', 'React', 'TypeScript', 'Motion', 'Figma', 'Node.js'].map(
   284|                    (skill) => (
   285|                      <span
   286|                        key={skill}
   287|                        className="text-xs tracking-wide text-muted-foreground border border-border/50 px-3 py-1.5"
   288|                      >
   289|                        {skill}
   290|                      </span>
   291|                    )
   292|                  )}
   293|                </div>
   294|              </div>
   295|            </div>
   296|
   297|            {/* Right — Decorative */}
   298|            <div className="flex items-center justify-center lg:justify-end">
   299|              <AboutDecoration />
   300|            </div>
   301|          </motion.div>
   302|        </div>
   303|      </section>
   304|
   305|      {/* ── WORK PLACEHOLDER ─────────────────────────────────────────────── */}
   306|      <section id="work" className="py-28 md:py-36 bg-background">
   307|        <div className="max-w-7xl mx-auto px-6 md:px-12">
   308|          <motion.div
   309|            variants={fadeIn}
   310|            initial="hidden"
   311|            whileInView="visible"
   312|            viewport={{ once: true, margin: '-80px' }}
   313|          >
   314|            <p className="text-primary text-xs font-medium tracking-[0.2em] uppercase mb-6">
   315|              Selected Work
   316|            </p>
   317|            <h2 className="font-heading text-4xl md:text-5xl text-foreground leading-tight mb-16">
   318|              Projects & case studies.
   319|            </h2>
   320|
   321|            {/* Placeholder cards */}
   322|            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border/20">
   323|              {[
   324|                { title: 'Brand Identity System', category: 'Branding / Design', year: '2025' },
   325|                { title: 'SaaS Dashboard', category: 'Product / Engineering', year: '2025' },
   326|                { title: 'E-commerce Redesign', category: 'UX / Frontend', year: '2024' },
   327|                { title: 'Mobile App', category: 'Design / React Native', year: '2024' },
   328|              ].map((project) => (
   329|                <div
   330|                  key={project.title}
   331|                  className="group relative bg-background border border-border/20 p-10 hover:border-primary/40 transition-colors duration-300 cursor-pointer"
   332|                >
   333|                  <div className="flex items-start justify-between mb-8">
   334|                    <span className="text-xs text-muted-foreground tracking-[0.15em] uppercase">
   335|                      {project.category}
   336|                    </span>
   337|                    <span className="text-xs text-muted-foreground">{project.year}</span>
   338|                  </div>
   339|                  <h3 className="font-heading text-2xl text-foreground group-hover:text-primary transition-colors duration-200 mb-4">
   340|                    {project.title}
   341|                  </h3>
   342|                  <div className="flex items-center gap-2 text-xs text-muted-foreground group-hover:text-primary transition-colors duration-200">
   343|                    <span>View project</span>
   344|                    <span className="transition-transform duration-200 group-hover:translate-x-1">→</span>
   345|                  </div>
   346|                </div>
   347|              ))}
   348|            </div>
   349|          </motion.div>
   350|        </div>
   351|      </section>
   352|
   353|      {/* ── CONTACT ──────────────────────────────────────────────────────── */}
   354|      <section id="contact" className="py-28 md:py-36 bg-muted/30">
   355|        <div className="max-w-7xl mx-auto px-6 md:px-12">
   356|          <motion.div
   357|            className="max-w-2xl"
   358|            variants={fadeIn}
   359|            initial="hidden"
   360|            whileInView="visible"
   361|            viewport={{ once: true, margin: '-80px' }}
   362|          >
   363|            <p className="text-primary text-xs font-medium tracking-[0.2em] uppercase mb-6">
   364|              Contact
   365|            </p>
   366|            <h2 className="font-heading text-5xl md:text-6xl text-foreground leading-tight mb-8">
   367|              Get in touch.
   368|            </h2>
   369|            <p className="text-muted-foreground leading-relaxed mb-12 max-w-md">
   370|              Have a project in mind or just want to say hello? I'm always open to interesting
   371|              conversations and new collaborations.
   372|            </p>
   373|
   374|            {/* Email link */}
   375|            <a
   376|              href="mailto:hello@alexmorgan.design"
   377|              className="group inline-flex items-center gap-3 text-foreground hover:text-primary transition-colors duration-200 mb-14"
   378|            >
   379|              <Mail size={18} className="shrink-0" />
   380|              <span className="relative text-lg font-medium">
   381|                hello@alexmorgan.design
   382|                <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-primary transition-all duration-200 group-hover:w-full" />
   383|              </span>
   384|            </a>
   385|
   386|            {/* Divider */}
   387|            <div className="w-12 h-px bg-border/40 mb-10" />
   388|
   389|            {/* Social icons */}
   390|            <div className="flex items-center gap-6">
   391|              {socialLinks.map(({ icon: Icon, href, label }) => (
   392|                <a
   393|                  key={label}
   394|                  href={href}
   395|                  target="_blank"
   396|                  rel="noopener noreferrer"
   397|                  aria-label={label}
   398|                  className="text-muted-foreground hover:text-primary transition-all duration-150 hover:scale-110"
   399|                >
   400|                  <Icon size={20} />
   401|                </a>
   402|              ))}
   403|            </div>
   404|          </motion.div>
   405|        </div>
   406|      </section>
   407|    </>
   408|  );
   409|}
   410|