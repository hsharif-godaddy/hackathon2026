'use client'

import React, { useState, useEffect } from 'react';

interface DatabasePanelProps {
  appId: string;
  section: 'connection' | 'schema' | 'actions';
}

interface DatabaseInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  status: 'connected' | 'disconnected' | 'connecting';
}

export function DatabasePanel({ appId, section }: DatabasePanelProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);

  useEffect(() => {
    // Simulate fetching database info
    setTimeout(() => {
      setDbInfo({
        host: 'localhost',
        port: 5432,
        database: 'myapp_db',
        user: 'postgres',
        status: 'connected'
      });
      setIsLoading(false);
    }, 500);
  }, [appId]);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-center text-muted-foreground">
          Loading database information...
        </div>
      </div>
    );
  }

  if (!dbInfo) {
    return (
      <div className="p-6">
        <div className="text-center text-muted-foreground">
          No database information available
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {section === 'connection' && (
          <div className="p-6">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Database Connection</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Host</label>
                    <div className="mt-1 text-sm">{dbInfo.host}</div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Port</label>
                    <div className="mt-1 text-sm">{dbInfo.port}</div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Database</label>
                    <div className="mt-1 text-sm">{dbInfo.database}</div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">User</label>
                    <div className="mt-1 text-sm">{dbInfo.user}</div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-4">Connection Status</h3>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      dbInfo.status === 'connected'
                        ? 'bg-green-500'
                        : dbInfo.status === 'connecting'
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                    }`}
                  />
                  <span className="text-sm capitalize">{dbInfo.status}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {section === 'schema' && (
          <div className="p-6">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Database Schema</h3>
                <div className="text-sm text-muted-foreground bg-muted rounded-lg p-8 text-center">
                  <p className="mb-4">Schema visualization and management coming soon</p>
                  <ul className="text-left max-w-md mx-auto space-y-2">
                    <li>• View all tables and relationships</li>
                    <li>• Inspect column types and constraints</li>
                    <li>• Visual schema designer</li>
                    <li>• Migration history</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {section === 'actions' && (
          <div className="p-6">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Database Actions</h3>
                <div className="text-sm text-muted-foreground bg-muted rounded-lg p-8 text-center">
                  <p className="mb-4">Database management tools coming soon</p>
                  <ul className="text-left max-w-md mx-auto space-y-2">
                    <li>• Run custom SQL queries</li>
                    <li>• Export/import data</li>
                    <li>• Database backup & restore</li>
                    <li>• Performance monitoring</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
