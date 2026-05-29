src/pages/index.tsx [340-379 of 379]
   340|          <motion.div
   341|            variants={stagger}
   342|            initial="hidden"
   343|            whileInView="visible"
   344|            viewport={{ once: true }}
   345|            className="flex flex-col lg:flex-row items-center justify-between gap-10"
   346|          >
   347|            <motion.div variants={fadeUp} className="text-center lg:text-left">
   348|              <h2 className="text-3xl sm:text-4xl font-bold text-primary-foreground mb-3">
   349|                Ready for a Cleaner Home?
   350|              </h2>
   351|              <p className="text-primary-foreground/80 text-lg">
   352|                Get your free, no-obligation quote today. We'll be in touch within 24 hours.
   353|              </p>
   354|            </motion.div>
   355|
   356|            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center gap-4 shrink-0">
   357|              <a
   358|                href="tel:+15555550100"
   359|                className="flex items-center gap-2 text-primary-foreground font-bold text-lg hover:text-primary-foreground/80 transition-colors duration-200"
   360|              >
   361|                <Phone className="w-5 h-5" />
   362|                (555) 555-0100
   363|              </a>
   364|              <Button
   365|                asChild
   366|                size="lg"
   367|                variant="secondary"
   368|                className="rounded-full px-8 font-semibold text-base"
   369|              >
   370|                <Link to="/contact">Request a Quote</Link>
   371|              </Button>
   372|            </motion.div>
   373|          </motion.div>
   374|        </div>
   375|      </section>
   376|    </>
   377|  );
   378|}
   379|