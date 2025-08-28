import { Link } from '../../router';

export default function Header() {
  return (
    <header className="border-b border-border">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <Link to="/" className="text-xl font-bold text-foreground">
            App
          </Link>
        </div>
      </div>
    </header>
  );
}
