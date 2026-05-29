src/layouts/parts/Header.tsx [79 lines]
     1|import { Link, useLocation } from 'react-router-dom';
     2|import { Menu, X } from 'lucide-react';
     3|import { useState } from 'react';
     4|
     5|/**
     6| * Header component for website navigation
     7| *
     8| * A simple, customizable header with logo and navigation links.
     9| * This component is designed to be directly edited by the AI agent
    10| * to match the specific needs of each website.
    11| */
    12|export default function Header() {
    13|  const location = useLocation();
    14|  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    15|
    16|  const navItems = [
    17|    { href: '/', label: 'Home' },
    18|    { href: '/about', label: 'About' },
    19|    { href: '/contact', label: 'Contact' },
    20|  ];
    21|
    22|  return (
    23|    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border">
    24|      <div className="container mx-auto px-4">
    25|        <div className="flex h-16 items-center justify-between">
    26|          <Link to="/" className="text-xl font-bold text-foreground">
    27|            App
    28|          </Link>
    29|
    30|          <nav className="hidden md:flex gap-6">
    31|            {navItems.map((item) => (
    32|              <Link
    33|                key={item.href}
    34|                to={item.href}
    35|                className={`text-sm font-medium transition-colors hover:text-primary ${
    36|                  location.pathname === item.href
    37|                    ? 'text-foreground'
    38|                    : 'text-muted-foreground'
    39|                }`}
    40|              >
    41|                {item.label}
    42|              </Link>
    43|            ))}
    44|          </nav>
    45|
    46|          <button
    47|            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
    48|            className="md:hidden p-2 hover:bg-accent rounded-md transition-colors"
    49|            aria-label="Toggle menu"
    50|          >
    51|            {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
    52|          </button>
    53|        </div>
    54|
    55|        {isMobileMenuOpen && (
    56|          <div className="md:hidden border-t border-border py-4">
    57|            <nav className="flex flex-col gap-2">
    58|              {navItems.map((item) => (
    59|                <Link
    60|                  key={item.href}
    61|                  to={item.href}
    62|                  className={`text-sm font-medium transition-colors hover:text-primary py-2 ${
    63|                    location.pathname === item.href
    64|                      ? 'text-foreground'
    65|                      : 'text-muted-foreground'
    66|                  }`}
    67|                  onClick={() => setIsMobileMenuOpen(false)}
    68|                >
    69|                  {item.label}
    70|                </Link>
    71|              ))}
    72|            </nav>
    73|          </div>
    74|        )}
    75|      </div>
    76|    </header>
    77|  );
    78|}
    79|