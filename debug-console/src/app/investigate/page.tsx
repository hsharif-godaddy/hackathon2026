import ProtectedRoute from '@/components/ProtectedRoute';
import InvestigatePanel from '@/components/InvestigatePanel';

export default function InvestigatePage() {
  return (
    <ProtectedRoute>
      <InvestigatePanel />
    </ProtectedRoute>
  );
}
