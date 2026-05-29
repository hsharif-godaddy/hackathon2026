src/pages/index.tsx [100-129 of 387] (truncated — use startLine/numLines to read remaining)
   100|      transition={{ duration: 0.15 }}
   101|    >
   102|      {children}
   103|    </motion.a>
   104|  );
   105|}
   106|
   107|// ─── Page ─────────────────────────────────────────────────────────────────────
   108|export default function HomePage() {
   109|  const heroRef = useRef<HTMLElement>(null);
   110|  const { scrollYProgress } = useScroll({
   111|    target: heroRef,
   112|    offset: ['start start', 'end start'],
   113|  });
   114|  const heroOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
   115|
   116|  return (
   117|    <>
   118|      <Helmet>
   119|        <title>Alex Johnson — Designer & Developer</title>
   120|        <meta
   121|          name="description"
   122|          content="Personal portfolio of Alex Johnson — a designer and developer crafting thoughtful digital experiences."
   123|        />
   124|      </Helmet>
   125|
   126|      {/* ── HERO ─────────────────────────────────────────────────────────── */}
   127|      <motion.section
   128|        ref={heroRef}
   129|        id="top"