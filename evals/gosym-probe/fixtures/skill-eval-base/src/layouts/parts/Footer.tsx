import { Link } from 'react-router-dom';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-blue-100 bg-white">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-sm text-gray-500">
            © {currentYear} Bright Smiles Dental Practice. All rights reserved.
          </div>
          <nav className="flex gap-6">
            <Link to="/contact" className="text-sm text-gray-500 hover:text-blue-700 transition-colors">
              Contact
            </Link>
            <Link to="/faq" className="text-sm text-gray-500 hover:text-blue-700 transition-colors">
              FAQ
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
