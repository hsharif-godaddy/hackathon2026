src/pages/index.tsx [195-224 of 365] (truncated — use startLine/numLines to read remaining)
   195|                  <p className="text-muted-foreground text-sm leading-relaxed">
   196|                    Weekly, bi-weekly, or monthly visits to keep your home consistently fresh.
   197|                    Dusting, vacuuming, mopping, kitchen, and bathrooms — all taken care of.
   198|                  </p>
   199|                  <Link
   200|                    to="/services"
   201|                    className="mt-4 text-sm font-semibold text-primary hover:underline"
   202|                  >
   203|                    Learn more →
   204|                  </Link>
   205|                </div>
   206|              </motion.div>
   207|
   208|              {/* Deep Cleaning */}
   209|              <motion.div
   210|                variants={fadeUp}
   211|                custom={0.1}
   212|                whileHover={{ y: -4, boxShadow: '0 20px 40px -12px rgba(0,0,0,0.12)' }}
   213|                className="bg-primary text-primary-foreground rounded-2xl overflow-hidden shadow-sm flex flex-col"
   214|              >
   215|                <div className="h-44 overflow-hidden">
   216|                  <img
   217|                    src="/airo-assets/images/pages/home/bathroom-clean"
   218|                    alt="Sparkling bathroom"
   219|                    className="w-full h-full object-cover opacity-80"
   220|                  />
   221|                </div>
   222|                <div className="p-7 flex flex-col flex-1 justify-between">
   223|                  <div>
   224|                    <h3 className="text-xl font-bold mb-3">Deep Cleaning</h3>