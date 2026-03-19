import { z } from 'zod';
import { SocialPost, SocialPostSchema } from '../types/social-posts.js';

export interface MarketingData {
  socialPosts?: SocialPost[];
}

export interface AppPlanData {
  appId: string;
  appName?: string | undefined;
  colorPalette?: ColorPalette | undefined;
  marketing?: MarketingData;              // Structured marketing data
  planData?: Record<string, any> | undefined; // Flexible storage for any additional plan data
  createdAt: Date;
  updatedAt: Date;
}

export interface ColorPalette {
  name?: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  successForeground: string;
  warning: string;
  warningForeground: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  theme: 'light' | 'dark';
}

export interface AppPlanToolOptions {
  appId: string;
  operation: 'create' | 'update' | 'get' | 'delete';
  appName?: string | undefined;
  colorPalette?: Partial<ColorPalette> | undefined;
  marketing?: MarketingData | undefined;
  planData?: Record<string, any> | undefined;
}

export interface AppPlanToolResult {
  success: boolean;
  data?: AppPlanData;
  message?: string;
  error?: string;
}

const ColorPaletteSchema = z.object({
  name: z.string().optional(),
  primary: z.string().optional(),
  primaryForeground: z.string().optional(),
  secondary: z.string().optional(),
  secondaryForeground: z.string().optional(),
  accent: z.string().optional(),
  accentForeground: z.string().optional(),
  background: z.string().optional(),
  foreground: z.string().optional(),
  muted: z.string().optional(),
  mutedForeground: z.string().optional(),
  border: z.string().optional(),
  destructive: z.string().optional(),
  destructiveForeground: z.string().optional(),
  success: z.string().optional(),
  successForeground: z.string().optional(),
  warning: z.string().optional(),
  warningForeground: z.string().optional(),
  chart1: z.string().optional(),
  chart2: z.string().optional(),
  chart3: z.string().optional(),
  chart4: z.string().optional(),
  chart5: z.string().optional(),
  theme: z.enum(['light', 'dark']).optional(),
});

const MarketingDataSchema = z.object({
  socialPosts: z.array(SocialPostSchema).optional()
});

export const AppPlanToolOptionsSchema = z.object({
  appId: z.string().min(1, 'App ID is required'),
  operation: z.enum(['create', 'update', 'get', 'delete']),
  appName: z.string().optional(),
  colorPalette: ColorPaletteSchema.optional(),
  marketing: MarketingDataSchema.optional(),
  planData: z.record(z.any()).optional(),
});

export class AppPlanTool {
  private plans: Map<string, AppPlanData> = new Map();

  async execute(options: AppPlanToolOptions): Promise<AppPlanToolResult> {
    try {
      // Validate options
      const validatedOptions = AppPlanToolOptionsSchema.parse(options);

      switch (validatedOptions.operation) {
        case 'create':
          return await this.createPlan(validatedOptions as AppPlanToolOptions);
        case 'update':
          return await this.updatePlan(validatedOptions as AppPlanToolOptions);
        case 'get':
          return await this.getPlan(validatedOptions as AppPlanToolOptions);
        case 'delete':
          return await this.deletePlan(validatedOptions as AppPlanToolOptions);
        default:
          return {
            success: false,
            error: `Unknown operation: ${validatedOptions.operation}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  private async createPlan(options: AppPlanToolOptions): Promise<AppPlanToolResult> {
    const { appId, appName, colorPalette, marketing, planData } = options;

    if (this.plans.has(appId)) {
      return {
        success: false,
        error: `App plan already exists for appId: ${appId}`,
      };
    }

    const defaultColorPalette: ColorPalette = {
      primary: '#007bff',
      primaryForeground: '#ffffff',
      secondary: '#6c757d',
      secondaryForeground: '#ffffff',
      accent: '#17a2b8',
      accentForeground: '#ffffff',
      background: '#ffffff',
      foreground: '#0a0a0a',
      muted: '#f8f9fa',
      mutedForeground: '#6c757d',
      border: '#e9ecef',
      destructive: '#dc3545',
      destructiveForeground: '#ffffff',
      success: '#28a745',
      successForeground: '#ffffff',
      warning: '#ffc107',
      warningForeground: '#000000',
      chart1: '#007bff',
      chart2: '#6610f2',
      chart3: '#6f42c1',
      chart4: '#e83e8c',
      chart5: '#fd7e14',
      theme: 'light',
    };

    const newPlan: AppPlanData = {
      appId,
      ...(appName !== undefined && { appName }),
      colorPalette: colorPalette ? { ...defaultColorPalette, ...colorPalette } : defaultColorPalette,
      ...(marketing && { marketing }),
      planData: planData || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.plans.set(appId, newPlan);

    return {
      success: true,
      data: newPlan,
      message: `App plan created successfully for ${appId}`,
    };
  }

  private async updatePlan(options: AppPlanToolOptions): Promise<AppPlanToolResult> {
    const { appId, appName, colorPalette, marketing, planData } = options;

    const existingPlan = this.plans.get(appId);
    if (!existingPlan) {
      return {
        success: false,
        error: `App plan not found for appId: ${appId}`,
      };
    }

    const updatedPlan: AppPlanData = {
      ...existingPlan,
      ...(appName !== undefined && { appName }),
      ...(colorPalette && { colorPalette: { ...existingPlan.colorPalette, ...colorPalette } as ColorPalette }),
      ...(marketing && { marketing }),
      ...(planData && { planData: { ...existingPlan.planData, ...planData } }),
      updatedAt: new Date(),
    };

    this.plans.set(appId, updatedPlan);

    return {
      success: true,
      data: updatedPlan,
      message: `App plan updated successfully for ${appId}`,
    };
  }

  private async getPlan(options: AppPlanToolOptions): Promise<AppPlanToolResult> {
    const { appId } = options;

    const plan = this.plans.get(appId);
    if (!plan) {
      return {
        success: false,
        error: `App plan not found for appId: ${appId}`,
      };
    }

    return {
      success: true,
      data: plan,
      message: `App plan retrieved successfully for ${appId}`,
    };
  }

  private async deletePlan(options: AppPlanToolOptions): Promise<AppPlanToolResult> {
    const { appId } = options;

    if (!this.plans.has(appId)) {
      return {
        success: false,
        error: `App plan not found for appId: ${appId}`,
      };
    }

    this.plans.delete(appId);

    return {
      success: true,
      message: `App plan deleted successfully for ${appId}`,
    };
  }

  // Utility methods for getting all plans or filtering
  getAllPlans(): AppPlanData[] {
    return Array.from(this.plans.values());
  }

  getPlansByName(name: string): AppPlanData[] {
    return this.getAllPlans().filter(plan => 
      plan.appName?.toLowerCase().includes(name.toLowerCase())
    );
  }

  getPlansByColorTheme(theme: 'light' | 'dark'): AppPlanData[] {
    return this.getAllPlans().filter(plan =>
      plan.colorPalette?.theme === theme
    );
  }
}

// Export default instance
export const appPlanTool = new AppPlanTool();
