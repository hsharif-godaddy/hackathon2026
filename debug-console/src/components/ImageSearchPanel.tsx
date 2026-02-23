'use client';

import React, { useState } from 'react';

interface ImageURLs {
  thumbnail: string;
  preview: string;
  highRes: string;
}

interface ImageAnalysis {
  primarySubject: string;
  subjectCategory: string;
  activity: string;
  composition: string;
  copySpaceLocation: string;
  copySpaceAmount: string;
  tone: string[];
  peopleCount: string;
  dominantColors: string[];
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
  orientations: string[];
  subjectCategory: string[];
  peopleCount: string[];
  tone: string[];
  copySpaceAmount: string[];
  colorMood: string[];
  composition: string[];
  usageContext: string[];
  backgroundType: string[];
  visualComplexity: string[];
}

const FILTER_OPTIONS = {
  orientations: ['square', 'landscape', 'portrait', 'panoramic', 'vertical-banner'],
  subjectCategory: ['person', 'people', 'animal', 'nature', 'technology', 'food', 'architecture', 'vehicle', 'product', 'abstract', 'workspace', 'lifestyle', 'other'],
  peopleCount: ['0', '1', '2-3', '4+'],
  tone: ['professional', 'casual', 'serious', 'playful', 'energetic', 'calm', 'dramatic', 'inspiring', 'luxurious', 'friendly', 'neutral'],
  copySpaceAmount: ['none', 'minimal', 'moderate', 'high'],
  colorMood: ['warm', 'cool', 'neutral', 'vibrant', 'muted'],
  composition: ['left', 'right', 'center', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'full-frame', 'scattered'],
  usageContext: ['hero', 'banner', 'background', 'product', 'profile', 'thumbnail', 'icon', 'content', 'testimonial', 'gallery', 'general'],
  backgroundType: ['solid', 'gradient', 'blurred', 'detailed', 'transparent', 'pattern', 'natural', 'complex'],
  visualComplexity: ['minimal', 'low', 'moderate', 'high', 'very-high'],
};

const FILTER_LABELS: Record<keyof SearchFilters, string> = {
  orientations: 'Orientation',
  subjectCategory: 'Subject Category',
  peopleCount: 'People Count',
  tone: 'Tone',
  copySpaceAmount: 'Copy Space',
  colorMood: 'Color Mood',
  composition: 'Composition',
  usageContext: 'Usage Context',
  backgroundType: 'Background Type',
  visualComplexity: 'Visual Complexity',
};

const emptyFilters: SearchFilters = {
  orientations: [],
  subjectCategory: [],
  peopleCount: [],
  tone: [],
  copySpaceAmount: [],
  colorMood: [],
  composition: [],
  usageContext: [],
  backgroundType: [],
  visualComplexity: [],
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

  const toggleFilter = (filterKey: keyof SearchFilters, value: string) => {
    setFilters((prev) => {
      const current = prev[filterKey];
      const newValues = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [filterKey]: newValues };
    });
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
  };

  const hasActiveFilters = Object.values(filters).some((arr) => arr.length > 0);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setSelectedImage(null);

    try {
      // Build filters object, only include non-empty arrays
      const activeFilters: Record<string, string[]> = {};
      for (const [key, values] of Object.entries(filters)) {
        if (values.length > 0) {
          activeFilters[key] = values;
        }
      }

      const response = await fetch('/api/image-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          maxResults: 20,
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
    if (filterMode === 'cached') return r.fromCache;
    if (filterMode === 'live') return !r.fromCache;
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
                {Object.values(filters).reduce((sum, arr) => sum + arr.length, 0)}
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

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                {(Object.keys(FILTER_OPTIONS) as Array<keyof SearchFilters>).map((filterKey) => (
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
                            {option}
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
              maxWidth: '800px',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: '1.5rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedImage.urls.preview || selectedImage.urls.thumbnail}
              alt={selectedImage.analysis?.primarySubject || selectedImage.gettyId}
              style={{ width: '100%', borderRadius: '8px', marginBottom: '1rem' }}
            />
            <div style={{ fontSize: '0.875rem' }}>
              <p><strong>Getty ID:</strong> {selectedImage.gettyId}</p>
              <p><strong>Relevance:</strong> {(selectedImage.relevanceScore * 100).toFixed(1)}%</p>
              <p><strong>Cached:</strong> {selectedImage.fromCache ? 'Yes' : 'No'}</p>
              {selectedImage.analysis && (
                <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                  <h4 style={{ margin: '0 0 0.5rem' }}>Analysis</h4>
                  <p><strong>Subject:</strong> {selectedImage.analysis.primarySubject}</p>
                  <p><strong>Category:</strong> {selectedImage.analysis.subjectCategory}</p>
                  <p><strong>Activity:</strong> {selectedImage.analysis.activity}</p>
                  <p><strong>Composition:</strong> {selectedImage.analysis.composition}</p>
                  <p><strong>Tone:</strong> {selectedImage.analysis.tone.join(', ')}</p>
                  <p><strong>People:</strong> {selectedImage.analysis.peopleCount}</p>
                  {selectedImage.analysis.dominantColors.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                      <strong>Colors:</strong>
                      {selectedImage.analysis.dominantColors.map((color, i) => (
                        <span
                          key={i}
                          style={{
                            width: '20px',
                            height: '20px',
                            backgroundColor: color,
                            borderRadius: '4px',
                            border: '1px solid #e5e7eb',
                          }}
                          title={color}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
