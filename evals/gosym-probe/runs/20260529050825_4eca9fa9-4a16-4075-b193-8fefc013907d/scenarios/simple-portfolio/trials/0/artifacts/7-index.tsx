src/pages/index.tsx [380-462 of 463] (truncated — use startLine/numLines to read remaining)
   380|              <span className="text-primary">something.</span>
   381|            </h2>
   382|            <p className="mt-6 text-muted-foreground leading-relaxed max-w-sm">
   383|              Have a project in mind or just want to say hello? My inbox is always open.
   384|            </p>
   385|          </FadeInSection>
   386|
   387|          {/* Contact details */}
   388|          <FadeInSection delay={0.15}>
   389|            <div className="space-y-10">
   390|              {/* Email */}
   391|              <div>
   392|                <p className="text-xs tracking-[0.25em] uppercase text-muted-foreground mb-3">
   393|                  Email
   394|                </p>
   395|                <a
   396|                  href="mailto:hello@jordanlee.dev"
   397|                  className="text-xl font-medium text-foreground hover:text-primary transition-colors duration-200 underline underline-offset-4 decoration-primary/40 hover:decoration-primary"
   398|                >
   399|                  hello@jordanlee.dev
   400|                </a>
   401|              </div>
   402|
   403|              {/* Social */}
   404|              <div>
   405|                <p className="text-xs tracking-[0.25em] uppercase text-muted-foreground mb-4">
   406|                  Find me online
   407|                </p>
   408|                <div className="flex items-center gap-3">
   409|                  <SocialIcon href="https://github.com" label="GitHub">
   410|                    <Github size={20} />
   411|                  </SocialIcon>
   412|                  <SocialIcon href="https://linkedin.com" label="LinkedIn">
   413|                    <Linkedin size={20} />
   414|                  </SocialIcon>
   415|                  <SocialIcon href="https://twitter.com" label="Twitter / X">
   416|                    <Twitter size={20} />
   417|                  </SocialIcon>
   418|                  <SocialIcon href="mailto:hello@jordanlee.dev" label="Email">
   419|                    <Mail size={20} />
   420|                  </SocialIcon>
   421|                </div>
   422|              </div>
   423|
   424|              {/* Availability badge */}
   425|              <div className="flex items-center gap-3">
   426|                <motion.div
   427|                  className="w-2 h-2 rounded-full bg-primary"
   428|                  animate={{ opacity: [1, 0.3, 1] }}
   429|                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
   430|                  style={{ boxShadow: '0 0 8px rgba(0,212,255,0.8)' }}
   431|                />
   432|                <span className="text-sm text-muted-foreground">
   433|                  Available for new projects
   434|                </span>
   435|              </div>
   436|            </div>
   437|          </FadeInSection>
   438|        </div>
   439|      </div>
   440|    </section>
   441|  );
   442|}
   443|
   444|// ─── Page ────────────────────────────────────────────────────────────────────
   445|export default function HomePage() {
   446|  return (
   447|    <>
   448|      <Helmet>
   449|        <title>Jordan Lee — Full-Stack Developer & Creator</title>
   450|        <meta
   451|          name="description"
   452|          content="Jordan Lee is a full-stack software engineer and creator building fast, thoughtful products."
   453|        />
   454|      </Helmet>
   455|      <main>
   456|        <HeroSection />
   457|        <AboutSection />
   458|        <ContactSection />
   459|      </main>
   460|    </>
   461|  );
   462|}