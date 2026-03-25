'use client';

import ProtectedRoute from '@/components/ProtectedRoute';
import QAResultsPanel from '@/components/QAResultsPanel';

function QAResultsContent() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      padding: '1rem 2vw',
    }}>
      <div style={{ width: '100%', maxWidth: '98vw', margin: '0 auto' }}>
        <header style={{
          backgroundColor: 'rgba(255,255,255,0.97)',
          padding: '1.25rem 1.5rem',
          borderRadius: '12px',
          marginBottom: '1.25rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>
              Agentic QA Results
            </h1>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              Automated end-to-end test runs against Airo Builder
            </p>
          </div>
          <a
            href="/"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#f1f5f9',
              color: '#334155',
              borderRadius: '6px',
              textDecoration: 'none',
              fontSize: '0.8rem',
              fontWeight: 500,
            }}
          >
            ← Dashboard
          </a>
        </header>
        <QAResultsPanel />
      </div>
    </div>
  );
}

export default function AgenticQAResultsPage() {
  return (
    <ProtectedRoute>
      <QAResultsContent />
    </ProtectedRoute>
  );
}
