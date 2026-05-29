src/layouts/parts/Footer.tsx [82 lines]
     1|import { Link } from 'react-router-dom';
     2|import { Phone, MapPin, Instagram, Facebook } from 'lucide-react';
     3|
     4|export default function Footer() {
     5|  return (
     6|    <footer className="bg-muted border-t border-border/40">
     7|      <div className="max-w-6xl mx-auto px-6 py-12">
     8|        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
     9|          {/* Brand */}
    10|          <div className="flex flex-col gap-4">
    11|            <Link to="/">
    12|              <img
    13|                src="/airo-assets/images/logo/horizontal"
    14|                alt="Sparkle Clean logo"
    15|                className="h-9 w-auto object-contain"
    16|              />
    17|            </Link>
    18|            <p className="text-sm text-muted-foreground leading-relaxed">
    19|              Professional house cleaning with a personal touch. Your home deserves to shine.
    20|            </p>
    21|          </div>
    22|
    23|          {/* Quick Links */}
    24|          <div className="flex flex-col gap-3">
    25|            <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">Quick Links</h4>
    26|            {[
    27|              { label: 'Home', href: '/' },
    28|              { label: 'Services', href: '/services' },
    29|              { label: 'About', href: '/about' },
    30|              { label: 'Contact', href: '/contact' },
    31|            ].map((link) => (
    32|              <Link
    33|                key={link.href}
    34|                to={link.href}
    35|                className="text-sm text-muted-foreground hover:text-primary transition-colors"
    36|              >
    37|                {link.label}
    38|              </Link>
    39|            ))}
    40|          </div>
    41|
    42|          {/* Contact */}
    43|          <div className="flex flex-col gap-3">
    44|            <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">Get in Touch</h4>
    45|            <a
    46|              href="tel:+15550000000"
    47|              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
    48|            >
    49|              <Phone size={14} />
    50|              (555) 000-0000
    51|            </a>
    52|            <div className="flex items-center gap-2 text-sm text-muted-foreground">
    53|              <MapPin size={14} />
    54|              Serving the Greater Metro Area
    55|            </div>
    56|            <div className="flex items-center gap-3 mt-2">
    57|              <a
    58|                href="#"
    59|                aria-label="Instagram"
    60|                className="text-muted-foreground hover:text-primary transition-colors"
    61|              >
    62|                <Instagram size={18} />
    63|              </a>
    64|              <a
    65|                href="#"
    66|                aria-label="Facebook"
    67|                className="text-muted-foreground hover:text-primary transition-colors"
    68|              >
    69|                <Facebook size={18} />
    70|              </a>
    71|            </div>
    72|          </div>
    73|        </div>
    74|
    75|        <div className="mt-10 pt-6 border-t border-border/40 text-center text-xs text-muted-foreground">
    76|          © {new Date().getFullYear()} Sparkle Clean. All rights reserved.
    77|        </div>
    78|      </div>
    79|    </footer>
    80|  );
    81|}
    82|