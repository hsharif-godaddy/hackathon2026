'use client'

import React from 'react';

interface DeploymentPanelProps {
  appId: string;
}

export function DeploymentPanel({ appId: _appId }: DeploymentPanelProps) {
  return (
    <div className="p-6">
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-4">Deployment Configuration</h3>
          <div className="text-sm text-muted-foreground bg-muted rounded-lg p-8 text-center">
            <p className="mb-4">Deployment configuration coming soon</p>
            <ul className="text-left max-w-md mx-auto space-y-2">
              <li>• One-click deployment to production</li>
              <li>• Configure deployment targets</li>
              <li>• Manage deployment history</li>
              <li>• Rollback capabilities</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
