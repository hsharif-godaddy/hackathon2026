/**
 * SQS-based Nomad Job Submission Service
 * Replaces direct Nomad API calls with SQS queue messages
 */

import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';

import { logger } from '../request-context';

export class SQSNomadService {
  private region: string;
  private queueUrl: string;
  private targetRoleArn: string;

  constructor() {
    this.region = process.env.AWS_REGION_NOMAD || 'eu-central-1';
    const accountId = process.env.AWS_ACCOUNT_ID_NOMAD || '418549769352';
    
    // Cross-account role that has SQS permissions in the target account
    this.targetRoleArn = `arn:aws:iam::${accountId}:role/pioneerc1-custom-cross-account-airo-builder-sqs`;
    
    // Use the correct queue name that the queue worker is monitoring
    this.queueUrl = `https://${this.region}.queue.amazonaws.com/${accountId}/c4-dev-sxb1-eu-central-1_nomadJobsQueue`;
    
    // SQS configuration logged at startup - no need to log here
  }

  /**
   * Assume cross-account role to get SQS permissions
   * This role exists in account 418549769352 and has SQS send permissions
   */
  private async assumeCrossAccountRole(): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
  }> {
    const stsClient = new STSClient({ region: this.region });
    
    logger.info('🔐 Assuming cross-account SQS role...');
    logger.info(`   From: ECS task in account 694282668781`);
    logger.info(`   To: ${this.targetRoleArn}`);
    
    try {
      const command = new AssumeRoleCommand({
        RoleArn: this.targetRoleArn,
        RoleSessionName: 'airo-app-builder-sqs-session',
        DurationSeconds: 3600, // 1 hour
      });

      const response = await stsClient.send(command);

      if (!response.Credentials) {
        throw new Error('No credentials returned from STS AssumeRole');
      }

      logger.info('✅ Cross-account role assumed successfully');
      logger.info(`   Session expires: ${response.Credentials.Expiration}`);

      return {
        accessKeyId: response.Credentials.AccessKeyId!,
        secretAccessKey: response.Credentials.SecretAccessKey!,
        sessionToken: response.Credentials.SessionToken!,
      };
    } catch (error) {
      logger.error('❌ Failed to assume cross-account role:', error);
      throw new Error(`Cross-account role assumption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get SQS client with cross-account assumed role credentials
   */
  private async getSQSClientWithCrossAccountRole(): Promise<SQSClient> {
    const credentials = await this.assumeCrossAccountRole();
    
    return new SQSClient({
      region: this.region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });
  }

  /**
   * Submit Nomad job creation request via SQS
   */
  async submitJobCreation(params: {
    siteId: string;
    jobId: string;
    jobSpec: Record<string, unknown>;
    accountId: string;
    userId?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Format message for the queue worker
      const message: Record<string, unknown> = {
        Namespace: 'sites',
        JobName: params.jobId,
        Job: params.jobSpec
      };

      const command = new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        MessageAttributes: {
          'MessageVersion': {
            StringValue: '2023-10-12',
            DataType: 'String'
          },
          'Operation': {
            StringValue: 'createUpdate',
            DataType: 'String'
          },
          // Keep these for our own tracking/debugging
          'SiteId': {
            StringValue: params.siteId,
            DataType: 'String'
          },
          'AccountId': {
            StringValue: params.accountId,
            DataType: 'String'
          }
        }
      });

      // Get SQS client with cross-account assumed role credentials
      const sqsClient = await this.getSQSClientWithCrossAccountRole();
      const result = await sqsClient.send(command);
      
      logger.info('✅ Nomad job creation queued successfully:', {
        messageId: result.MessageId,
        siteId: params.siteId,
        jobId: params.jobId,
        namespace: 'sites'
      });

      return { 
        success: true, 
        messageId: result.MessageId 
      };

    } catch (error) {
      logger.error('❌ Failed to queue Nomad job:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Submit job deletion request
   */
  async submitJobDeletion(params: {
    siteId: string;
    jobId: string;
    accountId: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Format message for the queue worker
      const message = {
        Namespace: 'sites',
        JobName: params.jobId
      };

      const command = new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        MessageAttributes: {
          'MessageVersion': {
            StringValue: '2023-10-12',
            DataType: 'String'
          },
          'Operation': {
            StringValue: 'stop',
            DataType: 'String'
          },
          // Keep these for our own tracking/debugging
          'JobId': {
            StringValue: params.jobId,
            DataType: 'String'
          },
          'SiteId': {
            StringValue: params.siteId,
            DataType: 'String'
          },
          'AccountId': {
            StringValue: params.accountId,
            DataType: 'String'
          }
        }
      });

      // Get SQS client with cross-account assumed role credentials
      const sqsClient = await this.getSQSClientWithCrossAccountRole();
      const result = await sqsClient.send(command);
      
      logger.info('✅ Nomad job deletion queued successfully:', {
        messageId: result.MessageId,
        siteId: params.siteId,
        jobId: params.jobId
      });
      
      return { success: true, messageId: result.MessageId };

    } catch (error) {
      logger.error('❌ Failed to queue Nomad job deletion:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }


}

// Export singleton instance
export const sqsNomadService = new SQSNomadService();
