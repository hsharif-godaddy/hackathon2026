'use client'

import React from 'react';

interface EnvironmentPanelProps {
  appId: string;
}

export function EnvironmentPanel({ appId: _appId }: EnvironmentPanelProps) {
  return (
    <div className="p-3">
      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold mb-2">Environment Variables</h3>
          <div className="text-sm text-muted-foreground bg-muted rounded-lg p-4 text-center">
            <p className="mb-2">Environment variable management coming soon</p>
            <ul className="text-left max-w-md mx-auto space-y-1">
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
