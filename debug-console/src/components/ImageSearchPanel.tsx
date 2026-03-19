'use client';

import React, { useState } from 'react';

interface ImageURLs {
  thumbnail: string;
  preview: string;
  highRes: string;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface ImageAnalysis {
  // Subject & Scene
  primarySubject: string;
  subjectCategory: string;
  activity: string;
  settingType: string;
  description?: string;
  // Composition
  composition: string;
  copySpaceLocation: string;
  copySpaceAmount: string;
  visualComplexity: string;
  backgroundType: string;
  // People
  peopleCount: string;
  peopleFocus: string;
  // Style & Mood
  tone: string[];
  colorMood: string;
  textSafeColors: string;
  authenticityStyle: string;
  usageContext: string[];
  // Colors
  dominantColors: string[];
  // Content
  title?: string;
  caption?: string;
  searchTerms?: string[];
  // Dimensions
  aspectRatioCategory: string;
  dimensions?: ImageDimensions;
  // Getty metadata
  orientation?: string;
  graphicalStyle?: string;
  moods?: string[];
  numberOfPeople?: string;
  ethnicity?: string[];
  ageOfPeople?: string[];
  collectionCode?: string;
  artist?: string;
  gettyKeywords?: string[];
}

interface SearchResult {
  gettyId: string;
  urls: ImageURLs;
  relevanceScore: number;
  fromCache: boolean;
  analysis?: ImageAnalysis;
}

interface SearchMeta {
  total: number;
  cached: number;
  analyzed: number;
  filtered: number;
  complete: boolean;
  pendingAnalysis: number;
}

interface SearchResponse {
  results: SearchResult[];
  meta: SearchMeta;
}

type FilterMode = 'all' | 'cached' | 'live';

interface SearchFilters {
  // Getty-native (multi-select)
  orientations: string[];
  compositions: string[];
  moods: string[];
  graphicalStyles: string[];
  numberOfPeople: string[];
  ethnicity: string[];
  ageOfPeople: string[];
  // Getty-native (single-value)
  minimumSize: string;
  sortOrder: string;
  color: string;
  // Analysis-enriched (multi-select)
  subjectCategory: string[];
  copySpaceAmount: string[];
  copySpaceLocation: string[];
  usageContext: string[];
  backgroundType: string[];
  visualComplexity: string[];
  tone: string[];
  peopleFocus: string[];
}

const FILTER_OPTIONS: Record<string, string[]> = {
  orientations: [
    'horizontal', 'vertical', 'square', 'panoramic_horizontal', 'panoramic_vertical',
  ],
  compositions: [
    'abstract', 'candid', 'close_up', 'copy_space', 'cut_out', 'full_frame',
    'full_length', 'headshot', 'looking_at_camera', 'macro', 'medium_shot',
    'portrait', 'sparse', 'still_life', 'waist_up', 'wide_shot',
  ],
  moods: [
    'dramatic', 'bold', 'vivid', 'warm', 'cool', 'natural', 'black_and_white',
  ],
  graphicalStyles: ['photography', 'illustration', 'fine_art', 'vector'],
  numberOfPeople: ['none', 'one', 'two', 'group'],
  ethnicity: [
    'black', 'white', 'east_asian', 'hispanic_latinx', 'japanese',
    'middle_eastern', 'multiracial_person', 'south_asian', 'southeast_asian',
  ],
  ageOfPeople: [
    'newborn', 'baby', 'child', 'teenager', 'young_adult',
    'adult', 'mature_adult', 'senior_adult',
  ],
  subjectCategory: [
    'person', 'people', 'animal', 'nature', 'technology', 'food',
    'architecture', 'vehicle', 'product', 'abstract', 'workspace', 'lifestyle', 'other',
  ],
  copySpaceAmount: ['none', 'minimal', 'moderate', 'high'],
  copySpaceLocation: [
    'left', 'right', 'top', 'bottom', 'center',
    'top-left', 'top-right', 'bottom-left', 'bottom-right', 'none', 'multiple',
  ],
  usageContext: [
    'hero', 'banner', 'background', 'product', 'profile', 'thumbnail',
    'icon', 'content', 'testimonial', 'gallery', 'general',
  ],
  backgroundType: [
    'solid', 'gradient', 'blurred', 'detailed', 'transparent',
    'pattern', 'natural', 'complex',
  ],
  visualComplexity: ['minimal', 'low', 'moderate', 'high', 'very-high'],
  tone: [
    'professional', 'casual', 'serious', 'playful', 'energetic',
    'calm', 'dramatic', 'inspiring', 'luxurious', 'friendly', 'neutral',
  ],
  peopleFocus: ['none', 'background', 'secondary', 'primary'],
};

const FILTER_LABELS: Record<string, string> = {
  orientations: 'Orientation',
  compositions: 'Composition',
  moods: 'Mood',
  graphicalStyles: 'Style',
  numberOfPeople: 'People Count',
  ethnicity: 'Ethnicity',
  ageOfPeople: 'Age',
  subjectCategory: 'Subject',
  copySpaceAmount: 'Copy Space',
  copySpaceLocation: 'Copy Space Position',
  usageContext: 'Usage',
  backgroundType: 'Background',
  visualComplexity: 'Complexity',
  tone: 'Tone',
  peopleFocus: 'People Focus',
};

type MultiSelectFilterKey = keyof {
  [K in keyof SearchFilters as SearchFilters[K] extends string[] ? K : never]: true;
};

const GETTY_FILTER_KEYS: readonly MultiSelectFilterKey[] = ['orientations', 'compositions', 'moods', 'graphicalStyles', 'numberOfPeople', 'ethnicity', 'ageOfPeople'] as const;
const ANALYSIS_FILTER_KEYS: readonly MultiSelectFilterKey[] = ['subjectCategory', 'copySpaceAmount', 'copySpaceLocation', 'usageContext', 'backgroundType', 'visualComplexity', 'tone', 'peopleFocus'] as const;

function formatFilterValue(value: string): string {
  return value
    .split(/[_-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const emptyFilters: SearchFilters = {
  orientations: [],
  compositions: [],
  moods: [],
  graphicalStyles: [],
  numberOfPeople: [],
  ethnicity: [],
  ageOfPeople: [],
  minimumSize: '',
  sortOrder: '',
  color: '',
  subjectCategory: [],
  copySpaceAmount: [],
  copySpaceLocation: [],
  usageContext: [],
  backgroundType: [],
  visualComplexity: [],
  tone: [],
  peopleFocus: [],
};

export default function ImageSearchPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<SearchResult | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [stats, setStats] = useState<{ cached: number; live: number } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>(emptyFilters);

  const toggleFilter = (filterKey: MultiSelectFilterKey, value: string) => {
    setFilters((prev) => {
      const current = prev[filterKey];
      const newValues = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [filterKey]: newValues };
    });
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
  };

  const activeArrayCount = Object.entries(filters).reduce((sum, [, val]) => {
    if (Array.isArray(val)) {return sum + val.length;}
    return sum;
  }, 0);
  const hasActiveFilters = activeArrayCount > 0 || !!filters.minimumSize || !!filters.sortOrder || !!filters.color;

  const handleSearch = async () => {
    if (!query.trim()) {return;}

    setLoading(true);
    setError(null);
    setSelectedImage(null);

    try {
      // Build filters object, only include non-empty values
      const activeFilters: Record<string, string[] | string> = {};
      for (const [key, value] of Object.entries(filters)) {
        if (Array.isArray(value) && value.length > 0) {
          activeFilters[key] = value;
        } else if (typeof value === 'string' && value) {
          activeFilters[key] = value;
        }
      }

      const response = await fetch('/api/image-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          count: 20,
          ...(Object.keys(activeFilters).length > 0 && { filters: activeFilters }),
        }),
      });

      if (response.status === 401) {
        setError('Session expired. Please refresh the page.');
        return;
      }

      if (response.status === 503) {
        setError('Image search service is unavailable.');
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Search failed');
        return;
      }

      const data: SearchResponse = await response.json();
      setResults(data.results || []);
      setStats({ cached: data.meta.cached, live: data.meta.total - data.meta.cached });
    } catch {
      setError('Failed to connect to search service');
    } finally {
      setLoading(false);
    }
  };

  const filteredResults = results.filter((r) => {
    if (filterMode === 'cached') {return r.fromCache;}
    if (filterMode === 'live') {return !r.fromCache;}
    return true;
  });

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Search Controls */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search for images..."
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              fontSize: '1rem',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
            }}
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: loading || !query.trim() ? '#9ca3af' : '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>Filter:</span>
          {(['all', 'cached', 'live'] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              style={{
                padding: '0.375rem 0.75rem',
                fontSize: '0.875rem',
                backgroundColor: filterMode === mode ? '#3b82f6' : '#f3f4f6',
                color: filterMode === mode ? 'white' : '#374151',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
              {stats && mode === 'cached' && ` (${stats.cached})`}
              {stats && mode === 'live' && ` (${stats.live})`}
            </button>
          ))}
        </div>

        {/* Advanced Filters Toggle */}
        <div style={{ marginTop: '1rem' }}>
          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 0.75rem',
              fontSize: '0.875rem',
              backgroundColor: hasActiveFilters ? '#dbeafe' : '#f3f4f6',
              color: hasActiveFilters ? '#1d4ed8' : '#374151',
              border: hasActiveFilters ? '1px solid #93c5fd' : '1px solid #e5e7eb',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            <span style={{ transform: advancedOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
              ▶
            </span>
            Advanced Filters
            {hasActiveFilters && (
              <span
                style={{
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  padding: '0.125rem 0.5rem',
                  borderRadius: '9999px',
                  fontSize: '0.75rem',
                }}
              >
                {activeArrayCount + (filters.minimumSize ? 1 : 0) + (filters.sortOrder ? 1 : 0) + (filters.color ? 1 : 0)}
              </span>
            )}
          </button>

          {/* Collapsible Advanced Filters */}
          {advancedOpen && (
            <div
              style={{
                marginTop: '0.75rem',
                padding: '1rem',
                backgroundColor: '#f9fafb',
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#374151' }}>Search Filters</span>
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    style={{
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.75rem',
                      backgroundColor: 'transparent',
                      color: '#6b7280',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Single-value controls */}
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Sort Order</label>
                  <select
                    value={filters.sortOrder}
                    onChange={(e) => setFilters(prev => ({ ...prev, sortOrder: e.target.value }))}
                    style={{
                      width: '100%',
                      backgroundColor: '#374151',
                      color: 'white',
                      fontSize: '0.875rem',
                      borderRadius: '4px',
                      padding: '0.375rem 0.5rem',
                      border: '1px solid #4b5563',
                    }}
                  >
                    <option value="">Default</option>
                    <option value="best_match">Best Match</option>
                    <option value="most_popular">Most Popular</option>
                    <option value="newest">Newest</option>
                    <option value="random">Random</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Min Size</label>
                  <select
                    value={filters.minimumSize}
                    onChange={(e) => setFilters(prev => ({ ...prev, minimumSize: e.target.value }))}
                    style={{
                      width: '100%',
                      backgroundColor: '#374151',
                      color: 'white',
                      fontSize: '0.875rem',
                      borderRadius: '4px',
                      padding: '0.375rem 0.5rem',
                      border: '1px solid #4b5563',
                    }}
                  >
                    <option value="">Any</option>
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                    <option value="x_large">X-Large</option>
                    <option value="xx_large">XX-Large</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Color</label>
                  <input
                    type="text"
                    placeholder="#FF0000"
                    value={filters.color}
                    onChange={(e) => setFilters(prev => ({ ...prev, color: e.target.value }))}
                    style={{
                      width: '100%',
                      backgroundColor: '#374151',
                      color: 'white',
                      fontSize: '0.875rem',
                      borderRadius: '4px',
                      padding: '0.375rem 0.5rem',
                      border: '1px solid #4b5563',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Getty Filters */}
              <h4 style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', marginTop: 0 }}>Getty Filters</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                {GETTY_FILTER_KEYS.map((filterKey) => (
                  <div key={filterKey}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        color: '#6b7280',
                        marginBottom: '0.5rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {FILTER_LABELS[filterKey]}
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {FILTER_OPTIONS[filterKey].map((option) => {
                        const isSelected = filters[filterKey].includes(option);
                        return (
                          <button
                            key={option}
                            onClick={() => toggleFilter(filterKey, option)}
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.75rem',
                              backgroundColor: isSelected ? '#3b82f6' : 'white',
                              color: isSelected ? 'white' : '#374151',
                              border: isSelected ? '1px solid #3b82f6' : '1px solid #d1d5db',
                              borderRadius: '4px',
                              cursor: 'pointer',
                            }}
                          >
                            {formatFilterValue(option)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Analysis Filters */}
              <h4 style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', marginTop: '1rem' }}>Analysis Filters</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                {ANALYSIS_FILTER_KEYS.map((filterKey) => (
                  <div key={filterKey}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        color: '#6b7280',
                        marginBottom: '0.5rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {FILTER_LABELS[filterKey]}
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {FILTER_OPTIONS[filterKey].map((option) => {
                        const isSelected = filters[filterKey].includes(option);
                        return (
                          <button
                            key={option}
                            onClick={() => toggleFilter(filterKey, option)}
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.75rem',
                              backgroundColor: isSelected ? '#3b82f6' : 'white',
                              color: isSelected ? 'white' : '#374151',
                              border: isSelected ? '1px solid #3b82f6' : '1px solid #d1d5db',
                              borderRadius: '4px',
                              cursor: 'pointer',
                            }}
                          >
                            {formatFilterValue(option)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#fef2f2',
            color: '#991b1b',
            borderRadius: '8px',
            marginBottom: '1rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Results Grid */}
      {filteredResults.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          {filteredResults.map((result) => (
            <div
              key={result.gettyId}
              onClick={() => setSelectedImage(result)}
              style={{
                border: selectedImage?.gettyId === result.gettyId ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                borderRadius: '8px',
                overflow: 'hidden',
                cursor: 'pointer',
                backgroundColor: 'white',
              }}
            >
              <div style={{ position: 'relative', paddingTop: '75%', backgroundColor: '#f3f4f6' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.urls.preview || result.urls.thumbnail}
                  alt={result.analysis?.primarySubject || result.gettyId}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
                {result.fromCache && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '0.5rem',
                      right: '0.5rem',
                      padding: '0.25rem 0.5rem',
                      backgroundColor: '#10b981',
                      color: 'white',
                      fontSize: '0.75rem',
                      borderRadius: '4px',
                    }}
                  >
                    Cached
                  </span>
                )}
              </div>
              <div style={{ padding: '0.75rem' }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {result.analysis?.primarySubject || result.gettyId}
                </p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
                  Score: {(result.relevanceScore * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No Results */}
      {!loading && results.length === 0 && query && !error && (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>
          No images found for &quot;{query}&quot;
        </div>
      )}

      {/* Selected Image Detail */}
      {selectedImage && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setSelectedImage(null)}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              maxWidth: '1100px',
              width: '95vw',
              maxHeight: '90vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem 1.5rem', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
              <h3 style={{ margin: 0 }}>{selectedImage.analysis?.primarySubject || selectedImage.gettyId}</h3>
              <button
                onClick={() => setSelectedImage(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: '#6b7280',
                }}
              >
                &times;
              </button>
            </div>
            {/* Two-column body */}
            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
              {/* Left column: image */}
              <div style={{ flex: '0 0 45%', padding: '1.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', borderRight: '1px solid #e5e7eb' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedImage.urls.preview || selectedImage.urls.thumbnail}
                  alt={selectedImage.analysis?.primarySubject || selectedImage.gettyId}
                  style={{ width: '100%', borderRadius: '8px', objectFit: 'contain' }}
                />
                <div style={{ fontSize: '0.875rem', marginTop: '1rem' }}>
                  <p style={{ margin: '0.25rem 0' }}><strong>Getty ID:</strong> {selectedImage.gettyId}</p>
                  <p style={{ margin: '0.25rem 0' }}><strong>Relevance:</strong> {(selectedImage.relevanceScore * 100).toFixed(1)}%</p>
                  <p style={{ margin: '0.25rem 0' }}><strong>Cached:</strong> {selectedImage.fromCache ? 'Yes' : 'No'}</p>
                </div>
              </div>
              {/* Right column: details */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', fontSize: '0.875rem' }}>
              {selectedImage.analysis && (() => {
                const a = selectedImage.analysis;
                const sectionStyle = { marginTop: '1rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '8px' };
                const headingStyle = { margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#374151' };
                const fieldStyle = { margin: '0.25rem 0' };
                const tagContainerStyle = { display: 'flex', flexWrap: 'wrap' as const, gap: '0.25rem', marginTop: '0.25rem' };
                const tagStyle = { display: 'inline-block', padding: '0.125rem 0.5rem', backgroundColor: '#e5e7eb', borderRadius: '9999px', fontSize: '0.75rem' };

                return (
                  <>
                    {/* Basic Info */}
                    <div style={sectionStyle}>
                      <h4 style={headingStyle}>Basic Info</h4>
                      {a.title && <p style={fieldStyle}><strong>Title:</strong> {a.title}</p>}
                      {a.caption && <p style={fieldStyle}><strong>Caption:</strong> {a.caption}</p>}
                      {a.dimensions && (
                        <p style={fieldStyle}><strong>Dimensions:</strong> {a.dimensions.width} x {a.dimensions.height}</p>
                      )}
                      {a.aspectRatioCategory && <p style={fieldStyle}><strong>Aspect Ratio:</strong> {formatFilterValue(a.aspectRatioCategory)}</p>}
                    </div>

                    {/* Subject & Scene */}
                    <div style={sectionStyle}>
                      <h4 style={headingStyle}>Subject & Scene</h4>
                      <p style={fieldStyle}><strong>Primary Subject:</strong> {a.primarySubject}</p>
                      <p style={fieldStyle}><strong>Category:</strong> {formatFilterValue(a.subjectCategory)}</p>
                      <p style={fieldStyle}><strong>Activity:</strong> {formatFilterValue(a.activity)}</p>
                      {a.settingType && <p style={fieldStyle}><strong>Setting:</strong> {formatFilterValue(a.settingType)}</p>}
                      {a.description && <p style={fieldStyle}><strong>Description:</strong> {a.description}</p>}
                    </div>

                    {/* Composition */}
                    <div style={sectionStyle}>
                      <h4 style={headingStyle}>Composition</h4>
                      <p style={fieldStyle}><strong>Composition:</strong> {formatFilterValue(a.composition)}</p>
                      <p style={fieldStyle}><strong>Copy Space:</strong> {formatFilterValue(a.copySpaceAmount)} ({formatFilterValue(a.copySpaceLocation)})</p>
                      {a.visualComplexity && <p style={fieldStyle}><strong>Visual Complexity:</strong> {formatFilterValue(a.visualComplexity)}</p>}
                      {a.backgroundType && <p style={fieldStyle}><strong>Background:</strong> {formatFilterValue(a.backgroundType)}</p>}
                    </div>

                    {/* People */}
                    <div style={sectionStyle}>
                      <h4 style={headingStyle}>People</h4>
                      <p style={fieldStyle}><strong>Count:</strong> {a.peopleCount}</p>
                      {a.peopleFocus && <p style={fieldStyle}><strong>Focus:</strong> {formatFilterValue(a.peopleFocus)}</p>}
                    </div>

                    {/* Style & Mood */}
                    <div style={sectionStyle}>
                      <h4 style={headingStyle}>Style & Mood</h4>
                      <p style={fieldStyle}><strong>Tone:</strong> {a.tone?.join(', ')}</p>
                      {a.colorMood && <p style={fieldStyle}><strong>Color Mood:</strong> {formatFilterValue(a.colorMood)}</p>}
                      {a.textSafeColors && <p style={fieldStyle}><strong>Text Safe Colors:</strong> {formatFilterValue(a.textSafeColors)}</p>}
                      {a.authenticityStyle && <p style={fieldStyle}><strong>Authenticity:</strong> {formatFilterValue(a.authenticityStyle)}</p>}
                      {a.usageContext && a.usageContext.length > 0 && (
                        <div style={fieldStyle}>
                          <strong>Usage Context:</strong>
                          <div style={tagContainerStyle}>
                            {a.usageContext.map((ctx, i) => <span key={i} style={tagStyle}>{formatFilterValue(ctx)}</span>)}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Colors */}
                    {a.dominantColors && a.dominantColors.length > 0 && (
                      <div style={sectionStyle}>
                        <h4 style={headingStyle}>Colors</h4>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          {a.dominantColors.map((color, i) => (
                            <div key={i} style={{ textAlign: 'center' }}>
                              <span
                                style={{
                                  display: 'block',
                                  width: '32px',
                                  height: '32px',
                                  backgroundColor: color,
                                  borderRadius: '4px',
                                  border: '1px solid #e5e7eb',
                                }}
                                title={color}
                              />
                              <span style={{ fontSize: '0.625rem', color: '#6b7280' }}>{color}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Getty Metadata */}
                    {(a.orientation || a.graphicalStyle || a.moods?.length || a.numberOfPeople || a.ethnicity?.length || a.ageOfPeople?.length || a.collectionCode || a.artist) && (
                      <div style={sectionStyle}>
                        <h4 style={headingStyle}>Getty Metadata</h4>
                        {a.orientation && <p style={fieldStyle}><strong>Orientation:</strong> {formatFilterValue(a.orientation)}</p>}
                        {a.graphicalStyle && <p style={fieldStyle}><strong>Graphical Style:</strong> {formatFilterValue(a.graphicalStyle)}</p>}
                        {a.numberOfPeople && <p style={fieldStyle}><strong>Number of People:</strong> {formatFilterValue(a.numberOfPeople)}</p>}
                        {a.moods && a.moods.length > 0 && <p style={fieldStyle}><strong>Moods:</strong> {a.moods.map(m => formatFilterValue(m)).join(', ')}</p>}
                        {a.ethnicity && a.ethnicity.length > 0 && <p style={fieldStyle}><strong>Ethnicity:</strong> {a.ethnicity.map(e => formatFilterValue(e)).join(', ')}</p>}
                        {a.ageOfPeople && a.ageOfPeople.length > 0 && <p style={fieldStyle}><strong>Age:</strong> {a.ageOfPeople.map(age => formatFilterValue(age)).join(', ')}</p>}
                        {a.collectionCode && <p style={fieldStyle}><strong>Collection:</strong> {a.collectionCode}</p>}
                        {a.artist && <p style={fieldStyle}><strong>Artist:</strong> {a.artist}</p>}
                      </div>
                    )}

                    {/* Search Terms */}
                    {((a.searchTerms && a.searchTerms.length > 0) || (a.gettyKeywords && a.gettyKeywords.length > 0)) && (
                      <div style={sectionStyle}>
                        <h4 style={headingStyle}>Search Terms</h4>
                        {a.searchTerms && a.searchTerms.length > 0 && (
                          <div style={fieldStyle}>
                            <strong>AI Search Terms:</strong>
                            <div style={tagContainerStyle}>
                              {a.searchTerms.map((term, i) => <span key={i} style={tagStyle}>{term}</span>)}
                            </div>
                          </div>
                        )}
                        {a.gettyKeywords && a.gettyKeywords.length > 0 && (
                          <div style={{ ...fieldStyle, marginTop: '0.5rem' }}>
                            <strong>Getty Keywords:</strong>
                            <div style={tagContainerStyle}>
                              {a.gettyKeywords.map((kw, i) => <span key={i} style={{ ...tagStyle, backgroundColor: '#dbeafe' }}>{kw}</span>)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
