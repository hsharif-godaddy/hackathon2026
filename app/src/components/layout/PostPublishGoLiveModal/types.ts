/**
 * Shared types for Post-Publish Go Live Modal
 */

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface SecurityScanResult {
  vulnerabilities: Array<{
    severity: 'critical' | 'high' | 'moderate' | 'low';
    title: string;
    description?: string;
  }>;
  summary: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
  };
}

export type GoLiveStep = 'confirm' | 'security' | 'video' | 'marketing';
