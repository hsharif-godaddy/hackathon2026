'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
    Area, AreaChart, Bar, BarChart, CartesianGrid,
    ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

import sp from '@/components/supportplane/sp.module.css';
import { useSupportPlaneData } from '@/contexts/SupportPlaneDataContext';
import TranscriptCalendar from '@/components/supportplane/transcripts/Calendar';
import DerivedInsightsPanel from './DerivedInsightsPanel';

// ── Dynamic Heatmap sub-component ─────────────────────────────────────────────

function DynamicHeatmap({ startDate, endDate }: { startDate: string; endDate: string }) {
    const [rowDim, setRowDim] = useState('friction_point');
    const [colDim, setColDim] = useState('category');
    const [heatmapData, setHeatmapData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const dimensions = [
        { value: 'category', label: 'Category' },
        { value: 'sub_intent', label: 'Sub-Intent' },
        { value: 'friction_point', label: 'Friction Point' },
        { value: 'airo_product_line', label: 'Product Line' },
        { value: 'issue_resolution', label: 'Resolution' },
        { value: 'inbound_volume_driver', label: 'Volume Driver' },
        { value: 'customer_sentiment', label: 'Sentiment' },
        { value: 'agent_department', label: 'Agent Dept' },
        { value: 'call_type', label: 'Call Type' },
    ];

    const fetchHeatmap = useCallback(async () => {
        if (rowDim === colDim) return;
        setLoading(true);
        try {
            const params = new URLSearchParams({ row_dimension: rowDim, col_dimension: colDim });
            if (startDate) params.append('start_date', startDate);
            if (endDate) params.append('end_date', endDate);
            const response = await fetch(`/api/supportplane/transcripts/heatmap?${params}`);
            const data = await response.json();
            if (response.ok) {
                setHeatmapData(data.heatmap);
            }
        } catch (err) {
            console.error('Failed to fetch heatmap:', err);
        } finally {
            setLoading(false);
        }
    }, [rowDim, colDim, startDate, endDate]);

    useEffect(() => { void fetchHeatmap(); }, [fetchHeatmap]);

    if (rowDim === colDim) {
        return (
            <div className={sp.chartCard} style={{marginTop:24}}>
                <div className={sp.chartTitle}>Custom Heatmap</div>
                <div style={{display:'flex',gap:12,marginBottom:16}}>
                    <div style={{flex:1}}>
                        <label style={{display:'block',fontSize:11,fontWeight:500,marginBottom:4,color:'var(--sp-txm)'}}>Row Dimension</label>
                        <select value={rowDim} onChange={(e) => setRowDim(e.target.value)} style={{width:'100%',padding:'6px 8px',fontSize:12,border:'1px solid var(--sp-border)',borderRadius:4,background:'var(--sp-bg)',color:'var(--sp-tx)'}}>
                            {dimensions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                    </div>
                    <div style={{flex:1}}>
                        <label style={{display:'block',fontSize:11,fontWeight:500,marginBottom:4,color:'var(--sp-txm)'}}>Column Dimension</label>
                        <select value={colDim} onChange={(e) => setColDim(e.target.value)} style={{width:'100%',padding:'6px 8px',fontSize:12,border:'1px solid var(--sp-border)',borderRadius:4,background:'var(--sp-bg)',color:'var(--sp-tx)'}}>
                            {dimensions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                    </div>
                </div>
                <div style={{padding:32,textAlign:'center',color:'var(--sp-txm)',fontSize:13}}>
                    Row and column dimensions must be different
                </div>
            </div>
        );
    }

    return (
        <div className={sp.chartCard} style={{marginTop:24}}>
            <div className={sp.chartTitle}>Custom Heatmap</div>
            <div style={{display:'flex',gap:12,marginBottom:16}}>
                <div style={{flex:1}}>
                    <label style={{display:'block',fontSize:11,fontWeight:500,marginBottom:4,color:'var(--sp-txm)'}}>Row Dimension</label>
                    <select value={rowDim} onChange={(e) => setRowDim(e.target.value)} style={{width:'100%',padding:'6px 8px',fontSize:12,border:'1px solid var(--sp-border)',borderRadius:4,background:'var(--sp-bg)',color:'var(--sp-tx)'}}>
                        {dimensions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                </div>
                <div style={{flex:1}}>
                    <label style={{display:'block',fontSize:11,fontWeight:500,marginBottom:4,color:'var(--sp-txm)'}}>Column Dimension</label>
                    <select value={colDim} onChange={(e) => setColDim(e.target.value)} style={{width:'100%',padding:'6px 8px',fontSize:12,border:'1px solid var(--sp-border)',borderRadius:4,background:'var(--sp-bg)',color:'var(--sp-tx)'}}>
                        {dimensions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                </div>
            </div>
            {loading ? (
                <div style={{padding:32,textAlign:'center',color:'var(--sp-txm)',fontSize:13}}>Loading...</div>
            ) : heatmapData.length === 0 ? (
                <div style={{padding:32,textAlign:'center',color:'var(--sp-txm)',fontSize:13}}>No data available</div>
            ) : (
                <div style={{overflowX:'auto',padding:'16px 0'}}>
                    <table style={{width:'100%',fontSize:11,borderCollapse:'collapse'}}>
                        <thead>
                            <tr>
                                <th style={{padding:8,textAlign:'left',color:'var(--sp-txm)',borderBottom:'2px solid var(--sp-border)'}}>
                                    {dimensions.find(d => d.value === rowDim)?.label}
                                </th>
                                {Array.from(new Set(heatmapData.flatMap((r: any) => Object.keys(r.by_column)))).map(col => (
                                    <th key={col} style={{padding:8,textAlign:'center',color:'var(--sp-txm)',borderBottom:'2px solid var(--sp-border)'}}>
                                        {col}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {heatmapData.slice(0, 15).map((row: any) => {
                                const allColumns = Array.from(new Set(heatmapData.flatMap((r: any) => Object.keys(r.by_column))));
                                const globalMax = Math.max(...heatmapData.flatMap((r: any) => Object.values(r.by_column as Record<string, number>)), 1);
                                return (
                                    <tr key={row.row_label}>
                                        <td style={{padding:8,color:'var(--sp-tx)',borderRight:'1px solid var(--sp-border)',fontWeight:500}}>
                                            {row.row_label}
                                        </td>
                                        {allColumns.map((col) => {
                                            const count = row.by_column[col] || 0;
                                            const intensity = count / globalMax;
                                            const bgColor = count === 0 ? 'var(--sp-s1)' : `rgba(139, 92, 246, ${0.1 + intensity * 0.7})`;
                                            return (
                                                <td
                                                    key={col}
                                                    style={{
                                                        padding:8,
                                                        textAlign:'center',
                                                        background:bgColor,
                                                        border:'1px solid var(--sp-border)',
                                                        color: intensity > 0.5 ? '#fff' : 'var(--sp-tx)',
                                                        fontWeight: count > 0 ? 600 : 400,
                                                    }}
                                                    title={`${count} transcripts`}
                                                >
                                                    {count > 0 ? count : '-'}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ── Tag Resolution Analysis sub-component ─────────────────────────────────────

function TagResolutionChart({ startDate, endDate }: { startDate: string; endDate: string }) {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const daysBack = startDate ? Math.ceil((Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) : 30;
            const response = await fetch(`/api/supportplane/transcripts/tag-resolution?days_back=${daysBack}&min_count=3`);
            const result = await response.json();
            if (response.ok) {
                setData(result.data || []);
            }
        } catch (err) {
            console.error('Failed to fetch tag resolution data:', err);
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate]);

    useEffect(() => { void fetchData(); }, [fetchData]);

    if (loading) {
        return (
            <div className={sp.chartCard} style={{marginTop:24}}>
                <div className={sp.chartTitle}>AI Tags vs Issue Resolution</div>
                <div style={{padding:32,textAlign:'center',color:'var(--sp-txm)',fontSize:13}}>Loading...</div>
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className={sp.chartCard} style={{marginTop:24}}>
                <div className={sp.chartTitle}>AI Tags vs Issue Resolution</div>
                <div style={{padding:32,textAlign:'center',color:'var(--sp-txm)',fontSize:13}}>No data available</div>
            </div>
        );
    }

    return (
        <div className={sp.chartCard} style={{marginTop:24}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div>
                    <div className={sp.chartTitle}>AI Tags vs Issue Resolution</div>
                    <div style={{fontSize:11,color:'var(--sp-txm)',marginTop:4}}>
                        Resolution rates by tag — lower rates indicate systemic issues
                    </div>
                </div>
                <div style={{fontSize:11,color:'var(--sp-txm)',display:'flex',gap:16,alignItems:'center'}}>
                    <div style={{display:'flex',alignItems:'center',gap:4}}>
                        <div style={{width:10,height:10,borderRadius:2,background:'#10b981'}} />
                        <span>Resolved</span>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:4}}>
                        <div style={{width:10,height:10,borderRadius:2,background:'#ef4444'}} />
                        <span>Unresolved</span>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:4}}>
                        <div style={{width:10,height:10,borderRadius:2,background:'#6b7280'}} />
                        <span>Unknown</span>
                    </div>
                </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'400px 250px 250px',gap:0,fontSize:11,margin:'0 auto',width:'900px'}}>
                {data.map((item: any, idx: number) => {
                    const resolvedPct: number = (item.resolved / item.total) * 100;
                    const unresolvedPct: number = (item.unresolved / item.total) * 100;
                    const unknownPct: number = (item.unknown / item.total) * 100;

                    return (
                        <React.Fragment key={`${item.tag}-${idx}`}>
                            <div style={{
                                padding:'6px 12px',
                                borderBottom:'1px solid var(--sp-border)',
                                overflow:'hidden',
                                textOverflow:'ellipsis',
                                whiteSpace:'nowrap',
                                display:'flex',
                                alignItems:'center',
                            }}>
                                <span style={{fontSize:11,fontWeight:600,color:'#0891b2'}}>#{item.tag}</span>
                            </div>
                            <div style={{
                                padding:'6px 12px',
                                borderBottom:'1px solid var(--sp-border)',
                                display:'flex',
                                alignItems:'center',
                            }}>
                                <div style={{width:'100%',height:10,borderRadius:2,overflow:'hidden',display:'flex',background:'var(--sp-s2)'}}>
                                    <div
                                        style={{width:`${resolvedPct}%`,background:'#10b981'}}
                                        title={`Resolved: ${item.resolved}`}
                                    />
                                    <div
                                        style={{width:`${unresolvedPct}%`,background:'#ef4444'}}
                                        title={`Unresolved: ${item.unresolved}`}
                                    />
                                    <div
                                        style={{width:`${unknownPct}%`,background:'#6b7280'}}
                                        title={`Unknown: ${item.unknown}`}
                                    />
                                </div>
                            </div>
                            <div style={{
                                padding:'6px 12px',
                                borderBottom:'1px solid var(--sp-border)',
                                display:'flex',
                                alignItems:'center',
                                gap:8,
                                fontSize:10,
                                justifyContent:'flex-end',
                            }}>
                                <span style={{color:'#10b981',fontWeight:600}}>{item.resolved}</span>
                                <span style={{color:'#ef4444',fontWeight:600}}>{item.unresolved}</span>
                                <span style={{color:'#6b7280'}}>{item.unknown}</span>
                                <span style={{
                                    fontWeight:700,
                                    color: item.resolution_rate >= 70 ? '#10b981' :
                                           item.resolution_rate >= 40 ? '#f59e0b' : '#ef4444'
                                }}>
                                    {item.resolution_rate}%
                                </span>
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
}

// ── 3-Way Flow sub-component ──────────────────────────────────────────────────

function ThreeWayFlow({ startDate, endDate }: { startDate: string; endDate: string }) {
    const [flowData, setFlowData] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    const fetchFlowData = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (startDate) params.append('start_date', startDate);
            if (endDate) params.append('end_date', endDate);
            const response = await fetch(`/api/supportplane/transcripts/flow?${params}`);
            const data = await response.json();
            if (response.ok) {
                setFlowData(data.flow);
            }
        } catch (err) {
            console.error('Failed to fetch flow data:', err);
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate]);

    useEffect(() => { void fetchFlowData(); }, [fetchFlowData]);

    if (loading) {
        return (
            <div className={sp.chartCard} style={{marginTop:24}}>
                <div className={sp.chartTitle}>3-Way Flow: Friction Point → Sub-Intent → Resolution</div>
                <div style={{padding:32,textAlign:'center',color:'var(--sp-txm)',fontSize:13}}>Loading...</div>
            </div>
        );
    }

    if (!flowData || flowData.length === 0) {
        return (
            <div className={sp.chartCard} style={{marginTop:24}}>
                <div className={sp.chartTitle}>3-Way Flow: Friction Point → Sub-Intent → Resolution</div>
                <div style={{padding:32,textAlign:'center',color:'var(--sp-txm)',fontSize:13}}>No data available</div>
            </div>
        );
    }

    return (
        <div className={sp.chartCard} style={{marginTop:24}}>
            <div className={sp.chartTitle}>3-Way Flow: Friction Point → Sub-Intent → Resolution</div>
            <div style={{fontSize:12,color:'var(--sp-txm)',marginBottom:16}}>
                Shows how friction points lead to specific intents and resolutions (top 10 flows by volume)
            </div>
            <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',fontSize:11,borderCollapse:'collapse'}}>
                    <thead>
                        <tr style={{borderBottom:'2px solid var(--sp-border)'}}>
                            <th style={{padding:8,textAlign:'left',color:'var(--sp-txm)'}}>Friction Point</th>
                            <th style={{padding:8,textAlign:'left',color:'var(--sp-txm)'}}>Sub-Intent</th>
                            <th style={{padding:8,textAlign:'left',color:'var(--sp-txm)'}}>Resolution</th>
                            <th style={{padding:8,textAlign:'right',color:'var(--sp-txm)'}}>Count</th>
                            <th style={{padding:8,textAlign:'left',color:'var(--sp-txm)'}}>Flow</th>
                        </tr>
                    </thead>
                    <tbody>
                        {flowData.slice(0, 10).map((item: any, idx: number) => {
                            const maxCount = flowData[0]?.count || 1;
                            const barWidth = (item.count / maxCount) * 100;
                            return (
                                <tr key={idx} style={{borderBottom:'1px solid var(--sp-border)'}}>
                                    <td style={{padding:8,color:'var(--sp-tx)',fontWeight:500}}>{item.friction_point}</td>
                                    <td style={{padding:8,color:'var(--sp-tx)'}}>{item.sub_intent}</td>
                                    <td style={{padding:8,color:'var(--sp-tx)'}}>{item.issue_resolution}</td>
                                    <td style={{padding:8,textAlign:'right',color:'var(--sp-tx)',fontWeight:600}}>{item.count}</td>
                                    <td style={{padding:8}}>
                                        <div style={{height:8,background:'var(--sp-s2)',borderRadius:4,overflow:'hidden'}}>
                                            <div style={{height:'100%',width:`${barWidth}%`,background:'linear-gradient(90deg, #ec4899, #8b5cf6)',borderRadius:4}} />
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── AnalysisPanel ─────────────────────────────────────────────────────────────

export default function AnalysisPanel() {
    // Use context for initial analytics data
    const { analytics: contextAnalytics, loading: contextLoading } = useSupportPlaneData();

    const [activeTab, setActiveTab] = useState<'analysis' | 'derived-insights'>('derived-insights');
    const [analytics, setAnalytics] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasCustomDates, setHasCustomDates] = useState(false);

    // Input dates (user selection, not yet applied)
    const [inputStartDate, setInputStartDate] = useState<string>(() => {
        const date: Date = new Date();
        date.setDate(date.getDate() - 30);
        return date.toISOString().split('T')[0];
    });
    const [inputEndDate, setInputEndDate] = useState<string>(() => {
        return new Date().toISOString().split('T')[0];
    });

    // Applied dates (used for API calls)
    const [startDate, setStartDate] = useState<string>(() => {
        const date: Date = new Date();
        date.setDate(date.getDate() - 30);
        return date.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState<string>(() => {
        return new Date().toISOString().split('T')[0];
    });

    // Refresh key to force all child visualizations to re-fetch
    const [refreshKey, setRefreshKey] = useState(0);

    // Calculate days for DerivedInsightsPanel (must be before any conditional returns)
    const days: number = React.useMemo(() => {
        const start: Date = new Date(startDate);
        const end: Date = new Date(endDate);
        const diffTime: number = Math.abs(end.getTime() - start.getTime());
        const diffDays: number = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    }, [startDate, endDate]);

    const fetchAnalytics = useCallback(async (start: string, end: string) => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (start) params.append('start_date', start);
            if (end) params.append('end_date', end);
            const url = `/api/supportplane/transcripts/analytics?${params}`;
            console.log('[AnalysisPanel] Fetching analytics:', url);
            const response = await fetch(url);
            const data = await response.json();
            console.log('[AnalysisPanel] Analytics response:', {
                ok: response.ok,
                status: response.status,
                total: data.analytics?.total,
                hasData: !!data.analytics
            });
            if (!response.ok) {
                setError(data.error || 'Failed to fetch analytics');
            } else {
                setAnalytics(data.analytics);
            }
        } catch (err) {
            console.error('[AnalysisPanel] Fetch error:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch analytics');
        } finally {
            setLoading(false);
        }
    }, []);

    // Use context analytics on initial load (default 30-day range)
    useEffect(() => {
        if (!hasCustomDates && contextAnalytics && !analytics) {
            console.log('[AnalysisPanel] Using context analytics (default 30-day range)');
            setAnalytics(contextAnalytics);
        }
    }, [contextAnalytics, analytics, hasCustomDates]);

    // Only fetch when user explicitly changes date range
    const handleApplyDateRange = () => {
        setStartDate(inputStartDate);
        setEndDate(inputEndDate);
        setHasCustomDates(true); // Mark that user has customized dates
        setRefreshKey(prev => prev + 1);
        // Fetch with custom dates
        void fetchAnalytics(inputStartDate, inputEndDate);
    };

    // renderHeatmap helper function
    const renderHeatmap = (data: any[], title: string, rowLabel: string, color: string) => {
        if (!data || data.length === 0) return null;
        const allColumns = Array.from(new Set(data.flatMap((r: any) => Object.keys(r.by_column))));
        const globalMax = Math.max(...data.flatMap((r: any) => Object.values(r.by_column as Record<string, number>)), 1);
        return (
            <div className={sp.chartCard} style={{marginTop:24}}>
                <div className={sp.chartTitle}>{title}</div>
                <div style={{overflowX:'auto',padding:'16px 0'}}>
                    <table style={{width:'100%',fontSize:11,borderCollapse:'collapse'}}>
                        <thead>
                            <tr>
                                <th style={{padding:8,textAlign:'left',color:'var(--sp-txm)',borderBottom:'2px solid var(--sp-border)'}}>{rowLabel}</th>
                                {allColumns.map(col => (
                                    <th key={col} style={{padding:8,textAlign:'center',color:'var(--sp-txm)',borderBottom:'2px solid var(--sp-border)'}}>
                                        {col}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {data.slice(0, 15).map((row: any) => (
                                <tr key={row.row_label}>
                                    <td style={{padding:8,color:'var(--sp-tx)',borderRight:'1px solid var(--sp-border)',fontWeight:500}}>
                                        {row.row_label}
                                    </td>
                                    {allColumns.map((col) => {
                                        const count = row.by_column[col] || 0;
                                        const intensity = count / globalMax;
                                        const bgColor = count === 0 ? 'var(--sp-s1)' : `rgba(${color}, ${0.1 + intensity * 0.7})`;
                                        return (
                                            <td
                                                key={col}
                                                style={{
                                                    padding:8,
                                                    textAlign:'center',
                                                    background:bgColor,
                                                    border:'1px solid var(--sp-border)',
                                                    color: intensity > 0.5 ? '#fff' : 'var(--sp-tx)',
                                                    fontWeight: count > 0 ? 600 : 400,
                                                }}
                                                title={`${count} transcripts`}
                                            >
                                                {count > 0 ? count : '-'}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div className={sp.panel}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>L1 Transcript Deep Dive</div>
                    <div className={sp.panelSubtitle}>
                        {activeTab === 'analysis'
                            ? `Raw transcript analytics: ${startDate} to ${endDate}`
                            : `AI-generated insights with independent date filtering`
                        }
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div style={{
                display:'flex',
                borderBottom:'2px solid var(--sp-border)',
                marginBottom:16,
                gap:4
            }}>
                <button
                    onClick={() => setActiveTab('derived-insights')}
                    style={{
                        padding:'8px 16px',
                        background:activeTab === 'derived-insights' ? 'var(--sp-s2)' : 'transparent',
                        border:'none',
                        borderBottom:activeTab === 'derived-insights' ? '2px solid var(--sp-primary)' : '2px solid transparent',
                        color:activeTab === 'derived-insights' ? 'var(--sp-primary)' : 'var(--sp-txm)',
                        cursor:'pointer',
                        fontSize:13,
                        fontWeight:600,
                        marginBottom:-2,
                        transition:'all 0.2s'
                    }}
                >
                    Derived Insights
                </button>
                <button
                    onClick={() => setActiveTab('analysis')}
                    style={{
                        padding:'8px 16px',
                        background:activeTab === 'analysis' ? 'var(--sp-s2)' : 'transparent',
                        border:'none',
                        borderBottom:activeTab === 'analysis' ? '2px solid var(--sp-primary)' : '2px solid transparent',
                        color:activeTab === 'analysis' ? 'var(--sp-primary)' : 'var(--sp-txm)',
                        cursor:'pointer',
                        fontSize:13,
                        fontWeight:600,
                        marginBottom:-2,
                        transition:'all 0.2s'
                    }}
                >
                    Raw Analytics
                </button>
            </div>

            {/* Date Range Selector (only for Raw Analytics) */}
            {activeTab === 'analysis' && (
                <div className={sp.card} style={{marginBottom:16,padding:14}}>
                    <div style={{fontSize:13,fontWeight:600,marginBottom:10,color:'var(--sp-tx1)'}}>
                        Date Range
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <input
                            type="date"
                            value={inputStartDate}
                            onChange={(e) => setInputStartDate(e.target.value)}
                            style={{
                                padding:'6px 10px',
                                fontSize:13,
                                border:'1px solid var(--sp-border)',
                                borderRadius:4,
                                background:'var(--sp-s2)',
                                color:'var(--sp-tx1)',
                                cursor:'pointer',
                                flex:1,
                            }}
                        />
                        <span style={{color:'var(--sp-txm)',fontSize:13}}>to</span>
                        <input
                            type="date"
                            value={inputEndDate}
                            onChange={(e) => setInputEndDate(e.target.value)}
                            style={{
                                padding:'6px 10px',
                                fontSize:13,
                                border:'1px solid var(--sp-border)',
                                borderRadius:4,
                                background:'var(--sp-s2)',
                                color:'var(--sp-tx1)',
                                cursor:'pointer',
                                flex:1,
                            }}
                        />
                        <button
                            onClick={handleApplyDateRange}
                            className={`${sp.btn} ${sp.btnPrimary}`}
                            style={{
                                padding:'6px 14px',
                                fontSize:13,
                                fontWeight:600,
                            }}
                        >
                            Apply
                        </button>
                        <span style={{fontSize:12,color:'var(--sp-txm)',whiteSpace:'nowrap'}}>
                            ({days}d)
                        </span>
                    </div>
                </div>
            )}

            {/* Render content based on active tab */}
            {activeTab === 'derived-insights' ? (
                <DerivedInsightsPanel days={days} analytics={analytics} />
            ) : (
                <>
                {/* Loading state for Raw Analytics */}
                {((contextLoading && !analytics) || (loading && hasCustomDates)) && (
                    <div style={{padding:'64px 0',textAlign:'center',color:'var(--sp-txm)',fontSize:14}}>
                        {hasCustomDates ? 'Loading custom date range...' : 'Loading analytics...'}
                    </div>
                )}

                {/* Error state for Raw Analytics */}
                {error && !loading && (
                    <div className={sp.demoBanner} style={{background:'#ef44441a',borderColor:'#ef444430',marginBottom:16}}>
                        <span className={sp.demoBadge} style={{background:'#ef44441a',color:'#ef4444',borderColor:'#ef444440'}}>Error</span>
                        {error}
                    </div>
                )}

                {/* Raw Analytics Content */}
                {!loading && analytics && analytics.total === 0 && (
                    <div className={sp.demoBanner} style={{background:'#f59e0b1a',borderColor:'#f59e0b30',marginBottom:16}}>
                        <span className={sp.demoBadge} style={{background:'#f59e0b1a',color:'#f59e0b',borderColor:'#f59e0b40'}}>No Data</span>
                        No transcripts found for the selected date range. Try expanding the date range or check if transcripts have been uploaded.
                    </div>
                )}

                {!loading && analytics && analytics.total > 0 && (
                    <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:20}}>
                <div className={sp.chartCard}>
                    <div className={sp.chartTitle}>Top Categories</div>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={analytics.by_category.slice(0,8)} margin={{top:8,right:8,left:-20,bottom:0}}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                            <XAxis dataKey="category" tick={{fontSize:11,fill:'var(--sp-txm)'}} angle={-45} textAnchor="end" height={80} />
                            <YAxis tick={{fontSize:11,fill:'var(--sp-txm)'}} />
                            <Tooltip contentStyle={{background:'var(--sp-s1)',border:'1px solid var(--sp-border)',borderRadius:4,fontSize:12}} />
                            <Bar dataKey="count" fill="#10b981" radius={[4,4,0,0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                <div className={sp.chartCard}>
                    <div className={sp.chartTitle}>Resolution Status</div>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={analytics.by_resolution} margin={{top:8,right:8,left:-20,bottom:0}}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                            <XAxis dataKey="interaction_status" tick={{fontSize:11,fill:'var(--sp-txm)'}} />
                            <YAxis tick={{fontSize:11,fill:'var(--sp-txm)'}} />
                            <Tooltip contentStyle={{background:'var(--sp-s1)',border:'1px solid var(--sp-border)',borderRadius:4,fontSize:12}} />
                            <Bar dataKey="count" fill="#f59e0b" radius={[4,4,0,0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

            </div>

            <div style={{marginTop:24,display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:20}}>
                <div className={sp.chartCard}>
                    <div className={sp.chartTitle}>Top Sub-Intents</div>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={analytics.by_sub_intent} margin={{top:8,right:8,left:-20,bottom:0}}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                            <XAxis dataKey="name" tick={{fontSize:11,fill:'var(--sp-txm)'}} angle={-45} textAnchor="end" height={80} />
                            <YAxis tick={{fontSize:11,fill:'var(--sp-txm)'}} />
                            <Tooltip contentStyle={{background:'var(--sp-s1)',border:'1px solid var(--sp-border)',borderRadius:4,fontSize:12}} />
                            <Bar dataKey="count" fill="#ec4899" radius={[4,4,0,0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                <div className={sp.chartCard}>
                    <div className={sp.chartTitle}>Top Friction Points</div>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={analytics.by_friction_point} margin={{top:8,right:8,left:-20,bottom:0}}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                            <XAxis dataKey="name" tick={{fontSize:11,fill:'var(--sp-txm)'}} angle={-45} textAnchor="end" height={80} />
                            <YAxis tick={{fontSize:11,fill:'var(--sp-txm)'}} />
                            <Tooltip contentStyle={{background:'var(--sp-s1)',border:'1px solid var(--sp-border)',borderRadius:4,fontSize:12}} />
                            <Bar dataKey="count" fill="#ef4444" radius={[4,4,0,0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                <div className={sp.chartCard}>
                    <div className={sp.chartTitle}>Product Line Distribution</div>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={analytics.by_product_line.slice(0,10)} margin={{top:8,right:8,left:-20,bottom:0}}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                            <XAxis dataKey="name" tick={{fontSize:11,fill:'var(--sp-txm)'}} angle={-45} textAnchor="end" height={80} />
                            <YAxis tick={{fontSize:11,fill:'var(--sp-txm)'}} />
                            <Tooltip contentStyle={{background:'var(--sp-s1)',border:'1px solid var(--sp-border)',borderRadius:4,fontSize:12}} />
                            <Bar dataKey="count" fill="#3b82f6" radius={[4,4,0,0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                <div className={sp.chartCard}>
                    <div className={sp.chartTitle}>Issue Resolution Methods</div>
                    {!analytics.by_issue_resolution || analytics.by_issue_resolution.length === 0 ? (
                        <div style={{padding:32,textAlign:'center',color:'var(--sp-txm)',fontSize:13}}>No data available</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={analytics.by_issue_resolution} margin={{top:8,right:8,left:-20,bottom:0}}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                                <XAxis dataKey="name" tick={{fontSize:11,fill:'var(--sp-txm)'}} angle={-45} textAnchor="end" height={80} />
                                <YAxis tick={{fontSize:11,fill:'var(--sp-txm)'}} />
                                <Tooltip contentStyle={{background:'var(--sp-s1)',border:'1px solid var(--sp-border)',borderRadius:4,fontSize:12}} />
                                <Bar dataKey="count" fill="#14b8a6" radius={[4,4,0,0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            <div className={sp.chartCard} style={{marginTop:24}}>
                <div className={sp.chartTitle}>Top Inbound Volume Drivers</div>
                <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={analytics.by_inbound_driver} margin={{top:8,right:8,left:-20,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                        <XAxis dataKey="name" tick={{fontSize:11,fill:'var(--sp-txm)'}} angle={-45} textAnchor="end" height={80} />
                        <YAxis tick={{fontSize:11,fill:'var(--sp-txm)'}} />
                        <Tooltip contentStyle={{background:'var(--sp-s1)',border:'1px solid var(--sp-border)',borderRadius:4,fontSize:12}} />
                        <Bar dataKey="count" fill="#8b5cf6" radius={[4,4,0,0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <TagResolutionChart key={`resolution-${refreshKey}`} startDate={startDate} endDate={endDate} />

            {renderHeatmap(analytics.friction_category_heatmap, 'Friction Point × Category', 'Friction Point', '239, 68, 68')}
            {renderHeatmap(analytics.friction_resolution_heatmap, 'Friction Point × Resolution', 'Friction Point', '20, 184, 166')}
            {renderHeatmap(analytics.friction_intent_heatmap, 'Friction Point × Intent', 'Friction Point', '236, 72, 153')}

            <DynamicHeatmap key={`heatmap-${refreshKey}`} startDate={startDate} endDate={endDate} />
            <ThreeWayFlow key={`flow-${refreshKey}`} startDate={startDate} endDate={endDate} />
                    </>
                )}
                </>
            )}
        </div>
    );
}
