src/pages/index.tsx [310-386 of 387] (truncated — use startLine/numLines to read remaining)
   310|      <div className="max-w-7xl mx-auto px-6 md:px-12">
   311|        <div className="h-px bg-border/20" />
   312|      </div>
   313|
   314|      {/* ── CONTACT ──────────────────────────────────────────────────────── */}
   315|      <section id="contact" className="py-32 px-6 md:px-12">
   316|        <div className="max-w-7xl mx-auto">
   317|          <FadeIn>
   318|            <div className="flex items-center gap-4 mb-16">
   319|              <p className="text-xs tracking-[0.3em] uppercase text-primary">03</p>
   320|              <div className="h-px w-8 bg-primary" />
   321|              <h2 className="text-xs tracking-[0.3em] uppercase text-muted-foreground">Contact</h2>
   322|            </div>
   323|          </FadeIn>
   324|
   325|          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-end">
   326|            {/* Left — copy + email */}
   327|            <div>
   328|              <FadeIn delay={0.1}>
   329|                <h3
   330|                  className="font-heading font-bold text-foreground leading-tight mb-6"
   331|                  style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)' }}
   332|                >
   333|                  Let's make
   334|                  <br />
   335|                  something{' '}
   336|                  <span className="text-primary">great.</span>
   337|                </h3>
   338|              </FadeIn>
   339|
   340|              <FadeIn delay={0.2}>
   341|                <p className="text-muted-foreground leading-relaxed mb-10 max-w-sm">
   342|                  I'm open to freelance projects, full-time roles, and interesting collaborations.
   343|                  Drop me a line — I'd love to hear what you're working on.
   344|                </p>
   345|              </FadeIn>
   346|
   347|              <FadeIn delay={0.3}>
   348|                <a
   349|                  href="mailto:hello@alexjohnson.co"
   350|                  className="group inline-flex items-center gap-3 text-foreground hover:text-primary transition-colors duration-200"
   351|                >
   352|                  <Mail size={18} className="text-primary shrink-0" />
   353|                  <span
   354|                    className="font-heading font-semibold relative"
   355|                    style={{ fontSize: 'clamp(1.1rem, 2.5vw, 1.6rem)' }}
   356|                  >
   357|                    hello@alexjohnson.co
   358|                    <span className="absolute -bottom-1 left-0 h-px w-0 bg-primary transition-all duration-300 group-hover:w-full" />
   359|                  </span>
   360|                </a>
   361|              </FadeIn>
   362|            </div>
   363|
   364|            {/* Right — social icons */}
   365|            <FadeIn delay={0.2} className="flex flex-col gap-8 md:items-end">
   366|              <p className="text-xs tracking-widest uppercase text-muted-foreground">
   367|                Find me online
   368|              </p>
   369|              <div className="flex items-center gap-6">
   370|                <SocialLink href="https://github.com" label="GitHub">
   371|                  <Github size={22} />
   372|                </SocialLink>
   373|                <SocialLink href="https://linkedin.com" label="LinkedIn">
   374|                  <Linkedin size={22} />
   375|                </SocialLink>
   376|                <SocialLink href="https://twitter.com" label="Twitter / X">
   377|                  <Twitter size={22} />
   378|                </SocialLink>
   379|              </div>
   380|            </FadeIn>
   381|          </div>
   382|        </div>
   383|      </section>
   384|    </>
   385|  );
   386|}