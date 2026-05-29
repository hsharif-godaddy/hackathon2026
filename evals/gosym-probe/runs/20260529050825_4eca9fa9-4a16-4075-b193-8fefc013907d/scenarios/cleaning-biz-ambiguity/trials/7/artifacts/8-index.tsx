src/pages/index.tsx [80-129 of 358] (truncated — use startLine/numLines to read remaining)
    80|        <div className="container mx-auto px-4 py-16 md:py-24">
    81|          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
    82|            {/* Text */}
    83|            <motion.div
    84|              variants={stagger}
    85|              initial="hidden"
    86|              animate="visible"
    87|              className="flex flex-col gap-6"
    88|            >
    89|              <motion.div variants={fadeUp}>
    90|                <span className="inline-block text-xs font-semibold tracking-widest text-primary uppercase bg-primary/10 px-3 py-1 rounded-full mb-4">
    91|                  Trusted House Cleaning
    92|                </span>
    93|                <h1 className="font-heading text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight">
    94|                  A cleaner home,{' '}
    95|                  <span className="relative inline-block text-primary">
    96|                    guaranteed.
    97|                    {/* Hand-drawn underline accent */}
    98|                    <svg
    99|                      className="absolute -bottom-2 left-0 w-full"
   100|                      viewBox="0 0 200 12"
   101|                      fill="none"
   102|                      xmlns="http://www.w3.org/2000/svg"
   103|                      aria-hidden="true"
   104|                    >
   105|                      <path
   106|                        d="M2 9 C40 3, 80 11, 120 6 C160 1, 185 8, 198 5"
   107|                        stroke="currentColor"
   108|                        strokeWidth="3"
   109|                        strokeLinecap="round"
   110|                        fill="none"
   111|                        opacity="0.5"
   112|                      />
   113|                    </svg>
   114|                  </span>
   115|                </h1>
   116|              </motion.div>
   117|
   118|              <motion.p variants={fadeUp} className="text-foreground/70 text-lg leading-relaxed max-w-md">
   119|                Professional, reliable house cleaning you can count on. I take pride in every home I clean — so you can come back to a space that feels fresh and cared for.
   120|              </motion.p>
   121|
   122|              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-3">
   123|                <a
   124|                  href="tel:+15551234567"
   125|                  className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3.5 rounded-full font-semibold text-sm hover:bg-primary/90 transition-colors duration-200 shadow-md"
   126|                >
   127|                  <Phone size={16} />
   128|                  Call (555) 123-4567
   129|                </a>