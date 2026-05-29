src/pages/index.tsx [278 lines]
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion } from 'motion/react';
     3|import { Github, Linkedin, Twitter } from 'lucide-react';
     4|
     5|// ─── Animation Variants ───────────────────────────────────────────────────────
     6|
     7|const fadeUp = {
     8|  hidden: { opacity: 0, y: 28 },
     9|  visible: (delay = 0) => ({
    10|    opacity: 1,
    11|    y: 0,
    12|    transition: { duration: 0.55, ease: 'easeOut' as const, delay },
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
    25|// ─── Social Link ──────────────────────────────────────────────────────────────
    26|
    27|function SocialLink({
    28|  href,
    29|  label,
    30|  icon: Icon,
    31|}: {
    32|  href: string;
    33|  label: string;
    34|  icon: React.ElementType;
    35|}) {
    36|  return (
    37|    <a
    38|      href={href}
    39|      target="_blank"
    40|      rel="noopener noreferrer"
    41|      aria-label={label}
    42|      className="group flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors duration-200 ease-out"
    43|    >
    44|      <Icon size={18} strokeWidth={1.5} />
    45|      <span className="relative text-sm tracking-wide">
    46|        {label}
    47|        <span className="absolute -bottom-px left-0 w-0 h-px bg-primary transition-all duration-200 ease-out group-hover:w-full" />
    48|      </span>
    49|    </a>
    50|  );
    51|}
    52|
    53|// ─── Page ─────────────────────────────────────────────────────────────────────
    54|
    55|export default function HomePage() {
    56|  return (
    57|    <>
    58|      <Helmet>
    59|        <title>Alex Morgan — Designer & Developer</title>
    60|        <meta
    61|          name="description"
    62|          content="Alex Morgan is a designer and developer crafting thoughtful digital experiences at the intersection of design and engineering."
    63|        />
    64|      </Helmet>
    65|
    66|      {/* ── Hero ─────────────────────────────────────────────────────────── */}
    67|      <section
    68|        id="top"
    69|        className="relative min-h-screen flex flex-col justify-center px-6 md:px-12 max-w-6xl mx-auto"
    70|        aria-label="Introduction"
    71|      >
    72|        {/* Subtle top rule */}
    73|        <div className="absolute top-0 left-6 right-6 md:left-12 md:right-12 h-px bg-border" />
    74|
    75|        <div className="pt-24 pb-16">
    76|          {/* Eyebrow */}
    77|          <motion.p
    78|            className="text-xs tracking-[0.25em] uppercase text-muted-foreground mb-6"
    79|            variants={fadeUp}
    80|            initial="hidden"
    81|            animate="visible"
    82|            custom={0}
    83|          >
    84|            Portfolio
    85|          </motion.p>
    86|
    87|          {/* Name — fluid oversized display */}
    88|          <motion.h1
    89|            className="font-heading font-black leading-[0.9] tracking-tight text-foreground mb-8"
    90|            style={{
    91|              fontSize: 'clamp(4.5rem, 12vw, 11rem)',
    92|            }}
    93|            variants={fadeUp}
    94|            initial="hidden"
    95|            animate="visible"
    96|            custom={0.1}
    97|          >
    98|            Alex
    99|            <br />
   100|            <span className="text-primary">Morgan</span>
   101|          </motion.h1>
   102|
   103|          {/* Tagline */}
   104|          <motion.p
   105|            className="text-lg md:text-xl text-muted-foreground max-w-md leading-relaxed"
   106|            variants={fadeUp}
   107|            initial="hidden"
   108|            animate="visible"
   109|            custom={0.25}
   110|          >
   111|            Designer &amp; Developer crafting thoughtful
   112|            <br className="hidden md:block" /> digital experiences.
   113|          </motion.p>
   114|
   115|          {/* CTA */}
   116|          <motion.div
   117|            className="mt-10"
   118|            variants={fadeUp}
   119|            initial="hidden"
   120|            animate="visible"
   121|            custom={0.38}
   122|          >
   123|            <a
   124|              href="#about"
   125|              className="group inline-flex items-center gap-3 text-sm tracking-widest uppercase text-foreground hover:text-primary transition-colors duration-200 ease-out"
   126|            >
   127|              <span className="w-10 h-px bg-foreground group-hover:bg-primary transition-colors duration-200 ease-out" />
   128|              Learn more
   129|            </a>
   130|          </motion.div>
   131|        </div>
   132|
   133|        {/* Scroll indicator */}
   134|        <motion.div
   135|          className="absolute bottom-10 left-6 md:left-12 flex items-center gap-3"
   136|          variants={fadeUp}
   137|          initial="hidden"
   138|          animate="visible"
   139|          custom={0.55}
   140|        >
   141|          <motion.div
   142|            className="w-px h-12 bg-border origin-top"
   143|            animate={{ scaleY: [1, 0.4, 1] }}
   144|            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
   145|          />
   146|          <span className="text-xs tracking-[0.2em] uppercase text-muted-foreground">
   147|            Scroll
   148|          </span>
   149|        </motion.div>
   150|      </section>
   151|
   152|      {/* ── About ────────────────────────────────────────────────────────── */}
   153|      <section
   154|        id="about"
   155|        className="border-t border-border py-24 md:py-36 px-6 md:px-12 max-w-6xl mx-auto"
   156|        aria-label="About"
   157|      >
   158|        <motion.div
   159|          className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-12 md:gap-20 items-start"
   160|          variants={fadeIn}
   161|          initial="hidden"
   162|          whileInView="visible"
   163|          viewport={{ once: true, margin: '-80px' }}
   164|        >
   165|          {/* Left label */}
   166|          <div>
   167|            <p className="text-xs tracking-[0.25em] uppercase text-muted-foreground mb-3">
   168|              About
   169|            </p>
   170|            <h2 className="font-heading font-bold text-3xl md:text-4xl leading-tight text-foreground">
   171|              Background
   172|            </h2>
   173|          </div>
   174|
   175|          {/* Right content */}
   176|          <div className="space-y-6">
   177|            <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
   178|              Based in San Francisco, I build products at the intersection of
   179|              design and engineering. With 5+ years of experience across
   180|              startups and agencies, I care deeply about craft, clarity, and
   181|              the details that make digital experiences feel human.
   182|            </p>
   183|            <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
   184|              My work spans product design, front-end development, and design
   185|              systems — always with an eye toward simplicity and intentionality.
   186|            </p>
   187|
   188|            {/* Skills row */}
   189|            <div className="pt-4 flex flex-wrap gap-3">
   190|              {['Design Systems', 'React', 'TypeScript', 'Figma', 'Motion'].map(
   191|                (skill) => (
   192|                  <span
   193|                    key={skill}
   194|                    className="text-xs tracking-widest uppercase border border-border px-3 py-1.5 text-muted-foreground"
   195|                  >
   196|                    {skill}
   197|                  </span>
   198|                )
   199|              )}
   200|            </div>
   201|          </div>
   202|        </motion.div>
   203|      </section>
   204|
   205|      {/* ── Contact ──────────────────────────────────────────────────────── */}
   206|      <section
   207|        id="contact"
   208|        className="border-t border-border py-24 md:py-36 px-6 md:px-12 max-w-6xl mx-auto"
   209|        aria-label="Contact"
   210|      >
   211|        <motion.div
   212|          className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-12 md:gap-20 items-start"
   213|          variants={fadeIn}
   214|          initial="hidden"
   215|          whileInView="visible"
   216|          viewport={{ once: true, margin: '-80px' }}
   217|        >
   218|          {/* Left label */}
   219|          <div>
   220|            <p className="text-xs tracking-[0.25em] uppercase text-muted-foreground mb-3">
   221|              Contact
   222|            </p>
   223|            <h2 className="font-heading font-bold text-3xl md:text-4xl leading-tight text-foreground">
   224|              Get in touch
   225|            </h2>
   226|          </div>
   227|
   228|          {/* Right content */}
   229|          <div className="space-y-10">
   230|            <p className="text-base md:text-lg text-muted-foreground leading-relaxed max-w-md">
   231|              I'm always open to interesting projects and conversations. Feel
   232|              free to reach out.
   233|            </p>
   234|
   235|            {/* Email */}
   236|            <div>
   237|              <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-3">
   238|                Email
   239|              </p>
   240|              <a
   241|                href="mailto:hello@alexmorgan.com"
   242|                className="group relative inline-block font-heading font-bold text-2xl md:text-3xl text-foreground hover:text-primary transition-colors duration-200 ease-out"
   243|              >
   244|                hello@alexmorgan.com
   245|                <span className="absolute -bottom-1 left-0 w-0 h-px bg-primary transition-all duration-200 ease-out group-hover:w-full" />
   246|              </a>
   247|            </div>
   248|
   249|            {/* Socials */}
   250|            <div>
   251|              <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
   252|                Elsewhere
   253|              </p>
   254|              <div className="flex flex-wrap gap-6">
   255|                <SocialLink
   256|                  href="https://github.com"
   257|                  label="GitHub"
   258|                  icon={Github}
   259|                />
   260|                <SocialLink
   261|                  href="https://linkedin.com"
   262|                  label="LinkedIn"
   263|                  icon={Linkedin}
   264|                />
   265|                <SocialLink
   266|                  href="https://twitter.com"
   267|                  label="Twitter / X"
   268|                  icon={Twitter}
   269|                />
   270|              </div>
   271|            </div>
   272|          </div>
   273|        </motion.div>
   274|      </section>
   275|    </>
   276|  );
   277|}
   278|