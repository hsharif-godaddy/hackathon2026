src/layouts/parts/Footer.tsx [40 lines]
     1|import { Link } from 'react-router-dom';
     2|
     3|/**
     4| * Footer component for website
     5| *
     6| * A simple, customizable footer with copyright and links.
     7| * This component is designed to be directly edited by the AI agent
     8| * to match the specific needs of each website.
     9| */
    10|export default function Footer() {
    11|  const currentYear = new Date().getFullYear();
    12|
    13|  return (
    14|    <footer className="mt-auto border-t border-border bg-background">
    15|      <div className="container mx-auto px-4 py-6">
    16|        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
    17|          <div className="text-sm text-muted-foreground">
    18|            © {currentYear} App. All rights reserved.
    19|          </div>
    20|
    21|          <nav className="flex gap-6">
    22|            <Link
    23|              to="/privacy"
    24|              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
    25|            >
    26|              Privacy
    27|            </Link>
    28|            <Link
    29|              to="/terms"
    30|              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
    31|            >
    32|              Terms
    33|            </Link>
    34|          </nav>
    35|        </div>
    36|      </div>
    37|    </footer>
    38|  );
    39|}
    40|