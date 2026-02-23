import ImageSearchPanel from '@/components/ImageSearchPanel';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function ImageSearchPage() {
  return (
    <ProtectedRoute>
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#f5f5f5',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          {/* Header */}
          <header
            style={{
              backgroundColor: 'white',
              padding: '1.5rem 2rem',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600, color: '#1a1a1a' }}>
                  Image Search Testing
                </h1>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#666' }}>
                  Test the image search service with Getty Images
                </p>
              </div>
              <a
                href="/"
                style={{
                  color: '#3b82f6',
                  textDecoration: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                }}
              >
                ← Back to Dashboard
              </a>
            </div>
          </header>

          {/* Main Content */}
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <ImageSearchPanel />
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
