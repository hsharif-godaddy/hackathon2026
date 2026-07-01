"use client";

import React from 'react';
import type { InsightRow } from '@/lib/supportplane/store/insights-client';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  BarChart,
  Bar,
  PieChart,
  Pie,
} from 'recharts';

interface Props {
  patterns: InsightRow[];
  bugs: InsightRow[];
  features: InsightRow[];
  onInsightClick: (insight: InsightRow) => void;
}

interface TooltipContentState<T> {
  active?: boolean;
  payload?: Array<{ payload: T }>;
}

interface PatternTooltipRow {
  name: string;
  count: number;
  contacts: number;
}

export default function InsightsVisualizations({ patterns, bugs, features, onInsightClick }: Props) {
  const allInsights: InsightRow[] = [...patterns, ...bugs, ...features];

  // Priority-heatmap cell analysis state. Declared at the component top level —
  // above the early return below — so the hook call order is identical on every
  // render regardless of how many insights are present (react-hooks/rules-of-hooks).
  const [selectedCell, setSelectedCell] = React.useState<{ row: number; col: number } | null>(null);
  const [cellAnalysis, setCellAnalysis] = React.useState<any>(null);
  const [analyzing, setAnalyzing] = React.useState<boolean>(false);

  if (allInsights.length === 0) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Pattern Severity Radar + Improvement Trends */}
      {patterns.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Pattern Severity Radar */}
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--sp-tx)', marginBottom: 8 }}>
              1. Pattern Severity by Category
            </div>
            <div style={{ fontSize: 11, color: 'var(--sp-txm)', marginBottom: 16, lineHeight: 1.5 }}>
              Radar chart showing severity score per friction category (impact × frequency). Larger area = more severe pain points in that category.
            </div>
            <ResponsiveContainer width="100%" height={350}>
              <RadarChart data={(() => {
                const categoryMap = new Map<string, { count: number; avgImpact: number; avgOccurrence: number }>();
                patterns.forEach(p => {
                  const cat: string = p.pattern_category || 'Other';
                  const existing = categoryMap.get(cat) || { count: 0, avgImpact: 0, avgOccurrence: 0 };
                  categoryMap.set(cat, {
                    count: existing.count + 1,
                    avgImpact: existing.avgImpact + p.business_impact_score,
                    avgOccurrence: existing.avgOccurrence + p.occurrence_count,
                  });
                });

                const radarData: Array<{ category: string; severity: number; fullMark: number }> = Array.from(categoryMap.entries()).map(([cat, data]) => ({
                  category: cat.length > 15 ? cat.substring(0, 15) + '...' : cat,
                  severity: (data.avgImpact / data.count) * (data.avgOccurrence / data.count) / 10,
                  fullMark: 100,
                })).slice(0, 8);

                return radarData;
              })()}>
                <PolarGrid stroke="var(--sp-border)" />
                <PolarAngleAxis dataKey="category" tick={{ fill: 'var(--sp-txm)', fontSize: 11 }} />
                <PolarRadiusAxis angle={90} domain={[0, 'auto']} tick={{ fill: 'var(--sp-txm)', fontSize: 10 }} />
                <Radar name="Severity" dataKey="severity" stroke="#ef4444" fill="#ef4444" fillOpacity={0.6} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--sp-txm)' }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Improvement Trends */}
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--sp-tx)', marginBottom: 8 }}>
              2. Improvement Trends
            </div>
            <div style={{ fontSize: 11, color: 'var(--sp-txm)', marginBottom: 16, lineHeight: 1.5 }}>
              Pattern count by trend direction. Increasing (red) = worsening patterns need attention. Decreasing (green) = improvements working.
            </div>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart
                data={(() => {
                  const increasing: InsightRow[] = patterns.filter(p => p.trend === 'increasing');
                  const decreasing: InsightRow[] = patterns.filter(p => p.trend === 'decreasing');
                  const stable: InsightRow[] = patterns.filter(p => !p.trend || p.trend === 'stable');

                  const increasingTotal: number = increasing.reduce((sum, p) => sum + p.occurrence_count, 0);
                  const decreasingTotal: number = decreasing.reduce((sum, p) => sum + p.occurrence_count, 0);
                  const stableTotal: number = stable.reduce((sum, p) => sum + p.occurrence_count, 0);

                  return [
                    {
                      name: 'Increasing\n(Worse)',
                      count: increasing.length,
                      contacts: increasingTotal,
                      fill: '#ef4444',
                    },
                    {
                      name: 'Stable',
                      count: stable.length,
                      contacts: stableTotal,
                      fill: '#94a3b8',
                    },
                    {
                      name: 'Decreasing\n(Better)',
                      count: decreasing.length,
                      contacts: decreasingTotal,
                      fill: '#10b981',
                    },
                  ];
                })()}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-border)" />
                <XAxis dataKey="name" stroke="var(--sp-txm)" tick={{ fill: 'var(--sp-txm)', fontSize: 11 }} />
                <YAxis stroke="var(--sp-txm)" tick={{ fill: 'var(--sp-txm)', fontSize: 10 }} />
                <Tooltip
                  cursor={{ fill: 'var(--sp-s2)' }}
                  content={({ active, payload }: TooltipContentState<PatternTooltipRow>) => {
                    if (active && payload && payload.length > 0) {
                      const data = payload[0].payload;
                      return (
                        <div style={{ background: 'var(--sp-bg)', border: '1px solid var(--sp-border)', borderRadius: 6, padding: '8px 12px' }}>
                          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--sp-tx)', fontSize: 12 }}>{data.name.replace(/\n/g, ' ')}</div>
                          <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Patterns: {data.count}</div>
                          <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Total Contacts: {data.contacts}</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                  {[0, 1, 2].map((_, index) => (
                    <Cell key={`cell-${index}`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Impact vs Frequency Heatmap - Enhanced */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--sp-tx)', marginBottom: 8 }}>
          3. Issue Priority Heatmap (Impact vs Frequency)
        </div>
        <div style={{ fontSize: 11, color: 'var(--sp-txm)', marginBottom: 16, lineHeight: 1.5 }}>
          3×3 grid grouping issues by business impact (Y) and occurrence frequency (X). Top-right cells = critical issues with high impact affecting many users. Click cells for AI-generated root cause analysis.
        </div>
        <div>
          {(() => {
            // Create 3x3 grid: Frequency (X) vs Impact (Y)
            const GRID_SIZE: number = 3;
            const buckets: Array<Array<{ count: number; insights: InsightRow[]; totalImpact: number }>> = Array(GRID_SIZE).fill(null).map(() =>
              Array(GRID_SIZE).fill(null).map(() => ({ count: 0, insights: [], totalImpact: 0 }))
            );

            // Calculate percentile thresholds for better distribution
            const frequencies: number[] = allInsights.map(i => i.occurrence_count).sort((a, b) => a - b);
            const impacts: number[] = allInsights.map(i => i.business_impact_score).sort((a, b) => a - b);

            const freqP33: number = frequencies[Math.floor(frequencies.length * 0.33)] || 0;
            const freqP67: number = frequencies[Math.floor(frequencies.length * 0.67)] || 0;
            const impactP33: number = impacts[Math.floor(impacts.length * 0.33)] || 0;
            const impactP67: number = impacts[Math.floor(impacts.length * 0.67)] || 0;

            // Bucket each insight by percentile ranges
            allInsights.forEach(insight => {
              const freq: number = insight.occurrence_count;
              const impact: number = insight.business_impact_score;

              // Frequency bucket (X-axis: 0=low, 1=med, 2=high)
              let freqBucket: number = 0;
              if (freq >= freqP67) freqBucket = 2;
              else if (freq >= freqP33) freqBucket = 1;

              // Impact bucket (Y-axis: 0=low, 1=med, 2=high)
              let impactBucket: number = 0;
              if (impact >= impactP67) impactBucket = 2;
              else if (impact >= impactP33) impactBucket = 1;

              // Invert Y-axis so high impact = top row
              const row: number = (GRID_SIZE - 1) - impactBucket;

              buckets[row][freqBucket].count += 1;
              buckets[row][freqBucket].insights.push(insight);
              buckets[row][freqBucket].totalImpact += impact;
            });

            const maxCount: number = Math.max(...buckets.flat().map(b => b.count), 1);
            const frequencyLabels: string[] = ['Low\n(Bottom 33%)', 'Medium\n(Mid 33%)', 'High\n(Top 33%)'];
            const impactLabels: string[] = ['High Impact\n(Top 33%)', 'Medium Impact\n(Mid 33%)', 'Low Impact\n(Bottom 33%)'];

            const analyzeCell = async (row: number, col: number) => {
              const cell = buckets[row][col];
              if (cell.count === 0) return;

              setSelectedCell({ row, col });
              setAnalyzing(true);

              // Calculate aggregate metrics
              const avgResolution: number = cell.insights.reduce((sum, i) => sum + i.resolution_rate, 0) / cell.count;
              const avgPreventable: number = cell.insights.reduce((sum, i) => sum + i.preventable_rate, 0) / cell.count;
              const totalContacts: number = cell.insights.reduce((sum, i) => sum + i.occurrence_count, 0);
              const preventableContacts: number = cell.insights.reduce((sum, i) => sum + (i.occurrence_count * i.preventable_rate), 0);

              const quadrant: string = row <= 0 && col <= 0 ? 'CRITICAL' : row <= 0 ? 'HIGH PRIORITY' : col <= 0 ? 'HARD TO RESOLVE' : 'GOOD';

              try {
                // Call AI-driven analysis API
                const response = await fetch('/api/supportplane/insights/analyze-cell', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    insights: cell.insights.map(i => ({
                      insight_title: i.insight_title,
                      insight_description: i.insight_description,
                      recommended_action: i.recommended_action,
                      occurrence_count: i.occurrence_count,
                      resolution_rate: i.resolution_rate,
                      preventable_rate: i.preventable_rate,
                      business_impact_score: i.business_impact_score,
                      product_line: i.product_line,
                      insight_type: i.insight_type,
                    })),
                    quadrant,
                    totalContacts,
                    preventableContacts: Math.round(preventableContacts),
                  }),
                });

                if (!response.ok) {
                  throw new Error('Failed to analyze cell');
                }

                const result = await response.json();

                setCellAnalysis({
                  quadrant,
                  totalIssues: cell.count,
                  totalContacts,
                  preventableContacts: Math.round(preventableContacts),
                  avgResolution: (avgResolution * 100).toFixed(0),
                  avgPreventable: (avgPreventable * 100).toFixed(0),
                  avgImpact: (cell.totalImpact / cell.count).toFixed(1),
                  sampleIssues: cell.insights.slice(0, 5),
                  aiAnalysis: result.analysis,
                });
              } catch (error) {
                setCellAnalysis({
                  quadrant,
                  totalIssues: cell.count,
                  totalContacts,
                  preventableContacts: Math.round(preventableContacts),
                  avgResolution: (avgResolution * 100).toFixed(0),
                  avgPreventable: (avgPreventable * 100).toFixed(0),
                  avgImpact: (cell.totalImpact / cell.count).toFixed(1),
                  sampleIssues: cell.insights.slice(0, 5),
                  aiAnalysis: null,
                  error: 'Failed to generate AI analysis',
                });
              }

              setAnalyzing(false);
            };

            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  {/* Y-axis label */}
                  <div style={{ display: 'flex', alignItems: 'center', height: 280 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-txm)', transform: 'rotate(-90deg)', whiteSpace: 'nowrap' }}>
                      Business Impact Score →
                    </div>
                  </div>

                  {/* Y-axis labels + Grid */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, justifyContent: 'space-between', paddingTop: 8 }}>
                      {impactLabels.map(label => (
                        <div key={label} style={{ height: 85, display: 'flex', alignItems: 'center', fontSize: 10, color: 'var(--sp-txm)', textAlign: 'right', width: 90, lineHeight: 1.3 }}>
                          {label}
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {buckets.map((row, i) => (
                        <div key={i} style={{ display: 'flex', gap: 3 }}>
                          {row.map((cell, j) => {
                            const intensity: number = maxCount > 0 ? cell.count / maxCount : 0;
                            const avgImpact: number = cell.count > 0 ? cell.totalImpact / cell.count : 0;
                            const preventableContacts: number = Math.round(cell.insights.reduce((sum, ins) => sum + (ins.occurrence_count * ins.preventable_rate), 0));

                            // Enhanced color coding based on quadrant priority
                            // Top-right = high impact + high frequency = CRITICAL
                            // Top-mid/left = high impact = HIGH
                            // Bottom-right = high frequency = MEDIUM
                            let baseColor: string = '#10b981';
                            let priority: string = 'LOW';
                            if (i === 0 && j === 2) {
                              baseColor = '#dc2626'; // Critical: high impact + high frequency
                              priority = 'CRITICAL';
                            } else if (i === 0) {
                              baseColor = '#f59e0b'; // High impact
                              priority = 'HIGH';
                            } else if (j === 2) {
                              baseColor = '#3b82f6'; // High frequency
                              priority = 'MEDIUM';
                            }

                            const isSelected: boolean = selectedCell?.row === i && selectedCell?.col === j;
                            const alpha: string = intensity > 0 ? Math.max(0.3, intensity).toFixed(2) : '0.08';

                            return (
                              <div
                                key={j}
                                onClick={() => cell.count > 0 && analyzeCell(i, j)}
                                style={{
                                  width: 140,
                                  height: 85,
                                  background: isSelected ? `${baseColor}50` : `${baseColor}${alpha.replace('0.', '')}`,
                                  border: isSelected ? `3px solid ${baseColor}` : `2px solid ${baseColor}40`,
                                  borderRadius: 8,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: cell.count > 0 ? 'pointer' : 'default',
                                  transition: 'all 0.2s',
                                  padding: 8,
                                }}
                                onMouseEnter={(e) => {
                                  if (cell.count > 0) e.currentTarget.style.transform = 'scale(1.05)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.transform = 'scale(1)';
                                }}
                              >
                                {cell.count > 0 ? (
                                  <>
                                    <div style={{ fontSize: 9, fontWeight: 700, color: baseColor, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                                      {priority}
                                    </div>
                                    <div style={{ fontSize: 24, fontWeight: 700, color: baseColor, lineHeight: 1 }}>
                                      {cell.count}
                                    </div>
                                    <div style={{ fontSize: 9, color: baseColor, fontWeight: 600, marginTop: 4 }}>
                                      ~{preventableContacts} contacts
                                    </div>
                                    <div style={{ fontSize: 8, color: baseColor, opacity: 0.8, marginTop: 2 }}>
                                      impact: {avgImpact.toFixed(1)}
                                    </div>
                                  </>
                                ) : (
                                  <div style={{ fontSize: 18, color: 'var(--sp-txm)', opacity: 0.3 }}>—</div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}

                      {/* X-axis labels */}
                      <div style={{ display: 'flex', gap: 3, marginTop: 8 }}>
                        {frequencyLabels.map(label => (
                          <div key={label} style={{ width: 140, textAlign: 'center', fontSize: 10, color: 'var(--sp-txm)', lineHeight: 1.3 }}>
                            {label}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* X-axis label */}
                <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--sp-txm)' }}>
                  Occurrence Frequency (Customer Contact Volume) →
                </div>

                {/* Enhanced Analysis Panel */}
                {selectedCell !== null && cellAnalysis && (
                  <div style={{
                    marginTop: 24,
                    padding: 24,
                    background: 'var(--sp-s2)',
                    border: '2px solid var(--sp-border)',
                    borderRadius: 12,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 20 }}>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sp-tx1)', marginBottom: 4 }}>
                          {cellAnalysis.quadrant} - AI Root Cause Analysis
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--sp-txm)' }}>
                          Frequency: {frequencyLabels[selectedCell.col].split('\n')[0]} • Impact: {impactLabels[selectedCell.row].split('\n')[0]}
                        </div>
                      </div>
                      <button
                        onClick={() => { setSelectedCell(null); setCellAnalysis(null); }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          fontSize: 24,
                          color: 'var(--sp-txm)',
                          cursor: 'pointer',
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>

                    {analyzing && (
                      <div style={{ textAlign: 'center', padding: 40, color: 'var(--sp-txm)' }}>
                        <div style={{ fontSize: 14, marginBottom: 8 }}>🤖 Analyzing with AI...</div>
                        <div style={{ fontSize: 12 }}>Identifying root causes and platform improvement opportunities</div>
                      </div>
                    )}

                    {!analyzing && cellAnalysis.error && (
                      <div style={{ padding: 16, background: '#ef444415', border: '1px solid #ef444430', borderRadius: 6, marginBottom: 20 }}>
                        <div style={{ fontSize: 13, color: '#ef4444' }}>{cellAnalysis.error}</div>
                      </div>
                    )}

                    {!analyzing && !cellAnalysis.error && (
                      <>
                        {/* Metrics Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 24 }}>
                          {[
                            { label: 'Total Issues', value: cellAnalysis.totalIssues, color: '#6366f1' },
                            { label: 'Total Contacts', value: cellAnalysis.totalContacts.toLocaleString(), color: '#0891b2' },
                            { label: 'Preventable Contacts', value: cellAnalysis.preventableContacts.toLocaleString(), color: '#ef4444' },
                            { label: 'Avg Resolution', value: cellAnalysis.avgResolution + '%', color: '#10b981' },
                            { label: 'Avg Impact', value: cellAnalysis.avgImpact, color: '#f59e0b' },
                          ].map(m => (
                            <div key={m.label} style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: 24, fontWeight: 700, color: m.color, marginBottom: 4 }}>
                                {m.value}
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                {m.label}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* AI Analysis Summary */}
                        {cellAnalysis.aiAnalysis && (
                          <div style={{ marginBottom: 24, padding: 16, background: 'var(--sp-bg)', border: '1px solid var(--sp-border)', borderRadius: 8 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sp-tx1)', marginBottom: 8 }}>
                              📊 Executive Summary
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--sp-tx1)', lineHeight: 1.6 }}>
                              {cellAnalysis.aiAnalysis.summary}
                            </div>
                          </div>
                        )}

                        {/* Root Causes with Platform Areas */}
                        {cellAnalysis.aiAnalysis?.root_causes && cellAnalysis.aiAnalysis.root_causes.length > 0 && (
                          <div style={{ marginBottom: 24 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sp-tx1)', marginBottom: 14 }}>
                              🔍 Root Causes (AI-Identified)
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              {cellAnalysis.aiAnalysis.root_causes.map((cause: any, idx: number) => (
                                <div key={idx} style={{ padding: 14, background: 'var(--sp-bg)', border: '1px solid var(--sp-border)', borderRadius: 6 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sp-tx1)', marginBottom: 4 }}>
                                        {cause.category.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                      </div>
                                      <div style={{ fontSize: 12, color: 'var(--sp-txm)', lineHeight: 1.5 }}>
                                        {cause.description}
                                      </div>
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
                                    <div>
                                      <span style={{ color: 'var(--sp-txm)' }}>Issues: </span>
                                      <span style={{ fontWeight: 600, color: 'var(--sp-tx1)' }}>{cause.affected_issues_count}</span>
                                    </div>
                                    <div>
                                      <span style={{ color: 'var(--sp-txm)' }}>Preventable: </span>
                                      <span style={{ fontWeight: 600, color: '#ef4444' }}>{cause.preventable_contacts}</span>
                                    </div>
                                    <div>
                                      <span style={{ color: 'var(--sp-txm)' }}>Area: </span>
                                      <span style={{ fontWeight: 600, color: '#0891b2', textTransform: 'capitalize' }}>{cause.platform_area}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Platform Recommendations */}
                        {cellAnalysis.aiAnalysis?.platform_recommendations && cellAnalysis.aiAnalysis.platform_recommendations.length > 0 && (
                          <div style={{ marginBottom: 24 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sp-tx1)', marginBottom: 14 }}>
                              🎯 Platform Improvement Recommendations
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              {cellAnalysis.aiAnalysis.platform_recommendations.map((rec: any, idx: number) => (
                                <div key={idx} style={{ padding: 14, background: '#10b98108', border: '1px solid #10b98125', borderRadius: 6 }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    {rec.area}
                                  </div>
                                  <div style={{ fontSize: 13, color: 'var(--sp-tx1)', marginBottom: 8, lineHeight: 1.5 }}>
                                    {rec.recommendation}
                                  </div>
                                  <div style={{ fontSize: 12, color: 'var(--sp-txm)', marginBottom: 10, fontStyle: 'italic' }}>
                                    Impact: {rec.impact}
                                  </div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {rec.repo_areas.map((area: string, aIdx: number) => (
                                      <span key={aIdx} style={{
                                        padding: '3px 8px',
                                        background: 'var(--sp-s3)',
                                        color: 'var(--sp-tx1)',
                                        fontSize: 10,
                                        fontFamily: 'monospace',
                                        borderRadius: 3,
                                      }}>
                                        {area}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Agent Improvements */}
                        {cellAnalysis.aiAnalysis?.agent_improvements && cellAnalysis.aiAnalysis.agent_improvements.length > 0 && (
                          <div style={{ marginBottom: 24 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sp-tx1)', marginBottom: 14 }}>
                              🤖 AI Agent Improvements
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {cellAnalysis.aiAnalysis.agent_improvements.map((imp: any, idx: number) => (
                                <div key={idx} style={{ padding: 12, background: '#6366f108', border: '1px solid #6366f125', borderRadius: 6 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: '#6366f1', marginBottom: 4 }}>
                                    {imp.improvement}
                                  </div>
                                  <div style={{ fontSize: 12, color: 'var(--sp-txm)', lineHeight: 1.5 }}>
                                    {imp.rationale}
                                  </div>
                                  <div style={{ fontSize: 11, color: 'var(--sp-txm)', marginTop: 6 }}>
                                    Affects {imp.affected_issues} issue(s)
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Codebase Areas */}
                        {cellAnalysis.aiAnalysis?.codebase_areas && cellAnalysis.aiAnalysis.codebase_areas.length > 0 && (
                          <div style={{ marginBottom: 24 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sp-tx1)', marginBottom: 14 }}>
                              📂 Affected Codebase Areas
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                              {cellAnalysis.aiAnalysis.codebase_areas.map((area: any, idx: number) => (
                                <div key={idx} style={{ padding: 12, background: 'var(--sp-bg)', border: '1px solid var(--sp-border)', borderRadius: 6 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-tx1)', fontFamily: 'monospace' }}>
                                      {area.area}
                                    </span>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>
                                      {area.issue_count}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 11, color: 'var(--sp-txm)', lineHeight: 1.4 }}>
                                    {area.suggested_changes}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Tags to Root Causes Mapping */}
                        {cellAnalysis.aiAnalysis?.tags_to_root_causes && cellAnalysis.aiAnalysis.tags_to_root_causes.length > 0 && (
                          <div style={{ marginBottom: 24 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sp-tx1)', marginBottom: 14 }}>
                              🏷️ Tags → Root Causes Mapping
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {cellAnalysis.aiAnalysis.tags_to_root_causes.slice(0, 15).map((mapping: any, idx: number) => (
                                <div key={idx} style={{
                                  padding: '6px 12px',
                                  background: 'var(--sp-bg)',
                                  border: '1px solid var(--sp-border)',
                                  borderRadius: 6,
                                  fontSize: 11,
                                }}>
                                  <span style={{ color: '#0891b2', fontWeight: 600 }}>#{mapping.tag}</span>
                                  <span style={{ color: 'var(--sp-txm)', margin: '0 4px' }}>→</span>
                                  <span style={{ color: 'var(--sp-tx1)' }}>{mapping.root_cause_category}</span>
                                  <span style={{ color: 'var(--sp-txm)', marginLeft: 4 }}>({mapping.frequency})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Sample Issues */}
                    <div style={{ marginTop: 20 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sp-tx1)', marginBottom: 12 }}>
                        💡 Sample Issues (Top 5)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {cellAnalysis.sampleIssues.map((issue: InsightRow, idx: number) => (
                          <div
                            key={idx}
                            onClick={() => onInsightClick(issue)}
                            style={{
                              padding: 12,
                              background: 'var(--sp-bg)',
                              border: '1px solid var(--sp-border)',
                              borderRadius: 6,
                              cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sp-s1)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--sp-bg)'; }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sp-tx1)', marginBottom: 4 }}>
                                  {issue.insight_title}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>
                                  {issue.occurrence_count} occurrences • {(issue.resolution_rate * 100).toFixed(0)}% resolved • {(issue.preventable_rate * 100).toFixed(0)}% preventable
                                </div>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--sp-accent)', whiteSpace: 'nowrap', marginLeft: 12 }}>
                                View →
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Platform Improvement Recommendation */}
                    <div style={{
                      marginTop: 20,
                      padding: 16,
                      background: '#ef444415',
                      border: '1px solid #ef444430',
                      borderRadius: 8,
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        🎯 Platform Improvement Impact
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--sp-tx1)', lineHeight: 1.6 }}>
                        {cellAnalysis.quadrant === 'CRITICAL' &&
                          `This quadrant represents the highest-priority improvements for Airo Builder. Issues here have both HIGH BUSINESS IMPACT and HIGH FREQUENCY, affecting many customers with significant consequences. With ${cellAnalysis.preventableContacts} preventable contacts, addressing these root causes would deliver maximum ROI in reducing support burden.`
                        }
                        {cellAnalysis.quadrant === 'HIGH' &&
                          `These issues have HIGH BUSINESS IMPACT but moderate-to-low frequency. While fewer customers are affected, the severity is significant. With ${cellAnalysis.preventableContacts} preventable contacts, these warrant attention to prevent serious customer pain points.`
                        }
                        {cellAnalysis.quadrant === 'MEDIUM' &&
                          `These issues occur frequently but have moderate impact. They create consistent support volume (${cellAnalysis.preventableContacts} preventable contacts) but don't severely block customers. Consider quick wins or self-service improvements to reduce volume.`
                        }
                        {cellAnalysis.quadrant === 'LOW' &&
                          `These issues have both low impact and low frequency. While ${cellAnalysis.preventableContacts} contacts could still be prevented, they represent lower-priority improvements compared to other quadrants.`
                        }
                      </div>
                    </div>
                  </div>
                )}

                {/* Legend */}
                <div style={{ marginTop: 20, display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 20, height: 20, background: '#dc2626', borderRadius: 4 }} />
                    <span style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Critical (High Impact + High Frequency)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 20, height: 20, background: '#f59e0b', borderRadius: 4 }} />
                    <span style={{ fontSize: 11, color: 'var(--sp-txm)' }}>High (High Impact)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 20, height: 20, background: '#3b82f6', borderRadius: 4 }} />
                    <span style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Medium (High Frequency)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 20, height: 20, background: '#10b981', borderRadius: 4 }} />
                    <span style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Low (Lower Priority)</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Bug Cluster Impact Matrix */}
      {bugs.length > 0 && (
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--sp-tx)', marginBottom: 8 }}>
            4. Bug Cluster Impact Matrix
          </div>
          <div style={{ fontSize: 11, color: 'var(--sp-txm)', marginBottom: 16, lineHeight: 1.5 }}>
            Scatter plot of bugs by occurrence (X) vs business impact (Y). Bubble size = preventable contacts. Red = low resolution rate (&lt;20%), needs urgent attention.
          </div>
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-border)" />
              <XAxis
                type="number"
                dataKey="occurrence_count"
                name="Occurrence"
                stroke="var(--sp-txm)"
                label={{ value: 'Occurrence Count', position: 'insideBottom', offset: -10, fill: 'var(--sp-txm)' }}
              />
              <YAxis
                type="number"
                dataKey="business_impact_score"
                name="Impact"
                stroke="var(--sp-txm)"
                label={{ value: 'Business Impact Score', angle: -90, position: 'insideLeft', fill: 'var(--sp-txm)' }}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }: TooltipContentState<InsightRow>) => {
                  if (active && payload && payload.length > 0) {
                    const data: InsightRow = payload[0].payload as InsightRow;
                    return (
                      <div style={{ background: 'var(--sp-bg)', border: '1px solid var(--sp-border)', borderRadius: 6, padding: '8px 12px' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--sp-tx)', fontSize: 12 }}>{data.insight_title}</div>
                        <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Occurrences: {data.occurrence_count}</div>
                        <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Impact: {data.business_impact_score.toFixed(1)}</div>
                        <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Resolution: {(data.resolution_rate * 100).toFixed(0)}%</div>
                        <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Preventable: {Math.round(data.occurrence_count * data.preventable_rate)} contacts</div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Scatter name="Bugs" data={bugs}>
                {bugs.map((bug, index) => {
                  const preventableContacts: number = Math.round(bug.occurrence_count * bug.preventable_rate);
                  const size: number = Math.max(50, Math.min(1000, preventableContacts * 5));
                  const resolutionRate: number = bug.resolution_rate;
                  let fillColor: string = '#10b981';
                  if (resolutionRate < 0.2) fillColor = '#ef4444';
                  else if (resolutionRate < 0.5) fillColor = '#f59e0b';

                  return (
                    <Cell
                      key={`cell-${index}`}
                      fill={fillColor}
                      fillOpacity={0.6}
                      stroke={fillColor}
                      strokeWidth={2}
                      r={size}
                      cursor="pointer"
                      onClick={() => onInsightClick(bug)}
                    />
                  );
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', fontSize: 11, color: 'var(--sp-txm)', marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ef4444' }} />
              <span>&lt;20% Resolution (Critical)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#f59e0b' }} />
              <span>20-50% Resolution</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981' }} />
              <span>&gt;50% Resolution</span>
            </div>
          </div>
        </div>
      )}

      {/* Feature Demand vs Value Matrix */}
      {features.length > 0 && (
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--sp-tx)', marginBottom: 8 }}>
            5. Feature Demand vs Value Matrix
          </div>
          <div style={{ fontSize: 11, color: 'var(--sp-txm)', marginBottom: 16, lineHeight: 1.5 }}>
            Scatter plot of feature requests by volume (X) vs conversion signal (Y). Bubble size = business impact. Green = high demand + high value = build first.
          </div>
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-border)" />
              <XAxis
                type="number"
                dataKey="occurrence_count"
                name="Requests"
                stroke="var(--sp-txm)"
                label={{ value: 'Request Count (Demand)', position: 'insideBottom', offset: -10, fill: 'var(--sp-txm)' }}
              />
              <YAxis
                type="number"
                dataKey="conversion_signal_rate"
                name="Conversion"
                stroke="var(--sp-txm)"
                label={{ value: 'Conversion Signal Rate', angle: -90, position: 'insideLeft', fill: 'var(--sp-txm)' }}
                domain={[0, 1]}
                tickFormatter={(value: number) => `${(value * 100).toFixed(0)}%`}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }: TooltipContentState<InsightRow>) => {
                  if (active && payload && payload.length > 0) {
                    const data: InsightRow = payload[0].payload as InsightRow;
                    return (
                      <div style={{ background: 'var(--sp-bg)', border: '1px solid var(--sp-border)', borderRadius: 6, padding: '8px 12px' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--sp-tx)', fontSize: 12 }}>{data.insight_title}</div>
                        <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Requests: {data.occurrence_count}</div>
                        <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>
                          Conversion: {data.conversion_signal_rate !== undefined ? `${(data.conversion_signal_rate * 100).toFixed(0)}%` : 'N/A'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Impact: {data.business_impact_score.toFixed(1)}</div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Scatter name="Features" data={features.filter(f => f.conversion_signal_rate !== undefined)}>
                {features.filter(f => f.conversion_signal_rate !== undefined).map((feature, index) => {
                  const size: number = Math.max(50, Math.min(1000, feature.business_impact_score * 20));
                  const isHighDemand: boolean = feature.occurrence_count > 10;
                  const isHighValue: boolean = (feature.conversion_signal_rate ?? 0) > 0.3;

                  let fillColor: string = '#6366f1';
                  if (isHighDemand && isHighValue) fillColor = '#10b981';
                  else if (isHighDemand) fillColor = '#3b82f6';
                  else if (isHighValue) fillColor = '#8b5cf6';

                  return (
                    <Cell
                      key={`cell-${index}`}
                      fill={fillColor}
                      fillOpacity={0.6}
                      stroke={fillColor}
                      strokeWidth={2}
                      r={size}
                      cursor="pointer"
                      onClick={() => onInsightClick(feature)}
                    />
                  );
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', fontSize: 11, color: 'var(--sp-txm)', marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981' }} />
              <span>High Demand + High Value (Priority)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#3b82f6' }} />
              <span>High Demand</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#8b5cf6' }} />
              <span>High Value</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
