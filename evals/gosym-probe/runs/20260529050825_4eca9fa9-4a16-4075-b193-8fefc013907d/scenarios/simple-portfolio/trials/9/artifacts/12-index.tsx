src/pages/index.tsx [245-309 of 387] (truncated — use startLine/numLines to read remaining)
   245|                    'UI Design',
   246|                    'Front-End Dev',
   247|                    'Motion',
   248|                    'Branding',
   249|                    'React / TypeScript',
   250|                    'Figma',
   251|                  ].map((skill) => (
   252|                    <SkillTag key={skill} label={skill} />
   253|                  ))}
   254|                </div>
   255|              </FadeIn>
   256|            </div>
   257|
   258|            {/* Image column */}
   259|            <FadeIn delay={0.2} className="relative">
   260|              <div className="relative aspect-square overflow-hidden">
   261|                <img
   262|                  src="/airo-assets/images/pages/home/avatar"
   263|                  alt="Alex Johnson"
   264|                  className="w-full h-full object-cover grayscale"
   265|                />
   266|                {/* Amber overlay tint */}
   267|                <div className="absolute inset-0 bg-primary/10 mix-blend-multiply" />
   268|              </div>
   269|              {/* Decorative offset border */}
   270|              <div className="absolute -bottom-4 -right-4 w-full h-full border border-primary/30 -z-10" />
   271|            </FadeIn>
   272|          </div>
   273|        </div>
   274|      </section>
   275|
   276|      {/* Divider */}
   277|      <div className="max-w-7xl mx-auto px-6 md:px-12">
   278|        <div className="h-px bg-border/20" />
   279|      </div>
   280|
   281|      {/* ── WORK ─────────────────────────────────────────────────────────── */}
   282|      <section id="work" className="py-32 px-6 md:px-12">
   283|        <div className="max-w-7xl mx-auto">
   284|          <FadeIn>
   285|            <div className="flex items-center gap-4 mb-16">
   286|              <p className="text-xs tracking-[0.3em] uppercase text-primary">02</p>
   287|              <div className="h-px w-8 bg-primary" />
   288|              <h2 className="text-xs tracking-[0.3em] uppercase text-muted-foreground">Work</h2>
   289|            </div>
   290|          </FadeIn>
   291|
   292|          <FadeIn delay={0.1}>
   293|            <h3
   294|              className="font-heading font-bold text-foreground leading-tight mb-16"
   295|              style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)' }}
   296|            >
   297|              Selected projects.
   298|            </h3>
   299|          </FadeIn>
   300|
   301|          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 md:gap-16">
   302|            {PROJECTS.map((project, i) => (
   303|              <ProjectCard key={project.index} project={project} delay={i * 0.1} />
   304|            ))}
   305|          </div>
   306|        </div>
   307|      </section>
   308|
   309|      {/* Divider */}