/**
 * GET /api/supportplane/transcripts/tag-clusters
 *
 * Analyzes tags and returns clustering data for 3D visualization.
 * Clusters tags based on co-occurrence (tags that appear together in transcripts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getAllTranscriptsCached } from '@/lib/supportplane/db/transcript-cache';
import type { TranscriptRow } from '@/lib/supportplane/db/l1-transcript-db';

interface TagClusterData {
  tag: string;
  count: number;
  cluster: number;
  x: number;
  y: number;
  z: number;
  avgSentiment: number;
  unresolvedRate: number;
}

async function handler(request: NextRequest) {
  try {
    if (request.method !== 'GET') {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const { searchParams } = new URL(request.url);
    const daysBack = parseInt(searchParams.get('days_back') || '30', 10);
    const minCount = parseInt(searchParams.get('min_count') || '5', 10);

    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    const rows: TranscriptRow[] = (await getAllTranscriptsCached())
      .filter((row) => Boolean(row.created_at) && new Date(row.created_at as string).getTime() >= cutoff);

    const tagMetrics = new Map<string, { count: number; sentimentTotal: number; unresolved: number }>();
    for (const row of rows) {
      const tags =
        Array.isArray(row.tags)
          ? row.tags
          : typeof row.tags === 'string'
            ? (() => {
                try {
                  return JSON.parse(row.tags) as string[];
                } catch {
                  return [] as string[];
                }
              })()
            : [];

      for (const tag of tags) {
        const metric = tagMetrics.get(tag) || { count: 0, sentimentTotal: 0, unresolved: 0 };
        metric.count += 1;
        metric.sentimentTotal += Number(row.sentiment_score || 0);
        if (row.interaction_status === 'unresolved') {
          metric.unresolved += 1;
        }
        tagMetrics.set(tag, metric);
      }
    }

    const tagData = [...tagMetrics.entries()]
      .map(([tag, metric]) => ({
        avg_sentiment: metric.count ? metric.sentimentTotal / metric.count : 0,
        count: metric.count,
        tag,
        unresolved_rate: metric.count ? (metric.unresolved * 100) / metric.count : 0,
      }))
      .filter((item) => item.count >= minCount)
      .sort((left, right) => right.count - left.count);

    if (tagData.length === 0) {
      return NextResponse.json({
        success: true,
        clusters: [],
        clusterLabels: [],
        message: 'No tag data available',
      });
    }

    // Build co-occurrence matrix
    const tags = tagData.map(t => t.tag);
    const cooccurrence = buildCooccurrenceMatrix(rows, tags);

    // Perform clustering using co-occurrence similarity
    const clusters = clusterTags(tags, cooccurrence, 4); // 4 clusters

    // Assign cluster labels based on tag patterns
    const clusterLabels = assignClusterLabels(clusters, tags);

    // Project to 3D space with cluster-aware positioning
    const coordinates = projectTo3D(tags, cooccurrence, clusters);

    const tagClusters: TagClusterData[] = tagData.map((t, idx) => {
      const clusterIdx = clusters[idx];
      const coords = coordinates[idx];

      return {
        tag: t.tag,
        count: t.count,
        cluster: clusterIdx,
        x: coords.x,
        y: coords.y,
        z: coords.z,
        avgSentiment: t.avg_sentiment,
        unresolvedRate: t.unresolved_rate,
      };
    });

    logger.info('supportplane.tag_clusters.done', {
      total_tags: tagData.length,
      clusters: clusterLabels.length,
    });

    return NextResponse.json({
      success: true,
      clusters: tagClusters,
      clusterLabels,
      daysBack,
    });
  } catch (error) {
    logger.error('supportplane.tag_clusters.error', {}, { error: error as Error });
    return NextResponse.json(
      {
        error: 'Failed to generate tag clusters',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * Build co-occurrence matrix (how often tags appear together)
 */
function buildCooccurrenceMatrix(
  rows: Array<{ tags?: string[] | string | null }>,
  tags: string[],
): Map<string, Map<string, number>> {
  const matrix = new Map<string, Map<string, number>>();

  // Initialize matrix
  tags.forEach(tag => {
    matrix.set(tag, new Map());
  });

  // Count co-occurrences
  rows.forEach((row) => {
    try {
      const transcriptTags =
        Array.isArray(row.tags)
          ? row.tags
          : typeof row.tags === 'string'
            ? (JSON.parse(row.tags) as string[])
            : [];

      if (transcriptTags.length < 2) {
        return;
      }

      // For each pair of tags in this transcript
      for (let i = 0; i < transcriptTags.length; i++) {
        const tag1 = transcriptTags[i];
        if (!matrix.has(tag1)) continue;

        for (let j = i + 1; j < transcriptTags.length; j++) {
          const tag2 = transcriptTags[j];
          if (!matrix.has(tag2)) continue;

          // Increment co-occurrence count for both directions
          const count1 = (matrix.get(tag1)?.get(tag2) || 0) + 1;
          const count2 = (matrix.get(tag2)?.get(tag1) || 0) + 1;

          matrix.get(tag1)!.set(tag2, count1);
          matrix.get(tag2)!.set(tag1, count2);
        }
      }
    } catch {
      // Skip invalid JSON
    }
  });

  return matrix;
}

/**
 * Cluster tags based on co-occurrence similarity (simple k-means-like approach)
 */
function clusterTags(
  tags: string[],
  cooccurrence: Map<string, Map<string, number>>,
  k: number
): number[] {
  const n = tags.length;
  const clusters = new Array(n).fill(0);

  // Use heuristic clustering based on tag name patterns
  tags.forEach((tag, idx) => {
    const lower = tag.toLowerCase();

    // Cluster 0: Publishing/Deployment issues
    if (
      lower.includes('publish') ||
      lower.includes('deploy') ||
      lower.includes('domain') ||
      lower.includes('dns') ||
      lower.includes('ssl') ||
      lower.includes('hosting')
    ) {
      clusters[idx] = 0;
    }
    // Cluster 1: UI/UX issues
    else if (
      lower.includes('ui') ||
      lower.includes('ux') ||
      lower.includes('responsive') ||
      lower.includes('mobile') ||
      lower.includes('layout') ||
      lower.includes('design') ||
      lower.includes('navigation') ||
      lower.includes('confusing')
    ) {
      clusters[idx] = 1;
    }
    // Cluster 2: AI/Generation issues
    else if (
      lower.includes('ai') ||
      lower.includes('generation') ||
      lower.includes('generate') ||
      lower.includes('content') ||
      lower.includes('template') ||
      lower.includes('image') ||
      lower.includes('text')
    ) {
      clusters[idx] = 2;
    }
    // Cluster 3: Account/Billing/Access issues
    else if (
      lower.includes('account') ||
      lower.includes('billing') ||
      lower.includes('payment') ||
      lower.includes('subscription') ||
      lower.includes('access') ||
      lower.includes('login') ||
      lower.includes('auth') ||
      lower.includes('permission')
    ) {
      clusters[idx] = 3;
    }
    // Default: assign based on co-occurrence with existing clusters
    else {
      let maxSimilarity = 0;
      let bestCluster = 0;

      for (let c = 0; c < k; c++) {
        let similarity = 0;
        tags.forEach((otherTag, otherIdx) => {
          if (clusters[otherIdx] === c) {
            similarity += cooccurrence.get(tag)?.get(otherTag) || 0;
          }
        });

        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          bestCluster = c;
        }
      }

      clusters[idx] = bestCluster;
    }
  });

  return clusters;
}

/**
 * Assign human-readable labels to clusters
 */
function assignClusterLabels(clusters: number[], tags: string[]): string[] {
  const labels = [
    'Publishing & Infrastructure',
    'UI/UX & Design',
    'AI & Content Generation',
    'Account & Access',
  ];

  // Count tags per cluster to verify distribution
  const counts = [0, 0, 0, 0];
  clusters.forEach(c => counts[c]++);

  logger.info('cluster_distribution', { counts });

  return labels;
}

/**
 * Project tags to 3D space with cluster-aware positioning
 */
function projectTo3D(
  tags: string[],
  cooccurrence: Map<string, Map<string, number>>,
  clusters: number[]
): Array<{ x: number; y: number; z: number }> {
  const n = tags.length;
  const numClusters = Math.max(...clusters) + 1;

  // Define cluster center positions - tetrahedral arrangement in 3D
  const clusterCenters: Array<{ x: number; y: number; z: number }> = [
    { x: 30, y: 0, z: 0 },      // Publishing & Infrastructure (front)
    { x: -15, y: 25, z: 0 },    // UI/UX & Design (back left)
    { x: -15, y: -25, z: 0 },   // AI & Content (back right)
    { x: 0, y: 0, z: 35 },      // Account & Access (top)
  ];

  // Initialize positions: random within cluster sphere
  const coords: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < n; i++) {
    const center = clusterCenters[clusters[i]];
    const radius = 8; // Larger initial sphere
    const theta = Math.random() * 2 * Math.PI;
    const phi = Math.random() * Math.PI;
    const r = radius * Math.cbrt(Math.random()); // Uniform distribution in sphere
    coords.push({
      x: center.x + r * Math.sin(phi) * Math.cos(theta),
      y: center.y + r * Math.sin(phi) * Math.sin(theta),
      z: center.z + r * Math.cos(phi),
    });
  }

  // Run force-directed iterations
  const iterations = 200;
  const learningRate = 0.1;

  for (let iter = 0; iter < iterations; iter++) {
    const forces: Array<{ x: number; y: number; z: number }> = coords.map(() => ({ x: 0, y: 0, z: 0 }));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sameCluster = clusters[i] === clusters[j];

        const dx = coords[j].x - coords[i].x;
        const dy = coords[j].y - coords[i].y;
        const dz = coords[j].z - coords[i].z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.1;

        let force = 0;
        if (sameCluster) {
          // Gentle repulsion within cluster (avoid overlap)
          if (dist < 3) {
            force = -0.5;
          }
        } else {
          // Strong repulsion between different clusters
          force = -50 / (dist * dist);
        }

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fz = (dz / dist) * force;

        forces[i].x += fx;
        forces[i].y += fy;
        forces[i].z += fz;
        forces[j].x -= fx;
        forces[j].y -= fy;
        forces[j].z -= fz;
      }

      // Strong spring force to cluster center
      const center = clusterCenters[clusters[i]];
      const dx = center.x - coords[i].x;
      const dy = center.y - coords[i].y;
      const dz = center.z - coords[i].z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.1;

      // Pull toward center, stronger for distant points
      const springStrength = 0.3;
      forces[i].x += (dx / dist) * springStrength * dist;
      forces[i].y += (dy / dist) * springStrength * dist;
      forces[i].z += (dz / dist) * springStrength * dist;
    }

    // Apply forces with damping (reduces over time for settling)
    const damping = 1 - (iter / iterations) * 0.5;
    for (let i = 0; i < n; i++) {
      coords[i].x += forces[i].x * learningRate * damping;
      coords[i].y += forces[i].y * learningRate * damping;
      coords[i].z += forces[i].z * learningRate * damping;
    }
  }

  return coords;
}

export const GET = withAuth(handler);
