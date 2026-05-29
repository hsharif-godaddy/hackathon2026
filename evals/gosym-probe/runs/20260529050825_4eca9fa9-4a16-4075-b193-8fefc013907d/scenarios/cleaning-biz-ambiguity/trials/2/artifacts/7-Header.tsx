src/layouts/parts/Header.tsx [55-69 of 103] (truncated — use startLine/numLines to read remaining)
    55|            ))}
    56|          </nav>
    57|
    58|          {/* CTA + Mobile Toggle */}
    59|          <div className="flex items-center gap-3">
    60|            <Button asChild className="hidden md:inline-flex rounded-full px-6 font-semibold shadow-sm">
    61|              <Link to="/contact">Book Now</Link>
    62|            </Button>
    63|            <button
    64|              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
    65|              className="md:hidden p-2 hover:bg-muted rounded-md transition-colors"
    66|              aria-label="Toggle menu"
    67|            >
    68|              {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
    69|            </button>