'use client';

import { useState } from 'react';
import Alert from '@ux/alert';
import text from '@ux/text';

export default function AppInactivityAlert() {
    const [closed, setClosed] = useState(false);

    if (closed) return null;

    return (
    <div className='mb-6'>
      <Alert emphasis='highlight' onClose={() => setClosed(true)}>
        <text.h3 size={1}>Heads up!</text.h3>
        <text.p>Apps that haven&apos;t been used in 7 days will be automatically removed.</text.p>
      </Alert>
    </div>
  );
}

