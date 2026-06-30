import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

/**
 * Utility class for creating CloudWatch alarms with SNS integration
 *
 * Provides a standardized way to create CloudWatch alarms that automatically
 * connect to the appropriate SNS topic for Slack notifications. The SNS topic
 * ARN is retrieved from AWS Systems Manager Parameter Store at CloudFormation
 * deployment time from the parameter: /AdminParams/SNS/AlarmNotificationTopic
 *
 * Note: The parameter must exist in Parameter Store before deployment.
 *
 * @example
 * ```typescript
 * AlarmUtil.createCloudWatchAlarm(
 *   this,
 *   'HighCPUAlarm',
 *   cpuMetric,
 *   80,
 *   'CPU utilization above 80%'
 * );
 * ```
 */
export class AlarmUtil {
  /**
   * Create a CloudWatch alarm with SNS action for both alarm and OK states
   *
   * Creates an alarm that monitors a metric and sends notifications to Slack
   * via SNS when the alarm state changes. The SNS topic ARN is retrieved from
   * AWS Systems Manager Parameter Store (/AdminParams/SNS/AlarmNotificationTopic)
   * at CloudFormation deployment time using a dynamic reference.
   *
   * Note: `StringParameter.valueForStringParameter()` returns a CDK token at
   * synth time — it is never a real ARN string until CloudFormation resolves it
   * at deploy time. Do not attempt to inspect or guard the returned value as a
   * plain string; CloudFormation will wire the SNS topic correctly via its
   * dynamic reference (`{{resolve:ssm:...}}`).
   *
   * @param scope - CDK construct scope for creating resources
   * @param id - Unique identifier for the alarm construct
   * @param metric - CloudWatch metric to monitor
   * @param threshold - Threshold value that triggers the alarm
   * @param description - Human-readable description of what the alarm monitors
   * @param comparisonOperator - Comparison operator for threshold (default: >=)
   * @param treatMissingData - How to treat missing data (default: NOT_BREACHING)
   *
   * @example
   * ```typescript
   * const cpuMetric = new cloudwatch.Metric({
   *   namespace: 'AWS/ECS',
   *   metricName: 'CPUUtilization',
   *   dimensionsMap: { ClusterName: 'my-cluster' },
   *   statistic: 'Average',
   *   period: cdk.Duration.minutes(5),
   * });
   *
   * // CPU alarm triggers when value >= 80 (missing data = not breaching)
   * AlarmUtil.createCloudWatchAlarm(
   *   this,
   *   'ECSCPUAlarm',
   *   cpuMetric,
   *   80,
   *   'P0: ECS CPU above 80%'
   * );
   *
   * // Task count alarm triggers when value < 2
   * AlarmUtil.createCloudWatchAlarm(
   *   this,
   *   'ECSTaskCountAlarm',
   *   taskMetric,
   *   2,
   *   'P0: Task count below 2',
   *   cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD
   * );
   * ```
   */
  static createCloudWatchAlarm(
    scope: Construct,
    id: string,
    metric: cloudwatch.IMetric,
    threshold: number,
    description: string,
    comparisonOperator: cloudwatch.ComparisonOperator = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: TreatMissingData = TreatMissingData.NOT_BREACHING
  ): void {
    const snsTopicArn: string = StringParameter.valueForStringParameter(scope, '/AdminParams/SNS/AlarmNotificationTopic');
    const snsTopic: sns.ITopic = sns.Topic.fromTopicArn(scope, `SNSAlertTopic${id}`, snsTopicArn);
    const snsAction: cloudwatchActions.SnsAction = new cloudwatchActions.SnsAction(snsTopic);

    const alarm: cloudwatch.Alarm = new cloudwatch.Alarm(scope, id, {
      metric: metric,
      threshold: threshold,
      evaluationPeriods: 1,
      treatMissingData: treatMissingData,
      alarmDescription: description,
      comparisonOperator: comparisonOperator
    });

    alarm.addAlarmAction(snsAction);
    alarm.addOkAction(snsAction);
  }
}
