src/pages/index.tsx [290-352 of 353] (truncated — use startLine/numLines to read remaining)
   290|              <motion.p variants={fadeUp} className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">
   291|                Ready to Shine?
   292|              </motion.p>
   293|              <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight">
   294|                Let's Make Your Home Sparkle
   295|              </motion.h2>
   296|              <motion.p variants={fadeUp} className="text-gray-600 leading-relaxed mb-8 text-lg">
   297|                Get a free, no-obligation quote today. We'll find the right cleaning plan for your home and schedule — no hassle, no pressure.
   298|              </motion.p>
   299|              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4">
   300|                <Link
   301|                  to="/contact"
   302|                  className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground font-bold px-8 py-4 rounded-full text-base hover:bg-primary/90 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
   303|                >
   304|                  Get a Free Quote
   305|                  <ArrowRight size={16} />
   306|                </Link>
   307|                <a
   308|                  href="tel:+15555550100"
   309|                  className="inline-flex items-center justify-center gap-2 border-2 border-gray-900 text-gray-900 font-semibold px-8 py-4 rounded-full text-base hover:bg-gray-900 hover:text-white transition-all duration-200"
   310|                >
   311|                  <Phone size={16} />
   312|                  Call Us Now
   313|                </a>
   314|              </motion.div>
   315|            </motion.div>
   316|
   317|            {/* Photo side */}
   318|            <motion.div
   319|              className="relative"
   320|              initial={{ opacity: 0, x: 40 }}
   321|              whileInView={{ opacity: 1, x: 0, transition: { duration: 0.5, ease: 'easeOut' as const } }}
   322|              viewport={{ once: true }}
   323|            >
   324|              <div className="relative rounded-2xl overflow-hidden shadow-2xl aspect-[3/4] max-w-sm mx-auto md:mx-0 md:ml-auto">
   325|                <img
   326|                  src="/airo-assets/images/pages/home/cta-photo"
   327|                  alt="Professional house cleaner"
   328|                  className="w-full h-full object-cover"
   329|                />
   330|                {/* Floating badge */}
   331|                <div className="absolute bottom-6 left-6 bg-white rounded-xl px-4 py-3 shadow-lg">
   332|                  <div className="flex items-center gap-2">
   333|                    <div className="flex gap-0.5">
   334|                      {[1,2,3,4,5].map(i => (
   335|                        <Star key={i} size={12} className="fill-yellow-400 text-yellow-400" />
   336|                      ))}
   337|                    </div>
   338|                    <span className="text-xs font-semibold text-gray-800">5-Star Rated</span>
   339|                  </div>
   340|                  <p className="text-xs text-gray-500 mt-0.5">500+ happy homeowners</p>
   341|                </div>
   342|              </div>
   343|              {/* Decorative element */}
   344|              <div className="absolute -top-6 -right-6 w-32 h-32 bg-yellow-200 rounded-full opacity-60 -z-10" />
   345|              <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-primary/20 rounded-full -z-10" />
   346|            </motion.div>
   347|          </div>
   348|        </div>
   349|      </section>
   350|    </>
   351|  );
   352|}