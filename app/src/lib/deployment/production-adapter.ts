/**
 * Production deployment adapter using Nomad + SQS + Ceph
 * Handles enterprise-grade deployment to production infrastructure
 */

import { sqsNomadService } from '@/lib/aws/sqs-nomad';
import { PrismaSiteService } from '@/lib/database/prisma-site-service';
import { generateJobName,generateNomadJobSpec } from '@/lib/nomad/job-template';
import { BaseDeploymentAdapter } from './base-adapter';
import { DeploymentConfig, DeploymentResult } from './types';

export class ProductionDeploymentAdapter extends BaseDeploymentAdapter {
  private siteService: PrismaSiteService;

  constructor() {
    super({
      mode: 'production',
      domain: process.env.PRODUCTION_DOMAIN || 'c4.dev-airoapp.ai'
    });

    this.siteService = new PrismaSiteService();
    this.log('info', 'Production deployment adapter initialized');
  }

  async deploy(config: DeploymentConfig): Promise<DeploymentResult> {
    const { siteId, accountId } = config;

    try {
      this.log('info', 'Starting production deployment', { siteId, accountId });

      // Get Ceph storage assignment (this should already be done during site creation)
      const metadata = await this.getMetadata(siteId);

      if (!metadata.cephMountId || !metadata.cephDirNumber) {
        throw new Error('Ceph storage not assigned for production deployment');
      }

      // Generate Nomad job configuration
      const jobName = generateJobName(siteId);
      const imageRegistry = process.env.NOMAD_IMAGE_REGISTRY || '418549769352.dkr.ecr.eu-central-1.amazonaws.com';
      const environmentName = process.env.NOMAD_SPEC_IMAGE_VERSION || 'development';
      const agentImage = `${imageRegistry}/airo-builder/agents:${environmentName}`;
      const appImage = `${imageRegistry}/airo-builder/apps:${environmentName}`;
      const jobSpecWrapper = generateNomadJobSpec({
        accountId,
        siteId,
        jobName,
        cephMountId: metadata.cephMountId,
        cephDirNumber: metadata.cephDirNumber,
        agentImage,
        appImage
      });

      this.log('info', 'Generated Nomad job spec', { jobName });

      // Submit job to SQS for queue worker processing
      const sqsResult = await sqsNomadService.submitJobCreation({
        siteId,
        jobId: jobName,
        jobSpec: jobSpecWrapper.Job,
        accountId
      });

      if (!sqsResult.success) {
        throw new Error(`SQS submission failed: ${sqsResult.error}`);
      }

      // Generate production URLs
      const urls = this.generateUrls(siteId);

      this.log('info', 'Production deployment queued successfully', {
        siteId,
        jobName,
        messageId: sqsResult.messageId,
        urls
      });

      return {
        success: true,
        siteId,
        urls,
        infrastructure: {
          jobId: jobName,
          cephMountId: metadata.cephMountId,
          cephDirNumber: metadata.cephDirNumber,
          messageId: sqsResult.messageId
        },
        status: 'created'
      };

    } catch (error) {
      this.log('error', 'Production deployment failed', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        siteId,
        error: error instanceof Error ? error.message : 'Unknown deployment error',
        status: 'failed'
      };
    }
  }

  async getStatus(siteId: string): Promise<{ status: 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error'; message?: string; }> {
    // In production, we rely on external queue workers to update site status
    // This would typically check Nomad job status or database records
    const site = await this.siteService.getSiteById(siteId);

    if (!site) {
      return { status: 'failed', message: 'Site not found' };
    }

    return {
      status: site.status,
      message: `Production deployment status: ${site.status}`
    };
  }

  async destroy(siteId: string): Promise<{ success: boolean; error?: string; }> {
    try {
      this.log('info', 'Destroying production deployment', { siteId });

      // Get site to find job information
      const site = await this.siteService.getSiteById(siteId);
      if (!site) {
        return { success: false, error: 'Site not found' };
      }

      // Stop Nomad job using site ID to generate job name
      const jobName = generateJobName(siteId);
      const stopResult = await sqsNomadService.submitJobDeletion({
        siteId,
        jobId: jobName,
        accountId: site.account_id
      });

      if (!stopResult.success) {
        this.log('warn', 'Failed to queue job deletion, but continuing', {
          siteId,
          error: stopResult.error
        });
      } else {
        this.log('info', 'Job deletion queued via SQS', {
          siteId,
          messageId: stopResult.messageId
        });
      }

      return { success: true };

    } catch (error) {
      this.log('error', 'Production deployment destruction failed', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown destruction error'
      };
    }
  }

  async getMetadata(siteId: string): Promise<{ cephMountId?: string; cephDirNumber?: string; [key: string]: any; }> {
    // In production, Ceph storage should already be assigned during site creation
    const site = await this.siteService.getSiteById(siteId);

    if (!site) {
      throw new Error('Site not found for metadata retrieval');
    }

    return {
      cephMountId: site.ceph_mount_id || undefined,
      cephDirNumber: site.ceph_dir_number || undefined,
      domain: this.environment.domain
    };
  }
}
