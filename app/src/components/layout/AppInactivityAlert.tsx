'use client';

import Alert from '@ux/alert';
import text from '@ux/text';

export default function AppInactivityAlert() {
    return (
    <div className='mb-6'>
      <Alert emphasis='highlight'>
        <text.h3 size={1}>Heads up!</text.h3>
        <text.p>Apps that haven&apos;t been changed or published in 7 days will be automatically removed.</text.p>
      </Alert>
    </div>
  );
}

