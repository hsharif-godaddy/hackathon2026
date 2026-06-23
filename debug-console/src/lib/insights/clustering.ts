/**
 * ML clustering utilities for derived insights
 * - TF-IDF vectorization
 * - Cosine similarity
 * - k-means clustering
 */

export interface ClusterOptions {
  minClusterSize?: number;
  similarityThreshold?: number;
  maxClusters?: number;
}

export interface Cluster<T> {
  id: string;
  items: T[];
  centroid: number[];
  keywords: string[];
}

/**
 * Simple TF-IDF implementation
 */
function computeTfIdf(documents: string[]): Map<string, number[]> {
  const vocabulary = new Set<string>();
  const tokenizedDocs: string[][] = [];

  // Stop words to filter out
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has',
    'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may',
    'might', 'can', 'this', 'that', 'these', 'those', 'it', 'its', 'they',
    'them', 'their', 'my', 'your', 'our', 'his', 'her', 'not', 'no', 'yes',
  ]);

  // Tokenize and build vocabulary
  for (const doc of documents) {
    const tokens = doc
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 2 && !stopWords.has(t));
    tokenizedDocs.push(tokens);
    tokens.forEach(t => vocabulary.add(t));
  }

  const vocabArray = Array.from(vocabulary);
  const vocabIndex = new Map(vocabArray.map((w, i) => [w, i]));

  // Document frequency
  const df = new Map<string, number>();
  for (const tokens of tokenizedDocs) {
    const uniqueTokens = new Set(tokens);
    uniqueTokens.forEach(token => {
      df.set(token, (df.get(token) || 0) + 1);
    });
  }

  // Compute TF-IDF vectors
  const vectors = new Map<string, number[]>();
  const N = documents.length;

  documents.forEach((doc, docIdx) => {
    const vector = new Array(vocabArray.length).fill(0);
    const tokens = tokenizedDocs[docIdx];
    const termFreq = new Map<string, number>();

    // Term frequency
    tokens.forEach(token => {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    });

    // TF-IDF
    termFreq.forEach((tf, term) => {
      const idx = vocabIndex.get(term)!;
      const idf = Math.log(N / (df.get(term) || 1));
      vector[idx] = tf * idf;
    });

    // Normalize
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }

    vectors.set(doc, vector);
  });

  return vectors;
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Simple k-means clustering
 */
function kMeans<T>(
  items: T[],
  vectors: Map<T, number[]>,
  k: number,
  maxIterations = 10
): Cluster<T>[] {
  if (items.length === 0 || k === 0) return [];

  const vectorArray = items.map(item => vectors.get(item)!);
  const dimensions = vectorArray[0].length;

  // Initialize centroids randomly
  let centroids = items
    .slice(0, k)
    .map(item => [...vectors.get(item)!]);

  let assignments = new Array(items.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign points to nearest centroid
    const newAssignments = vectorArray.map(vec => {
      let bestCluster = 0;
      let bestSim = -1;

      centroids.forEach((centroid, clusterIdx) => {
        const sim = cosineSimilarity(vec, centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = clusterIdx;
        }
      });

      return bestCluster;
    });

    // Check convergence
    if (assignments.every((a, i) => a === newAssignments[i])) {
      break;
    }
    assignments = newAssignments;

    // Update centroids
    centroids = centroids.map((_, clusterIdx) => {
      const clusterVectors = vectorArray.filter((_, i) => assignments[i] === clusterIdx);
      if (clusterVectors.length === 0) return centroids[clusterIdx];

      const centroid = new Array(dimensions).fill(0);
      clusterVectors.forEach(vec => {
        vec.forEach((val, i) => {
          centroid[i] += val;
        });
      });

      // Average and normalize
      const count = clusterVectors.length;
      for (let i = 0; i < dimensions; i++) {
        centroid[i] /= count;
      }

      const magnitude = Math.sqrt(centroid.reduce((sum, val) => sum + val * val, 0));
      if (magnitude > 0) {
        for (let i = 0; i < dimensions; i++) {
          centroid[i] /= magnitude;
        }
      }

      return centroid;
    });
  }

  // Build clusters
  const clusters: Cluster<T>[] = [];
  for (let clusterIdx = 0; clusterIdx < k; clusterIdx++) {
    const clusterItems = items.filter((_, i) => assignments[i] === clusterIdx);
    if (clusterItems.length > 0) {
      clusters.push({
        id: `cluster_${clusterIdx}`,
        items: clusterItems,
        centroid: centroids[clusterIdx],
        keywords: [], // Extracted later
      });
    }
  }

  return clusters;
}

/**
 * Cluster items by text similarity
 */
export function clusterBySimilarity<T>(
  items: T[],
  textExtractor: (item: T) => string,
  options: ClusterOptions = {}
): Cluster<T>[] {
  const {
    minClusterSize = 3,
    similarityThreshold = 0.7,
    maxClusters = 10,
  } = options;

  if (items.length < minClusterSize) {
    return [];
  }

  // Extract text and compute TF-IDF vectors
  const texts = items.map(textExtractor);
  const textToItemMap = new Map<string, T>();
  texts.forEach((text, i) => textToItemMap.set(text, items[i]));

  const vectors = computeTfIdf(texts);
  const textVectors = new Map<T, number[]>();
  items.forEach((item, i) => {
    textVectors.set(item, vectors.get(texts[i])!);
  });

  // Determine number of clusters (use elbow method approximation)
  const k = Math.min(maxClusters, Math.max(2, Math.floor(items.length / 5)));

  // Run k-means
  const clusters = kMeans(items, textVectors, k);

  // Filter by minimum cluster size
  const filteredClusters = clusters.filter(c => c.items.length >= minClusterSize);

  // Extract keywords for each cluster (top terms by TF-IDF sum)
  filteredClusters.forEach(cluster => {
    const clusterTexts = cluster.items.map(item => {
      const text = textExtractor(item);
      return text;
    });

    const clusterVectors = computeTfIdf(clusterTexts);
    const termSums = new Map<string, number>();

    clusterTexts.forEach(text => {
      const vector = clusterVectors.get(text)!;
      const tokens = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(t => t.length > 2);

      tokens.forEach((token, idx) => {
        if (vector[idx]) {
          termSums.set(token, (termSums.get(token) || 0) + vector[idx]);
        }
      });
    });

    const sortedTerms = Array.from(termSums.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([term]) => term);

    cluster.keywords = sortedTerms;
  });

  return filteredClusters;
}

/**
 * Generate a deterministic cluster ID from keywords.
 *
 * The id is the partition key persisted as insight_key, so it MUST be stable
 * across generation runs for the same cluster — otherwise each run upserts a
 * new row and the same bug/feature reappears as a duplicate card. Derive it
 * only from the top keywords (sorted so equal-weight tie ordering can't change
 * the key); do not mix in run time.
 */
export function generateClusterId(keywords: string[], prefix: string): string {
  const slug = keywords
    .slice(0, 3)
    .sort()
    .join('_')
    .replace(/[^a-z0-9_]/g, '');
  return `${prefix}_${slug}`;
}
