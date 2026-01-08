import ProtectedRoute from '@/components/ProtectedRoute';
import Dashboard from '@/pages/Dashboard';

export default function HomePage() {
  return (
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  );
}
