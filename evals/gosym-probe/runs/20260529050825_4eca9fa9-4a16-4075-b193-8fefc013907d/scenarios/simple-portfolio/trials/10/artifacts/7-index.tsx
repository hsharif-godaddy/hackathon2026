src/pages/index.tsx [374 lines]
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion } from 'motion/react';
     3|import { Github, Linkedin, Twitter, ArrowUpRight, Mail } from 'lucide-react';
     4|
     5|// ─── Animation Variants ───────────────────────────────────────────────────────
     6|
     7|const fadeUp = {
     8|  hidden: { opacity: 0, y: 28 },
     9|  visible: (delay = 0) => ({
    10|    opacity: 1,
    11|    y: 0,
    12|    transition: { duration: 0.45, delay, ease: 'easeOut' as const },
    13|  }),
    14|};
    15|
    16|const fadeIn = {
    17|  hidden: { opacity: 0 },
    18|  visible: (delay = 0) => ({
    19|    opacity: 1,
    20|    transition: { duration: 0.5, delay, ease: 'easeOut' as const },
    21|  }),
    22|};
    23|
    24|// ─── Social Links ─────────────────────────────────────────────────────────────
    25|
    26|const socials = [
    27|  { label: 'GitHub', href: 'https://github.com', icon: Github },
    28|  { label: 'LinkedIn', href: 'https://linkedin.com', icon: Linkedin },
    29|  { label: 'Twitter / X', href: 'https://twitter.com', icon: Twitter },
    30|];
    31|
    32|// ─── Page ─────────────────────────────────────────────────────────────────────
    33|
    34|export default function HomePage() {
    35|  return (
    36|    <>
    37|      <Helmet>
    38|        <title>Alex Morgan — Designer &amp; Developer</title>
    39|        <meta
    40|          name="description"
    41|          content="Alex Morgan is a designer and developer crafting thoughtful digital experiences."
    42|        />
    43|      </Helmet>
    44|
    45|      <main>
    46|        {/* ── HERO ──────────────────────────────────────────────────────────── */}
    47|        <section className="relative min-h-[90vh] flex items-center overflow-hidden">
    48|          {/* Background geometric accents */}
    49|          <div
    50|            aria-hidden="true"
    51|            className="pointer-events-none absolute inset-0 overflow-hidden"
    52|          >
    53|            {/* Large soft circle — top right */}
    54|            <div className="absolute -top-32 -right-32 w-[520px] h-[520px] rounded-full bg-primary/8 blur-3xl" />
    55|            {/* Dot grid — bottom left */}
    56|            <svg
    57|              className="absolute bottom-16 left-8 opacity-20 text-foreground/30"
    58|              width="160"
    59|              height="160"
    60|              viewBox="0 0 160 160"
    61|              fill="none"
    62|            >
    63|              {Array.from({ length: 8 }).map((_, row) =>
    64|                Array.from({ length: 8 }).map((_, col) => (
    65|                  <circle
    66|                    key={`${row}-${col}`}
    67|                    cx={col * 20 + 10}
    68|                    cy={row * 20 + 10}
    69|                    r="1.5"
    70|                    fill="currentColor"
    71|                  />
    72|                ))
    73|              )}
    74|            </svg>
    75|            {/* Thin horizontal rule */}
    76|            <div className="absolute top-1/2 right-0 w-1/3 h-px bg-border/60" />
    77|          </div>
    78|
    79|          <div className="relative max-w-6xl mx-auto px-6 md:px-10 py-24 md:py-32 w-full">
    80|            {/* Eyebrow */}
    81|            <motion.p
    82|              variants={fadeUp}
    83|              initial="hidden"
    84|              animate="visible"
    85|              custom={0}
    86|              className="text-xs font-medium tracking-[0.2em] uppercase text-primary mb-6"
    87|            >
    88|              Portfolio — 2026
    89|            </motion.p>
    90|
    91|            {/* Name — oversized, breaks the grid */}
    92|            <motion.h1
    93|              variants={fadeUp}
    94|              initial="hidden"
    95|              animate="visible"
    96|              custom={0.1}
    97|              className="font-heading text-[clamp(3.5rem,10vw,8rem)] leading-[0.92] font-normal text-foreground mb-8 -ml-1"
    98|            >
    99|              Alex
   100|              <br />
   101|              <span className="text-primary">Morgan.</span>
   102|            </motion.h1>
   103|
   104|            {/* Tagline */}
   105|            <motion.p
   106|              variants={fadeUp}
   107|              initial="hidden"
   108|              animate="visible"
   109|              custom={0.25}
   110|              className="text-lg md:text-xl text-foreground/70 max-w-md leading-relaxed mb-12"
   111|            >
   112|              Designer &amp; Developer crafting thoughtful digital experiences that connect people
   113|              with ideas.
   114|            </motion.p>
   115|
   116|            {/* CTA row */}
   117|            <motion.div
   118|              variants={fadeUp}
   119|              initial="hidden"
   120|              animate="visible"
   121|              custom={0.38}
   122|              className="flex flex-wrap items-center gap-5"
   123|            >
   124|              <a
   125|                href="#contact"
   126|                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-sm font-medium rounded-sm hover:bg-primary/90 transition-colors duration-200"
   127|              >
   128|                Get in touch
   129|                <ArrowUpRight size={15} />
   130|              </a>
   131|              <a
   132|                href="#about"
   133|                className="text-sm font-medium text-foreground/60 hover:text-foreground transition-colors duration-200 underline underline-offset-4 decoration-border hover:decoration-foreground"
   134|              >
   135|                Learn more about me
   136|              </a>
   137|            </motion.div>
   138|          </div>
   139|        </section>
   140|
   141|        {/* ── ABOUT ─────────────────────────────────────────────────────────── */}
   142|        <section id="about" className="py-24 md:py-32 bg-card/40">
   143|          <div className="max-w-6xl mx-auto px-6 md:px-10">
   144|            {/* Section label */}
   145|            <motion.div
   146|              variants={fadeIn}
   147|              initial="hidden"
   148|              whileInView="visible"
   149|              viewport={{ once: true }}
   150|              custom={0}
   151|              className="flex items-center gap-4 mb-14"
   152|            >
   153|              <span className="text-xs font-medium tracking-[0.2em] uppercase text-primary">
   154|                About
   155|              </span>
   156|              <div className="h-px flex-1 max-w-[60px] bg-primary/40" />
   157|            </motion.div>
   158|
   159|            <div className="grid md:grid-cols-[1fr_0.75fr] gap-12 md:gap-20 items-start">
   160|              {/* Text column */}
   161|              <div>
   162|                <motion.h2
   163|                  variants={fadeUp}
   164|                  initial="hidden"
   165|                  whileInView="visible"
   166|                  viewport={{ once: true }}
   167|                  custom={0.05}
   168|                  className="font-heading text-4xl md:text-5xl font-normal text-foreground leading-tight mb-8"
   169|                >
   170|                  Building at the intersection of design and code.
   171|                </motion.h2>
   172|
   173|                <motion.div
   174|                  variants={fadeUp}
   175|                  initial="hidden"
   176|                  whileInView="visible"
   177|                  viewport={{ once: true }}
   178|                  custom={0.15}
   179|                  className="space-y-5 text-foreground/70 leading-relaxed"
   180|                >
   181|                  <p>
   182|                    I'm a multidisciplinary designer and developer with over 8 years of experience
   183|                    building digital products. My work spans brand identity, interface design, and
   184|                    full-stack development — I believe the best digital experiences come from
   185|                    understanding both sides of the craft.
   186|                  </p>
   187|                  <p>
   188|                    Previously at Figma, Stripe, and a handful of early-stage startups. Currently
   189|                    available for select freelance projects and collaborations.
   190|                  </p>
   191|                  <p>
   192|                    When I'm not at my desk, you'll find me hiking the Pacific Crest Trail,
   193|                    collecting vintage design books, or experimenting with film photography.
   194|                  </p>
   195|                </motion.div>
   196|
   197|                {/* Skills row */}
   198|                <motion.div
   199|                  variants={fadeUp}
   200|                  initial="hidden"
   201|                  whileInView="visible"
   202|                  viewport={{ once: true }}
   203|                  custom={0.25}
   204|                  className="mt-10 flex flex-wrap gap-2"
   205|                >
   206|                  {[
   207|                    'UI/UX Design',
   208|                    'React',
   209|                    'TypeScript',
   210|                    'Figma',
   211|                    'Node.js',
   212|                    'Brand Identity',
   213|                  ].map((skill) => (
   214|                    <span
   215|                      key={skill}
   216|                      className="text-xs font-medium tracking-wide px-3 py-1.5 border border-border rounded-sm text-foreground/60"
   217|                    >
   218|                      {skill}
   219|                    </span>
   220|                  ))}
   221|                </motion.div>
   222|              </div>
   223|
   224|              {/* Visual column */}
   225|              <motion.div
   226|                variants={fadeIn}
   227|                initial="hidden"
   228|                whileInView="visible"
   229|                viewport={{ once: true }}
   230|                custom={0.1}
   231|                className="relative"
   232|              >
   233|                {/* Portrait image */}
   234|                <div className="relative aspect-[3/4] rounded-sm overflow-hidden bg-muted">
   235|                  <img
   236|                    src="/airo-assets/images/pages/about/portrait"
   237|                    alt="Alex Morgan"
   238|                    className="w-full h-full object-cover"
   239|                  />
   240|                  {/* Warm overlay */}
   241|                  <div className="absolute inset-0 bg-primary/10 mix-blend-multiply" />
   242|                </div>
   243|
   244|                {/* Decorative offset border */}
   245|                <div
   246|                  aria-hidden="true"
   247|                  className="absolute -bottom-4 -right-4 w-full h-full border border-primary/20 rounded-sm -z-10"
   248|                />
   249|
   250|                {/* Floating stat card */}
   251|                <div className="absolute -bottom-6 -left-4 md:-left-8 bg-background border border-border/60 rounded-sm px-5 py-4 shadow-sm">
   252|                  <p className="font-heading text-3xl font-normal text-foreground">8+</p>
   253|                  <p className="text-xs text-muted-foreground tracking-wide mt-0.5">
   254|                    Years of experience
   255|                  </p>
   256|                </div>
   257|              </motion.div>
   258|            </div>
   259|          </div>
   260|        </section>
   261|
   262|        {/* ── CONTACT ───────────────────────────────────────────────────────── */}
   263|        <section id="contact" className="py-24 md:py-32">
   264|          <div className="max-w-6xl mx-auto px-6 md:px-10">
   265|            {/* Section label */}
   266|            <motion.div
   267|              variants={fadeIn}
   268|              initial="hidden"
   269|              whileInView="visible"
   270|              viewport={{ once: true }}
   271|              custom={0}
   272|              className="flex items-center gap-4 mb-14"
   273|            >
   274|              <span className="text-xs font-medium tracking-[0.2em] uppercase text-primary">
   275|                Contact
   276|              </span>
   277|              <div className="h-px flex-1 max-w-[60px] bg-primary/40" />
   278|            </motion.div>
   279|
   280|            <div className="grid md:grid-cols-2 gap-12 md:gap-20 items-start">
   281|              {/* Left: Heading + email */}
   282|              <div>
   283|                <motion.h2
   284|                  variants={fadeUp}
   285|                  initial="hidden"
   286|                  whileInView="visible"
   287|                  viewport={{ once: true }}
   288|                  custom={0.05}
   289|                  className="font-heading text-4xl md:text-5xl font-normal text-foreground leading-tight mb-6"
   290|                >
   291|                  Let's make something great together.
   292|                </motion.h2>
   293|
   294|                <motion.p
   295|                  variants={fadeUp}
   296|                  initial="hidden"
   297|                  whileInView="visible"
   298|                  viewport={{ once: true }}
   299|                  custom={0.15}
   300|                  className="text-foreground/60 leading-relaxed mb-10 max-w-sm"
   301|                >
   302|                  Whether you have a project in mind, a question, or just want to say hello — my
   303|                  inbox is always open.
   304|                </motion.p>
   305|
   306|                {/* Large email link */}
   307|                <motion.a
   308|                  variants={fadeUp}
   309|                  initial="hidden"
   310|                  whileInView="visible"
   311|                  viewport={{ once: true }}
   312|                  custom={0.22}
   313|                  href="mailto:hello@alexmorgan.com"
   314|                  className="group inline-flex items-center gap-3 text-xl md:text-2xl font-medium text-foreground hover:text-primary transition-colors duration-200"
   315|                >
   316|                  <Mail size={22} className="text-primary shrink-0" />
   317|                  <span className="border-b border-border group-hover:border-primary transition-colors duration-200 pb-0.5">
   318|                    hello@alexmorgan.com
   319|                  </span>
   320|                </motion.a>
   321|              </div>
   322|
   323|              {/* Right: Social icons + availability */}
   324|              <motion.div
   325|                variants={fadeUp}
   326|                initial="hidden"
   327|                whileInView="visible"
   328|                viewport={{ once: true }}
   329|                custom={0.1}
   330|                className="flex flex-col gap-8 md:pt-4"
   331|              >
   332|                {/* Availability badge */}
   333|                <div className="inline-flex items-center gap-2.5 self-start px-4 py-2.5 bg-card border border-border/60 rounded-sm">
   334|                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
   335|                  <span className="text-sm text-foreground/70">
   336|                    Available for new projects
   337|                  </span>
   338|                </div>
   339|
   340|                {/* Social links */}
   341|                <div>
   342|                  <p className="text-xs font-medium tracking-[0.15em] uppercase text-muted-foreground mb-5">
   343|                    Find me online
   344|                  </p>
   345|                  <div className="flex flex-col gap-3">
   346|                    {socials.map(({ label, href, icon: Icon }) => (
   347|                      <a
   348|                        key={label}
   349|                        href={href}
   350|                        target="_blank"
   351|                        rel="noopener noreferrer"
   352|                        className="group inline-flex items-center gap-3 text-sm font-medium text-foreground/60 hover:text-foreground transition-all duration-200"
   353|                      >
   354|                        <span className="flex items-center justify-center w-9 h-9 border border-border/60 rounded-sm group-hover:border-primary group-hover:-translate-y-0.5 group-hover:text-primary transition-all duration-200">
   355|                          <Icon size={15} />
   356|                        </span>
   357|                        {label}
   358|                        <ArrowUpRight
   359|                          size={13}
   360|                          className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-primary"
   361|                        />
   362|                      </a>
   363|                    ))}
   364|                  </div>
   365|                </div>
   366|              </motion.div>
   367|            </div>
   368|          </div>
   369|        </section>
   370|      </main>
   371|    </>
   372|  );
   373|}
   374|