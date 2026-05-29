src/layouts/parts/Footer.tsx [71 lines]
     1|import { Link } from 'react-router-dom';
     2|import { Phone } from 'lucide-react';
     3|
     4|export default function Footer() {
     5|  const currentYear = new Date().getFullYear();
     6|
     7|  return (
     8|    <footer className="bg-foreground text-background">
     9|      <div className="container mx-auto px-4 py-12">
    10|        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
    11|          {/* Brand */}
    12|          <div>
    13|            <img
    14|              src="/airo-assets/images/logo/horizontal?variant=solid"
    15|              alt="Shine & Co. logo"
    16|              className="h-9 w-auto object-contain shrink-0 mb-4 brightness-0 invert"
    17|            />
    18|            <p className="text-background/60 text-sm leading-relaxed">
    19|              Professional house cleaning you can trust. Serving local families with care and attention to detail.
    20|            </p>
    21|          </div>
    22|
    23|          {/* Navigation */}
    24|          <div>
    25|            <h3 className="text-sm font-semibold uppercase tracking-wider text-background/50 mb-4">Navigation</h3>
    26|            <nav className="flex flex-col gap-2">
    27|              {[
    28|                { href: '/', label: 'Home' },
    29|                { href: '/services', label: 'Services' },
    30|                { href: '/about', label: 'About' },
    31|                { href: '/contact', label: 'Contact' },
    32|              ].map((item) => (
    33|                <Link
    34|                  key={item.href}
    35|                  to={item.href}
    36|                  className="text-sm text-background/70 hover:text-background transition-colors"
    37|                >
    38|                  {item.label}
    39|                </Link>
    40|              ))}
    41|            </nav>
    42|          </div>
    43|
    44|          {/* Contact */}
    45|          <div>
    46|            <h3 className="text-sm font-semibold uppercase tracking-wider text-background/50 mb-4">Get in Touch</h3>
    47|            <a
    48|              href="tel:+15551234567"
    49|              className="flex items-center gap-2 text-background/80 hover:text-background transition-colors text-sm mb-2"
    50|            >
    51|              <Phone size={14} />
    52|              (555) 123-4567
    53|            </a>
    54|            <p className="text-background/50 text-sm">Mon–Sat: 8am – 6pm</p>
    55|            <a
    56|              href="/contact"
    57|              className="inline-block mt-4 bg-primary text-primary-foreground px-5 py-2 rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors"
    58|            >
    59|              Get a Free Quote
    60|            </a>
    61|          </div>
    62|        </div>
    63|
    64|        <div className="border-t border-background/10 mt-10 pt-6 text-center text-background/40 text-xs">
    65|          © {currentYear} Shine & Co. All rights reserved.
    66|        </div>
    67|      </div>
    68|    </footer>
    69|  );
    70|}
    71|