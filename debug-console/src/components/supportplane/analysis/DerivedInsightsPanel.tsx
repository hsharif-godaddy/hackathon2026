"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { InsightRow } from "@/lib/supportplane/store/insights-client";
import { useSupportPlaneData } from '@/contexts/SupportPlaneDataContext';
import sp from '@/components/supportplane/sp.module.css';
import InsightsVisualizations from './InsightsVisualizations';

interface InsightDetailModalProps {
  insight: InsightRow;
  onClose: () => void;
}

function InsightDetailModal({ insight, onClose }: InsightDetailModalProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className={sp.card}
        style={{
          maxWidth: 900,
          width: '90%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '24px 28px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: '1px solid var(--sp-border)',
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sp-tx1)' }}>{insight.insight_title}</div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              color: 'var(--sp-txm)',
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Description */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-txm)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Description</div>
            <div style={{ color: 'var(--sp-tx1)', lineHeight: 1.6, fontSize: 14 }}>{insight.insight_description}</div>
          </div>

          {/* Recommended Action */}
          {insight.recommended_action && (
            <div style={{ background: 'var(--sp-s2)', border: '1px solid var(--sp-border)', borderRadius: 6, padding: '16px 18px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-accent)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Recommended Action</div>
              <div style={{ color: 'var(--sp-tx1)', lineHeight: 1.6, fontSize: 14 }}>{insight.recommended_action}</div>
            </div>
          )}

          {/* Business Case (Features only) */}
          {insight.business_case && (
            <div style={{ background: '#10b98115', border: '1px solid #10b98130', borderRadius: 6, padding: '16px 18px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#10b981', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Business Case</div>
              <div style={{ color: 'var(--sp-tx1)', lineHeight: 1.6, fontSize: 14 }}>{insight.business_case}</div>
            </div>
          )}

          {/* Metrics Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-txm)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Metrics</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--sp-txm)' }}>Occurrences:</span>
                  <span style={{ fontWeight: 600 }}>{insight.occurrence_count}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--sp-txm)' }}>Resolution Rate:</span>
                  <span style={{ fontWeight: 600 }}>{(insight.resolution_rate * 100).toFixed(0)}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--sp-txm)' }}>Preventable Rate:</span>
                  <span style={{ fontWeight: 600 }}>{(insight.preventable_rate * 100).toFixed(0)}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--sp-txm)' }}>Impact Score:</span>
                  <span style={{ fontWeight: 600 }}>{insight.business_impact_score.toFixed(1)}</span>
                </div>
                {insight.conversion_signal_rate !== undefined && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--sp-txm)' }}>Conversion Signal:</span>
                    <span style={{ fontWeight: 600 }}>{(insight.conversion_signal_rate * 100).toFixed(0)}%</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-txm)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Timeline</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--sp-txm)' }}>First Seen:</span>
                  <span style={{ fontWeight: 600 }}>{new Date(insight.first_seen).toLocaleDateString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--sp-txm)' }}>Last Seen:</span>
                  <span style={{ fontWeight: 600 }}>{new Date(insight.last_seen).toLocaleDateString()}</span>
                </div>
                {insight.product_line && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--sp-txm)' }}>Product Line:</span>
                    <span style={{ fontWeight: 600 }}>{insight.product_line}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sample Transcripts */}
          {insight.sample_transcript_ids && insight.sample_transcript_ids.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-txm)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sample Transcripts ({insight.sample_transcript_ids.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {insight.sample_transcript_ids.map((id) => (
                  <a
                    key={id}
                    href={`/supportplane?panel=transcripts&id=${id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: '6px 12px',
                      background: '#6366f115',
                      border: '1px solid #6366f130',
                      borderRadius: 4,
                      fontSize: 12,
                      color: '#6366f1',
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {id.substring(0, 8)}...
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface DerivedInsightsPanelProps {
  days: number;
}

export default function DerivedInsightsPanel({ days: _parentDays }: DerivedInsightsPanelProps) {
  // Use centralized data context (loaded on app mount)
  const { bugs: allBugs, features: allFeatures, patterns: allPatterns, loading: contextLoading, refetchInsights, cachedInsightsDays } = useSupportPlaneData();

  const [activeSection, setActiveSection] = useState<'bugs' | 'features' | 'patterns'>('bugs');
  const [selectedInsight, setSelectedInsight] = useState<InsightRow | null>(null);
  const [generating, setGenerating] = useState<boolean>(false);
  const [refetching, setRefetching] = useState<boolean>(false);

  // Derived Insights has its own date range (relative selector)
  const [insightsDays, setInsightsDays] = useState<number>(30);

  // Auto-refetch when selected range exceeds cached range
  useEffect(() => {
    if (insightsDays > cachedInsightsDays && !refetching && !contextLoading) {
      setRefetching(true);
      void refetchInsights(insightsDays).then(() => {
        setRefetching(false);
      });
    }
  }, [insightsDays, cachedInsightsDays, refetchInsights, refetching, contextLoading]);

  // Filter context data by date range (client-side filtering for instant response)
  const { bugs, features, patterns } = useMemo(() => {
    const cutoffDate: Date = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - insightsDays);
    const cutoffTimestamp: number = cutoffDate.getTime();

    const filterByDate = (insights: InsightRow[]): InsightRow[] => {
      return insights.filter((insight: InsightRow) => {
        const createdAt: Date = new Date(insight.created_at);
        return createdAt.getTime() >= cutoffTimestamp;
      });
    };

    return {
      bugs: filterByDate(allBugs),
      features: filterByDate(allFeatures),
      patterns: filterByDate(allPatterns),
    };
  }, [allBugs, allFeatures, allPatterns, insightsDays]);

  const handleGenerate = async () => {
    try {
      setGenerating(true);

      const response: Response = await fetch('/api/supportplane/insights/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: insightsDays }), // Use Derived Insights date range for generation
      });

      if (!response.ok) {
        throw new Error('Failed to trigger insight generation');
      }

      // Wait and then refresh from context
      setTimeout(() => {
        void refetchInsights().then(() => {
          setGenerating(false);
        });
      }, 120000); // 2 minutes
    } catch (err) {
      setGenerating(false);
    }
  };

  if (contextLoading || refetching) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
        <div style={{ color: 'var(--sp-txm)' }}>
          {refetching ? 'Fetching additional data...' : 'Loading insights...'}
        </div>
      </div>
    );
  }

  const totalBugs: number = bugs.length;
  const totalFeatures: number = features.length;
  const totalPatterns: number = patterns.length;
  const criticalBugs: number = bugs.filter(b => b.resolution_rate < 0.2).length;

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Date Range Selector for Derived Insights */}
      <div className={sp.card} style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--sp-tx1)' }}>
            Show insights from last:
          </label>
          <select
            value={insightsDays}
            onChange={(e) => setInsightsDays(Number(e.target.value))}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 600,
              border: '1px solid var(--sp-border)',
              borderRadius: 6,
              background: 'var(--sp-s2)',
              color: 'var(--sp-tx1)',
              cursor: 'pointer',
              minWidth: 120,
            }}
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>1 year</option>
          </select>
          <div style={{ fontSize: 12, color: 'var(--sp-txm)' }}>
            (filters by when insights were generated)
          </div>
        </div>
      </div>

      {/* Generate Button */}
      <div className={sp.card} style={{ marginBottom: 20, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sp-tx1)', marginBottom: 6 }}>Derived Insights</div>
            <div style={{ fontSize: 13, color: 'var(--sp-txm)', lineHeight: 1.5 }}>
              AI-powered pain point analysis from support transcripts. Click "Regenerate" to run fresh AI analysis on the last {insightsDays} days and identify new bugs, feature requests, and usage patterns.
            </div>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className={`${sp.btn} ${generating ? '' : sp.btnPrimary}`}
            style={{
              opacity: generating ? 0.5 : 1,
              cursor: generating ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {generating ? 'Generating...' : 'Regenerate Insights'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className={sp.statCard}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--sp-txm)' }}>Platform Bugs</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--sp-tx1)' }}>{totalBugs}</div>
        </div>
        <div className={sp.statCard}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--sp-txm)' }}>Critical Issues</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#ef4444' }}>{criticalBugs}</div>
          <div style={{ fontSize: 11, color: 'var(--sp-txm)', marginTop: 4 }}>&lt;20% resolution</div>
        </div>
        <div className={sp.statCard}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--sp-txm)' }}>Feature Requests</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--sp-tx1)' }}>{totalFeatures}</div>
        </div>
        <div className={sp.statCard}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--sp-txm)' }}>Usage Patterns</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--sp-tx1)' }}>{totalPatterns}</div>
        </div>
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid var(--sp-border)', marginBottom: 20 }}>
        <button
          onClick={() => setActiveSection('bugs')}
          style={{
            padding: '8px 16px',
            background: activeSection === 'bugs' ? 'var(--sp-s2)' : 'transparent',
            border: 'none',
            borderBottom: activeSection === 'bugs' ? '2px solid var(--sp-accent)' : 'none',
            color: activeSection === 'bugs' ? 'var(--sp-accent)' : 'var(--sp-txm)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: -2,
          }}
        >
          Bugs ({totalBugs})
        </button>
        <button
          onClick={() => setActiveSection('features')}
          style={{
            padding: '8px 16px',
            background: activeSection === 'features' ? 'var(--sp-s2)' : 'transparent',
            border: 'none',
            borderBottom: activeSection === 'features' ? '2px solid var(--sp-accent)' : 'none',
            color: activeSection === 'features' ? 'var(--sp-accent)' : 'var(--sp-txm)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: -2,
          }}
        >
          Features ({totalFeatures})
        </button>
        <button
          onClick={() => setActiveSection('patterns')}
          style={{
            padding: '8px 16px',
            background: activeSection === 'patterns' ? 'var(--sp-s2)' : 'transparent',
            border: 'none',
            borderBottom: activeSection === 'patterns' ? '2px solid var(--sp-accent)' : 'none',
            color: activeSection === 'patterns' ? 'var(--sp-accent)' : 'var(--sp-txm)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: -2,
          }}
        >
          Patterns ({totalPatterns})
        </button>
      </div>

      {/* Content area - Data Tables */}
      <div className={sp.card} style={{ marginBottom: 24 }}>
        {activeSection === 'bugs' && (
          <div>
            {bugs.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--sp-txm)' }}>
                No bugs found. Click &apos;Generate Insights&apos; to analyze transcripts.
              </div>
            ) : (
              <div style={{ maxHeight: '600px', overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--sp-bg)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '2px solid var(--sp-border)' }}>
                      <th style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--sp-txm)', fontWeight: 600, fontSize: 12 }}>Bug Title</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--sp-txm)', fontWeight: 600, fontSize: 12 }}>Count</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--sp-txm)', fontWeight: 600, fontSize: 12 }}>Resolution</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--sp-txm)', fontWeight: 600, fontSize: 12 }}>Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bugs.slice(0, 20).map((bug, idx) => (
                      <tr
                        key={`${bug.insight_key}-${idx}`}
                        onClick={() => setSelectedInsight(bug)}
                        style={{
                          borderBottom: '1px solid var(--sp-s3)',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--sp-s2)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <td style={{ padding: '12px 16px', color: 'var(--sp-tx1)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {bug.insight_title}
                            {bug.resolution_rate < 0.2 && (
                              <span style={{ padding: '2px 8px', background: '#ef444415', color: '#ef4444', fontSize: 10, fontWeight: 700, borderRadius: 4, whiteSpace: 'nowrap' }}>CRITICAL</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--sp-tx1)', fontWeight: 600 }}>{bug.occurrence_count}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--sp-tx1)', fontWeight: 600 }}>
                          {Math.round(bug.resolution_rate * 100)}%
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--sp-tx1)', fontWeight: 600 }}>
                          {bug.business_impact_score.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeSection === 'features' && (
          <div>
            {features.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--sp-txm)' }}>
                No feature requests found. Click &apos;Generate Insights&apos; to analyze transcripts.
              </div>
            ) : (
              <div style={{ maxHeight: '600px', overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--sp-bg)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '2px solid var(--sp-border)' }}>
                      <th style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--sp-txm)', fontWeight: 600, fontSize: 12 }}>Feature Title</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--sp-txm)', fontWeight: 600, fontSize: 12 }}>Requests</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--sp-txm)', fontWeight: 600, fontSize: 12 }}>Conversion</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--sp-txm)', fontWeight: 600, fontSize: 12 }}>Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {features.slice(0, 20).map((feature, idx) => (
                      <tr
                        key={`${feature.insight_key}-${idx}`}
                        onClick={() => setSelectedInsight(feature)}
                        style={{
                          borderBottom: '1px solid var(--sp-s3)',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--sp-s2)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <td style={{ padding: '12px 16px', color: 'var(--sp-tx1)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {feature.insight_title}
                            {feature.occurrence_count > 10 && (
                              <span style={{ padding: '2px 8px', background: '#10b98115', color: '#10b981', fontSize: 10, fontWeight: 700, borderRadius: 4, whiteSpace: 'nowrap' }}>HIGH DEMAND</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--sp-tx1)', fontWeight: 600 }}>{feature.occurrence_count}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--sp-tx1)', fontWeight: 600 }}>
                          {feature.conversion_signal_rate !== undefined ? `${Math.round(feature.conversion_signal_rate * 100)}%` : '-'}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--sp-tx1)', fontWeight: 600 }}>
                          {feature.business_impact_score.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeSection === 'patterns' && (
          <div>
            {patterns.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--sp-txm)' }}>
                No patterns found. Click &apos;Generate Insights&apos; to analyze transcripts.
              </div>
            ) : (
              <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                {patterns.map((pattern, idx) => (
                <div
                  key={`${pattern.insight_key}-${idx}`}
                  style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid var(--sp-border)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedInsight(pattern)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sp-s2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--sp-tx1)' }}>{pattern.insight_title}</div>
                        {pattern.trend === 'increasing' && (
                          <span style={{ padding: '3px 10px', background: '#ef444415', color: '#ef4444', fontSize: 10, fontWeight: 700, borderRadius: 4 }}>INCREASING</span>
                        )}
                        {pattern.trend === 'decreasing' && (
                          <span style={{ padding: '3px 10px', background: '#10b98115', color: '#10b981', fontSize: 10, fontWeight: 700, borderRadius: 4 }}>DECREASING</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: 'var(--sp-txm)' }}>
                        <span>Count: <strong>{pattern.occurrence_count}</strong></span>
                        <span>Category: <strong>{pattern.pattern_category}</strong></span>
                      </div>
                    </div>
                    <div style={{ marginLeft: 20, fontSize: 12, color: 'var(--sp-accent)', whiteSpace: 'nowrap' }}>View Details →</div>
                  </div>
                </div>
              ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* VISUALIZATIONS - Always visible */}
      {(bugs.length > 0 || features.length > 0 || patterns.length > 0) && (
        <div className={sp.card} style={{ marginTop: 24, padding: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--sp-tx1)', marginBottom: 24 }}>
            📊 Pain Point Visualizations
          </h3>
          <InsightsVisualizations
            bugs={bugs}
            features={features}
            patterns={patterns}
            onInsightClick={setSelectedInsight}
          />
        </div>
      )}

      {/* Detail Modal */}
      {selectedInsight && (
        <InsightDetailModal insight={selectedInsight} onClose={() => setSelectedInsight(null)} />
      )}
    </div>
  );
}
