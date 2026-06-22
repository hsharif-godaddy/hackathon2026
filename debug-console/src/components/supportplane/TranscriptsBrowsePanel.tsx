'use client';

import { FileText, RefreshCw, Upload, Tag } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import sp from '@/components/supportplane/sp.module.css';
import type { PanelId } from '@/components/supportplane/types';

export default function TranscriptsBrowsePanel({ onUpload }: { onUpload: () => void }) {
    const parseTags = (value: unknown): string[] => {
        if (Array.isArray(value)) {
            return value.filter((entry): entry is string => typeof entry === 'string');
        }
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed)
                    ? parsed.filter((entry): entry is string => typeof entry === 'string')
                    : [];
            } catch {
                return [];
            }
        }
        return [];
    };

    const parseRawData = (value: unknown): Record<string, any> | null => {
        if (!value) {
            return null;
        }
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch {
                return null;
            }
        }
        if (typeof value === 'object') {
            return value as Record<string, any>;
        }
        return null;
    };

    const [transcripts, setTranscripts] = useState<any[]>([]);
    const [expandedTranscript, setExpandedTranscript] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pagination, setPagination] = useState<any>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [showRawData, setShowRawData] = useState<Record<string, boolean>>({});
    const [modalTranscript, setModalTranscript] = useState<any | null>(null);
    const [modalWidth, setModalWidth] = useState(50);
    const [filters, setFilters] = useState({ limit: 50, offset: 0, _key: 0 });
    const [searchFilters, setSearchFilters] = useState({
        interaction_id: '',
        shopper_id: '',
        customer_id: '',
        category: '',
        interaction_status: '',
        sub_intent: '',
        friction_point: '',
        text_search: '',
        tags: '',
        start_date: '',
        end_date: '',
    });
    const [datePreset, setDatePreset] = useState<string>('all');
    const [filterOptions, setFilterOptions] = useState<{
        categories: string[];
        interaction_statuses: string[];
        sub_intents: string[];
        friction_points: string[];
        tags: string[];
    }>({ categories: [], interaction_statuses: [], sub_intents: [], friction_points: [], tags: [] });
    const [tagInput, setTagInput] = useState<string>('');
    const [showTagDropdown, setShowTagDropdown] = useState<boolean>(false);
    const [taggingInProgress, setTaggingInProgress] = useState(false);
    const [bulkTaggingActive, setBulkTaggingActive] = useState(false);
    const [bulkTaggingResult, setBulkTaggingResult] = useState<string | null>(null);
    const [individualTagging, setIndividualTagging] = useState<Set<string>>(new Set());
    const [untaggedCount, setUntaggedCount] = useState<number | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchTranscripts = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            Object.entries({...filters, ...searchFilters}).forEach(([key, value]) => {
                if (key !== '_key' && value) params.append(key, String(value));
            });
            const response = await fetch(`/api/supportplane/transcripts/browse?${params}`);
            const data = await response.json();
            if (!response.ok) {
                setError(data.error || 'Failed to fetch transcripts');
            } else {
                setTranscripts(data.transcripts || []);
                setPagination(data.pagination);

                const stillActive: boolean = data.tagging_active ?? false;
                setTaggingInProgress(stillActive);
                if (stillActive && !pollRef.current) {
                    pollRef.current = setInterval(() => {
                        void fetchTranscripts(true);
                        void fetchUntaggedCount();
                    }, 10000);
                } else if (!stillActive && pollRef.current) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch transcripts');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [filters, searchFilters]);

    const fetchUntaggedCount = useCallback(async () => {
        try {
            const res = await fetch('/api/supportplane/transcripts/untagged-count');
            if (res.ok) {
                const data = await res.json();
                setUntaggedCount(data.untagged);
            }
        } catch {
            // Silently degrade
        }
    }, []);

    // On first mount: fetch immediately, then poll every 10s ONLY while tagging is active
    useEffect(() => {
        void fetchTranscripts();
        void fetchUntaggedCount();

        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, []);

    // Re-fetch when filters/pagination change (not on mount — handled above)
    const isFirstRender = useRef(true);
    useEffect(() => {
        if (isFirstRender.current) { isFirstRender.current = false; return; }
        void fetchTranscripts();
    }, [fetchTranscripts]);

    useEffect(() => {
        const fetchFilters = async () => {
            try {
                const response = await fetch('/api/supportplane/transcripts/filters');
                const data = await response.json();
                if (response.ok) {
                    setFilterOptions(data.filters);
                }
            } catch (err) {
                console.error('Failed to fetch filter options:', err);
            }
        };
        void fetchFilters();
    }, []);

    const toggleExpand = (id: string) => {
        if (expandedId === id) {
            setExpandedId(null);
            return;
        }
        setExpandedId(id);
        if (!expandedTranscript[id]) {
            fetch(`/api/supportplane/transcripts/detail?id=${encodeURIComponent(id)}`)
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (data?.transcript) {
                        setExpandedTranscript(prev => ({ ...prev, [id]: data.transcript }));
                    }
                })
                .catch(() => {});
        }
    };
    const handleNextPage = () => {
        if (pagination?.has_more) setFilters(prev => ({ ...prev, offset: prev.offset + prev.limit }));
    };
    const handlePrevPage = () => {
        if (filters.offset > 0) setFilters(prev => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }));
    };

    const handleSearch = () => {
        setFilters(prev => ({ ...prev, offset: 0, _key: prev._key + 1 }));
    };

    const handleClearSearch = () => {
        setSearchFilters({
            interaction_id: '',
            shopper_id: '',
            customer_id: '',
            category: '',
            interaction_status: '',
            sub_intent: '',
            friction_point: '',
            text_search: '',
            tags: '',
            start_date: '',
            end_date: '',
        });
        setTagInput('');
        setDatePreset('all');
        setFilters(prev => ({ ...prev, offset: 0 }));
    };

    const handleTagClick = (tag: string) => {
        const currentTags = searchFilters.tags.split(',').filter(Boolean);
        if (!currentTags.includes(tag)) {
            const newTags = [...currentTags, tag].join(',');
            setSearchFilters(prev => ({ ...prev, tags: newTags }));
            setTagInput(newTags);
        }
    };

    const handleTagInputChange = (value: string) => {
        setTagInput(value);
        setSearchFilters(prev => ({ ...prev, tags: value }));
        setShowTagDropdown(value.length > 0);
    };

    const handleTagSelect = (tag: string) => {
        const currentTags = tagInput.split(',').map(t => t.trim()).filter(Boolean);
        // Remove last partial tag and add selected tag
        currentTags.pop();
        currentTags.push(tag);
        const newValue = currentTags.join(', ');
        setTagInput(newValue);
        setSearchFilters(prev => ({ ...prev, tags: newValue }));
        setShowTagDropdown(false);
    };

    const handleDatePresetChange = (preset: string) => {
        setDatePreset(preset);
        const today = new Date();
        const formatDate = (d: Date) => d.toISOString().split('T')[0];

        switch (preset) {
            case 'today':
                setSearchFilters(prev => ({
                    ...prev,
                    start_date: formatDate(today),
                    end_date: formatDate(today),
                }));
                break;
            case 'yesterday': {
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                setSearchFilters(prev => ({
                    ...prev,
                    start_date: formatDate(yesterday),
                    end_date: formatDate(yesterday),
                }));
                break;
            }
            case 'this_week': {
                const startOfWeek = new Date(today);
                startOfWeek.setDate(today.getDate() - today.getDay());
                setSearchFilters(prev => ({
                    ...prev,
                    start_date: formatDate(startOfWeek),
                    end_date: formatDate(today),
                }));
                break;
            }
            case 'last_week': {
                const lastWeekEnd = new Date(today);
                lastWeekEnd.setDate(today.getDate() - today.getDay() - 1);
                const lastWeekStart = new Date(lastWeekEnd);
                lastWeekStart.setDate(lastWeekEnd.getDate() - 6);
                setSearchFilters(prev => ({
                    ...prev,
                    start_date: formatDate(lastWeekStart),
                    end_date: formatDate(lastWeekEnd),
                }));
                break;
            }
            case 'this_month': {
                const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
                setSearchFilters(prev => ({
                    ...prev,
                    start_date: formatDate(startOfMonth),
                    end_date: formatDate(today),
                }));
                break;
            }
            case 'last_month': {
                const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
                setSearchFilters(prev => ({
                    ...prev,
                    start_date: formatDate(lastMonthStart),
                    end_date: formatDate(lastMonthEnd),
                }));
                break;
            }
            case 'last_7_days': {
                const sevenDaysAgo = new Date(today);
                sevenDaysAgo.setDate(today.getDate() - 7);
                setSearchFilters(prev => ({
                    ...prev,
                    start_date: formatDate(sevenDaysAgo),
                    end_date: formatDate(today),
                }));
                break;
            }
            case 'last_30_days': {
                const thirtyDaysAgo = new Date(today);
                thirtyDaysAgo.setDate(today.getDate() - 30);
                setSearchFilters(prev => ({
                    ...prev,
                    start_date: formatDate(thirtyDaysAgo),
                    end_date: formatDate(today),
                }));
                break;
            }
            case 'all':
            default:
                setSearchFilters(prev => ({
                    ...prev,
                    start_date: '',
                    end_date: '',
                }));
                break;
        }
        setFilters(prev => ({ ...prev, offset: 0 }));
    };

    const handleBulkTagging = async () => {
        if (bulkTaggingActive) return;

        setBulkTaggingActive(true);
        setBulkTaggingResult(null);
        setError(null);

        try {
            const response = await fetch('/api/supportplane/transcripts/tag-bulk?batch_size=50', {
                method: 'POST',
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || data.message || 'Tagging failed');
            } else {
                if (data.status === 'processing') {
                    setBulkTaggingResult(`✓ Tagging queued for ${data.total} transcripts (processing in background)`);
                } else if (data.status === 'completed') {
                    setBulkTaggingResult(`✓ No untagged transcripts found`);
                }
                // Refresh transcripts and untagged count to show any updated tags
                await fetchTranscripts(true);
                await fetchUntaggedCount();
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Tagging failed');
        } finally {
            setBulkTaggingActive(false);
        }
    };

    const handleIndividualTag = async (interactionId: string) => {
        setIndividualTagging(prev => new Set(prev).add(interactionId));
        setError(null);

        try {
            const response = await fetch(`/api/supportplane/transcripts/tag-single`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ interaction_id: interactionId }),
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || data.message || 'Tagging failed');
            } else {
                // Refresh to show updated tags
                await fetchTranscripts(true);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Individual tagging failed');
        } finally {
            setIndividualTagging(prev => {
                const next = new Set(prev);
                next.delete(interactionId);
                return next;
            });
        }
    };

    return (
        <div className={sp.panel}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>L1 Transcripts</div>
                    <div className={sp.panelSubtitle}>
                        Ingested call records · {pagination?.total || 0} total
                        {taggingInProgress && (
                            <span style={{marginLeft:8,color:'#0891b2',fontSize:11}}>· AI tagging in progress</span>
                        )}
                    </div>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <button
                        className={`${sp.btn} ${sp.btnSecondary}`}
                        onClick={handleBulkTagging}
                        disabled={bulkTaggingActive || taggingInProgress || untaggedCount === 0}
                        title="Generate AI tags for up to 50 transcripts without tags (runs in background)"
                    >
                        <Tag size={14} />
                        {bulkTaggingActive || taggingInProgress ? 'Tagging in progress...' : 'Generate Tags (50)'}
                    </button>
                    {untaggedCount !== null && untaggedCount === 0 && (
                        <span style={{fontSize:11,color:'var(--green)',fontWeight:500}}>
                            ✓ All transcripts have tags
                        </span>
                    )}
                    <button
                        className={`${sp.btn} ${sp.btnSecondary}`}
                        onClick={() => void fetchTranscripts()}
                        disabled={loading}
                        title="Refresh transcripts"
                    >
                        <RefreshCw size={14} />
                    </button>
                    <button className={`${sp.btn} ${sp.btnPrimary}`} onClick={onUpload}><Upload size={14} />Upload</button>
                </div>
            </div>

            {/* Bulk tagging result */}
            {bulkTaggingResult && (
                <div style={{marginBottom:16,padding:12,background:'#dcfce7',border:'1px solid #86efac',borderRadius:8,color:'#166534',fontSize:13}}>
                    {bulkTaggingResult}
                </div>
            )}

            {/* Error */}
            {error && (
                <div style={{marginBottom:16,padding:12,background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,color:'#991b1b',fontSize:13}}>
                    {error}
                </div>
            )}

            {/* Search & Filters */}
            <div className={sp.card} style={{marginBottom:20,padding:'20px 24px'}}>
                <div style={{display:'flex',flexDirection:'column',gap:14}}>
                    {/* Row 1: Search + Date Range */}
                    <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                        <input
                            type="text"
                            value={searchFilters.text_search}
                            onChange={(e) => setSearchFilters(prev => ({...prev, text_search: e.target.value}))}
                            placeholder="Search all fields..."
                            className={sp.searchInput}
                            style={{flex:'1 1 300px',minWidth:250,fontSize:13,padding:'9px 14px'}}
                        />
                        <select
                            value={datePreset}
                            onChange={(e) => handleDatePresetChange(e.target.value)}
                            className={sp.select}
                            style={{fontSize:12}}
                        >
                            <option value="all">All Time</option>
                            <option value="today">Today</option>
                            <option value="yesterday">Yesterday</option>
                            <option value="last_7_days">Last 7 Days</option>
                            <option value="last_30_days">Last 30 Days</option>
                        </select>
                        <input
                            type="date"
                            value={searchFilters.start_date}
                            onChange={(e) => {setSearchFilters(prev => ({...prev, start_date: e.target.value}));setDatePreset('custom');}}
                            className={sp.searchInput}
                            style={{width:145,fontSize:12}}
                        />
                        <input
                            type="date"
                            value={searchFilters.end_date}
                            onChange={(e) => {setSearchFilters(prev => ({...prev, end_date: e.target.value}));setDatePreset('custom');}}
                            className={sp.searchInput}
                            style={{width:145,fontSize:12}}
                        />
                    </div>

                    {/* Row 2: Filters */}
                    <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                        <input
                            type="text"
                            value={searchFilters.interaction_id}
                            onChange={(e) => setSearchFilters(prev => ({...prev, interaction_id: e.target.value}))}
                            placeholder="Interaction ID"
                            className={sp.searchInput}
                            style={{width:140,fontSize:12}}
                        />
                        <input
                            type="text"
                            value={searchFilters.shopper_id}
                            onChange={(e) => setSearchFilters(prev => ({...prev, shopper_id: e.target.value}))}
                            placeholder="Shopper ID"
                            className={sp.searchInput}
                            style={{width:130,fontSize:12}}
                        />
                        <input
                            type="text"
                            value={searchFilters.customer_id}
                            onChange={(e) => setSearchFilters(prev => ({...prev, customer_id: e.target.value}))}
                            placeholder="Customer ID"
                            className={sp.searchInput}
                            style={{width:130,fontSize:12}}
                        />
                        <select
                            value={searchFilters.category}
                            onChange={(e) => setSearchFilters(prev => ({...prev, category: e.target.value}))}
                            className={sp.select}
                            style={{minWidth:130,fontSize:12}}
                        >
                            <option value="">Category</option>
                            {filterOptions.categories.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                        </select>
                        <select
                            value={searchFilters.interaction_status}
                            onChange={(e) => setSearchFilters(prev => ({...prev, interaction_status: e.target.value}))}
                            className={sp.select}
                            style={{minWidth:120,fontSize:12}}
                        >
                            <option value="">Status</option>
                            {filterOptions.interaction_statuses.map(status => (<option key={status} value={status}>{status}</option>))}
                        </select>
                        <select
                            value={searchFilters.sub_intent}
                            onChange={(e) => setSearchFilters(prev => ({...prev, sub_intent: e.target.value}))}
                            className={sp.select}
                            style={{minWidth:130,fontSize:12}}
                        >
                            <option value="">Sub-Intent</option>
                            {filterOptions.sub_intents.map(intent => (<option key={intent} value={intent}>{intent}</option>))}
                        </select>
                        <select
                            value={searchFilters.friction_point}
                            onChange={(e) => setSearchFilters(prev => ({...prev, friction_point: e.target.value}))}
                            className={sp.select}
                            style={{minWidth:120,fontSize:12}}
                        >
                            <option value="">Friction</option>
                            {filterOptions.friction_points.map(friction => (<option key={friction} value={friction}>{friction}</option>))}
                        </select>
                        <div style={{position:'relative',flex:'0 0 auto'}}>
                            <input
                                type="text"
                                value={tagInput}
                                onChange={(e) => handleTagInputChange(e.target.value)}
                                onFocus={() => setShowTagDropdown(tagInput.length > 0)}
                                onBlur={() => setTimeout(() => setShowTagDropdown(false), 200)}
                                placeholder="Tags"
                                className={sp.searchInput}
                                style={{width:120,fontSize:12}}
                            />
                            {showTagDropdown && tagInput && (
                                <div style={{position:'absolute',top:'100%',left:0,minWidth:220,maxHeight:240,overflowY:'auto',background:'var(--sp-s1)',border:'1px solid var(--sp-border)',borderRadius:8,marginTop:4,zIndex:100,boxShadow:'0 6px 20px rgba(0,0,0,0.12)'}}>
                                    {filterOptions.tags.filter(tag => {const lastTag = tagInput.split(',').pop()?.trim().toLowerCase() || '';return tag.toLowerCase().includes(lastTag);}).slice(0, 50).map(tag => (
                                        <div
                                            key={tag}
                                            onMouseDown={() => handleTagSelect(tag)}
                                            style={{padding:'8px 12px',fontSize:12,cursor:'pointer',borderBottom:'1px solid var(--sp-s3)',transition:'background 0.1s'}}
                                            onMouseEnter={(e) => e.currentTarget.style.background='var(--sp-s2)'}
                                            onMouseLeave={(e) => e.currentTarget.style.background='transparent'}
                                        >
                                            #{tag}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
                            <button onClick={handleSearch} className={sp.btnPrimary}>Search</button>
                            <button onClick={handleClearSearch} className={sp.btnSecondary}>Clear</button>
                        </div>
                    </div>
                </div>
            </div>

            {loading && <div style={{padding:'32px 0',textAlign:'center',color:'var(--sp-txm)',fontSize:13}}>Loading transcripts...</div>}
            {error && <div className={sp.demoBanner} style={{background:'#ef44441a',borderColor:'#ef444430'}}><span className={sp.demoBadge} style={{background:'#ef44441a',color:'#ef4444',borderColor:'#ef444440'}}>Error</span>{error}</div>}
            {!loading && !error && transcripts.length === 0 && (
                <div className={sp.empty} style={{padding:32}}><FileText size={36} className={sp.emptyIcon} /><div className={sp.emptyTitle}>No Transcripts</div><div className={sp.emptySub}>Upload xlsx or csv files to get started</div></div>
            )}
            {!loading && transcripts.length > 0 && (
                <>
                    <div className={sp.fileList}>
                        {transcripts.map((t) => {
                            // Parse raw_data and tags for header display
                            const rawData = parseRawData(t.raw_data);
                            const tags = parseTags(t.tags);

                            return (<div key={t.interaction_id} style={{background:'var(--sp-s1)',border:'1px solid var(--sp-border)',borderRadius:10,overflow:'hidden',transition:'all 0.2s',boxShadow:expandedId===t.interaction_id?'0 2px 12px rgba(0,0,0,0.08)':'none'}}>
                                    <div
                                    onClick={() => toggleExpand(t.interaction_id)}
                                    style={{
                                        cursor:'pointer',
                                        display:'flex',
                                        alignItems:'flex-start',
                                        gap:16,
                                        padding:'16px 18px',
                                        transition:'background 0.15s',
                                        background:expandedId===t.interaction_id?'var(--sp-s2)':'transparent'
                                    }}
                                    onMouseEnter={(e) => {if(expandedId!==t.interaction_id) e.currentTarget.style.background='var(--sp-s2)'}}
                                    onMouseLeave={(e) => {if(expandedId!==t.interaction_id) e.currentTarget.style.background='transparent'}}
                                >
                                    <div style={{paddingTop:2}}>
                                        <FileText size={18} style={{color:'var(--sp-accent)',flexShrink:0}} />
                                    </div>
                                    <div style={{flex:1,minWidth:0}}>
                                        <div style={{fontSize:13.5,fontWeight:600,marginBottom:7,color:'var(--sp-tx1)',fontFamily:'var(--mono)',letterSpacing:'-0.01em'}}>
                                            {t.interaction_id}
                                        </div>
                                        <div style={{display:'flex',flexWrap:'wrap',gap:'6px 12px',fontSize:11.5,color:'var(--sp-tx2)',marginBottom:8}}>
                                            <span style={{display:'flex',alignItems:'center',gap:5}}>
                                                <span style={{fontWeight:600,color:'var(--sp-txm)'}}>Shopper:</span>
                                                <span style={{fontFamily:'var(--mono)',fontSize:11}}>{t.shopper_id||'N/A'}</span>
                                            </span>
                                            <span style={{display:'flex',alignItems:'center',gap:5}}>
                                                <span style={{fontWeight:600,color:'var(--sp-txm)'}}>Customer:</span>
                                                <span style={{fontFamily:'var(--mono)',fontSize:11}}>{t.customer_id||'N/A'}</span>
                                            </span>
                                            {t.category && (
                                                <span style={{display:'flex',alignItems:'center',gap:5}}>
                                                    <span style={{fontWeight:600,color:'var(--sp-txm)'}}>Intent:</span>
                                                    <span>{t.category}</span>
                                                </span>
                                            )}
                                            {rawData?.sub_intent && rawData.sub_intent !== 'N/A' && (
                                                <span style={{display:'flex',alignItems:'center',gap:5}}>
                                                    <span style={{fontWeight:600,color:'var(--sp-txm)'}}>Sub:</span>
                                                    <span>{rawData.sub_intent}</span>
                                                </span>
                                            )}
                                            {rawData?.friction_point && rawData.friction_point !== 'N/A' && (
                                                <span style={{display:'flex',alignItems:'center',gap:5}}>
                                                    <span style={{fontWeight:600,color:'var(--sp-txm)'}}>Friction:</span>
                                                    <span>{rawData.friction_point}</span>
                                                </span>
                                            )}
                                        </div>
                                        {tags.length > 0 && (
                                            <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                                                {tags.slice(0, 6).map((tag, idx) => (
                                                    <span
                                                        key={idx}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleTagClick(tag);
                                                        }}
                                                        style={{
                                                            fontSize:9,
                                                            fontWeight:500,
                                                            color:'var(--sp-tx1)',
                                                            cursor:'pointer',
                                                            padding:'2px 6px',
                                                            background:'var(--sp-s2)',
                                                            borderRadius:3,
                                                            border:'1px solid var(--sp-border)',
                                                            whiteSpace:'nowrap',
                                                            transition:'all 0.15s'
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.background='var(--sp-s1)';
                                                            e.currentTarget.style.borderColor='var(--sp-txm)';
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.background='var(--sp-s2)';
                                                            e.currentTarget.style.borderColor='var(--sp-border)';
                                                        }}
                                                        title={`Click to filter by ${tag}`}
                                                    >
                                                        #{tag}
                                                    </span>
                                                ))}
                                                {tags.length > 6 && (
                                                    <span style={{fontSize:9,color:'var(--sp-txm)',fontWeight:500}}>
                                                        +{tags.length - 6} more
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,flexShrink:0}}>
                                        <span style={{fontSize:11,color:'var(--sp-txm)',whiteSpace:'nowrap'}}>
                                            {t.created_at?new Date(t.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'-'}
                                        </span>
                                        <span style={{fontSize:13,color:'var(--sp-tx2)'}}>{expandedId===t.interaction_id?'▼':'▶'}</span>
                                    </div>
                                </div>
                                {expandedId === t.interaction_id && (() => {
                                    const detail = expandedTranscript[t.interaction_id] || t;
                                    const messages = (detail.full_transcript || '').split('|||').map((msg: string) => {
                                        const match = msg.match(/^(Customer|Agent|Bot):\s*(.*)$/s);
                                        if (match) {
                                            return { role: match[1], text: match[2].trim() };
                                        }
                                        return null;
                                    }).filter(Boolean);

                                    const tags = parseTags(t.tags);
                                    const rawData = parseRawData(t.raw_data);

                                    return (
                                        <div style={{padding:'20px 24px',background:'var(--sp-bg)',borderTop:'1px solid var(--sp-border)'}}>
                                            {/* Summary */}
                                            <div style={{marginBottom:20}}>
                                                <div style={{fontSize:12,fontWeight:700,color:'var(--sp-txm)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>
                                                    Summary
                                                </div>
                                                <div style={{padding:16,background:'var(--sp-s1)',borderRadius:10,border:'1px solid var(--sp-border)',fontSize:13,lineHeight:1.6,color:'var(--sp-tx1)'}}>
                                                    {detail.conversation_summary||<span style={{color:'var(--sp-txm)',fontStyle:'italic'}}>{expandedTranscript[t.interaction_id] ? 'No summary available' : 'Loading...'}</span>}
                                                </div>
                                            </div>

                                            {/* Full Conversation */}
                                            <div style={{marginBottom:24}}>
                                                <div style={{fontSize:12,fontWeight:700,color:'var(--sp-txm)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>
                                                    Full Conversation
                                                </div>
                                                <button
                                                    onClick={() => setModalTranscript(expandedTranscript[t.interaction_id] || t)}
                                                    className={sp.btnPrimary}
                                                    style={{width:'100%',padding:'12px',fontSize:13,fontWeight:600}}
                                                >
                                                    <FileText size={16} />
                                                    View Full Conversation in Modal
                                                </button>
                                            </div>

                                            {/* Core Fields */}
                                            <div style={{marginBottom:24}}>
                                                <div style={{fontSize:12,fontWeight:700,color:'var(--sp-txm)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>
                                                    Core Fields
                                                </div>
                                                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))',gap:12,background:'var(--sp-s1)',padding:16,borderRadius:10,border:'1px solid var(--sp-border)'}}>
                                                    {[
                                                        ['Interaction ID', t.interaction_id],
                                                        ['Shopper ID', t.shopper_id],
                                                        ['Customer ID', t.customer_id],
                                                        ['App ID', t.app_id],
                                                        ['Domain', t.domain],
                                                        ['Interaction Type', t.interaction_type],
                                                        ['Status', t.interaction_status],
                                                        ['Agent', t.agent_name],
                                                        ['Category', t.category],
                                                        ['Subcategory', t.subcategory],
                                                        ['Sentiment', t.sentiment_score ? String(t.sentiment_score) : null],
                                                        ['Language', t.language],
                                                        ['Created', t.created_at ? new Date(t.created_at).toLocaleString() : null],
                                                        ['Updated', t.updated_at ? new Date(t.updated_at).toLocaleString() : null],
                                                        ['Ingested', t.ingested_at ? new Date(t.ingested_at).toLocaleString() : null],
                                                        ['Resolution Time', t.resolution_time_seconds ? `${t.resolution_time_seconds}s` : null],
                                                    ].map(([label, value]) => (
                                                        <div key={label} style={{fontSize:11.5}}>
                                                            <div style={{color:'var(--sp-txm)',fontSize:10.5,fontWeight:600,marginBottom:3}}>{label}</div>
                                                            <div style={{color:'var(--sp-tx1)',fontWeight:500,fontFamily:['ID','Shopper','Customer','App'].some(k=>label.includes(k))?'var(--mono)':'inherit'}}>
                                                                {value || 'N/A'}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Source Metadata */}
                                            <div style={{marginBottom:24}}>
                                                <div style={{fontSize:12,fontWeight:700,color:'var(--sp-txm)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>
                                                    Source Metadata
                                                </div>
                                                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))',gap:12,background:'var(--sp-s1)',padding:16,borderRadius:10,border:'1px solid var(--sp-border)'}}>
                                                    <div style={{fontSize:11.5}}>
                                                        <div style={{color:'var(--sp-txm)',fontSize:10.5,fontWeight:600,marginBottom:3}}>S3 Key</div>
                                                        <div style={{color:'var(--sp-tx1)',fontWeight:500,wordBreak:'break-all'}}>{t.source_s3_key||'N/A'}</div>
                                                    </div>
                                                    <div style={{fontSize:11.5}}>
                                                        <div style={{color:'var(--sp-txm)',fontSize:10.5,fontWeight:600,marginBottom:3}}>Row Index</div>
                                                        <div style={{color:'var(--sp-tx1)',fontWeight:500}}>{t.xlsx_row_index??'N/A'}</div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* AI Tags */}
                                            <div style={{marginBottom:24}}>
                                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                                                    <div style={{fontSize:12,fontWeight:700,color:'var(--sp-txm)',textTransform:'uppercase',letterSpacing:'0.06em'}}>
                                                        AI Tags
                                                    </div>
                                                    <button
                                                        onClick={() => handleIndividualTag(t.interaction_id)}
                                                        disabled={individualTagging.has(t.interaction_id)}
                                                        className={sp.btnSecondary}
                                                        style={{fontSize:11,padding:'6px 12px'}}
                                                        title={tags && tags.length > 0 ? 'Regenerate tags' : 'Generate tags'}
                                                    >
                                                        <Tag size={13} />
                                                        {individualTagging.has(t.interaction_id) ? 'Tagging...' : (tags && tags.length > 0 ? 'Regenerate' : 'Generate')}
                                                    </button>
                                                </div>
                                                {tags && Array.isArray(tags) && tags.length > 0 ? (
                                                    <div style={{display:'flex',flexWrap:'wrap',gap:6,background:'var(--sp-s1)',padding:12,borderRadius:8,border:'1px solid var(--sp-border)'}}>
                                                        {tags.map((tag: string, idx: number) => (
                                                            <span
                                                                key={idx}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleTagClick(tag);
                                                                }}
                                                                style={{
                                                                    fontSize:10,
                                                                    fontWeight:500,
                                                                    padding:'3px 8px',
                                                                    background:'var(--sp-s2)',
                                                                    color:'var(--sp-tx1)',
                                                                    border:'1px solid var(--sp-border)',
                                                                    borderRadius:4,
                                                                    cursor:'pointer',
                                                                    transition:'all 0.15s',
                                                                }}
                                                                onMouseEnter={(e) => {
                                                                    e.currentTarget.style.background='var(--sp-bg)';
                                                                    e.currentTarget.style.borderColor='var(--sp-txm)';
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    e.currentTarget.style.background='var(--sp-s2)';
                                                                    e.currentTarget.style.borderColor='var(--sp-border)';
                                                                }}
                                                                title={`Click to filter by ${tag}`}
                                                            >
                                                                #{tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div style={{padding:16,background:'var(--sp-s1)',borderRadius:10,border:'1px solid var(--sp-border)',fontSize:12,color:'var(--sp-txm)',textAlign:'center'}}>
                                                        No tags yet — click &quot;Generate&quot; to analyze this transcript
                                                    </div>
                                                )}

                                            {rawData && Object.keys(rawData).length > 0 && (
                                                <div style={{marginTop:16}}>
                                                    <div style={{fontSize:12,fontWeight:700,color:'var(--sp-txm)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>
                                                        Additional Source File Data
                                                    </div>
                                                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))',gap:12,background:'var(--sp-s1)',padding:16,borderRadius:10,border:'1px solid var(--sp-border)'}}>
                                                        {Object.entries(rawData).map(([key, value]: [string, any]) => (
                                                            <div key={key} style={{fontSize:11.5}}>
                                                                <div style={{color:'var(--sp-txm)',fontSize:10.5,fontWeight:600,marginBottom:3}}>{key.replace(/_/g, ' ')}</div>
                                                                <div style={{color:'var(--sp-tx1)',fontWeight:500,wordBreak:'break-word'}}>{value || 'N/A'}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        );
                    })}
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:24,padding:'16px 0',borderTop:'1px solid var(--sp-border)'}}>
                        <button
                            onClick={handlePrevPage}
                            disabled={filters.offset===0}
                            className={sp.btnSecondary}
                            style={{padding:'8px 16px',fontSize:12,fontWeight:600}}
                        >
                            ← Previous
                        </button>
                        <span style={{fontSize:12.5,color:'var(--sp-tx2)',fontWeight:500}}>
                            Showing <strong style={{color:'var(--sp-tx1)',fontWeight:700}}>{filters.offset+1}-{Math.min(filters.offset+filters.limit,pagination?.total||0)}</strong> of <strong style={{color:'var(--sp-tx1)',fontWeight:700}}>{pagination?.total||0}</strong>
                        </span>
                        <button
                            onClick={handleNextPage}
                            disabled={!pagination?.has_more}
                            className={sp.btnSecondary}
                            style={{padding:'8px 16px',fontSize:12,fontWeight:600}}
                        >
                            Next →
                        </button>
                    </div>
                </>
            )}

            {/* Transcript Modal */}
            {modalTranscript && (() => {
                const messages = (modalTranscript.full_transcript || '').split('|||').map((msg: string) => {
                    const match = msg.match(/^(Customer|Agent|Bot):\s*(.*)$/s);
                    if (match) return { role: match[1], text: match[2].trim() };
                    return null;
                }).filter(Boolean);

                const handleMouseDown = (e: React.MouseEvent) => {
                    e.preventDefault();
                    const startX = e.clientX;
                    const startWidth = modalWidth;

                    const handleMouseMove = (moveEvent: MouseEvent) => {
                        const deltaX = startX - moveEvent.clientX;
                        const newWidth = Math.min(90, Math.max(30, startWidth + (deltaX / window.innerWidth) * 100));
                        setModalWidth(newWidth);
                    };

                    const handleMouseUp = () => {
                        document.removeEventListener('mousemove', handleMouseMove);
                        document.removeEventListener('mouseup', handleMouseUp);
                    };

                    document.addEventListener('mousemove', handleMouseMove);
                    document.addEventListener('mouseup', handleMouseUp);
                };

                return (
                    <div style={{
                        position:'fixed',
                        top:0,
                        right:0,
                        bottom:0,
                        width:`${modalWidth}%`,
                        background:'var(--sp-bg)',
                        borderLeft:'1px solid var(--sp-border)',
                        zIndex:1000,
                        display:'flex',
                        flexDirection:'column',
                    }}>
                        <div
                            onMouseDown={handleMouseDown}
                            style={{
                                position:'absolute',
                                left:0,
                                top:0,
                                bottom:0,
                                width:8,
                                cursor:'ew-resize',
                                background:'transparent',
                                zIndex:1001,
                            }}
                            title="Drag to resize"
                        >
                            <div style={{
                                position:'absolute',
                                left:3,
                                top:'50%',
                                transform:'translateY(-50%)',
                                width:2,
                                height:40,
                                background:'var(--sp-border)',
                                borderRadius:1,
                            }} />
                        </div>
                        <div style={{
                            padding:16,
                            borderBottom:'1px solid var(--sp-border)',
                            display:'flex',
                            alignItems:'center',
                            justifyContent:'space-between',
                        }}>
                            <div>
                                <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>
                                    {modalTranscript.interaction_id}
                                </div>
                                <div style={{fontSize:12,color:'var(--sp-txm)'}}>
                                    Shopper: {modalTranscript.shopper_id} · Customer: {modalTranscript.customer_id}
                                </div>
                            </div>
                            <button
                                onClick={() => setModalTranscript(null)}
                                style={{
                                    padding:'8px 12px',
                                    fontSize:12,
                                    background:'transparent',
                                    border:'1px solid var(--sp-border)',
                                    borderRadius:4,
                                    cursor:'pointer',
                                    color:'var(--sp-tx)',
                                }}
                            >
                                Close
                            </button>
                        </div>

                        <div style={{flex:1,overflow:'auto',padding:24,background:'var(--sp-bg)'}}>
                            {messages.length > 0 ? (
                                <div style={{display:'flex',flexDirection:'column',gap:14,maxWidth:900,margin:'0 auto'}}>
                                    {messages.map((msg: any, idx: number) => {
                                        const isCustomer = msg.role === 'Customer';
                                        const isBot = msg.role === 'Bot';
                                        const roleColor = isCustomer ? 'var(--blue)' : isBot ? 'var(--amber)' : 'var(--green)';
                                        return (
                                            <div key={idx} style={{
                                                display:'flex',
                                                justifyContent: isCustomer ? 'flex-end' : 'flex-start',
                                            }}>
                                                <div style={{
                                                    maxWidth:'80%',
                                                    padding:'14px 16px',
                                                    borderRadius:12,
                                                    background: 'var(--sp-s1)',
                                                    border: `2px solid ${roleColor}`,
                                                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                                                }}>
                                                    <div style={{
                                                        fontSize:10,
                                                        fontWeight:700,
                                                        marginBottom:8,
                                                        color: roleColor,
                                                        letterSpacing:'0.05em',
                                                        textTransform:'uppercase',
                                                    }}>
                                                        {msg.role}
                                                    </div>
                                                    <div style={{fontSize:13.5,lineHeight:1.65,color:'var(--sp-tx1)'}}>{msg.text}</div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div style={{fontSize:13,color:'var(--sp-txm)',textAlign:'center',padding:60}}>
                                    No transcript messages available
                                </div>
                            )}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
