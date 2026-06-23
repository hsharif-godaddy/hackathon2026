import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';
import { Construct } from 'constructs';

import config from './config';

/**
 * DynamoDB storage for SupportPlane L1 transcript migration.
 *
 * Design principle:
 * - fixed generic keys (`pk`, `sk`) for stable access patterns
 * - schemaless non-key attributes for future fields without table migrations
 */
export class SupportplaneDynamoStack extends GDStack {
  public readonly transcriptsTable: dynamodb.Table;
  public readonly uploadsTable: dynamodb.Table;
  public readonly analyticsTable: dynamodb.Table;
  public readonly feedbackTable: dynamodb.Table;
  public readonly feedbackStatsTable: dynamodb.Table;
  public readonly feedbackIngestTable: dynamodb.Table;
  public readonly ticketsTable: dynamodb.Table;
  public readonly insightsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    this.transcriptsTable = this.buildTranscripts();
    this.uploadsTable = this.buildUploads();
    this.analyticsTable = this.buildAnalytics();
    this.feedbackTable = this.buildFeedback();
    this.feedbackStatsTable = this.buildFeedbackStats();
    this.feedbackIngestTable = this.buildFeedbackIngest();
    this.ticketsTable = this.buildTickets();
    this.insightsTable = this.buildInsights();

    this.grant();
    this.output();
  }

  private buildTranscripts(): dynamodb.Table {
    const table = new dynamodb.Table(this, 'SupportplaneTranscriptsTable', {
      tableName: `airo-builde-supportplane-l1-transcript-${config.envName}`,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'interaction_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      deletionProtection: config.envName === 'prod',
      removalPolicy:
        config.envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'shopperIndex',
      partitionKey: { name: 'shopper_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'shopperCreatedAtIndex',
      partitionKey: { name: 'shopper_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'customerIndex',
      partitionKey: { name: 'customer_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'customerCreatedAtIndex',
      partitionKey: { name: 'customer_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'appIndex',
      partitionKey: { name: 'app_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'appCreatedAtIndex',
      partitionKey: { name: 'app_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'domainIndex',
      partitionKey: { name: 'domain', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'domainCreatedAtIndex',
      partitionKey: { name: 'domain', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'taggingStatusIndex',
      partitionKey: { name: 'tagging_status', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // browseIndex: fixed PK "GLOBAL" + SK created_at — enables O(limit) reverse-chronological
    // browse queries without a full table scan. Deploy as a SEPARATE CDK update (AWS limit:
    // one GSI creation/deletion per update on existing tables).
    table.addGlobalSecondaryIndex({
      indexName: 'browseIndex',
      partitionKey: { name: 'browse_pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    return table;
  }

  private buildUploads(): dynamodb.Table {
    const table = new dynamodb.Table(this, 'SupportplaneUploadsTable', {
      tableName: `airo-builde-supportplane-l1-upload-${config.envName}`,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'upload_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'uploaded_at', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      deletionProtection: config.envName === 'prod',
      removalPolicy:
        config.envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'fileHashIndex',
      partitionKey: { name: 'file_hash', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'statusTaggingIndex',
      partitionKey: { name: 'status_tagging', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    return table;
  }

  private buildAnalytics(): dynamodb.Table {
    // metric_type is the partition key because client-side analytics reads are
    // metric-first (category/tag/flow/etc.) across time windows; day-first
    // partitioning would require fan-out queries per day.
    return new dynamodb.Table(this, 'SupportplaneAnalyticsTable', {
      tableName: `airo-builde-supportplane-l1-analytics-${config.envName}`,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'metric_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      deletionProtection: config.envName === 'prod',
      removalPolicy:
        config.envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
  }

  private buildFeedback(): dynamodb.Table {
    return new dynamodb.Table(this, 'SupportplaneFeedbackTable', {
      tableName: `airo-builde-supportplane-feedback-${config.envName}`,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'feedback_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      deletionProtection: config.envName === 'prod',
      removalPolicy:
        config.envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
  }

  private buildFeedbackStats(): dynamodb.Table {
    return new dynamodb.Table(this, 'SupportplaneFeedbackStatsTable', {
      tableName: `airo-builde-supportplane-feedback-stats-${config.envName}`,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'date_env', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'app_id', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      deletionProtection: config.envName === 'prod',
      removalPolicy:
        config.envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
  }

  private buildFeedbackIngest(): dynamodb.Table {
    return new dynamodb.Table(this, 'SupportplaneFeedbackIngestTable', {
      tableName: `airo-builde-supportplane-feedback-ingest-${config.envName}`,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'ingest_key', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      deletionProtection: config.envName === 'prod',
      removalPolicy:
        config.envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
  }

  private buildTickets(): dynamodb.Table {
    return new dynamodb.Table(this, 'SupportplaneTicketsTable', {
      tableName: `airo-builde-supportplane-tickets-${config.envName}`,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'ticket_key', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      deletionProtection: config.envName === 'prod',
      removalPolicy:
        config.envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
  }

  private buildInsights(): dynamodb.Table {
    // Derived insights table for aggregated bugs, features, patterns.
    // Single-table design with insight_type as discriminator.
    // PK: insight_type#insight_id (e.g., "BUG#logo_auth_001", "FEATURE#commerce_001")
    // SK: created_at (ISO8601 timestamp for sorting)
    const table = new dynamodb.Table(this, 'SupportplaneInsightsTable', {
      tableName: `airo-builde-supportplane-insights-${config.envName}`,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'insight_key', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      deletionProtection: config.envName === 'prod',
      removalPolicy:
        config.envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // GSI1: Query by insight type (BUG, FEATURE, PATTERN) + last seen
    table.addGlobalSecondaryIndex({
      indexName: 'insightTypeIndex',
      partitionKey: { name: 'insight_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'last_seen', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: Query by product line + occurrence count for heatmaps
    table.addGlobalSecondaryIndex({
      indexName: 'productLineIndex',
      partitionKey: { name: 'product_line', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'occurrence_count', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI3: Query by business impact score (for prioritization)
    table.addGlobalSecondaryIndex({
      indexName: 'impactScoreIndex',
      partitionKey: { name: 'insight_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'business_impact_score', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    return table;
  }

  private grant(): void {
    const consoleWriterRoleArns = config.katanaEcsTaskRoleArn.filter(
      (arn) => arn.includes('7794') || arn.includes('7797')
    );
    // Guard hook blocks mutating GD-managed Ops roles and creating custom
    // managed-policy resources in this stack. Keep grants scoped to app-owned
    // Katana task roles.
    const writerRoleArns = (
      consoleWriterRoleArns.length > 0 ? consoleWriterRoleArns : config.katanaEcsTaskRoleArn
    ).filter((arn) => !arn.endsWith(':role/GD-AWS-USA-GD-AiroBuilde-Ops'));
    const uniqueRoleArns = [...new Set(writerRoleArns)];
    const resources = [
      this.transcriptsTable.tableArn,
      `${this.transcriptsTable.tableArn}/index/*`,
      this.uploadsTable.tableArn,
      `${this.uploadsTable.tableArn}/index/*`,
      this.analyticsTable.tableArn,
      `${this.analyticsTable.tableArn}/index/*`,
      this.feedbackTable.tableArn,
      `${this.feedbackTable.tableArn}/index/*`,
      this.feedbackStatsTable.tableArn,
      `${this.feedbackStatsTable.tableArn}/index/*`,
      this.feedbackIngestTable.tableArn,
      `${this.feedbackIngestTable.tableArn}/index/*`,
      this.ticketsTable.tableArn,
      `${this.ticketsTable.tableArn}/index/*`,
      this.insightsTable.tableArn,
      `${this.insightsTable.tableArn}/index/*`,
    ];

    uniqueRoleArns.forEach((roleArn, index) => {
      const role = iam.Role.fromRoleArn(this, `SupportplaneRole${index}`, roleArn);
      role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:Scan',
            'dynamodb:BatchGetItem',
            'dynamodb:BatchWriteItem',
          ],
          resources,
        })
      );
    });
  }

  private output(): void {
    new cdk.CfnOutput(this, 'SupportplaneTranscriptsTableName', {
      value: this.transcriptsTable.tableName,
      description: 'SupportPlane L1 transcripts DynamoDB table name',
      exportName: `airo-builde-supportplane-l1-transcript-table-name-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneUploadsTableName', {
      value: this.uploadsTable.tableName,
      description: 'SupportPlane L1 uploads DynamoDB table name',
      exportName: `airo-builde-supportplane-l1-upload-table-name-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneAnalyticsTableName', {
      value: this.analyticsTable.tableName,
      description: 'SupportPlane L1 analytics DynamoDB table name',
      exportName: `airo-builde-supportplane-l1-analytics-table-name-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneFeedbackTableName', {
      value: this.feedbackTable.tableName,
      description: 'SupportPlane feedback DynamoDB table name',
      exportName: `airo-builde-supportplane-feedback-table-name-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneFeedbackStatsTableName', {
      value: this.feedbackStatsTable.tableName,
      description: 'SupportPlane feedback stats DynamoDB table name',
      exportName: `airo-builde-supportplane-feedback-stats-table-name-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneFeedbackIngestTableName', {
      value: this.feedbackIngestTable.tableName,
      description: 'SupportPlane feedback ingest DynamoDB table name',
      exportName: `airo-builde-supportplane-feedback-ingest-table-name-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneTicketsTableName', {
      value: this.ticketsTable.tableName,
      description: 'SupportPlane tickets DynamoDB table name',
      exportName: `airo-builde-supportplane-tickets-table-name-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneInsightsTableName', {
      value: this.insightsTable.tableName,
      description: 'SupportPlane derived insights DynamoDB table name',
      exportName: `airo-builde-supportplane-insights-table-name-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneTranscriptsTableArn', {
      value: this.transcriptsTable.tableArn,
      description: 'SupportPlane L1 transcripts DynamoDB table ARN',
      exportName: `airo-builde-supportplane-l1-transcript-table-arn-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneUploadsTableArn', {
      value: this.uploadsTable.tableArn,
      description: 'SupportPlane L1 uploads DynamoDB table ARN',
      exportName: `airo-builde-supportplane-l1-upload-table-arn-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneAnalyticsTableArn', {
      value: this.analyticsTable.tableArn,
      description: 'SupportPlane L1 analytics DynamoDB table ARN',
      exportName: `airo-builde-supportplane-l1-analytics-table-arn-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneFeedbackTableArn', {
      value: this.feedbackTable.tableArn,
      description: 'SupportPlane feedback DynamoDB table ARN',
      exportName: `airo-builde-supportplane-feedback-table-arn-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneFeedbackStatsTableArn', {
      value: this.feedbackStatsTable.tableArn,
      description: 'SupportPlane feedback stats DynamoDB table ARN',
      exportName: `airo-builde-supportplane-feedback-stats-table-arn-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneFeedbackIngestTableArn', {
      value: this.feedbackIngestTable.tableArn,
      description: 'SupportPlane feedback ingest DynamoDB table ARN',
      exportName: `airo-builde-supportplane-feedback-ingest-table-arn-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneTicketsTableArn', {
      value: this.ticketsTable.tableArn,
      description: 'SupportPlane tickets DynamoDB table ARN',
      exportName: `airo-builde-supportplane-tickets-table-arn-${config.envName}`,
    });
    new cdk.CfnOutput(this, 'SupportplaneInsightsTableArn', {
      value: this.insightsTable.tableArn,
      description: 'SupportPlane derived insights DynamoDB table ARN',
      exportName: `airo-builde-supportplane-insights-table-arn-${config.envName}`,
    });
  }
}
