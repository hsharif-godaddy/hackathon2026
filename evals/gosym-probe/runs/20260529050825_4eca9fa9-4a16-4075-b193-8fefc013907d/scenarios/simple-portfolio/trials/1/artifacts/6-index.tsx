src/pages/index.tsx [403 lines]
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion } from 'motion/react';
     3|import { Github, Linkedin, Twitter, ArrowDown, Mail } from 'lucide-react';
     4|
     5|// ─── Animation Variants ───────────────────────────────────────────────────────
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
    16|const fadeIn = {
    17|  hidden: { opacity: 0, y: 16 },
    18|  visible: {
    19|    opacity: 1,
    20|    y: 0,
    21|    transition: { duration: 0.6, ease: 'easeOut' as const },
    22|  },
    23|};
    24|
    25|// ─── Social Link ──────────────────────────────────────────────────────────────
    26|
    27|function SocialLink({
    28|  href,
    29|  label,
    30|  children,
    31|}: {
    32|  href: string;
    33|  label: string;
    34|  children: React.ReactNode;
    35|}) {
    36|  return (
    37|    <a
    38|      href={href}
    39|      target="_blank"
    40|      rel="noopener noreferrer"
    41|      aria-label={label}
    42|      className="flex items-center justify-center w-11 h-11 rounded-full border border-border text-muted-foreground hover:text-primary hover:border-primary transition-all duration-150 hover:scale-110"
    43|    >
    44|      {children}
    45|    </a>
    46|  );
    47|}
    48|
    49|// ─── Page ─────────────────────────────────────────────────────────────────────
    50|
    51|export default function HomePage() {
    52|  return (
    53|    <>
    54|      <Helmet>
    55|        <title>Alex Morgan — Designer & Developer</title>
    56|        <meta
    57|          name="description"
    58|          content="Personal portfolio of Alex Morgan — a designer and developer crafting thoughtful digital experiences."
    59|        />
    60|      </Helmet>
    61|
    62|      {/* ── Hero ────────────────────────────────────────────────────────────── */}
    63|      <section
    64|        id="top"
    65|        className="relative min-h-screen flex flex-col justify-center overflow-hidden"
    66|      >
    67|        {/* Subtle background texture */}
    68|        <div className="absolute inset-0 pointer-events-none">
    69|          <div
    70|            className="absolute top-0 right-0 w-1/2 h-full opacity-[0.03]"
    71|            style={{
    72|              backgroundImage:
    73|                'repeating-linear-gradient(0deg, hsl(var(--primary)) 0px, hsl(var(--primary)) 1px, transparent 1px, transparent 80px)',
    74|            }}
    75|          />
    76|        </div>
    77|
    78|        <div className="max-w-7xl mx-auto px-6 md:px-12 pt-32 pb-24 w-full">
    79|          {/* Eyebrow */}
    80|          <motion.p
    81|            variants={fadeUp}
    82|            initial="hidden"
    83|            animate="visible"
    84|            custom={0}
    85|            className="text-xs tracking-[0.3em] uppercase text-primary mb-8 font-sans"
    86|          >
    87|            Designer &amp; Developer
    88|          </motion.p>
    89|
    90|          {/* Name — oversized, breaks the grid */}
    91|          <motion.h1
    92|            variants={fadeUp}
    93|            initial="hidden"
    94|            animate="visible"
    95|            custom={0.1}
    96|            className="font-heading text-[clamp(3.5rem,10vw,7.5rem)] leading-[0.92] tracking-tight text-foreground mb-0"
    97|            style={{ fontFamily: 'var(--font-heading)' }}
    98|          >
    99|            Alex
   100|            <br />
   101|            Morgan.
   102|          </motion.h1>
   103|
   104|          {/* Accent rule */}
   105|          <motion.div
   106|            initial={{ scaleX: 0, originX: 0 }}
   107|            animate={{ scaleX: 1 }}
   108|            transition={{ duration: 0.6, delay: 0.35, ease: 'easeOut' as const }}
   109|            className="h-px bg-primary w-24 my-8"
   110|          />
   111|
   112|          {/* Tagline */}
   113|          <motion.p
   114|            variants={fadeUp}
   115|            initial="hidden"
   116|            animate="visible"
   117|            custom={0.4}
   118|            className="text-lg md:text-xl text-muted-foreground max-w-md leading-relaxed font-sans"
   119|          >
   120|            Crafting digital experiences that are as thoughtful as they are beautiful.
   121|          </motion.p>
   122|
   123|          {/* CTA links */}
   124|          <motion.div
   125|            variants={fadeUp}
   126|            initial="hidden"
   127|            animate="visible"
   128|            custom={0.55}
   129|            className="flex items-center gap-8 mt-12"
   130|          >
   131|            <a
   132|              href="#work"
   133|              className="relative text-sm tracking-widest uppercase text-foreground hover:text-primary transition-colors duration-200 group"
   134|            >
   135|              View Work
   136|              <span className="absolute -bottom-0.5 left-0 w-full h-px bg-primary scale-x-100 origin-left transition-transform duration-200" />
   137|            </a>
   138|            <a
   139|              href="#contact"
   140|              className="relative text-sm tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors duration-200 group"
   141|            >
   142|              Get in Touch
   143|              <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-primary transition-all duration-200 group-hover:w-full" />
   144|            </a>
   145|          </motion.div>
   146|        </div>
   147|
   148|        {/* Scroll indicator */}
   149|        <motion.div
   150|          initial={{ opacity: 0 }}
   151|          animate={{ opacity: 1 }}
   152|          transition={{ delay: 1, duration: 0.6 }}
   153|          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-muted-foreground"
   154|        >
   155|          <span className="text-xs tracking-widest uppercase">Scroll</span>
   156|          <motion.div
   157|            animate={{ y: [0, 6, 0] }}
   158|            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' as const }}
   159|          >
   160|            <ArrowDown size={14} className="text-primary" />
   161|          </motion.div>
   162|        </motion.div>
   163|      </section>
   164|
   165|      {/* ── About ───────────────────────────────────────────────────────────── */}
   166|      <section id="about" className="py-32 border-t border-border">
   167|        <div className="max-w-7xl mx-auto px-6 md:px-12">
   168|          {/* Section label */}
   169|          <motion.p
   170|            variants={fadeIn}
   171|            initial="hidden"
   172|            whileInView="visible"
   173|            viewport={{ once: true }}
   174|            className="text-xs tracking-[0.3em] uppercase text-primary mb-16 font-sans"
   175|          >
   176|            About
   177|          </motion.p>
   178|
   179|          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-24 items-start">
   180|            {/* Left — text */}
   181|            <motion.div
   182|              variants={fadeIn}
   183|              initial="hidden"
   184|              whileInView="visible"
   185|              viewport={{ once: true }}
   186|              className="space-y-6"
   187|            >
   188|              <h2
   189|                className="font-heading text-4xl md:text-5xl leading-tight text-foreground"
   190|                style={{ fontFamily: 'var(--font-heading)' }}
   191|              >
   192|                Building with intention, designing with care.
   193|              </h2>
   194|
   195|              <div className="h-px bg-border w-full" />
   196|
   197|              <p className="text-muted-foreground leading-relaxed font-sans">
   198|                I'm a multidisciplinary designer and developer based in San Francisco. With over
   199|                eight years of experience, I bridge the gap between design and engineering — turning
   200|                complex problems into elegant, user-centered solutions.
   201|              </p>
   202|              <p className="text-muted-foreground leading-relaxed font-sans">
   203|                My work spans product design, brand identity, and full-stack development. I believe
   204|                the best digital experiences are born from a deep understanding of both craft and
   205|                context.
   206|              </p>
   207|
   208|              {/* Skills */}
   209|              <div className="pt-4">
   210|                <p className="text-xs tracking-widest uppercase text-primary mb-4 font-sans">
   211|                  Disciplines
   212|                </p>
   213|                <div className="flex flex-wrap gap-3">
   214|                  {[
   215|                    'Product Design',
   216|                    'UI / UX',
   217|                    'React',
   218|                    'TypeScript',
   219|                    'Brand Identity',
   220|                    'Motion',
   221|                  ].map((skill) => (
   222|                    <span
   223|                      key={skill}
   224|                      className="text-xs tracking-wider uppercase px-3 py-1.5 border border-border text-muted-foreground font-sans"
   225|                    >
   226|                      {skill}
   227|                    </span>
   228|                  ))}
   229|                </div>
   230|              </div>
   231|            </motion.div>
   232|
   233|            {/* Right — decorative large initial */}
   234|            <motion.div
   235|              initial={{ opacity: 0, x: 24 }}
   236|              whileInView={{ opacity: 1, x: 0 }}
   237|              viewport={{ once: true }}
   238|              transition={{ duration: 0.7, ease: 'easeOut' as const, delay: 0.15 }}
   239|              className="flex items-center justify-center md:justify-end"
   240|            >
   241|              <div className="relative select-none">
   242|                {/* Large decorative letter */}
   243|                <span
   244|                  className="font-heading text-[clamp(12rem,22vw,18rem)] leading-none text-primary/10 tracking-tighter"
   245|                  style={{ fontFamily: 'var(--font-heading)' }}
   246|                  aria-hidden="true"
   247|                >
   248|                  A
   249|                </span>
   250|                {/* Geometric accent lines */}
   251|                <div className="absolute top-1/2 -translate-y-1/2 right-0 flex flex-col gap-3">
   252|                  <div className="w-16 h-px bg-primary/40" />
   253|                  <div className="w-10 h-px bg-primary/25" />
   254|                  <div className="w-6 h-px bg-primary/15" />
   255|                </div>
   256|                <div className="absolute bottom-8 left-8 w-px h-16 bg-primary/30" />
   257|              </div>
   258|            </motion.div>
   259|          </div>
   260|        </div>
   261|      </section>
   262|
   263|      {/* ── Work (placeholder) ──────────────────────────────────────────────── */}
   264|      <section id="work" className="py-32 border-t border-border">
   265|        <div className="max-w-7xl mx-auto px-6 md:px-12">
   266|          <motion.p
   267|            variants={fadeIn}
   268|            initial="hidden"
   269|            whileInView="visible"
   270|            viewport={{ once: true }}
   271|            className="text-xs tracking-[0.3em] uppercase text-primary mb-16 font-sans"
   272|          >
   273|            Selected Work
   274|          </motion.p>
   275|
   276|          <motion.div
   277|            variants={fadeIn}
   278|            initial="hidden"
   279|            whileInView="visible"
   280|            viewport={{ once: true }}
   281|            className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border"
   282|          >
   283|            {[
   284|              { num: '01', title: 'Brand Identity System', tags: ['Branding', 'Strategy'] },
   285|              { num: '02', title: 'Product Design Platform', tags: ['UI/UX', 'React'] },
   286|              { num: '03', title: 'Editorial Web Experience', tags: ['Design', 'Motion'] },
   287|              { num: '04', title: 'Mobile App Redesign', tags: ['iOS', 'UX Research'] },
   288|            ].map((project) => (
   289|              <div
   290|                key={project.num}
   291|                className="group bg-background p-10 cursor-pointer hover:bg-muted transition-colors duration-200"
   292|              >
   293|                <div className="flex items-start justify-between mb-8">
   294|                  <span className="text-xs tracking-widest text-muted-foreground font-sans">
   295|                    {project.num}
   296|                  </span>
   297|                  <div className="flex gap-2">
   298|                    {project.tags.map((tag) => (
   299|                      <span
   300|                        key={tag}
   301|                        className="text-xs tracking-wider uppercase px-2 py-1 border border-border text-muted-foreground font-sans"
   302|                      >
   303|                        {tag}
   304|                      </span>
   305|                    ))}
   306|                  </div>
   307|                </div>
   308|                <h3
   309|                  className="font-heading text-2xl md:text-3xl text-foreground group-hover:text-primary transition-colors duration-200"
   310|                  style={{ fontFamily: 'var(--font-heading)' }}
   311|                >
   312|                  {project.title}
   313|                </h3>
   314|                <div className="mt-6 h-px w-0 bg-primary group-hover:w-12 transition-all duration-300" />
   315|              </div>
   316|            ))}
   317|          </motion.div>
   318|        </div>
   319|      </section>
   320|
   321|      {/* ── Contact ─────────────────────────────────────────────────────────── */}
   322|      <section id="contact" className="py-32 border-t border-border">
   323|        <div className="max-w-7xl mx-auto px-6 md:px-12">
   324|          <motion.p
   325|            variants={fadeIn}
   326|            initial="hidden"
   327|            whileInView="visible"
   328|            viewport={{ once: true }}
   329|            className="text-xs tracking-[0.3em] uppercase text-primary mb-16 font-sans"
   330|          >
   331|            Contact
   332|          </motion.p>
   333|
   334|          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-end">
   335|            {/* Left — heading + email */}
   336|            <motion.div
   337|              variants={fadeIn}
   338|              initial="hidden"
   339|              whileInView="visible"
   340|              viewport={{ once: true }}
   341|              className="space-y-10"
   342|            >
   343|              <h2
   344|                className="font-heading text-4xl md:text-5xl leading-tight text-foreground"
   345|                style={{ fontFamily: 'var(--font-heading)' }}
   346|              >
   347|                Let's make something worth remembering.
   348|              </h2>
   349|
   350|              <div>
   351|                <p className="text-xs tracking-widest uppercase text-muted-foreground mb-4 font-sans">
   352|                  Email
   353|                </p>
   354|                <a
   355|                  href="mailto:hello@alexmorgan.design"
   356|                  className="relative inline-flex items-center gap-3 text-xl md:text-2xl text-foreground hover:text-primary transition-colors duration-200 group font-sans"
   357|                >
   358|                  <Mail size={20} className="text-primary shrink-0" />
   359|                  hello@alexmorgan.design
   360|                  <span className="absolute -bottom-1 left-0 w-0 h-px bg-primary transition-all duration-200 group-hover:w-full" />
   361|                </a>
   362|              </div>
   363|            </motion.div>
   364|
   365|            {/* Right — social icons + availability */}
   366|            <motion.div
   367|              initial={{ opacity: 0, y: 16 }}
   368|              whileInView={{ opacity: 1, y: 0 }}
   369|              viewport={{ once: true }}
   370|              transition={{ duration: 0.6, ease: 'easeOut' as const, delay: 0.2 }}
   371|              className="space-y-10 md:text-right"
   372|            >
   373|              <div>
   374|                <p className="text-xs tracking-widest uppercase text-muted-foreground mb-6 font-sans">
   375|                  Find me online
   376|                </p>
   377|                <div className="flex gap-3 md:justify-end">
   378|                  <SocialLink href="https://github.com" label="GitHub">
   379|                    <Github size={16} />
   380|                  </SocialLink>
   381|                  <SocialLink href="https://linkedin.com" label="LinkedIn">
   382|                    <Linkedin size={16} />
   383|                  </SocialLink>
   384|                  <SocialLink href="https://twitter.com" label="Twitter / X">
   385|                    <Twitter size={16} />
   386|                  </SocialLink>
   387|                </div>
   388|              </div>
   389|
   390|              <div className="inline-flex items-center gap-3 md:justify-end">
   391|                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
   392|                <p className="text-sm text-muted-foreground font-sans">
   393|                  Available for new projects
   394|                </p>
   395|              </div>
   396|            </motion.div>
   397|          </div>
   398|        </div>
   399|      </section>
   400|    </>
   401|  );
   402|}
   403|