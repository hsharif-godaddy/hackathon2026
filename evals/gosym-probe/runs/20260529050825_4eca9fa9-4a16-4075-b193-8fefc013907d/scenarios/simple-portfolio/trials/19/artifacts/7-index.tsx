src/pages/index.tsx [310 lines]
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion } from 'motion/react';
     3|import { Github, Linkedin, Twitter } from 'lucide-react';
     4|
     5|// ─── Geometric SVG decoration for hero right column ───────────────────────────
     6|function GeometricGraphic() {
     7|  return (
     8|    <svg
     9|      viewBox="0 0 480 480"
    10|      fill="none"
    11|      xmlns="http://www.w3.org/2000/svg"
    12|      className="w-full h-full opacity-60"
    13|      aria-hidden="true"
    14|    >
    15|      {/* Dot grid */}
    16|      {Array.from({ length: 10 }).map((_, row) =>
    17|        Array.from({ length: 10 }).map((_, col) => (
    18|          <circle
    19|            key={`${row}-${col}`}
    20|            cx={col * 48 + 24}
    21|            cy={row * 48 + 24}
    22|            r="1.5"
    23|            fill="hsl(var(--muted-foreground))"
    24|            opacity="0.4"
    25|          />
    26|        ))
    27|      )}
    28|      {/* Large outer circle */}
    29|      <circle cx="240" cy="240" r="180" stroke="hsl(var(--border))" strokeWidth="1" />
    30|      {/* Medium circle */}
    31|      <circle cx="240" cy="240" r="120" stroke="hsl(var(--border))" strokeWidth="0.75" />
    32|      {/* Small inner circle */}
    33|      <circle cx="240" cy="240" r="60" stroke="hsl(var(--primary))" strokeWidth="0.75" opacity="0.5" />
    34|      {/* Cross lines */}
    35|      <line x1="240" y1="60" x2="240" y2="420" stroke="hsl(var(--border))" strokeWidth="0.5" />
    36|      <line x1="60" y1="240" x2="420" y2="240" stroke="hsl(var(--border))" strokeWidth="0.5" />
    37|      {/* Diagonal lines */}
    38|      <line x1="113" y1="113" x2="367" y2="367" stroke="hsl(var(--border))" strokeWidth="0.5" />
    39|      <line x1="367" y1="113" x2="113" y2="367" stroke="hsl(var(--border))" strokeWidth="0.5" />
    40|      {/* Accent arc */}
    41|      <path
    42|        d="M 240 60 A 180 180 0 0 1 420 240"
    43|        stroke="hsl(var(--primary))"
    44|        strokeWidth="1.5"
    45|        opacity="0.6"
    46|      />
    47|      {/* Small accent dot */}
    48|      <circle cx="240" cy="240" r="4" fill="hsl(var(--primary))" opacity="0.8" />
    49|    </svg>
    50|  );
    51|}
    52|
    53|// ─── Skills list ──────────────────────────────────────────────────────────────
    54|const skills = [
    55|  'UI / UX Design',
    56|  'React & TypeScript',
    57|  'Node.js & APIs',
    58|  'Design Systems',
    59|  'Motion & Animation',
    60|  'Brand Identity',
    61|];
    62|
    63|// ─── Social links ─────────────────────────────────────────────────────────────
    64|const socials = [
    65|  { label: 'GitHub', href: 'https://github.com', icon: Github },
    66|  { label: 'LinkedIn', href: 'https://linkedin.com', icon: Linkedin },
    67|  { label: 'Twitter / X', href: 'https://twitter.com', icon: Twitter },
    68|];
    69|
    70|// ─── Animation variants ───────────────────────────────────────────────────────
    71|const fadeUp = {
    72|  hidden: { opacity: 0, y: 24 },
    73|  visible: (delay = 0) => ({
    74|    opacity: 1,
    75|    y: 0,
    76|    transition: { duration: 0.5, delay, ease: 'easeOut' as const },
    77|  }),
    78|};
    79|
    80|const fadeIn = {
    81|  hidden: { opacity: 0, y: 16 },
    82|  visible: {
    83|    opacity: 1,
    84|    y: 0,
    85|    transition: { duration: 0.6, ease: 'easeOut' as const },
    86|  },
    87|};
    88|
    89|export default function HomePage() {
    90|  return (
    91|    <>
    92|      <Helmet>
    93|        <title>Alex Morgan — Designer & Developer</title>
    94|        <meta
    95|          name="description"
    96|          content="Personal portfolio of Alex Morgan — a designer and developer crafting thoughtful digital experiences."
    97|        />
    98|      </Helmet>
    99|
   100|      <main id="top">
   101|        {/* ── HERO ─────────────────────────────────────────────────────────── */}
   102|        <section className="min-h-screen flex items-center pt-20">
   103|          <div className="max-w-6xl mx-auto px-6 md:px-10 w-full py-24 md:py-32">
   104|            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-8 items-center">
   105|              {/* Left: Text */}
   106|              <div className="flex flex-col">
   107|                <motion.p
   108|                  className="text-xs tracking-[0.25em] uppercase text-primary mb-6 font-medium"
   109|                  variants={fadeUp}
   110|                  initial="hidden"
   111|                  animate="visible"
   112|                  custom={0}
   113|                >
   114|                  Portfolio — 2026
   115|                </motion.p>
   116|
   117|                <motion.h1
   118|                  className="font-heading text-6xl md:text-7xl lg:text-8xl font-bold leading-[0.95] tracking-tight text-foreground mb-8"
   119|                  variants={fadeUp}
   120|                  initial="hidden"
   121|                  animate="visible"
   122|                  custom={0.1}
   123|                >
   124|                  Alex
   125|                  <br />
   126|                  <span className="text-primary">Morgan</span>
   127|                </motion.h1>
   128|
   129|                <motion.p
   130|                  className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-md mb-10"
   131|                  variants={fadeUp}
   132|                  initial="hidden"
   133|                  animate="visible"
   134|                  custom={0.3}
   135|                >
   136|                  Designer and developer building precise, considered digital experiences — where craft meets clarity.
   137|                </motion.p>
   138|
   139|                <motion.div
   140|                  className="flex items-center gap-6"
   141|                  variants={fadeUp}
   142|                  initial="hidden"
   143|                  animate="visible"
   144|                  custom={0.45}
   145|                >
   146|                  <a
   147|                    href="#contact"
   148|                    className="text-sm font-medium tracking-wide text-background bg-primary px-6 py-3 hover:bg-primary/90 transition-colors duration-200"
   149|                  >
   150|                    Get in touch
   151|                  </a>
   152|                  <a
   153|                    href="#about"
   154|                    className="text-sm font-medium tracking-wide text-muted-foreground hover:text-foreground transition-colors duration-200 group flex items-center gap-2"
   155|                  >
   156|                    About me
   157|                    <span className="inline-block transition-transform duration-200 group-hover:translate-x-1">→</span>
   158|                  </a>
   159|                </motion.div>
   160|              </div>
   161|
   162|              {/* Right: Geometric graphic */}
   163|              <motion.div
   164|                className="hidden md:flex items-center justify-center"
   165|                initial={{ opacity: 0, scale: 0.95 }}
   166|                animate={{ opacity: 1, scale: 1 }}
   167|                transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
   168|              >
   169|                <div className="w-full max-w-sm aspect-square">
   170|                  <GeometricGraphic />
   171|                </div>
   172|              </motion.div>
   173|            </div>
   174|          </div>
   175|        </section>
   176|
   177|        {/* ── ABOUT ────────────────────────────────────────────────────────── */}
   178|        <section id="about" className="py-28 md:py-36 border-t border-border">
   179|          <div className="max-w-6xl mx-auto px-6 md:px-10">
   180|            <motion.div
   181|              variants={fadeIn}
   182|              initial="hidden"
   183|              whileInView="visible"
   184|              viewport={{ once: true, margin: '-80px' }}
   185|            >
   186|              {/* Section label */}
   187|              <div className="flex items-center gap-4 mb-12">
   188|                <span className="text-xs tracking-[0.25em] uppercase text-primary font-medium">About</span>
   189|                <div className="flex-1 h-px bg-border" />
   190|              </div>
   191|
   192|              <div className="grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-24">
   193|                {/* Bio */}
   194|                <div>
   195|                  <h2 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight mb-8">
   196|                    Craft over
   197|                    <br />
   198|                    convention.
   199|                  </h2>
   200|                  <div className="space-y-4 text-muted-foreground leading-relaxed">
   201|                    <p>
   202|                      I'm a designer and developer with over eight years of experience working at the intersection of visual design and engineering. I believe the best digital products are built with equal parts intention and technical rigor.
   203|                    </p>
   204|                    <p>
   205|                      My work spans product design, front-end development, and brand identity — always with an emphasis on clarity, precision, and the kind of detail that makes the difference between good and great.
   206|                    </p>
   207|                    <p>
   208|                      Previously at Figma, Stripe, and a handful of early-stage startups. Currently available for select freelance projects.
   209|                    </p>
   210|                  </div>
   211|                </div>
   212|
   213|                {/* Skills */}
   214|                <div>
   215|                  <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-8 font-medium">
   216|                    Areas of focus
   217|                  </p>
   218|                  <ul className="space-y-0">
   219|                    {skills.map((skill, i) => (
   220|                      <li
   221|                        key={skill}
   222|                        className="flex items-center justify-between py-4 border-b border-border last:border-0"
   223|                      >
   224|                        <span className="text-foreground font-medium">{skill}</span>
   225|                        <span className="text-xs text-muted-foreground tabular-nums">
   226|                          {String(i + 1).padStart(2, '0')}
   227|                        </span>
   228|                      </li>
   229|                    ))}
   230|                  </ul>
   231|                </div>
   232|              </div>
   233|            </motion.div>
   234|          </div>
   235|        </section>
   236|
   237|        {/* ── CONTACT ──────────────────────────────────────────────────────── */}
   238|        <section id="contact" className="py-28 md:py-36 border-t border-border">
   239|          <div className="max-w-6xl mx-auto px-6 md:px-10">
   240|            <motion.div
   241|              variants={fadeIn}
   242|              initial="hidden"
   243|              whileInView="visible"
   244|              viewport={{ once: true, margin: '-80px' }}
   245|            >
   246|              {/* Section label */}
   247|              <div className="flex items-center gap-4 mb-16">
   248|                <span className="text-xs tracking-[0.25em] uppercase text-primary font-medium">Contact</span>
   249|                <div className="flex-1 h-px bg-border" />
   250|              </div>
   251|
   252|              <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-end">
   253|                {/* Heading + email */}
   254|                <div>
   255|                  <h2 className="font-heading text-5xl md:text-6xl lg:text-7xl font-bold text-foreground leading-tight mb-10">
   256|                    Let's
   257|                    <br />
   258|                    <span className="text-primary">Talk.</span>
   259|                  </h2>
   260|                  <a
   261|                    href="mailto:hello@alexmorgan.dev"
   262|                    className="group inline-flex items-center gap-3 text-lg md:text-xl text-muted-foreground hover:text-foreground transition-colors duration-200"
   263|                  >
   264|                    <span className="border-b border-muted-foreground/30 group-hover:border-foreground transition-colors duration-200 pb-0.5">
   265|                      hello@alexmorgan.dev
   266|                    </span>
   267|                    <span className="text-primary transition-transform duration-200 group-hover:translate-x-1">→</span>
   268|                  </a>
   269|                </div>
   270|
   271|                {/* Social + availability */}
   272|                <div className="flex flex-col gap-10 md:items-end">
   273|                  <div>
   274|                    <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-6 font-medium md:text-right">
   275|                      Find me online
   276|                    </p>
   277|                    <div className="flex items-center gap-6">
   278|                      {socials.map(({ label, href, icon: Icon }) => (
   279|                        <motion.a
   280|                          key={label}
   281|                          href={href}
   282|                          target="_blank"
   283|                          rel="noopener noreferrer"
   284|                          aria-label={label}
   285|                          className="text-muted-foreground hover:text-foreground transition-colors duration-150"
   286|                          whileHover={{ scale: 1.15, opacity: 1 }}
   287|                          initial={{ opacity: 0.7 }}
   288|                        >
   289|                          <Icon size={20} strokeWidth={1.5} />
   290|                        </motion.a>
   291|                      ))}
   292|                    </div>
   293|                  </div>
   294|
   295|                  <div className="flex items-center gap-3">
   296|                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
   297|                    <span className="text-sm text-muted-foreground">
   298|                      Available for freelance — <span className="text-foreground">2026</span>
   299|                    </span>
   300|                  </div>
   301|                </div>
   302|              </div>
   303|            </motion.div>
   304|          </div>
   305|        </section>
   306|      </main>
   307|    </>
   308|  );
   309|}
   310|