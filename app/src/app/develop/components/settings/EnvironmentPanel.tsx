'use client'

import React from 'react';

interface EnvironmentPanelProps {
  appId: string;
}

export function EnvironmentPanel({ appId: _appId }: EnvironmentPanelProps) {
  return (
    <div className="p-6">
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-4">Environment Variables</h3>
          <div className="text-sm text-muted-foreground bg-muted rounded-lg p-8 text-center">
            <p className="mb-4">Environment variable management coming soon</p>
            <ul className="text-left max-w-md mx-auto space-y-2">
              <li>• Manage application environment variables</li>
              <li>• Separate development and production configs</li>
              <li>• Secure storage for sensitive data</li>
              <li>• Easy import/export functionality</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
