src/layouts/parts/Header.tsx [85 lines]
     1|import { Link, useLocation } from 'react-router-dom';
     2|import { Menu, X } from 'lucide-react';
     3|import { useState } from 'react';
     4|
     5|export default function Header() {
     6|  const location = useLocation();
     7|  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
     8|
     9|  const navItems = [
    10|    { href: '/#about', label: 'About' },
    11|    { href: '/#contact', label: 'Contact' },
    12|  ];
    13|
    14|  return (
    15|    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
    16|      <div className="max-w-6xl mx-auto px-6 md:px-10">
    17|        <div className="flex h-20 items-center justify-between">
    18|          {/* Logo */}
    19|          <Link to="/" className="flex items-center shrink-0">
    20|            <img
    21|              src="/airo-assets/images/logo/horizontal"
    22|              alt="Alex Morgan"
    23|              className="h-8 w-auto object-contain"
    24|            />
    25|          </Link>
    26|
    27|          {/* Desktop Nav */}
    28|          <nav className="hidden md:flex items-center gap-10">
    29|            {navItems.map((item) => (
    30|              <a
    31|                key={item.href}
    32|                href={item.href}
    33|                className="relative text-sm font-medium tracking-wide text-muted-foreground transition-colors hover:text-foreground group"
    34|              >
    35|                {item.label}
    36|                <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-primary transition-all duration-300 group-hover:w-full" />
    37|              </a>
    38|            ))}
    39|            <a
    40|              href="mailto:hello@alexmorgan.dev"
    41|              className="text-sm font-medium tracking-wide text-primary border border-primary/40 px-4 py-1.5 hover:bg-primary hover:text-background transition-all duration-200"
    42|            >
    43|              Hire Me
    44|            </a>
    45|          </nav>
    46|
    47|          {/* Mobile Toggle */}
    48|          <button
    49|            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
    50|            className="md:hidden p-2 text-muted-foreground hover:text-foreground transition-colors"
    51|            aria-label="Toggle menu"
    52|          >
    53|            {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
    54|          </button>
    55|        </div>
    56|
    57|        {/* Mobile Menu */}
    58|        {isMobileMenuOpen && (
    59|          <div className="md:hidden border-t border-border py-6">
    60|            <nav className="flex flex-col gap-4">
    61|              {navItems.map((item) => (
    62|                <a
    63|                  key={item.href}
    64|                  href={item.href}
    65|                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-1"
    66|                  onClick={() => setIsMobileMenuOpen(false)}
    67|                >
    68|                  {item.label}
    69|                </a>
    70|              ))}
    71|              <a
    72|                href="mailto:hello@alexmorgan.dev"
    73|                className="text-sm font-medium text-primary mt-2"
    74|                onClick={() => setIsMobileMenuOpen(false)}
    75|              >
    76|                Hire Me →
    77|              </a>
    78|            </nav>
    79|          </div>
    80|        )}
    81|      </div>
    82|    </header>
    83|  );
    84|}
    85|