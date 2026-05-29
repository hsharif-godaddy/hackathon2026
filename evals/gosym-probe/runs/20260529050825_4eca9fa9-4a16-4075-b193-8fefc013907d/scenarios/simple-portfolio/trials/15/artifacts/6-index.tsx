src/pages/index.tsx [323 lines]
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion } from 'motion/react';
     3|import { Github, Linkedin, Twitter, ArrowDown, Mail } from 'lucide-react';
     4|
     5|// ─── Animation variants ───────────────────────────────────────────────────────
     6|const fadeUp = {
     7|  hidden: { opacity: 0, y: 28 },
     8|  visible: (delay = 0) => ({
     9|    opacity: 1,
    10|    y: 0,
    11|    transition: { duration: 0.6, ease: 'easeOut' as const, delay },
    12|  }),
    13|};
    14|
    15|const fadeIn = {
    16|  hidden: { opacity: 0, y: 16 },
    17|  visible: {
    18|    opacity: 1,
    19|    y: 0,
    20|    transition: { duration: 0.5, ease: 'easeOut' as const },
    21|  },
    22|};
    23|
    24|// ─── Skills list ──────────────────────────────────────────────────────────────
    25|const skills = [
    26|  'React', 'TypeScript', 'Node.js', 'UI/UX Design',
    27|  'Figma', 'CSS / Tailwind', 'GraphQL', 'Next.js',
    28|];
    29|
    30|const socials = [
    31|  { href: 'https://github.com', label: 'GitHub', Icon: Github },
    32|  { href: 'https://linkedin.com', label: 'LinkedIn', Icon: Linkedin },
    33|  { href: 'https://twitter.com', label: 'Twitter / X', Icon: Twitter },
    34|];
    35|
    36|export default function HomePage() {
    37|  return (
    38|    <>
    39|      <Helmet>
    40|        <title>Your Name — Designer &amp; Developer</title>
    41|        <meta
    42|          name="description"
    43|          content="Personal portfolio of Your Name — a designer and developer crafting thoughtful digital experiences."
    44|        />
    45|      </Helmet>
    46|
    47|      {/* ── HERO ─────────────────────────────────────────────────────────── */}
    48|      <section className="relative min-h-screen flex flex-col justify-center overflow-hidden">
    49|        {/* Subtle dot-grid background */}
    50|        <div
    51|          className="absolute inset-0 pointer-events-none"
    52|          style={{
    53|            backgroundImage:
    54|              'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
    55|            backgroundSize: '28px 28px',
    56|            opacity: 0.55,
    57|          }}
    58|        />
    59|
    60|        {/* Thin amber accent line — top-left decoration */}
    61|        <div className="absolute top-0 left-0 w-px h-40 bg-primary opacity-60" />
    62|        <div className="absolute top-0 left-0 h-px w-40 bg-primary opacity-60" />
    63|
    64|        <div className="relative max-w-6xl mx-auto px-6 md:px-10 pt-32 pb-24">
    65|          {/* Eyebrow */}
    66|          <motion.p
    67|            className="text-xs tracking-[0.25em] uppercase text-primary font-medium mb-6"
    68|            variants={fadeUp}
    69|            initial="hidden"
    70|            animate="visible"
    71|            custom={0}
    72|          >
    73|            Portfolio
    74|          </motion.p>
    75|
    76|          {/* Name — oversized, grid-breaking serif */}
    77|          <motion.h1
    78|            className="font-heading text-[clamp(3.5rem,12vw,9rem)] leading-[0.9] tracking-tight text-foreground mb-8 -ml-1"
    79|            variants={fadeUp}
    80|            initial="hidden"
    81|            animate="visible"
    82|            custom={0.1}
    83|          >
    84|            Your
    85|            <br />
    86|            <span className="text-primary">Name.</span>
    87|          </motion.h1>
    88|
    89|          {/* Thin rule */}
    90|          <motion.div
    91|            className="w-16 h-px bg-border mb-8"
    92|            variants={fadeUp}
    93|            initial="hidden"
    94|            animate="visible"
    95|            custom={0.25}
    96|          />
    97|
    98|          {/* Tagline */}
    99|          <motion.p
   100|            className="text-lg md:text-xl text-muted-foreground max-w-md leading-relaxed"
   101|            variants={fadeUp}
   102|            initial="hidden"
   103|            animate="visible"
   104|            custom={0.35}
   105|          >
   106|            Designer &amp; developer crafting thoughtful digital experiences
   107|            that sit at the intersection of form and function.
   108|          </motion.p>
   109|
   110|          {/* CTA */}
   111|          <motion.div
   112|            className="mt-10 flex items-center gap-6"
   113|            variants={fadeUp}
   114|            initial="hidden"
   115|            animate="visible"
   116|            custom={0.5}
   117|          >
   118|            <a
   119|              href="#about"
   120|              className="relative inline-block text-sm tracking-widest uppercase font-medium text-foreground group"
   121|            >
   122|              View my work
   123|              <span className="absolute -bottom-0.5 left-0 h-px w-full bg-primary transition-transform duration-200 origin-left scale-x-100 group-hover:scale-x-0" />
   124|            </a>
   125|            <a
   126|              href="#contact"
   127|              className="relative inline-block text-sm tracking-widest uppercase font-medium text-muted-foreground group hover:text-foreground transition-colors duration-200"
   128|            >
   129|              Get in touch
   130|              <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-border transition-all duration-200 group-hover:w-full" />
   131|            </a>
   132|          </motion.div>
   133|        </div>
   134|
   135|        {/* Scroll indicator */}
   136|        <motion.div
   137|          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-muted-foreground"
   138|          initial={{ opacity: 0 }}
   139|          animate={{ opacity: 1 }}
   140|          transition={{ delay: 1.2, duration: 0.6 }}
   141|        >
   142|          <span className="text-xs tracking-widest uppercase">Scroll</span>
   143|          <motion.div
   144|            animate={{ y: [0, 6, 0] }}
   145|            transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
   146|          >
   147|            <ArrowDown size={14} />
   148|          </motion.div>
   149|        </motion.div>
   150|      </section>
   151|
   152|      {/* ── ABOUT ────────────────────────────────────────────────────────── */}
   153|      <section id="about" className="py-28 md:py-36 bg-card">
   154|        <div className="max-w-6xl mx-auto px-6 md:px-10">
   155|          {/* Section label */}
   156|          <motion.p
   157|            className="text-xs tracking-[0.25em] uppercase text-primary font-medium mb-12"
   158|            variants={fadeIn}
   159|            initial="hidden"
   160|            whileInView="visible"
   161|            viewport={{ once: true }}
   162|          >
   163|            About
   164|          </motion.p>
   165|
   166|          {/* Two-column asymmetric layout */}
   167|          <div className="grid grid-cols-1 md:grid-cols-[3fr_1.2fr] gap-16 md:gap-24 items-start">
   168|            {/* Left — text */}
   169|            <motion.div
   170|              variants={fadeIn}
   171|              initial="hidden"
   172|              whileInView="visible"
   173|              viewport={{ once: true }}
   174|            >
   175|              <h2 className="font-heading text-4xl md:text-5xl text-foreground leading-tight mb-8">
   176|                I build things that
   177|                <br />
   178|                <em className="not-italic text-primary">feel right.</em>
   179|              </h2>
   180|              <div className="space-y-5 text-muted-foreground leading-relaxed max-w-xl">
   181|                <p>
   182|                  I'm a designer and developer with a passion for creating
   183|                  digital products that are both beautiful and functional. With
   184|                  over five years of experience, I've worked with startups and
   185|                  established companies to bring ideas to life.
   186|                </p>
   187|                <p>
   188|                  My approach blends strong visual instincts with clean,
   189|                  maintainable code. I believe the best products emerge when
   190|                  design and engineering work in harmony — not in silos.
   191|                </p>
   192|                <p>
   193|                  When I'm not at my desk, you'll find me exploring typography,
   194|                  reading about systems thinking, or hiking somewhere with bad
   195|                  cell service.
   196|                </p>
   197|              </div>
   198|            </motion.div>
   199|
   200|            {/* Right — skills */}
   201|            <motion.div
   202|              variants={fadeIn}
   203|              initial="hidden"
   204|              whileInView="visible"
   205|              viewport={{ once: true }}
   206|              className="md:pt-2"
   207|            >
   208|              {/* Decorative accent block */}
   209|              <div className="w-full aspect-square max-w-[180px] mb-8 relative">
   210|                <div className="absolute inset-0 border border-border" />
   211|                <div className="absolute inset-3 border border-primary/30" />
   212|                <div className="absolute inset-6 bg-primary/10" />
   213|              </div>
   214|
   215|              <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4 font-medium">
   216|                Skills
   217|              </p>
   218|              <ul className="space-y-2">
   219|                {skills.map((skill) => (
   220|                  <li
   221|                    key={skill}
   222|                    className="text-sm text-foreground flex items-center gap-2"
   223|                  >
   224|                    <span className="w-1 h-1 rounded-full bg-primary shrink-0" />
   225|                    {skill}
   226|                  </li>
   227|                ))}
   228|              </ul>
   229|            </motion.div>
   230|          </div>
   231|        </div>
   232|      </section>
   233|
   234|      {/* Thin rule divider */}
   235|      <div className="max-w-6xl mx-auto px-6 md:px-10">
   236|        <div className="h-px bg-border" />
   237|      </div>
   238|
   239|      {/* ── CONTACT ──────────────────────────────────────────────────────── */}
   240|      <section id="contact" className="py-28 md:py-36">
   241|        <div className="max-w-6xl mx-auto px-6 md:px-10">
   242|          {/* Section label */}
   243|          <motion.p
   244|            className="text-xs tracking-[0.25em] uppercase text-primary font-medium mb-12"
   245|            variants={fadeIn}
   246|            initial="hidden"
   247|            whileInView="visible"
   248|            viewport={{ once: true }}
   249|          >
   250|            Contact
   251|          </motion.p>
   252|
   253|          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-16 items-start">
   254|            {/* Left — email CTA */}
   255|            <motion.div
   256|              variants={fadeIn}
   257|              initial="hidden"
   258|              whileInView="visible"
   259|              viewport={{ once: true }}
   260|            >
   261|              <h2 className="font-heading text-4xl md:text-5xl text-foreground leading-tight mb-6">
   262|                Let's work
   263|                <br />
   264|                together.
   265|              </h2>
   266|              <p className="text-muted-foreground leading-relaxed max-w-sm mb-10">
   267|                Have a project in mind or just want to say hello? My inbox is
   268|                always open.
   269|              </p>
   270|
   271|              {/* Large email link */}
   272|              <a
   273|                href="mailto:hello@yourname.com"
   274|                className="group inline-flex items-center gap-3 text-foreground hover:text-primary transition-colors duration-200"
   275|              >
   276|                <Mail size={18} className="text-primary shrink-0" />
   277|                <span className="relative text-lg font-medium">
   278|                  hello@yourname.com
   279|                  <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-primary transition-all duration-200 group-hover:w-full" />
   280|                </span>
   281|              </a>
   282|            </motion.div>
   283|
   284|            {/* Right — social icons */}
   285|            <motion.div
   286|              variants={fadeIn}
   287|              initial="hidden"
   288|              whileInView="visible"
   289|              viewport={{ once: true }}
   290|              className="md:pt-2"
   291|            >
   292|              <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-6 font-medium">
   293|                Find me on
   294|              </p>
   295|              <ul className="space-y-4">
   296|                {socials.map(({ href, label, Icon }) => (
   297|                  <li key={label}>
   298|                    <a
   299|                      href={href}
   300|                      target="_blank"
   301|                      rel="noopener noreferrer"
   302|                      className="group inline-flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors duration-200"
   303|                    >
   304|                      <Icon
   305|                        size={18}
   306|                        className="text-muted-foreground group-hover:text-primary transition-colors duration-200 shrink-0"
   307|                      />
   308|                      <span className="relative text-sm font-medium">
   309|                        {label}
   310|                        <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-primary transition-all duration-200 group-hover:w-full" />
   311|                      </span>
   312|                    </a>
   313|                  </li>
   314|                ))}
   315|              </ul>
   316|            </motion.div>
   317|          </div>
   318|        </div>
   319|      </section>
   320|    </>
   321|  );
   322|}
   323|