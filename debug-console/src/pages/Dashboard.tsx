'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import AppContextPanel from '@/components/AppContextPanel';
import LangfusePanel from '@/components/LangfusePanel';
import LogsPanel, { type LogSource } from '@/components/LogsPanel';

interface Widget {
  id: string;
  type: 'logs' | 'langfuse';
  sourceId?: string;
}

// Height of the fixed navigation bar for scroll margin calculations
const FIXED_NAV_HEIGHT = '80px';

export default function Dashboard() {
  const [sources, setSources] = useState<LogSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [draggedIndex, setDragIndex] = useState<number | null>(null);
  const [contextAppId, setContextAppId] = useState('');
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [langfuseBaseUrl, setLangfuseBaseUrl] = useState<string | undefined>(undefined);
  const [langfuseProjectId, setLangfuseProjectId] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [showAllLogs, setShowAllLogs] = useState(false);

  // Refs for scrolling to widgets
  const widgetRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const appContextRef = useRef<HTMLDivElement | null>(null);

  const scrollToWidget = useCallback((widgetId: string) => {
    if (widgetId === 'app-context') {
      appContextRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveTab('app-context');
      return;
    }
    const element = widgetRefs.current[widgetId];
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveTab(widgetId);
    }
  }, []);

  // Get widget display name
  const getWidgetName = useCallback((widget: Widget) => {
    if (widget.type === 'langfuse') {
      return '🔍 Conversation Traces';
    }
    const source = sources.find(s => s.id === widget.sourceId);
    return source?.name || widget.sourceId || 'Logs';
  }, [sources]);

  // Stable ref callback for widget refs
  const setWidgetRef = useCallback((widgetId: string) => {
    return (el: HTMLDivElement | null) => {
      widgetRefs.current[widgetId] = el;
    };
  }, []);

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

  // Fetch Langfuse config
  useEffect(() => {
    async function fetchLangfuseConfig() {
      try {
        const response = await fetch('/api/langfuse/config');
        if (response.ok) {
          const data = await response.json();
          if (data.baseUrl) {
            setLangfuseBaseUrl(data.baseUrl);
          }
          if (data.projectId) {
            setLangfuseProjectId(data.projectId);
          }
        }
      } catch (error) {
        console.error('Failed to fetch Langfuse config:', error);
      }
    }

    fetchLangfuseConfig();
  }, []);

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
      padding: '2rem',
      paddingTop: FIXED_NAV_HEIGHT
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
          alignItems: 'center'
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
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div style={{ position: 'relative' }}>
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
                      padding: '0.5rem 2rem 0.5rem 1rem',
                      borderRadius: '6px',
                      border: '1px solid #d1d5db',
                      fontSize: '0.875rem',
                      width: '200px'
                    }}
                  />
                  {contextAppId && (
                    <button
                      onClick={() => {
                        setContextAppId('');
                        setShowContextPanel(false);
                      }}
                      style={{
                        position: 'absolute',
                        right: '6px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: '#e5e7eb',
                        border: 'none',
                        borderRadius: '50%',
                        width: '18px',
                        height: '18px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        color: '#6b7280',
                        fontWeight: 'bold',
                        lineHeight: 1
                      }}
                      title="Clear filter"
                    >
                      ×
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setShowContextPanel(true)}
                  disabled={!contextAppId.trim()}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: contextAppId.trim() ? '#3b82f6' : '#9ca3af',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: contextAppId.trim() ? 'pointer' : 'not-allowed',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    opacity: contextAppId.trim() ? 1 : 0.6
                  }}
                >
                  Search
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Fixed Navigation Tabs */}
        {(widgets.length > 0 || (showContextPanel && contextAppId.trim())) && (
          <>
            <div style={{
              position: 'fixed',
              top: '0',
              left: '0',
              right: '0',
              zIndex: 200,
              backgroundColor: '#f5f5f5',
              padding: '0.5rem 2rem',
              borderBottom: '1px solid #e5e7eb',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              <div style={{
                maxWidth: '1400px',
                margin: '0 auto',
                display: 'flex',
                gap: '0.5rem',
                flexWrap: 'wrap',
                padding: '0.5rem 0.75rem',
                backgroundColor: 'white',
                borderRadius: '8px',
                alignItems: 'center'
              }}>
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#6b7280',
                  marginRight: '0.5rem'
                }}>
                  Jump to:
                </span>
                {/* App Context Tab - shown when context panel is visible */}
                {showContextPanel && contextAppId.trim() && (
                  <button
                    onClick={() => scrollToWidget('app-context')}
                    style={{
                      padding: '0.375rem 0.75rem',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      borderRadius: '6px',
                      border: activeTab === 'app-context' ? '2px solid #10b981' : '1px solid #d1d5db',
                      backgroundColor: activeTab === 'app-context' ? '#ecfdf5' : '#f9fafb',
                      color: activeTab === 'app-context' ? '#059669' : '#374151',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      whiteSpace: 'nowrap'
                    }}
                    onMouseEnter={(e) => {
                      if (activeTab !== 'app-context') {
                        e.currentTarget.style.backgroundColor = '#e5e7eb';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (activeTab !== 'app-context') {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                      }
                    }}
                  >
                    🎯 App Context
                  </button>
                )}
                {widgets.map((widget) => (
                  <button
                    key={widget.id}
                    onClick={() => scrollToWidget(widget.id)}
                    style={{
                      padding: '0.375rem 0.75rem',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      borderRadius: '6px',
                      border: activeTab === widget.id ? '2px solid #3b82f6' : '1px solid #d1d5db',
                      backgroundColor: activeTab === widget.id ? '#eff6ff' : '#f9fafb',
                      color: activeTab === widget.id ? '#2563eb' : '#374151',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      whiteSpace: 'nowrap'
                    }}
                    onMouseEnter={(e) => {
                      if (activeTab !== widget.id) {
                        e.currentTarget.style.backgroundColor = '#e5e7eb';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (activeTab !== widget.id) {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                      }
                    }}
                  >
                    {widget.type === 'langfuse' ? '🔍 ' : '📋 '}
                    {getWidgetName(widget)}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

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
              <div
                ref={appContextRef}
                style={{ marginBottom: '2rem', scrollMarginTop: FIXED_NAV_HEIGHT }}
              >
                <AppContextPanel
                  appId={contextAppId.trim()}
                  onClose={() => {
                    setShowContextPanel(false);
                    setContextAppId('');
                  }}
                  showAllLogs={showAllLogs}
                  onShowAllLogsChange={setShowAllLogs}
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
              display: 'flex',
              flexDirection: 'column',
              gap: '2rem',
              marginBottom: '2rem'
            }}>
              {widgets.map((widget, index) => (
                <div
                  key={widget.id}
                  ref={setWidgetRef(widget.id)}
                  onDragOver={(e) => onDragOver(e, index)}
                  style={{
                    opacity: draggedIndex === index ? 0.5 : 1,
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    minWidth: 0,
                    width: '100%',
                    scrollMarginTop: FIXED_NAV_HEIGHT
                  }}
                >
                  {/* Drag handle - only this element is draggable */}
                  <button
                    type="button"
                    draggable
                    onDragStart={() => onDragStart(index)}
                    onDragEnd={onDragEnd}
                    style={{
                      position: 'absolute',
                      top: '12px',
                      left: '12px',
                      width: '28px',
                      height: '28px',
                      cursor: draggedIndex === index ? 'grabbing' : 'grab',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#6b7280',
                      zIndex: 20,
                      borderRadius: '4px',
                      backgroundColor: '#f3f4f6',
                      border: '1px solid #e5e7eb',
                      padding: 0
                    }}
                    aria-label={`Drag to reorder ${getWidgetName(widget)} panel`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="9" cy="5" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="19" r="1" />
                    </svg>
                  </button>
                  {widget.type === 'langfuse' ? (
                    <LangfusePanel
                      globalAppId={contextAppId.trim() || undefined}
                      onSessionClick={(sessionId) => {
                        setContextAppId(sessionId);
                        setShowContextPanel(true);
                      }}
                      langfuseBaseUrl={langfuseBaseUrl}
                      langfuseProjectId={langfuseProjectId}
                    />
                  ) : (
                    <LogsPanel
                      sources={sources}
                      defaultSource={widget.sourceId}
                      isWidget={true}
                      globalAppId={contextAppId.trim() || undefined}
                      onAppIdClick={(appId) => {
                        setContextAppId(appId);
                        setShowContextPanel(true);
                      }}
                      showAllLogs={showAllLogs}
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
