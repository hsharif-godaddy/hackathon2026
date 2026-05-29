src/layouts/parts/Header.tsx [54 lines]
     1|import { useEffect, useState } from 'react';
     2|
     3|
     4|const navLinks = [
     5|  { label: 'About', href: '#about' },
     6|  { label: 'Work', href: '#work' },
     7|  { label: 'Contact', href: '#contact' },
     8|];
     9|
    10|export default function Header() {
    11|  const [scrolled, setScrolled] = useState(false);
    12|
    13|  useEffect(() => {
    14|    const onScroll = () => setScrolled(window.scrollY > 60);
    15|    window.addEventListener('scroll', onScroll, { passive: true });
    16|    return () => window.removeEventListener('scroll', onScroll);
    17|  }, []);
    18|
    19|  return (
    20|    <header
    21|      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
    22|        scrolled
    23|          ? 'bg-background/95 backdrop-blur-sm border-b border-border/20'
    24|          : 'bg-transparent'
    25|      }`}
    26|    >
    27|      <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-20">
    28|        {/* Monogram Logo */}
    29|        <a href="/" aria-label="Home" className="flex items-center">
    30|          <img
    31|            src="/airo-assets/images/logo/primary"
    32|            alt="AJ logo"
    33|            className="h-10 w-auto object-contain shrink-0"
    34|          />
    35|        </a>
    36|
    37|        {/* Nav */}
    38|        <nav className="flex items-center gap-8" aria-label="Main navigation">
    39|          {navLinks.map((link) => (
    40|            <a
    41|              key={link.href}
    42|              href={link.href}
    43|              className="relative text-sm tracking-widest uppercase text-foreground/70 hover:text-foreground transition-colors duration-200 group"
    44|            >
    45|              {link.label}
    46|              <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-primary transition-all duration-300 group-hover:w-full" />
    47|            </a>
    48|          ))}
    49|        </nav>
    50|      </div>
    51|    </header>
    52|  );
    53|}
    54|