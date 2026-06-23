'use client';

import { useEffect, useState } from 'react';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import sp from '@/components/supportplane/sp.module.css';

interface PatternData {
  pattern_category: string;
  business_impact_score: number;
  occurrence_count: number;
}

interface PatternSeverityChartProps {
  daysBack?: number;
}

export default function PatternSeverityChart({ daysBack = 30 }: PatternSeverityChartProps) {
  const [patterns, setPatterns] = useState<PatternData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPatterns = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response: Response = await fetch(`/api/supportplane/insights/patterns?days_back=${daysBack}`);
      const data = (await response.json()) as { patterns?: PatternData[]; error?: string };
      if (!response.ok) {
        setError(data.error ?? 'Failed to load patterns');
      } else {
        setPatterns(data.patterns ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load patterns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPatterns();
  }, [daysBack]);

  if (loading) {
    return (
      <div className={sp.card} style={{ padding: 32, textAlign: 'center' }}>
        <div
          style={{
            width: 24,
            height: 24,
            border: '3px solid #0891b2',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        <div style={{ fontSize: 13, color: 'var(--sp-txm)' }}>Loading pattern severity...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={sp.card} style={{ padding: 16 }}>
        <div className={sp.alertError}>{error}</div>
      </div>
    );
  }

  if (patterns.length === 0) {
    return (
      <div className={sp.card} style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--sp-txm)' }}>
          No pattern data available. Generate insights to see patterns.
        </div>
      </div>
    );
  }

  // Calculate radar chart data
  const categoryMap = new Map<string, { count: number; avgImpact: number; avgOccurrence: number }>();
  patterns.forEach((p: PatternData) => {
    const cat: string = p.pattern_category || 'Other';
    const existing = categoryMap.get(cat) || { count: 0, avgImpact: 0, avgOccurrence: 0 };
    categoryMap.set(cat, {
      count: existing.count + 1,
      avgImpact: existing.avgImpact + p.business_impact_score,
      avgOccurrence: existing.avgOccurrence + p.occurrence_count,
    });
  });

  const radarData: Array<{ category: string; severity: number; fullMark: number }> = Array.from(
    categoryMap.entries()
  )
    .map(([cat, data]) => ({
      category: cat.length > 15 ? cat.substring(0, 15) + '...' : cat,
      severity: ((data.avgImpact / data.count) * (data.avgOccurrence / data.count)) / 10,
      fullMark: 100,
    }))
    .slice(0, 8);

  return (
    <div className={sp.card}>
      <div
        style={{
          padding: 16,
          borderBottom: '1px solid var(--sp-border)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Pattern Severity by Category</div>
        <div style={{ fontSize: 12, color: 'var(--sp-txm)' }}>
          Shows which friction categories have the most severe patterns
        </div>
      </div>
      <div style={{ padding: 16 }}>
        <ResponsiveContainer width="100%" height={400}>
          <RadarChart data={radarData}>
            <PolarGrid stroke="var(--sp-border)" />
            <PolarAngleAxis dataKey="category" tick={{ fill: 'var(--sp-txm)', fontSize: 11 }} />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 'auto']}
              tick={{ fill: 'var(--sp-txm)', fontSize: 10 }}
            />
            <Radar
              name="Severity"
              dataKey="severity"
              stroke="#ef4444"
              fill="#ef4444"
              fillOpacity={0.6}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: 'var(--sp-txm)' }} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
