'use client';

import React, { useEffect, useState } from 'react';

import AppContextPanel from '@/components/AppContextPanel';
import LangfusePanel from '@/components/LangfusePanel';
import LogsPanel from '@/components/LogsPanel';
import type { LogSource } from '@/components/LogSourceSelector';

interface Widget {
  id: string;
  type: 'logs' | 'langfuse';
  sourceId?: string;
}

export default function Dashboard() {
  const [sources, setSources] = useState<LogSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [draggedIndex, setDragIndex] = useState<number | null>(null);
  const [contextAppId, setContextAppId] = useState('');
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    async function fetchSources() {
      try {
        const response = await fetch('/api/log-sources');
        if (response.ok) {
          const data = await response.json();
          const fetchedSources: LogSource[] = data.sources || [];
          setSources(fetchedSources);

          // Initialize with ALL log sources first, then Langfuse panel at the bottom
          if (fetchedSources.length > 0 && widgets.length === 0 && !initialized) {
            const logWidgets = fetchedSources.map(source => ({
              id: `logs-${source.id}`,
              type: 'logs' as const,
              sourceId: source.id
            }));
            const langfuseWidget: Widget = {
              id: 'langfuse-default',
              type: 'langfuse'
            };
            setWidgets([...logWidgets, langfuseWidget]);
            setInitialized(true);
          }
        }
      } catch (error) {
        console.error('Failed to fetch log sources:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchSources();
  }, [widgets.length, initialized]);

  const addLogsWidget = (sourceId: string) => {
    if (!sourceId) return;
    const newId = `logs-${sourceId}-${Date.now()}`;
    setWidgets([...widgets, { id: newId, type: 'logs', sourceId }]);
  };

  const removeWidget = (id: string) => {
    setWidgets(widgets.filter(w => w.id !== id));
  };

  const onDragStart = (index: number) => {
    setDragIndex(index);
  };

  const onDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newWidgets = [...widgets];
    const draggedItem = newWidgets[draggedIndex];
    newWidgets.splice(draggedIndex, 1);
    newWidgets.splice(index, 0, draggedItem);

    setDragIndex(index);
    setWidgets(newWidgets);
  };

  const onDragEnd = () => {
    setDragIndex(null);
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      padding: '2rem'
    }}>
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto'
      }}>
        <header style={{
          backgroundColor: 'white',
          padding: '1.5rem 2rem',
          borderRadius: '8px',
          marginBottom: '2rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: '1rem',
          zIndex: 100
        }}>
          <div>
            <h1 style={{
              margin: 0,
              fontSize: '1.75rem',
              fontWeight: 600,
              color: '#1a1a1a'
            }}>
              Admin Debug Console
            </h1>
            <p style={{
              margin: '0.5rem 0 0 0',
              fontSize: '0.875rem',
              color: '#666'
            }}>
              Customize your observability view
            </p>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            <a
              href="/analytics"
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#3b82f6',
                color: 'white',
                borderRadius: '6px',
                textDecoration: 'none',
                fontSize: '0.875rem',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              📊 Apps Analytics
            </a>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151' }}>
                App Context
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={contextAppId}
                  onChange={(e) => setContextAppId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && contextAppId.trim()) {
                      setShowContextPanel(true);
                    }
                  }}
                  placeholder="Enter app ID..."
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    border: '1px solid #d1d5db',
                    fontSize: '0.875rem',
                    width: '200px'
                  }}
                />
                {contextAppId.trim() && (
                  <button
                    onClick={() => setShowContextPanel(true)}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      fontWeight: 500
                    }}
                  >
                    View Context
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151' }}>
                Add New Panel
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      addLogsWidget(e.target.value);
                      e.target.value = '';
                    }
                  }}
                  value=""
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    border: '1px solid #d1d5db',
                    fontSize: '0.875rem',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    cursor: 'pointer'
                  }}
                >
                  <option value="" disabled>+ Select Log Source</option>
                  {sources.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </header>

        {loading ? (
          <div style={{
            backgroundColor: 'white',
            padding: '2rem',
            borderRadius: '8px',
            textAlign: 'center',
            marginBottom: '2rem'
          }}>
            <p>Loading log sources...</p>
          </div>
        ) : (
          <>
            {showContextPanel && contextAppId.trim() && (
              <div style={{ marginBottom: '2rem' }}>
                <AppContextPanel
                  appId={contextAppId.trim()}
                  onClose={() => {
                    setShowContextPanel(false);
                    setContextAppId('');
                  }}
                />
              </div>
            )}

            {widgets.length === 0 && !loading && (
              <div style={{
                backgroundColor: 'white',
                padding: '2rem',
                borderRadius: '8px',
                textAlign: 'center',
                marginBottom: '2rem'
              }}>
                <p style={{ color: '#6b7280' }}>No log sources available</p>
              </div>
            )}

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(600px, 1fr))',
              gap: '2rem',
              marginBottom: '2rem'
            }}>
              {widgets.map((widget, index) => (
                <div
                  key={widget.id}
                  draggable
                  onDragStart={() => onDragStart(index)}
                  onDragOver={(e) => onDragOver(e, index)}
                  onDragEnd={onDragEnd}
                  style={{
                    cursor: draggedIndex === index ? 'grabbing' : 'grab',
                    opacity: draggedIndex === index ? 0.5 : 1,
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    minWidth: 0, // Prevent grid item overflow
                    gridColumn: widget.type === 'langfuse' ? '1 / -1' : 'auto' // Full width for Langfuse
                  }}
                >
                  {widget.type === 'langfuse' ? (
                    <LangfusePanel
                      globalAppId={contextAppId.trim() || undefined}
                      onRemove={() => removeWidget(widget.id)}
                      onSessionClick={(sessionId) => {
                        setContextAppId(sessionId);
                        setShowContextPanel(true);
                      }}
                    />
                  ) : (
                    <LogsPanel
                      sources={sources}
                      defaultSource={widget.sourceId}
                      isWidget={true}
                      globalAppId={contextAppId.trim() || undefined}
                      onRemove={() => removeWidget(widget.id)}
                      onAppIdClick={(appId) => {
                        setContextAppId(appId);
                        setShowContextPanel(true);
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
