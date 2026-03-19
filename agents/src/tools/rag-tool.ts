import { logger } from '../logging/index.js';
import { qdrantService, type VectorSearchResult } from '../services/qdrant-service.js';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

export interface RagSearchOptions {
  query: string;
  limit?: number;
  score_threshold?: number;
  collection?: string;
}

export interface RagSearchResult {
  success: boolean;
  results?: Array<{
    key: string;
    value: unknown;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
  error?: string;
}

interface UnifiedDesignData {
  name: string;
  type: 'classic-style' | 'design-trend';
  description: string;
  visualCharacteristics: string[];
  typography: {
    guidance?: string;
    styles: string[];
    fonts?: string[];
  };
  colors: {
    guidance?: string;
    schemes: string[];
  };
  useCases: string[];
  industries: string[];
  keyElements: string[];
  relatedDesigns?: string[];
  layoutPrinciples?: string[];
  visualEffects?: {
    distortionTechniques: string[];
    effectsPlacement: string[];
    technicalEffects: string[];
    colorEffects: string[];
    layeringTechniques: string[];
    typographyInteraction: string;
    primarySubjects: string[];
    effectIntensity: string;
  };
  graphicElements?: string[];
  metadata: {
    source: string;
    generatedAt?: string;
  };
}

export class RagTool {
  private readonly logger = logger.child({ module: 'RagTool' });
  private designData: UnifiedDesignData[] = [];
  private initialized = false;

  private extractSearchableText(data: UnifiedDesignData): string {
    const parts: string[] = [
      data.name,
      data.type,
      data.description,
      ...data.visualCharacteristics,
      ...(data.typography.styles || []),
      ...(data.typography.fonts || []),
      ...(data.colors.schemes || []),
      ...data.useCases,
      ...data.industries,
      ...data.keyElements,
      ...(data.relatedDesigns || []),
      ...(data.graphicElements || [])
    ];

    if (data.typography.guidance) {parts.push(data.typography.guidance);}
    if (data.colors.guidance) {parts.push(data.colors.guidance);}
    if (data.layoutPrinciples) {parts.push(...data.layoutPrinciples);}

    return parts.filter(p => p && typeof p === 'string').join(' ');
  }

  async initialize(dataPath?: string): Promise<void> {
    if (this.initialized) {return;}

    try {
      const projectRoot = resolve(process.cwd(), '..');
      const classicStylesPath = dataPath || resolve(projectRoot, 'design-data/classic-styles.json');
      const designTrendsPath = dataPath || resolve(projectRoot, 'design-data/design-trends-rag.json');

      this.logger.info('rag.init.start', {
        classicStylesPath,
        designTrendsPath
      });

      const [classicStylesRaw, designTrendsRaw] = await Promise.all([
        readFile(classicStylesPath, 'utf-8'),
        readFile(designTrendsPath, 'utf-8')
      ]);

      const classicStyles = JSON.parse(classicStylesRaw);
      const designTrends = JSON.parse(designTrendsRaw);

      this.designData = [
        ...classicStyles.map(this.unifyClassicStyle),
        ...designTrends.map(this.unifyDesignTrend)
      ];

      const storePromises = this.designData.map(async (design) => {
        const key = `design.${design.type}.${design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const searchText = this.extractSearchableText(design);

        return qdrantService.storeVector({
          key,
          value: design,
          text: searchText,
          metadata: {
            type: design.type,
            name: design.name,
            source: design.metadata.source,
            collection: 'design-rag'
          }
        });
      });

      await Promise.all(storePromises);

      this.initialized = true;

      this.logger.info('rag.init.success', {
        totalDesigns: this.designData.length,
        classicStyles: classicStyles.length,
        designTrends: designTrends.length
      });
    } catch (error) {
      this.logger.error('rag.init.failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private unifyClassicStyle(style: any): UnifiedDesignData {
    return {
      name: style.styleName,
      type: 'classic-style',
      description: style.description,
      visualCharacteristics: style.visualCharacteristics,
      typography: {
        guidance: style.typographyGuidance,
        styles: [],
        fonts: []
      },
      colors: {
        guidance: style.colorPaletteGuidance,
        schemes: []
      },
      useCases: style.exampleUseCases,
      industries: [],
      keyElements: style.modernApplications,
      relatedDesigns: style.relatedTrends,
      layoutPrinciples: style.layoutPrinciples,
      metadata: {
        source: 'classic-styles',
        generatedAt: style.generatedAt
      }
    };
  }

  private unifyDesignTrend(trendData: any): UnifiedDesignData {
    return {
      name: trendData.trend.name,
      type: 'design-trend',
      description: trendData.trend.description,
      visualCharacteristics: trendData.trend.keyCharacteristics,
      typography: {
        styles: trendData.trend.typographyStyles,
        fonts: trendData.trend.fonts
      },
      colors: {
        schemes: trendData.trend.colorSchemes
      },
      useCases: trendData.trend.useCases,
      industries: trendData.trend.industries,
      keyElements: trendData.trend.keyCharacteristics,
      visualEffects: trendData.trend.visualEffects,
      graphicElements: trendData.trend.graphicElements,
      metadata: {
        source: 'design-trends-rag'
      }
    };
  }

  async search(options: RagSearchOptions): Promise<RagSearchResult> {
    const startTime = Date.now();
    const { query, limit = 10, score_threshold = 0.7, collection } = options;

    if (!this.initialized) {
      await this.initialize();
    }

    this.logger.info('rag.search.start', {
      query,
      limit,
      scoreThreshold: score_threshold
    });

    try {
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return {
          success: false,
          error: 'Query must be a non-empty string'
        };
      }

      const vectorResult: VectorSearchResult = await qdrantService.searchVectors({
        query,
        limit,
        score_threshold,
        ...(collection && { collection })
      });

      if (!vectorResult.success) {
        return {
          success: false,
          error: vectorResult.error || 'Vector search failed'
        };
      }

      const results = vectorResult.results || [];

      const duration = Date.now() - startTime;
      this.logger.info('rag.search.success', {
        query,
        resultCount: results.length,
        executionTime: duration
      });

      return {
        success: true,
        results
      };
    } catch (error) {
      this.logger.error('rag.search.failed', {
        query,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async getAll(): Promise<UnifiedDesignData[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.designData;
  }

  async getByName(name: string): Promise<UnifiedDesignData | null> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.designData.find(d => d.name.toLowerCase() === name.toLowerCase()) || null;
  }

  async getByType(type: 'classic-style' | 'design-trend'): Promise<UnifiedDesignData[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.designData.filter(d => d.type === type);
  }
}
