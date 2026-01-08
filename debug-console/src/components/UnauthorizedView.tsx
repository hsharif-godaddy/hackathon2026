import React from 'react';

export default function UnauthorizedView() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      padding: '2rem'
    }}>
      <h2>Unauthorized</h2>
      <p>You do not have permission to access this page.</p>
      <p>This page requires admin access via jomax realm.</p>
    </div>
  );
}
