import Header from '@/components/layout/Header';

interface PageLayoutProps {
  children: React.ReactNode;
}

/**
 * Page layout wrapper for consistent structure across all states
 */
export default function PageLayout({ children }: PageLayoutProps) {
  return (
    <div className="min-h-screen">
      <Header location="manage-plan" />
      <main className="max-w-6xl mx-auto px-2 sm:px-3 lg:px-4 pt-4 pb-8">
        {children}
      </main>
    </div>
  );
}
