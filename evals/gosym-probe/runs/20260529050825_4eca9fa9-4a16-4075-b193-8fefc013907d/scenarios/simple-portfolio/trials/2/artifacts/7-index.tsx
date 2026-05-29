src/pages/index.tsx [336 lines]
     1|import { motion } from 'motion/react';
     2|import { Github, Linkedin, Twitter, ArrowDown, Mail } from 'lucide-react';
     3|
     4|// ─── Animation variants ───────────────────────────────────────────────────────
     5|
     6|const fadeUp = {
     7|  hidden: { opacity: 0, y: 28 },
     8|  visible: (delay = 0) => ({
     9|    opacity: 1,
    10|    y: 0,
    11|    transition: { duration: 0.55, ease: 'easeOut' as const, delay },
    12|  }),
    13|};
    14|
    15|const fadeIn = {
    16|  hidden: { opacity: 0, y: 16 },
    17|  visible: {
    18|    opacity: 1,
    19|    y: 0,
    20|    transition: { duration: 0.4, ease: 'easeOut' as const },
    21|  },
    22|};
    23|
    24|// ─── Decorative SVG ───────────────────────────────────────────────────────────
    25|
    26|function GeometricAccent() {
    27|  return (
    28|    <svg
    29|      viewBox="0 0 320 320"
    30|      fill="none"
    31|      xmlns="http://www.w3.org/2000/svg"
    32|      className="w-full max-w-xs md:max-w-sm opacity-60"
    33|      aria-hidden="true"
    34|    >
    35|      {/* Outer square rotated */}
    36|      <rect
    37|        x="40"
    38|        y="40"
    39|        width="240"
    40|        height="240"
    41|        stroke="hsl(var(--primary))"
    42|        strokeWidth="1"
    43|        strokeDasharray="4 8"
    44|        transform="rotate(15 160 160)"
    45|      />
    46|      {/* Inner square */}
    47|      <rect
    48|        x="90"
    49|        y="90"
    50|        width="140"
    51|        height="140"
    52|        stroke="hsl(var(--primary))"
    53|        strokeWidth="0.75"
    54|        transform="rotate(-8 160 160)"
    55|      />
    56|      {/* Center cross */}
    57|      <line x1="160" y1="60" x2="160" y2="260" stroke="hsl(var(--primary))" strokeWidth="0.5" />
    58|      <line x1="60" y1="160" x2="260" y2="160" stroke="hsl(var(--primary))" strokeWidth="0.5" />
    59|      {/* Corner dots */}
    60|      <circle cx="160" cy="160" r="4" fill="hsl(var(--primary))" />
    61|      <circle cx="100" cy="100" r="2" fill="hsl(var(--primary))" opacity="0.6" />
    62|      <circle cx="220" cy="100" r="2" fill="hsl(var(--primary))" opacity="0.6" />
    63|      <circle cx="100" cy="220" r="2" fill="hsl(var(--primary))" opacity="0.6" />
    64|      <circle cx="220" cy="220" r="2" fill="hsl(var(--primary))" opacity="0.6" />
    65|      {/* Outer ring arc */}
    66|      <circle
    67|        cx="160"
    68|        cy="160"
    69|        r="120"
    70|        stroke="hsl(var(--primary))"
    71|        strokeWidth="0.5"
    72|        strokeDasharray="2 12"
    73|        opacity="0.4"
    74|      />
    75|    </svg>
    76|  );
    77|}
    78|
    79|// ─── Social icon link ─────────────────────────────────────────────────────────
    80|
    81|interface SocialLinkProps {
    82|  href: string;
    83|  label: string;
    84|  icon: React.ReactNode;
    85|}
    86|
    87|function SocialLink({ href, label, icon }: SocialLinkProps) {
    88|  return (
    89|    <a
    90|      href={href}
    91|      target="_blank"
    92|      rel="noopener noreferrer"
    93|      aria-label={label}
    94|      className="text-muted-foreground hover:text-primary transition-colors duration-200"
    95|    >
    96|      {icon}
    97|    </a>
    98|  );
    99|}
   100|
   101|// ─── Page ─────────────────────────────────────────────────────────────────────
   102|
   103|export default function HomePage() {
   104|  return (
   105|    <main className="bg-background text-foreground">
   106|      {/* ── HERO ─────────────────────────────────────────────────────────── */}
   107|      <section className="relative min-h-screen flex flex-col justify-center overflow-hidden px-6 md:px-12 pt-24 pb-16">
   108|        {/* Subtle background grid */}
   109|        <div
   110|          className="pointer-events-none absolute inset-0 opacity-[0.03]"
   111|          style={{
   112|            backgroundImage:
   113|              'linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)',
   114|            backgroundSize: '80px 80px',
   115|          }}
   116|          aria-hidden="true"
   117|        />
   118|
   119|        <div className="max-w-7xl mx-auto w-full">
   120|          {/* Overline */}
   121|          <motion.p
   122|            variants={fadeUp}
   123|            initial="hidden"
   124|            animate="visible"
   125|            custom={0}
   126|            className="text-xs tracking-[0.3em] uppercase text-primary mb-8 md:mb-10"
   127|          >
   128|            Portfolio
   129|          </motion.p>
   130|
   131|          {/* Oversized name — architectural treatment */}
   132|          <div className="overflow-hidden">
   133|            <motion.h1
   134|              variants={fadeUp}
   135|              initial="hidden"
   136|              animate="visible"
   137|              custom={0.1}
   138|              className="font-heading text-[clamp(3.5rem,12vw,10rem)] leading-[0.9] tracking-tight text-foreground"
   139|            >
   140|              Alex
   141|            </motion.h1>
   142|          </div>
   143|          <div className="overflow-hidden">
   144|            <motion.h1
   145|              variants={fadeUp}
   146|              initial="hidden"
   147|              animate="visible"
   148|              custom={0.22}
   149|              className="font-heading text-[clamp(3.5rem,12vw,10rem)] leading-[0.9] tracking-tight text-foreground"
   150|            >
   151|              Morgan
   152|            </motion.h1>
   153|          </div>
   154|
   155|          {/* Tagline — offset right */}
   156|          <motion.div
   157|            variants={fadeUp}
   158|            initial="hidden"
   159|            animate="visible"
   160|            custom={0.38}
   161|            className="mt-8 md:mt-10 md:ml-auto md:max-w-md"
   162|          >
   163|            {/* Accent rule */}
   164|            <div className="w-8 h-px bg-primary mb-4" />
   165|            <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
   166|              Designer &amp; Developer crafting thoughtful digital experiences.
   167|            </p>
   168|          </motion.div>
   169|        </div>
   170|
   171|        {/* Scroll indicator */}
   172|        <motion.div
   173|          initial={{ opacity: 0 }}
   174|          animate={{ opacity: 1 }}
   175|          transition={{ delay: 1.1, duration: 0.6 }}
   176|          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-muted-foreground"
   177|          aria-hidden="true"
   178|        >
   179|          <span className="text-[10px] tracking-[0.25em] uppercase">Scroll</span>
   180|          <motion.div
   181|            animate={{ y: [0, 6, 0] }}
   182|            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
   183|          >
   184|            <ArrowDown size={14} />
   185|          </motion.div>
   186|        </motion.div>
   187|      </section>
   188|
   189|      {/* ── ABOUT ────────────────────────────────────────────────────────── */}
   190|      <section id="about" className="py-28 md:py-36 px-6 md:px-12">
   191|        <div className="max-w-7xl mx-auto">
   192|          {/* Section label */}
   193|          <motion.p
   194|            variants={fadeIn}
   195|            initial="hidden"
   196|            whileInView="visible"
   197|            viewport={{ once: true }}
   198|            className="text-xs tracking-[0.3em] uppercase text-primary mb-12"
   199|          >
   200|            About
   201|          </motion.p>
   202|
   203|          <div className="grid md:grid-cols-2 gap-16 md:gap-24 items-center">
   204|            {/* Left — bio */}
   205|            <motion.div
   206|              variants={fadeIn}
   207|              initial="hidden"
   208|              whileInView="visible"
   209|              viewport={{ once: true }}
   210|            >
   211|              <h2 className="font-heading text-4xl md:text-5xl text-foreground mb-8 leading-tight">
   212|                Craft over<br />convention.
   213|              </h2>
   214|              {/* Accent rule */}
   215|              <div className="w-8 h-px bg-primary mb-8" />
   216|              <div className="space-y-5 text-muted-foreground leading-[1.85] text-base md:text-[1.0625rem]">
   217|                <p>
   218|                  With a background spanning interaction design and front-end engineering, I work at
   219|                  the intersection of aesthetics and function — building interfaces that feel as
   220|                  considered as they look.
   221|                </p>
   222|                <p>
   223|                  I'm drawn to projects where clarity matters: products that need to communicate
   224|                  complex ideas simply, or experiences that earn trust through restraint rather than
   225|                  noise.
   226|                </p>
   227|                <p>
   228|                  Collaboration is central to how I work. The best outcomes come from close
   229|                  partnership with product, engineering, and the people who actually use what we
   230|                  build.
   231|                </p>
   232|              </div>
   233|            </motion.div>
   234|
   235|            {/* Right — geometric decorative element */}
   236|            <motion.div
   237|              variants={fadeIn}
   238|              initial="hidden"
   239|              whileInView="visible"
   240|              viewport={{ once: true }}
   241|              className="flex items-center justify-center"
   242|            >
   243|              <GeometricAccent />
   244|            </motion.div>
   245|          </div>
   246|        </div>
   247|      </section>
   248|
   249|      {/* Divider */}
   250|      <div className="max-w-7xl mx-auto px-6 md:px-12">
   251|        <div className="h-px bg-border" />
   252|      </div>
   253|
   254|      {/* ── CONTACT ──────────────────────────────────────────────────────── */}
   255|      <section id="contact" className="py-28 md:py-36 px-6 md:px-12">
   256|        <div className="max-w-7xl mx-auto">
   257|          {/* Section label */}
   258|          <motion.p
   259|            variants={fadeIn}
   260|            initial="hidden"
   261|            whileInView="visible"
   262|            viewport={{ once: true }}
   263|            className="text-xs tracking-[0.3em] uppercase text-primary mb-12"
   264|          >
   265|            Contact
   266|          </motion.p>
   267|
   268|          <div className="grid md:grid-cols-2 gap-16 md:gap-24 items-start">
   269|            {/* Left — heading */}
   270|            <motion.div
   271|              variants={fadeIn}
   272|              initial="hidden"
   273|              whileInView="visible"
   274|              viewport={{ once: true }}
   275|            >
   276|              <h2 className="font-heading text-4xl md:text-5xl text-foreground leading-tight">
   277|                Let's make<br />something<br />together.
   278|              </h2>
   279|            </motion.div>
   280|
   281|            {/* Right — email + socials */}
   282|            <motion.div
   283|              variants={fadeIn}
   284|              initial="hidden"
   285|              whileInView="visible"
   286|              viewport={{ once: true }}
   287|              className="flex flex-col justify-center gap-10"
   288|            >
   289|              {/* Email */}
   290|              <div>
   291|                <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-3">
   292|                  Email
   293|                </p>
   294|                <a
   295|                  href="mailto:alex@example.com"
   296|                  className="group inline-flex items-center gap-3 text-foreground hover:text-primary transition-colors duration-200"
   297|                >
   298|                  <Mail size={16} className="shrink-0 text-primary" />
   299|                  <span className="text-lg relative">
   300|                    alex@example.com
   301|                    <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-primary transition-all duration-300 group-hover:w-full" />
   302|                  </span>
   303|                </a>
   304|              </div>
   305|
   306|              {/* Social links */}
   307|              <div>
   308|                <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
   309|                  Elsewhere
   310|                </p>
   311|                <div className="flex items-center gap-6">
   312|                  <SocialLink
   313|                    href="https://github.com"
   314|                    label="GitHub"
   315|                    icon={<Github size={20} />}
   316|                  />
   317|                  <SocialLink
   318|                    href="https://linkedin.com"
   319|                    label="LinkedIn"
   320|                    icon={<Linkedin size={20} />}
   321|                  />
   322|                  <SocialLink
   323|                    href="https://twitter.com"
   324|                    label="Twitter / X"
   325|                    icon={<Twitter size={20} />}
   326|                  />
   327|                </div>
   328|              </div>
   329|            </motion.div>
   330|          </div>
   331|        </div>
   332|      </section>
   333|    </main>
   334|  );
   335|}
   336|