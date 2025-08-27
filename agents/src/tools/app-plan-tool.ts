import { z } from 'zod';

export interface AppPlanData {
  appId: string;
  appName?: string;
  colorPalette?: ColorPalette;
  planData?: Record<string, any>; // Flexible storage for any additional plan data
  createdAt: Date;
  updatedAt: Date;
}

export interface ColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  scheme: 'light' | 'dark' | 'auto';
  name?: string; // User-friendly name like "Ocean Blue" or "Forest Green"
}

export interface AppPlanToolOptions {
  appId: string;
  operation: 'create' | 'update' | 'get' | 'delete';
  appName?: string;
  colorPalette?: Partial<ColorPalette>;
  planData?: Record<string, any>;
}

export interface AppPlanToolResult {
  success: boolean;
  data?: AppPlanData;
  message?: string;
  error?: string;
}

const ColorPaletteSchema = z.object({
  primary: z.string().optional(),
  secondary: z.string().optional(),
  accent: z.string().optional(),
  background: z.string().optional(),
  surface: z.string().optional(),
  text: z.string().optional(),
  textSecondary: z.string().optional(),
  error: z.string().optional(),
  warning: z.string().optional(),
  success: z.string().optional(),
  info: z.string().optional(),
  scheme: z.enum(['light', 'dark', 'auto']).optional(),
  name: z.string().optional(),
});

export const AppPlanToolOptionsSchema = z.object({
  appId: z.string().min(1, 'App ID is required'),
  operation: z.enum(['create', 'update', 'get', 'delete']),
  appName: z.string().optional(),
  colorPalette: ColorPaletteSchema.optional(),
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
          return await this.createPlan(validatedOptions);
        case 'update':
          return await this.updatePlan(validatedOptions);
        case 'get':
          return await this.getPlan(validatedOptions);
        case 'delete':
          return await this.deletePlan(validatedOptions);
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
    const { appId, appName, colorPalette, planData } = options;

    if (this.plans.has(appId)) {
      return {
        success: false,
        error: `App plan already exists for appId: ${appId}`,
      };
    }

    const defaultColorPalette: ColorPalette = {
      primary: '#007bff',
      secondary: '#6c757d',
      accent: '#17a2b8',
      background: '#ffffff',
      surface: '#f8f9fa',
      text: '#212529',
      textSecondary: '#6c757d',
      error: '#dc3545',
      warning: '#ffc107',
      success: '#28a745',
      info: '#17a2b8',
      scheme: 'light',
    };

    const newPlan: AppPlanData = {
      appId,
      appName,
      colorPalette: colorPalette ? { ...defaultColorPalette, ...colorPalette } : defaultColorPalette,
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
    const { appId, appName, colorPalette, planData } = options;

    const existingPlan = this.plans.get(appId);
    if (!existingPlan) {
      return {
        success: false,
        error: `App plan not found for appId: ${appId}`,
      };
    }

    const updatedPlan: AppPlanData = {
      ...existingPlan,
      appName: appName !== undefined ? appName : existingPlan.appName,
      colorPalette: colorPalette 
        ? { ...existingPlan.colorPalette, ...colorPalette }
        : existingPlan.colorPalette,
      planData: planData 
        ? { ...existingPlan.planData, ...planData }
        : existingPlan.planData,
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
      plan.appName && plan.appName.toLowerCase().includes(name.toLowerCase())
    );
  }

  getPlansByColorScheme(scheme: 'light' | 'dark' | 'auto'): AppPlanData[] {
    return this.getAllPlans().filter(plan => 
      plan.colorPalette?.scheme === scheme
    );
  }
}

// Export default instance
export const appPlanTool = new AppPlanTool();
