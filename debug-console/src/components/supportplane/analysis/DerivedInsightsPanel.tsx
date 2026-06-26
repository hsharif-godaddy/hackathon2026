"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { InsightRow } from "@/lib/supportplane/store/insights-client";
import { useSupportPlaneData } from '@/contexts/SupportPlaneDataContext';
import sp from '@/components/supportplane/sp.module.css';
import InsightsVisualizations from './InsightsVisualizations';
import TranscriptCalendar from '@/components/supportplane/transcripts/Calendar';
import {
    Area, AreaChart, CartesianGrid,
    ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

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

          {/* Where Airo Went Wrong (Bugs) */}
          {insight.insight_type === 'BUG' && insight.where_airo_went_wrong && (
            <div style={{ background: '#ef444415', border: '1px solid #ef444430', borderRadius: 6, padding: '16px 18px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#ef4444', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Where Airo Went Wrong</div>

              {/* Platform Area */}
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-txm)', textTransform: 'uppercase' }}>Platform Area: </span>
                <span style={{
                  padding: '2px 8px',
                  background: 'var(--sp-s2)',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--sp-tx1)'
                }}>
                  {insight.where_airo_went_wrong_platform_area}
                </span>
              </div>

              {/* What Airo Did Wrong */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-txm)', marginBottom: 8, textTransform: 'uppercase' }}>What Airo Did Wrong:</div>
                {insight.where_airo_went_wrong.map((issue: any, idx: number) => (
                  <div key={idx} style={{
                    marginBottom: 10,
                    padding: '10px 12px',
                    background: 'var(--sp-s2)',
                    borderRadius: 4,
                    borderLeft: `3px solid ${
                      issue.confidence === 'high' ? '#ef4444' :
                      issue.confidence === 'medium' ? '#f59e0b' : '#94a3b8'
                    }`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sp-tx1)' }}>{issue.issue}</div>
                      <span style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 3,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        background: issue.confidence === 'high' ? '#ef444415' :
                                   issue.confidence === 'medium' ? '#f59e0b15' : '#94a3b815',
                        color: issue.confidence === 'high' ? '#ef4444' :
                               issue.confidence === 'medium' ? '#f59e0b' : '#94a3b8'
                      }}>
                        {issue.confidence}
                      </span>
                    </div>
                    <div style={{ color: 'var(--sp-txm)', fontSize: 12, lineHeight: 1.5 }}>{issue.description}</div>
                  </div>
                ))}
              </div>

              {/* Codebase Locations */}
              {insight.where_airo_went_wrong_codebase_locations && insight.where_airo_went_wrong_codebase_locations.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-txm)', marginBottom: 8, textTransform: 'uppercase' }}>Likely Code Locations:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {insight.where_airo_went_wrong_codebase_locations.map((location: string, idx: number) => (
                      <code key={idx} style={{
                        padding: '4px 8px',
                        background: 'var(--sp-s1)',
                        border: '1px solid var(--sp-border)',
                        borderRadius: 4,
                        fontSize: 11,
                        color: '#6366f1',
                        fontFamily: 'monospace'
                      }}>
                        {location}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {/* Technical Details */}
              {insight.where_airo_went_wrong_technical_details && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-txm)', marginBottom: 8, textTransform: 'uppercase' }}>Technical Details:</div>
                  <div style={{
                    padding: '10px 12px',
                    background: 'var(--sp-s1)',
                    border: '1px solid var(--sp-border)',
                    borderRadius: 4,
                    color: 'var(--sp-tx1)',
                    fontSize: 12,
                    lineHeight: 1.6,
                  }}>
                    {insight.where_airo_went_wrong_technical_details}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Where Things Went Wrong (Patterns) */}
          {insight.insight_type === 'PATTERN' && insight.what_went_wrong && (
            <div style={{ background: '#8b5cf615', border: '1px solid #8b5cf630', borderRadius: 6, padding: '16px 18px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#8b5cf6', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Where Things Went Wrong</div>

              {/* Platform Area */}
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-txm)', textTransform: 'uppercase' }}>Platform Area: </span>
                <span style={{
                  padding: '2px 8px',
                  background: 'var(--sp-s2)',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--sp-tx1)'
                }}>
                  {insight.where_things_went_wrong_platform_area}
                </span>
              </div>

              {/* Issues */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-txm)', marginBottom: 8, textTransform: 'uppercase' }}>Issues Identified:</div>
                {insight.what_went_wrong.map((issue: any, idx: number) => (
                  <div key={idx} style={{
                    marginBottom: 10,
                    padding: '10px 12px',
                    background: 'var(--sp-s2)',
                    borderRadius: 4,
                    borderLeft: `3px solid ${
                      issue.who === 'user' ? '#3b82f6' :
                      issue.who === 'airo-agent' ? '#ef4444' : '#f59e0b'
                    }`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sp-tx1)' }}>{issue.issue}</div>
                      <span style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 3,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        background: issue.who === 'user' ? '#3b82f615' :
                                   issue.who === 'airo-agent' ? '#ef444415' : '#f59e0b15',
                        color: issue.who === 'user' ? '#3b82f6' :
                               issue.who === 'airo-agent' ? '#ef4444' : '#f59e0b'
                      }}>
                        {issue.who === 'airo-agent' ? 'AIRO' : issue.who.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ color: 'var(--sp-txm)', fontSize: 12, lineHeight: 1.5 }}>{issue.description}</div>
                  </div>
                ))}
              </div>
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

interface DerivedInsightsPanelProps {
  days: number;
  analytics: any;
}

export default function DerivedInsightsPanel({ days: _parentDays, analytics }: DerivedInsightsPanelProps) {
  // Use centralized data context (loaded on app mount)
  const { bugs: allBugs, features: allFeatures, patterns: allPatterns, loading: contextLoading, refetchInsights, cachedInsightsDays } = useSupportPlaneData();

  const [activeSection, setActiveSection] = useState<'bugs' | 'features' | 'patterns'>('patterns');
  const [selectedInsight, setSelectedInsight] = useState<InsightRow | null>(null);
  const [generating, setGenerating] = useState<boolean>(false);
  const [refetching, setRefetching] = useState<boolean>(false);

  // Derived Insights has its own date range (relative selector)
  const [insightsDays, setInsightsDays] = useState<number>(30);

  // Local timeline data fetched based on insightsDays
  const [timeline, setTimeline] = useState<{date: string; count: number}[]>([]);

  useEffect(() => {
    async function fetchTimeline() {
      try {
        const end: Date = new Date();
        const start: Date = new Date();
        start.setDate(start.getDate() - insightsDays);
        const params: URLSearchParams = new URLSearchParams({
          start_date: start.toISOString().split('T')[0],
          end_date: end.toISOString().split('T')[0],
        });
        const res: Response = await fetch(`/api/supportplane/transcripts/analytics?${params}`);
        if (res.ok) {
          const data = await res.json();
          setTimeline(data.analytics?.timeline || []);
        }
      } catch { /* silently degrade */ }
    }
    void fetchTimeline();
  }, [insightsDays]);

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
      {/* AI Insights Header with Time Range */}
      <div style={{
        marginBottom:24,
        padding:'20px 24px',
        background:'var(--sp-bg)',
        borderRadius:16,
        boxShadow:'8px 8px 16px rgba(0,0,0,0.15), -8px -8px 16px rgba(255,255,255,0.05)'
      }}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:'var(--sp-tx1)',marginBottom:6,letterSpacing:'0.3px'}}>
              AI-Powered Pain Point Analysis
            </div>
            <div style={{fontSize:12,color:'var(--sp-txm)',lineHeight:1.6,opacity:0.9}}>
              Automatically identifies bugs, feature requests, and usage patterns from {insightsDays} days of support transcripts
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
            <select
              value={insightsDays}
              onChange={(e) => setInsightsDays(Number(e.target.value))}
              style={{
                padding:'10px 16px',
                fontSize:13,
                fontWeight:600,
                border:'none',
                borderRadius:12,
                background:'var(--sp-bg)',
                color:'var(--sp-tx1)',
                cursor:'pointer',
                minWidth:140,
                boxShadow:'inset 3px 3px 6px rgba(0,0,0,0.1), inset -3px -3px 6px rgba(255,255,255,0.03)',
                outline:'none'
              }}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
              <option value={365}>Last year</option>
            </select>
            <button
              onClick={handleGenerate}
              disabled={generating}
              style={{
                padding:'10px 20px',
                fontSize:13,
                fontWeight:600,
                border:'none',
                borderRadius:12,
                background: 'var(--sp-bg)',
                color: generating ? 'var(--sp-txm)' : 'var(--sp-tx1)',
                cursor: generating ? 'not-allowed' : 'pointer',
                whiteSpace:'nowrap',
                transition:'all 0.3s ease',
                boxShadow: generating
                  ? 'inset 3px 3px 6px rgba(0,0,0,0.1), inset -3px -3px 6px rgba(255,255,255,0.03)'
                  : '4px 4px 8px rgba(0,0,0,0.15), -4px -4px 8px rgba(255,255,255,0.05)',
                opacity: generating ? 0.6 : 1
              }}
            >
              {generating ? 'Generating...' : 'Regenerate'}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Grid: Chart+Stats (left) + Calendar (right) */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 400px',gap:20,marginBottom:28}}>
        {/* Left column: Volume chart stacked above stats */}
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {/* Transcript Volume Over Time */}
          <div style={{
            padding:'20px',
            background:'var(--sp-bg)',
            borderRadius:16,
            boxShadow:'8px 8px 16px rgba(0,0,0,0.15), -8px -8px 16px rgba(255,255,255,0.05)'
          }}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:12,color:'var(--sp-tx1)',letterSpacing:'0.3px'}}>
              Transcript Volume Over Time
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={timeline} margin={{top:10,right:10,left:0,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                <XAxis dataKey="date" tick={{fontSize:10,fill:'var(--sp-txm)'}} />
                <YAxis tick={{fontSize:10,fill:'var(--sp-txm)'}} />
                <Tooltip contentStyle={{background:'var(--sp-bg)',border:'1px solid var(--sp-border)',borderRadius:8,fontSize:12}} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#0891b2"
                  fill="#0891b21a"
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Stats Grid - 2x2 */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div style={{
              padding:'14px 16px',
              background:'var(--sp-bg)',
              borderRadius:12,
              boxShadow:'6px 6px 12px rgba(0,0,0,0.12), -6px -6px 12px rgba(255,255,255,0.04)',
            }}>
              <div style={{fontSize:10,fontWeight:600,color:'var(--sp-txm)',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.5px'}}>Total Transcripts</div>
              <div style={{fontSize:24,fontWeight:700,color:'var(--sp-tx1)',lineHeight:1}}>{analytics?.total.toLocaleString() || 0}</div>
            </div>
            <div style={{
              padding:'14px 16px',
              background:'var(--sp-bg)',
              borderRadius:12,
              boxShadow:'6px 6px 12px rgba(0,0,0,0.12), -6px -6px 12px rgba(255,255,255,0.04)',
            }}>
              <div style={{fontSize:10,fontWeight:600,color:'var(--sp-txm)',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.5px'}}>Unique Tags</div>
              <div style={{fontSize:24,fontWeight:700,color:'var(--sp-tx1)',lineHeight:1}}>{analytics?.top_tags.length || 0}</div>
            </div>
            <div style={{
              padding:'14px 16px',
              background:'var(--sp-bg)',
              borderRadius:12,
              boxShadow:'6px 6px 12px rgba(0,0,0,0.12), -6px -6px 12px rgba(255,255,255,0.04)',
            }}>
              <div style={{fontSize:10,fontWeight:600,color:'var(--sp-txm)',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.5px'}}>Categories</div>
              <div style={{fontSize:24,fontWeight:700,color:'var(--sp-tx1)',lineHeight:1}}>{analytics?.by_category.length || 0}</div>
            </div>
            <div style={{
              padding:'14px 16px',
              background:'var(--sp-bg)',
              borderRadius:12,
              boxShadow:'6px 6px 12px rgba(0,0,0,0.12), -6px -6px 12px rgba(255,255,255,0.04)',
            }}>
              <div style={{fontSize:10,fontWeight:600,color:'var(--sp-txm)',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.5px'}}>Days of Data</div>
              <div style={{fontSize:24,fontWeight:700,color:'var(--sp-tx1)',lineHeight:1}}>{timeline.length || 0}</div>
            </div>
          </div>
        </div>

        {/* Right column: Data Coverage Calendar (fixed 400px) */}
        <div style={{
          padding:'16px',
          background:'var(--sp-bg)',
          borderRadius:16,
          boxShadow:'8px 8px 16px rgba(0,0,0,0.15), -8px -8px 16px rgba(255,255,255,0.05)',
        }}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:8,color:'var(--sp-tx1)',letterSpacing:'0.3px'}}>
            Data Coverage Calendar
          </div>
          <TranscriptCalendar onDateClick={(date: string) => console.log('Selected date:', date)} />
        </div>
      </div>

      {/* Top Tags and Friction Points - Neomorphic */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:32}}>
        {/* Top 15 AI-Generated Tags */}
        <div style={{
          padding:'24px',
          background:'var(--sp-bg)',
          borderRadius:16,
          boxShadow:'8px 8px 16px rgba(0,0,0,0.15), -8px -8px 16px rgba(255,255,255,0.05)'
        }}>
          <div style={{
            display:'flex',
            alignItems:'center',
            justifyContent:'space-between',
            marginBottom:16,
            paddingBottom:12,
            borderBottom:'1px solid var(--sp-border)'
          }}>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:'var(--sp-tx1)',marginBottom:4}}>
                Top AI-Generated Tags
              </div>
              <div style={{fontSize:12,color:'var(--sp-txm)'}}>
                Most frequent support topics
              </div>
            </div>
            <div style={{
              padding:'4px 12px',
              background:'#0891b215',
              borderRadius:6,
              fontSize:12,
              fontWeight:600,
              color:'#0891b2'
            }}>
              {analytics?.top_tags.length || 0} total
            </div>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {analytics?.top_tags.slice(0, 15).map((item: {tag: string; count: number}, idx: number) => {
              const maxCount: number = analytics?.top_tags[0]?.count || 1;
              const percentage: number = (item.count / maxCount) * 100;
              return (
                <div key={item.tag} style={{
                  display:'flex',
                  alignItems:'center',
                  gap:10
                }}>
                  <div style={{
                    minWidth:24,
                    height:24,
                    borderRadius:6,
                    background:'#0891b215',
                    display:'flex',
                    alignItems:'center',
                    justifyContent:'center',
                    fontSize:11,
                    fontWeight:700,
                    color:'#0891b2'
                  }}>
                    {idx + 1}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                      <span style={{fontSize:12,fontWeight:600,color:'var(--sp-tx1)'}}>#{item.tag}</span>
                      <span style={{fontSize:11,fontWeight:600,color:'var(--sp-txm)'}}>{item.count}</span>
                    </div>
                    <div style={{
                      height:4,
                      background:'var(--sp-s3)',
                      borderRadius:2,
                      overflow:'hidden'
                    }}>
                      <div style={{
                        height:'100%',
                        width:`${percentage}%`,
                        background:'linear-gradient(90deg, #0891b2, #06b6d4)',
                        borderRadius:2
                      }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top 15 Friction Points */}
        <div style={{
          padding:'24px',
          background:'var(--sp-bg)',
          borderRadius:16,
          boxShadow:'8px 8px 16px rgba(0,0,0,0.15), -8px -8px 16px rgba(255,255,255,0.05)'
        }}>
          <div style={{
            display:'flex',
            alignItems:'center',
            justifyContent:'space-between',
            marginBottom:16,
            paddingBottom:12,
            borderBottom:'1px solid var(--sp-border)'
          }}>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:'var(--sp-tx1)',marginBottom:4}}>
                Top Friction Points
              </div>
              <div style={{fontSize:12,color:'var(--sp-txm)'}}>
                Most common customer pain points
              </div>
            </div>
            <div style={{
              padding:'4px 12px',
              background:'#ef444415',
              borderRadius:6,
              fontSize:12,
              fontWeight:600,
              color:'#ef4444'
            }}>
              {analytics?.by_friction_point.length || 0} total
            </div>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {analytics?.by_friction_point.slice(0, 15).map((item: {name: string; count: number}, idx: number) => {
              const maxCount: number = analytics?.by_friction_point[0]?.count || 1;
              const percentage: number = (item.count / maxCount) * 100;
              return (
                <div key={item.name} style={{
                  display:'flex',
                  alignItems:'center',
                  gap:10
                }}>
                  <div style={{
                    minWidth:24,
                    height:24,
                    borderRadius:6,
                    background:'#ef444415',
                    display:'flex',
                    alignItems:'center',
                    justifyContent:'center',
                    fontSize:11,
                    fontWeight:700,
                    color:'#ef4444'
                  }}>
                    {idx + 1}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                      <span style={{fontSize:12,fontWeight:600,color:'var(--sp-tx1)'}}>{item.name}</span>
                      <span style={{fontSize:11,fontWeight:600,color:'var(--sp-txm)'}}>{item.count}</span>
                    </div>
                    <div style={{
                      height:4,
                      background:'var(--sp-s3)',
                      borderRadius:2,
                      overflow:'hidden'
                    }}>
                      <div style={{
                        height:'100%',
                        width:`${percentage}%`,
                        background:'linear-gradient(90deg, #ef4444, #f87171)',
                        borderRadius:2
                      }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* AI Insights KPI Cards - Neomorphic Design */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 32 }}>
        <div style={{
          background:'var(--sp-bg)',
          borderRadius:16,
          padding:'24px',
          boxShadow:'8px 8px 16px rgba(0,0,0,0.15), -8px -8px 16px rgba(255,255,255,0.05)',
          transition:'all 0.3s ease'
        }}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--sp-txm)',marginBottom:12,textTransform:'uppercase',letterSpacing:'1px'}}>Usage Patterns</div>
          <div style={{fontSize:36,fontWeight:700,color:'var(--sp-tx1)',marginBottom:8,lineHeight:1}}>{totalPatterns}</div>
          <div style={{fontSize:11,color:'var(--sp-txm)',opacity:0.8}}>Behavioral insights</div>
        </div>

        <div style={{
          background:'var(--sp-bg)',
          borderRadius:16,
          padding:'24px',
          boxShadow:'8px 8px 16px rgba(0,0,0,0.15), -8px -8px 16px rgba(255,255,255,0.05)',
          transition:'all 0.3s ease'
        }}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--sp-txm)',marginBottom:12,textTransform:'uppercase',letterSpacing:'1px'}}>Platform Bugs</div>
          <div style={{fontSize:36,fontWeight:700,color:'var(--sp-tx1)',marginBottom:8,lineHeight:1}}>{totalBugs}</div>
          <div style={{fontSize:11,color:'var(--sp-txm)',opacity:0.8}}>Identified issues</div>
        </div>

        <div style={{
          background:'var(--sp-bg)',
          borderRadius:16,
          padding:'24px',
          boxShadow:'8px 8px 16px rgba(0,0,0,0.15), -8px -8px 16px rgba(255,255,255,0.05)',
          transition:'all 0.3s ease'
        }}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--sp-txm)',marginBottom:12,textTransform:'uppercase',letterSpacing:'1px'}}>Critical Issues</div>
          <div style={{fontSize:36,fontWeight:700,color:'#ef4444',marginBottom:8,lineHeight:1}}>{criticalBugs}</div>
          <div style={{fontSize:11,color:'var(--sp-txm)',opacity:0.8}}>&lt;20% resolution rate</div>
        </div>

        <div style={{
          background:'var(--sp-bg)',
          borderRadius:16,
          padding:'24px',
          boxShadow:'8px 8px 16px rgba(0,0,0,0.15), -8px -8px 16px rgba(255,255,255,0.05)',
          transition:'all 0.3s ease'
        }}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--sp-txm)',marginBottom:12,textTransform:'uppercase',letterSpacing:'1px'}}>Feature Requests</div>
          <div style={{fontSize:36,fontWeight:700,color:'var(--sp-tx1)',marginBottom:8,lineHeight:1}}>{totalFeatures}</div>
          <div style={{fontSize:11,color:'var(--sp-txm)',opacity:0.8}}>User-requested features</div>
        </div>
      </div>

      {/* Section tabs - Neomorphic Design */}
      <div style={{
        display: 'flex',
        gap: 12,
        marginBottom: 28,
        padding: 8,
        background: 'var(--sp-bg)',
        borderRadius: 16,
        width: 'fit-content',
        boxShadow:'inset 4px 4px 8px rgba(0,0,0,0.1), inset -4px -4px 8px rgba(255,255,255,0.03)'
      }}>
        <button
          onClick={() => setActiveSection('patterns')}
          style={{
            padding: '12px 24px',
            background: activeSection === 'patterns' ? 'var(--sp-bg)' : 'transparent',
            border: 'none',
            borderRadius: 12,
            color: activeSection === 'patterns' ? 'var(--sp-tx1)' : 'var(--sp-txm)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            transition: 'all 0.3s ease',
            boxShadow: activeSection === 'patterns' ? '4px 4px 8px rgba(0,0,0,0.15), -4px -4px 8px rgba(255,255,255,0.05)' : 'none'
          }}
        >
          Patterns <span style={{opacity:0.6,marginLeft:6}}>({totalPatterns})</span>
        </button>
        <button
          onClick={() => setActiveSection('bugs')}
          style={{
            padding: '12px 24px',
            background: activeSection === 'bugs' ? 'var(--sp-bg)' : 'transparent',
            border: 'none',
            borderRadius: 12,
            color: activeSection === 'bugs' ? 'var(--sp-tx1)' : 'var(--sp-txm)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            transition: 'all 0.3s ease',
            boxShadow: activeSection === 'bugs' ? '4px 4px 8px rgba(0,0,0,0.15), -4px -4px 8px rgba(255,255,255,0.05)' : 'none'
          }}
        >
          Bugs <span style={{opacity:0.6,marginLeft:6}}>({totalBugs})</span>
        </button>
        <button
          onClick={() => setActiveSection('features')}
          style={{
            padding: '12px 24px',
            background: activeSection === 'features' ? 'var(--sp-bg)' : 'transparent',
            border: 'none',
            borderRadius: 12,
            color: activeSection === 'features' ? 'var(--sp-tx1)' : 'var(--sp-txm)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            transition: 'all 0.3s ease',
            boxShadow: activeSection === 'features' ? '4px 4px 8px rgba(0,0,0,0.15), -4px -4px 8px rgba(255,255,255,0.05)' : 'none'
          }}
        >
          Features <span style={{opacity:0.6,marginLeft:6}}>({totalFeatures})</span>
        </button>
      </div>

      {/* Content area - Data Tables */}
      <div className={sp.card} style={{ marginBottom: 24 }}>
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
      </div>

      {/* VISUALIZATIONS - Always visible */}
      {(bugs.length > 0 || features.length > 0 || patterns.length > 0) && (
        <div className={sp.card} style={{ marginTop: 24, padding: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--sp-tx1)', marginBottom: 24 }}>
            📊 Pain Point Visualizations
          </h3>
          <InsightsVisualizations
            patterns={patterns}
            bugs={bugs}
            features={features}
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
