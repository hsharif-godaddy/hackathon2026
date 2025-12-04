"use client";

import Alert from '@ux/alert';

export default function AppInactivityAlert() {
  return (
    <div className="mb-3">
      <Alert emphasis="highlight" title="Heads up!">
        Apps that haven&apos;t been changed or published in 7 days will be
        automatically removed.
      </Alert>
    </div>
  );
}
