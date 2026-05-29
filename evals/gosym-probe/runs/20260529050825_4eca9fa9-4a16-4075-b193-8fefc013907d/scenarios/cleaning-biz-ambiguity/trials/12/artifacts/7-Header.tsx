src/layouts/parts/Header.tsx [97 lines]
     1|import { Link, useLocation } from 'react-router-dom';
     2|import { Menu, X, Phone } from 'lucide-react';
     3|import { useState } from 'react';
     4|
     5|export default function Header() {
     6|  const location = useLocation();
     7|  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
     8|
     9|  const navItems = [
    10|    { href: '/', label: 'Home' },
    11|    { href: '/services', label: 'Services' },
    12|    { href: '/about', label: 'About' },
    13|    { href: '/contact', label: 'Contact' },
    14|  ];
    15|
    16|  return (
    17|    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border shadow-sm">
    18|      <div className="container mx-auto px-4">
    19|        <div className="flex h-20 md:h-24 items-center justify-between">
    20|          {/* Logo */}
    21|          <Link to="/" className="flex items-center shrink-0">
    22|            <img
    23|              src="/airo-assets/images/logo/horizontal"
    24|              alt="Shine & Co. logo"
    25|              className="h-10 md:h-12 w-auto object-contain shrink-0"
    26|            />
    27|          </Link>
    28|
    29|          {/* Desktop Nav */}
    30|          <nav className="hidden md:flex items-center gap-8">
    31|            {navItems.map((item) => (
    32|              <Link
    33|                key={item.href}
    34|                to={item.href}
    35|                className={`text-sm font-medium transition-colors hover:text-primary ${
    36|                  location.pathname === item.href
    37|                    ? 'text-primary'
    38|                    : 'text-foreground/70'
    39|                }`}
    40|              >
    41|                {item.label}
    42|              </Link>
    43|            ))}
    44|          </nav>
    45|
    46|          {/* Phone CTA */}
    47|          <a
    48|            href="tel:+15551234567"
    49|            className="hidden md:flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors duration-200"
    50|          >
    51|            <Phone size={15} />
    52|            (555) 123-4567
    53|          </a>
    54|
    55|          {/* Mobile menu button */}
    56|          <button
    57|            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
    58|            className="md:hidden p-2 hover:bg-muted rounded-md transition-colors"
    59|            aria-label="Toggle menu"
    60|          >
    61|            {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
    62|          </button>
    63|        </div>
    64|
    65|        {/* Mobile Menu */}
    66|        {isMobileMenuOpen && (
    67|          <div className="md:hidden border-t border-border py-4">
    68|            <nav className="flex flex-col gap-1">
    69|              {navItems.map((item) => (
    70|                <Link
    71|                  key={item.href}
    72|                  to={item.href}
    73|                  className={`text-sm font-medium transition-colors hover:text-primary py-2.5 px-2 rounded-md ${
    74|                    location.pathname === item.href
    75|                      ? 'text-primary bg-muted'
    76|                      : 'text-foreground/70'
    77|                  }`}
    78|                  onClick={() => setIsMobileMenuOpen(false)}
    79|                >
    80|                  {item.label}
    81|                </Link>
    82|              ))}
    83|              <a
    84|                href="tel:+15551234567"
    85|                className="flex items-center gap-2 mt-3 bg-primary text-primary-foreground px-4 py-2.5 rounded-full text-sm font-semibold w-fit"
    86|              >
    87|                <Phone size={14} />
    88|                (555) 123-4567
    89|              </a>
    90|            </nav>
    91|          </div>
    92|        )}
    93|      </div>
    94|    </header>
    95|  );
    96|}
    97|