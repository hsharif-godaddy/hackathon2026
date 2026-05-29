src/pages/index.tsx [270-329 of 329]
   270|                custom={i * 0.1}
   271|              >
   272|                {/* Stars */}
   273|                <div className="flex gap-1 mb-4">
   274|                  {Array.from({ length: t.stars }).map((_, j) => (
   275|                    <Star key={j} size={16} className="fill-yellow-400 text-yellow-400" />
   276|                  ))}
   277|                </div>
   278|                <p className="text-gray-700 leading-relaxed mb-6 italic">"{t.quote}"</p>
   279|                <div>
   280|                  <p className="font-semibold text-gray-900">{t.name}</p>
   281|                  <p className="text-sm text-gray-500">{t.location}</p>
   282|                </div>
   283|              </motion.div>
   284|            ))}
   285|          </div>
   286|        </div>
   287|      </section>
   288|
   289|      {/* ── CTA ──────────────────────────────────────────────────────────── */}
   290|      <section className="relative py-32 overflow-hidden">
   291|        {/* Background */}
   292|        <div className="absolute inset-0">
   293|          <img
   294|            src="/airo-assets/images/pages/home/cta-background"
   295|            alt="Spotless clean kitchen"
   296|            className="w-full h-full object-cover"
   297|          />
   298|          <div className="absolute inset-0 bg-gradient-to-r from-gray-900/85 via-gray-900/70 to-gray-900/40" />
   299|        </div>
   300|
   301|        {/* Content — asymmetric left-aligned */}
   302|        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
   303|          <motion.div
   304|            className="max-w-xl"
   305|            variants={fadeUp}
   306|            initial="hidden"
   307|            whileInView="visible"
   308|            viewport={{ once: true }}
   309|          >
   310|            <h2 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-6">
   311|              Ready for a Home That Truly Shines?
   312|            </h2>
   313|            <p className="text-gray-300 text-lg leading-relaxed mb-10">
   314|              Book your first cleaning today and see the Sparkle Clean difference. Free quotes, flexible scheduling, and results you'll love.
   315|            </p>
   316|            <Button
   317|              asChild
   318|              size="lg"
   319|              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-full px-10 py-6 text-base font-semibold shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5"
   320|            >
   321|              <Link to="/contact">Book Your Cleaning</Link>
   322|            </Button>
   323|          </motion.div>
   324|        </div>
   325|      </section>
   326|    </>
   327|  );
   328|}
   329|