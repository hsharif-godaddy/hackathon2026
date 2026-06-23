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
  bugs: InsightRow[];
  features: InsightRow[];
  patterns: InsightRow[];
  onInsightClick: (insight: InsightRow) => void;
}

export default function InsightsVisualizations({ bugs, features, patterns, onInsightClick }: Props) {
  const allInsights: InsightRow[] = [...bugs, ...features, ...patterns];

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
            <div style={{ fontSize: 12, color: 'var(--sp-txm)', marginBottom: 16 }}>
              Shows which friction categories have the most severe patterns
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
            <div style={{ fontSize: 12, color: 'var(--sp-txm)', marginBottom: 16 }}>
              Shows which patterns are improving (↓) vs getting worse (↑)
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
                  content={({ active, payload }) => {
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

      {/* Top Preventable Issues (ROI) */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--sp-tx)', marginBottom: 8 }}>
          3. Top Preventable Issues (Highest ROI)
        </div>
        <div style={{ fontSize: 12, color: 'var(--sp-txm)', marginBottom: 16 }}>
          Issues with highest preventable contact count - where product improvements would have biggest impact
        </div>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={(() => {
              return allInsights
                .map(insight => ({
                  title: insight.insight_title.length > 35 ? insight.insight_title.substring(0, 35) + '...' : insight.insight_title,
                  preventable: Math.round(insight.occurrence_count * insight.preventable_rate),
                  nonPreventable: Math.round(insight.occurrence_count * (1 - insight.preventable_rate)),
                  fullTitle: insight.insight_title,
                  insight,
                }))
                .sort((a, b) => b.preventable - a.preventable)
                .slice(0, 15);
            })()}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 150, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-border)" />
            <XAxis type="number" stroke="var(--sp-txm)" tick={{ fill: 'var(--sp-txm)', fontSize: 10 }} />
            <YAxis
              dataKey="title"
              type="category"
              stroke="var(--sp-txm)"
              tick={{ fill: 'var(--sp-txm)', fontSize: 10 }}
              width={150}
            />
            <Tooltip
              cursor={{ fill: 'var(--sp-s2)' }}
              content={({ active, payload }) => {
                if (active && payload && payload.length > 0) {
                  const data = payload[0].payload;
                  return (
                    <div style={{ background: 'var(--sp-bg)', border: '1px solid var(--sp-border)', borderRadius: 6, padding: '8px 12px' }}>
                      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--sp-tx)', fontSize: 12 }}>{data.fullTitle}</div>
                      <div style={{ fontSize: 11, color: '#ef4444' }}>Preventable: {data.preventable}</div>
                      <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Non-preventable: {data.nonPreventable}</div>
                      <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Total: {data.preventable + data.nonPreventable}</div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar dataKey="preventable" stackId="a" fill="#ef4444" name="Preventable" />
            <Bar dataKey="nonPreventable" stackId="a" fill="#94a3b8" name="Non-preventable" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Resolution vs Preventability Heatmap */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--sp-tx)', marginBottom: 8 }}>
          4. Issue Priority Heatmap (Resolution vs Preventability)
        </div>
        <div style={{ fontSize: 12, color: 'var(--sp-txm)', marginBottom: 16 }}>
          Shows where issues cluster. Top-left = critical (low resolution + high preventable). Click cells to see issues.
        </div>
        <div>
          {(() => {
            // Create 5x5 grid: Resolution (x-axis) vs Preventability (y-axis)
            const buckets: Array<Array<{ count: number; insights: InsightRow[]; totalImpact: number }>> = Array(5).fill(null).map(() =>
              Array(5).fill(null).map(() => ({ count: 0, insights: [], totalImpact: 0 }))
            );

            // Bucket each insight
            allInsights.forEach(insight => {
              const resolutionBucket: number = Math.min(4, Math.floor(insight.resolution_rate * 5));
              const preventabilityBucket: number = Math.min(4, Math.floor(insight.preventable_rate * 5));
              buckets[4 - preventabilityBucket][resolutionBucket].count += 1;
              buckets[4 - preventabilityBucket][resolutionBucket].insights.push(insight);
              buckets[4 - preventabilityBucket][resolutionBucket].totalImpact += insight.business_impact_score;
            });

            const maxCount: number = Math.max(...buckets.flat().map(b => b.count));
            const resolutionLabels: string[] = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'];
            const preventabilityLabels: string[] = ['80-100%', '60-80%', '40-60%', '20-40%', '0-20%'];

            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  {/* Y-axis label */}
                  <div style={{ display: 'flex', alignItems: 'center', height: 350 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-txm)', transform: 'rotate(-90deg)', whiteSpace: 'nowrap' }}>
                      Preventability Rate →
                    </div>
                  </div>

                  {/* Y-axis labels + Grid */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'space-between', paddingTop: 8 }}>
                      {preventabilityLabels.map(label => (
                        <div key={label} style={{ height: 65, display: 'flex', alignItems: 'center', fontSize: 11, color: 'var(--sp-txm)' }}>
                          {label}
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {buckets.map((row, i) => (
                        <div key={i} style={{ display: 'flex', gap: 2 }}>
                          {row.map((cell, j) => {
                            const intensity: number = maxCount > 0 ? cell.count / maxCount : 0;
                            const avgImpact: number = cell.count > 0 ? cell.totalImpact / cell.count : 0;

                            // Color based on quadrant
                            let baseColor: string = '#cbd5e1';
                            if (i <= 1 && j <= 1) baseColor = '#ef4444'; // Top-left: CRITICAL
                            else if (i <= 1) baseColor = '#f59e0b'; // Top-middle/right: WARNING
                            else if (j <= 1) baseColor = '#3b82f6'; // Bottom-left: INFO
                            else baseColor = '#10b981'; // Bottom-right: GOOD

                            const alpha: string = intensity > 0 ? Math.max(0.2, intensity).toFixed(2) : '0.05';

                            return (
                              <div
                                key={j}
                                onClick={() => {
                                  if (cell.count > 0 && onInsightClick) {
                                    onInsightClick(cell.insights[0]);
                                  }
                                }}
                                style={{
                                  width: 110,
                                  height: 65,
                                  background: `${baseColor}${alpha.replace('0.', '')}`,
                                  border: `2px solid ${baseColor}40`,
                                  borderRadius: 6,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: cell.count > 0 ? 'pointer' : 'default',
                                  transition: 'transform 0.1s',
                                }}
                                onMouseEnter={(e) => {
                                  if (cell.count > 0) e.currentTarget.style.transform = 'scale(1.05)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.transform = 'scale(1)';
                                }}
                                title={cell.count > 0 ? `${cell.count} issue(s)\nAvg Impact: ${avgImpact.toFixed(1)}\nClick to view first issue` : ''}
                              >
                                <div style={{ fontSize: 20, fontWeight: 700, color: cell.count > 0 ? baseColor : 'var(--sp-txm)' }}>
                                  {cell.count}
                                </div>
                                {cell.count > 0 && (
                                  <div style={{ fontSize: 10, color: baseColor, fontWeight: 500 }}>
                                    {avgImpact.toFixed(1)} avg
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}

                      {/* X-axis labels */}
                      <div style={{ display: 'flex', gap: 2, marginTop: 8 }}>
                        {resolutionLabels.map(label => (
                          <div key={label} style={{ width: 110, textAlign: 'center', fontSize: 11, color: 'var(--sp-txm)' }}>
                            {label}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* X-axis label */}
                <div style={{ marginTop: 8, textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--sp-txm)' }}>
                  Resolution Rate →
                </div>

                {/* Legend */}
                <div style={{ marginTop: 20, display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 20, height: 20, background: '#ef4444', borderRadius: 4 }} />
                    <span style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Critical (High Preventable + Low Resolution)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 20, height: 20, background: '#f59e0b', borderRadius: 4 }} />
                    <span style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Warning (High Preventable)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 20, height: 20, background: '#3b82f6', borderRadius: 4 }} />
                    <span style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Info (Low Resolution)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 20, height: 20, background: '#10b981', borderRadius: 4 }} />
                    <span style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Good (High Resolution + Low Preventable)</span>
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
            5. Bug Cluster Impact Matrix
          </div>
          <div style={{ fontSize: 12, color: 'var(--sp-txm)', marginBottom: 16 }}>
            Shows which bugs have high impact AND high occurrence. Size = preventable contacts. Color = resolution rate (red = critical).
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
                content={({ active, payload }) => {
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
            6. Feature Demand vs Value Matrix
          </div>
          <div style={{ fontSize: 12, color: 'var(--sp-txm)', marginBottom: 16 }}>
            Shows which features users want most AND have highest business value. Size = business impact. Green = priority features.
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
                content={({ active, payload }) => {
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
