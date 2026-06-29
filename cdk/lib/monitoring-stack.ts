import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { AlarmUtil } from './AlarmUtil';
import config from './config';

/**
 * Monitoring stack for Airo Builder application
 * 
 * Creates CloudWatch alarms for:
 * - ALB monitoring (5xx, 4xx, high TPS)
 * - ECS monitoring (CPU, memory, task count)
 * - RDS Aurora Serverless v2 monitoring (ACU utilization, connections, CPU)
 * 
 * Alarms are sent to environment-specific SNS topics which trigger
 * the gd-sns-notify Lambda function for Slack notifications.
 * 
 * @example
 * ```typescript
 * new MonitoringStack(app, 'MonitoringStack', {
 *   env: { account: '123456789', region: 'us-west-2' },
 *   appAlbArn: 'arn:aws:elasticloadbalancing:...',
 *   ecsClusterName: 'airo-builder-cluster',
 *   rdsClusterIdentifier: 'airo-builder-db',
 *   alarmThresholds: { ... }
 * });
 * ```
 */
export interface MonitoringStackProps extends GDStackProps {
  /** Name of the ECS cluster to monitor */
  ecsClusterName: string;
  /** Name of the ECS service to monitor */
  ecsServiceName?: string;
  /** ARN of the app/frontend Application Load Balancer to monitor */
  appAlbArn?: string;
  /** Identifier of the RDS Aurora cluster to monitor */
  rdsClusterIdentifier: string;
  /** Thresholds for various alarm metrics */
  alarmThresholds: {
    alb5xxThreshold: number;
    alb4xxThreshold: number;
    albHighTpsThreshold: number;
    ecsMaxUtilization: number;
    rdsMaxUtilization: number;
    rdsMaxConnections: number;
  };
}

export class MonitoringStack extends GDStack {
  /** CloudWatch dashboard for monitoring overview */
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // Create ALB alarms for app (frontend) if provided
    if (props.appAlbArn) {
      this.createAlbAlarms(props.appAlbArn, 'App');
    }

    // Create ECS alarms if cluster details are provided
    if (props.ecsClusterName && props.ecsServiceName) {
      this.createEcsAlarms(props.ecsClusterName, props.ecsServiceName);
    }

    // Create RDS alarms if cluster identifier is provided
    if (props.rdsClusterIdentifier) {
      this.createRdsAlarms(props.rdsClusterIdentifier);
    }

    // WAF blocked-request alarms
    if (config.monitoring.wafWebAclNames.length > 0) {
      this.createWafAlarms(config.monitoring.wafWebAclNames);
    }

    // Create CloudWatch dashboard
    this.dashboard = this.createDashboard();
  }

  /**
   * Create CloudWatch alarms for Application Load Balancer
   * 
   * Monitors:
   * - 5xx errors (server errors)
   * - 4xx errors (client errors)
   * - High TPS (requests per second)
   * 
   * @param albArn - ARN of the ALB to monitor
   * @param prefix - Prefix for alarm names (e.g., 'Proxy' or 'App') to differentiate between ALBs
   */
  private createAlbAlarms(albArn: string, prefix: string = ''): void {
    const albName = this.extractAlbName(albArn);
    const thresholds = config.monitoring.alarmThresholds;
    const idPrefix = prefix ? `${prefix}` : '';

    // ALB 5xx errors alarm
    AlarmUtil.createCloudWatchAlarm(
      this,
      `${idPrefix}ALB5xxErrorsAlarm`,
      new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_5XX_Count',
        dimensionsMap: {
          LoadBalancer: albName,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      thresholds.alb5xxThreshold,
      'P0: ALB returning 5xx errors - indicates backend service issues'
    );

    // ALB 4xx errors alarm
    AlarmUtil.createCloudWatchAlarm(
      this,
      `${idPrefix}ALB4xxErrorsAlarm`,
      new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_4XX_Count',
        dimensionsMap: {
          LoadBalancer: albName,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      thresholds.alb4xxThreshold,
      'P0: ALB returning high 4xx errors - check client requests'
    );

    // ALB High TPS alarm
    AlarmUtil.createCloudWatchAlarm(
      this,
      `${idPrefix}ALBHighTPSAlarm`,
      new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'RequestCount',
        dimensionsMap: {
          LoadBalancer: albName,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      thresholds.albHighTpsThreshold,
      'P0: ALB experiencing unusually high traffic'
    );
  }

  /**
   * Create CloudWatch alarms for ECS service
   * 
   * Monitors:
   * - CPU utilization
   * - Memory utilization
   * - Running task count
   * 
   * @param clusterName - Name of the ECS cluster
   * @param serviceName - Name of the ECS service
   */
  private createEcsAlarms(clusterName: string, serviceName: string): void {
    const thresholds = config.monitoring.alarmThresholds;

    // ECS CPU utilization alarm
    AlarmUtil.createCloudWatchAlarm(
      this,
      'ECSCPUUtilizationAlarm',
      new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          ClusterName: clusterName,
          ServiceName: serviceName,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
      }),
      thresholds.ecsMaxUtilization,
      'P0: ECS CPU utilization above 90% - may need scaling'
    );

    // ECS Memory utilization alarm
    AlarmUtil.createCloudWatchAlarm(
      this,
      'ECSMemoryUtilizationAlarm',
      new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'MemoryUtilization',
        dimensionsMap: {
          ClusterName: clusterName,
          ServiceName: serviceName,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
      }),
      thresholds.ecsMaxUtilization,
      'P0: ECS memory utilization above 90% - may need scaling'
    );

    // ECS Task Count alarm (triggers when count < 2)
    AlarmUtil.createCloudWatchAlarm(
      this,
      'ECSTaskCountLowAlarm',
      new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'RunningTaskCount',
        dimensionsMap: {
          ClusterName: clusterName,
          ServiceName: serviceName,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
      }),
      2,
      'P0: ECS running task count below minimum - service degradation',
      cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD
    );
  }

  /**
   * Create CloudWatch alarms for Aurora RDS cluster
   * 
   * Monitors:
   * - ACU (Aurora Capacity Units) utilization
   * - CPU utilization
   * - Database connections
   * 
   * Note: Storage monitoring not included as Aurora Serverless v2 auto-scales storage
   * 
   * @param clusterIdentifier - Identifier of the RDS cluster
   */
  private createRdsAlarms(clusterIdentifier: string): void {
    const thresholds = config.monitoring.alarmThresholds;

    // RDS ACU Utilization alarm
    AlarmUtil.createCloudWatchAlarm(
      this,
      'RDSACUUtilizationAlarm',
      new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'ServerlessDatabaseCapacity',
        dimensionsMap: {
          DBClusterIdentifier: clusterIdentifier,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      config.serverlessV2MaxCapacity * (thresholds.rdsMaxUtilization / 100),
      'P0: RDS ACU utilization above 80% for 15 minutes - may need capacity increase'
    );

    // RDS CPU Utilization alarm
    AlarmUtil.createCloudWatchAlarm(
      this,
      'RDSCPUUtilizationAlarm',
      new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          DBClusterIdentifier: clusterIdentifier,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      80,
      'P0: RDS CPU utilization above 80% - check query performance'
    );

    // RDS Database Connections alarm
    AlarmUtil.createCloudWatchAlarm(
      this,
      'RDSConnectionsHighAlarm',
      new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'DatabaseConnections',
        dimensionsMap: {
          DBClusterIdentifier: clusterIdentifier,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      thresholds.rdsMaxConnections,
      'P0: RDS connection count above threshold - check connection pooling'
    );
  }

  private createWafAlarms(webAclNames: string[]): void {
    const thresholds = config.monitoring.alarmThresholds;

    for (const webAclName of webAclNames) {
      const safeId: string = webAclName.replace(/[^a-zA-Z0-9]/g, '');
      AlarmUtil.createCloudWatchAlarm(
        this,
        `WAFBlockedAll${safeId}`,
        new cloudwatch.Metric({
          namespace: 'AWS/WAFV2',
          metricName: 'BlockedRequests',
          dimensionsMap: {
            WebACL: webAclName,
            Region: config.region,
            Rule: 'ALL',
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
        thresholds.wafMaxBlockedReqs,
        `WAF blocked requests spike on ${webAclName} (all rules)`
      );
    }
  }

  /**
   * Create CloudWatch dashboard with monitoring overview
   * 
   * Displays:
   * - ALB traffic metrics (requests, errors)
   * - ECS resource utilization and task counts
   * - RDS Aurora Serverless v2 metrics (ACU, CPU, connections)
   * 
   * @returns Created CloudWatch dashboard
   */
  private createDashboard(): cloudwatch.Dashboard {
    const dashboard = new cloudwatch.Dashboard(this, 'MonitoringDashboard', {
      dashboardName: `${config.envName}-airo-builder-overview`,
      defaultInterval: cdk.Duration.hours(3),
    });

    // Add ALB metrics section
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ALB - Request Count',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'RequestCount',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'ALB - Error Rates',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_5XX_Count',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            label: '5xx Errors',
            color: cloudwatch.Color.RED,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_4XX_Count',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            label: '4xx Errors',
            color: cloudwatch.Color.ORANGE,
          }),
        ],
        width: 12,
      })
    );

    // Add ECS metrics section
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ECS - CPU & Memory Utilization',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'CPUUtilization',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            label: 'CPU %',
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'MemoryUtilization',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            label: 'Memory %',
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'ECS - Running Tasks',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'RunningTaskCount',
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
      })
    );

    // Add RDS metrics section
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'RDS - ACU Utilization',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'ServerlessDatabaseCapacity',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'RDS - Connections & CPU',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'DatabaseConnections',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            label: 'Connections',
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'CPUUtilization',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            label: 'CPU %',
          }),
        ],
        width: 12,
      })
    );

    if (config.monitoring.wafWebAclNames.length > 0) {
      dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: 'WAF - Blocked Requests (All WebACLs)',
          left: config.monitoring.wafWebAclNames.map((webAclName: string) =>
            new cloudwatch.Metric({
              namespace: 'AWS/WAFV2',
              metricName: 'BlockedRequests',
              dimensionsMap: {
                WebACL: webAclName,
                Region: config.region,
                Rule: 'ALL',
              },
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
              label: webAclName,
            })
          ),
          width: 24,
        })
      );
    }

    return dashboard;
  }

  /**
   * Extract ALB name from full ARN
   * 
   * @param albArn - Full ARN of the ALB
   * @returns ALB name portion for CloudWatch metrics
   * 
   * @example
   * ```typescript
   * extractAlbName('arn:aws:elasticloadbalancing:us-west-2:123:loadbalancer/app/my-alb/abc123')
   * // Returns: 'app/my-alb/abc123'
   * ```
   */
  private extractAlbName(albArn: string): string {
    return albArn.split('loadbalancer/')[1] || albArn;
  }
}

