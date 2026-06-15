import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
import { CfnOutput, Duration } from "aws-cdk-lib";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

import config from './config';

interface TransactionalEventsKinesisProps extends GDStackProps {
  /** Optional customer-managed KMS key for stream encryption. Omit to use AWS-managed encryption. */
  kmsKey?: kms.IKey;
}

interface KinesisConfig {
  kinesis: {
    streamName: string;
    streamMode: 'PROVISIONED' | 'ON_DEMAND';
    shardCount?: number;
    retentionPeriodHours: number;
  };
  crossAccount: {
    /**
     * EventBridge cross-account producer role ARNs granted PutRecord(s) on the main stream.
     * Each entry is an eventbus-custom-eventbus-cross-account role in a producing AWS account.
     * dev:  924341083046 (dev-private cell), 334617369240 (test cell), 207848954651 (staging cell)
     * test: 334617369240 (test cell)
     * prod: 380414489361 (prod cell)
     */
    producerRoleArns: string[];
    /**
     * Consumer role ARNs granted read access to the main stream and read+write access
     * to the reminder and expiry streams. Add the Katana ECS task role for the
     * notification service.
     */
    consumerRoleArns: string[];
  };
}

function validate(raw: unknown): KinesisConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('TransactionalEventsKinesisStack config must be an object');
  }
  const c = raw as Record<string, unknown>;
  if (typeof c['kinesis'] !== 'object' || c['kinesis'] === null) {
    throw new Error('Config missing required "kinesis" section');
  }
  const k = c['kinesis'] as Record<string, unknown>;
  if (typeof k['streamName'] !== 'string' || !k['streamName']) {
    throw new Error('Config kinesis.streamName must be a non-empty string');
  }
  if (k['streamMode'] !== 'ON_DEMAND' && k['streamMode'] !== 'PROVISIONED') {
    throw new Error(`Config kinesis.streamMode must be "ON_DEMAND" or "PROVISIONED", got: ${String(k['streamMode'])}`);
  }
  if (typeof k['retentionPeriodHours'] !== 'number') {
    throw new Error('Config kinesis.retentionPeriodHours must be a number');
  }
  if (k['streamMode'] === 'PROVISIONED' && k['shardCount'] !== undefined && typeof k['shardCount'] !== 'number') {
    throw new Error('Config kinesis.shardCount must be a number when streamMode is PROVISIONED');
  }
  if (typeof c['crossAccount'] !== 'object' || c['crossAccount'] === null) {
    throw new Error('Config missing required "crossAccount" section');
  }
  const ca = c['crossAccount'] as Record<string, unknown>;
  if (!Array.isArray(ca['producerRoleArns'])) {
    throw new Error('Config crossAccount.producerRoleArns must be an array');
  }
  if (!ca['producerRoleArns'].every((arn: unknown) => typeof arn === 'string')) {
    throw new Error('Config crossAccount.producerRoleArns must be an array of strings');
  }
  if (ca['consumerRoleArns'] !== undefined) {
    if (!Array.isArray(ca['consumerRoleArns'])) {
      throw new Error('Config crossAccount.consumerRoleArns must be an array');
    }
    if (!ca['consumerRoleArns'].every((arn: unknown) => typeof arn === 'string')) {
      throw new Error('Config crossAccount.consumerRoleArns must be an array of strings');
    }
  }
  return raw as KinesisConfig;
}

/** Grants consumer roles read+write on an internal stream (no cross-account producers). */
function addInternalStreamPolicy(
  stream: kinesis.Stream,
  consumerRoleArns: string[],
): void {
  if (consumerRoleArns.length === 0) return;
  stream.addToResourcePolicy(
    new iam.PolicyStatement({
      actions: [
        'kinesis:DescribeStream',
        'kinesis:DescribeStreamSummary',
        'kinesis:GetRecords',
        'kinesis:GetShardIterator',
        'kinesis:ListShards',
        'kinesis:PutRecord',
        'kinesis:PutRecords',
      ],
      principals: consumerRoleArns.map(arn => new iam.ArnPrincipal(arn)),
      effect: iam.Effect.ALLOW,
      resources: [stream.streamArn],
    }),
  );
}

export class TransactionalEventsKinesisStack extends GDStack {
  public readonly kinesisStream: kinesis.Stream;

  /**
   * Internal stream for 24h reminder emails.
   * Notification service writes one record per transfer initiation; the timer consumer
   * replays records at AT_TIMESTAMP(now − 48h) to fire the reminder 24h before expiry.
   * 72h retention keeps records available through the 48h processing window with headroom.
   */
  public readonly reminderStream: kinesis.Stream;

  /**
   * Internal stream for 72h expiry emails.
   * Notification service writes one record per transfer initiation; the timer consumer
   * replays records at AT_TIMESTAMP(now − 72h) to fire the expiry email to the sender.
   * 96h retention keeps records available through the 72h processing window with headroom.
   */
  public readonly expiryStream: kinesis.Stream;

  constructor(scope: Construct, id: string, props: TransactionalEventsKinesisProps) {
    super(scope, id, props);

    const configPath = path.join(__dirname, '..', 'config', 'TransactionalEventsKinesisStack', `${config.envName}.json`);
    const kinesisConfig = validate(JSON.parse(fs.readFileSync(configPath, 'utf8')));

    const streamProps: kinesis.StreamProps = {
      streamName: kinesisConfig.kinesis.streamName,
      retentionPeriod: Duration.hours(kinesisConfig.kinesis.retentionPeriodHours),
      ...(kinesisConfig.kinesis.streamMode === 'ON_DEMAND'
        ? { streamMode: kinesis.StreamMode.ON_DEMAND }
        : { streamMode: kinesis.StreamMode.PROVISIONED, shardCount: kinesisConfig.kinesis.shardCount ?? 1 }),
      ...(props.kmsKey
        ? { encryption: kinesis.StreamEncryption.KMS, encryptionKey: props.kmsKey }
        : {}),
    };

    this.kinesisStream = new kinesis.Stream(this, 'TransactionalEventsStream', streamProps);

    this.reminderStream = new kinesis.Stream(this, 'TransferReminderStream', {
      streamName: `transfer-reminder-stream-${config.envName}`,
      retentionPeriod: Duration.hours(72),
      streamMode: kinesis.StreamMode.PROVISIONED,
      shardCount: 1,
      ...(props.kmsKey
        ? { encryption: kinesis.StreamEncryption.KMS, encryptionKey: props.kmsKey }
        : {}),
    });

    this.expiryStream = new kinesis.Stream(this, 'TransferExpiryStream', {
      streamName: `transfer-expiry-stream-${config.envName}`,
      retentionPeriod: Duration.hours(96),
      streamMode: kinesis.StreamMode.PROVISIONED,
      shardCount: 1,
      ...(props.kmsKey
        ? { encryption: kinesis.StreamEncryption.KMS, encryptionKey: props.kmsKey }
        : {}),
    });

    if (kinesisConfig.crossAccount.producerRoleArns.length > 0) {
      this.kinesisStream.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: [
            'kinesis:DescribeStreamSummary',
            'kinesis:ListShards',
            'kinesis:PutRecord',
            'kinesis:PutRecords',
          ],
          principals: kinesisConfig.crossAccount.producerRoleArns.map(arn => new iam.ArnPrincipal(arn)),
          effect: iam.Effect.ALLOW,
          resources: [this.kinesisStream.streamArn],
        })
      );
    }

    const consumerRoleArns = kinesisConfig.crossAccount.consumerRoleArns ?? [];
    if (consumerRoleArns.length > 0) {
      this.kinesisStream.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: [
            'kinesis:DescribeStream',
            'kinesis:DescribeStreamSummary',
            'kinesis:GetRecords',
            'kinesis:GetShardIterator',
            'kinesis:ListShards',
          ],
          principals: consumerRoleArns.map(arn => new iam.ArnPrincipal(arn)),
          effect: iam.Effect.ALLOW,
          resources: [this.kinesisStream.streamArn],
        })
      );
    }

    addInternalStreamPolicy(this.reminderStream, consumerRoleArns);
    addInternalStreamPolicy(this.expiryStream, consumerRoleArns);

    new ssm.StringParameter(this, 'StreamArnParameter', {
      parameterName: `/transactional-events/kinesis/${config.envName}/stream-arn`,
      stringValue: this.kinesisStream.streamArn,
      description: 'Transactional Events Kinesis Stream ARN',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'StreamNameParameter', {
      parameterName: `/transactional-events/kinesis/${config.envName}/stream-name`,
      stringValue: this.kinesisStream.streamName,
      description: 'Transactional Events Kinesis Stream Name',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'ReminderStreamNameParameter', {
      parameterName: `/transactional-events/kinesis/${config.envName}/reminder-stream-name`,
      stringValue: this.reminderStream.streamName,
      description: 'Transfer Reminder Kinesis Stream Name',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'ReminderStreamArnParameter', {
      parameterName: `/transactional-events/kinesis/${config.envName}/reminder-stream-arn`,
      stringValue: this.reminderStream.streamArn,
      description: 'Transfer Reminder Kinesis Stream ARN',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'ExpiryStreamNameParameter', {
      parameterName: `/transactional-events/kinesis/${config.envName}/expiry-stream-name`,
      stringValue: this.expiryStream.streamName,
      description: 'Transfer Expiry Kinesis Stream Name',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'ExpiryStreamArnParameter', {
      parameterName: `/transactional-events/kinesis/${config.envName}/expiry-stream-arn`,
      stringValue: this.expiryStream.streamArn,
      description: 'Transfer Expiry Kinesis Stream ARN',
      tier: ssm.ParameterTier.STANDARD,
    });

    new CfnOutput(this, 'KinesisStreamArn', {
      value: this.kinesisStream.streamArn,
      description: 'Kinesis Stream ARN',
      exportName: `${config.envName}-transactional-events-stream-arn`,
    });

    new CfnOutput(this, 'KinesisStreamName', {
      value: this.kinesisStream.streamName,
      description: 'Kinesis Stream Name',
      exportName: `${config.envName}-transactional-events-stream-name`,
    });

    new CfnOutput(this, 'KinesisStreamMode', {
      value: kinesisConfig.kinesis.streamMode,
      description: 'Kinesis Stream Mode (ON_DEMAND or PROVISIONED)',
    });

    if (kinesisConfig.kinesis.streamMode === 'PROVISIONED') {
      new CfnOutput(this, 'KinesisShardCount', {
        value: (kinesisConfig.kinesis.shardCount ?? 1).toString(),
        description: 'Number of shards (PROVISIONED mode only)',
      });
    }

    new CfnOutput(this, 'KinesisEncryptionEnabled', {
      value: (props.kmsKey !== undefined).toString(),
      description: 'Whether KMS encryption is enabled',
    });

    new CfnOutput(this, 'ReminderStreamName', {
      value: this.reminderStream.streamName,
      description: 'Transfer Reminder Kinesis Stream Name (72h retention, 1 shard)',
      exportName: `${config.envName}-transfer-reminder-stream-name`,
    });

    new CfnOutput(this, 'ReminderStreamArn', {
      value: this.reminderStream.streamArn,
      description: 'Transfer Reminder Kinesis Stream ARN',
      exportName: `${config.envName}-transfer-reminder-stream-arn`,
    });

    new CfnOutput(this, 'ExpiryStreamName', {
      value: this.expiryStream.streamName,
      description: 'Transfer Expiry Kinesis Stream Name (96h retention, 1 shard)',
      exportName: `${config.envName}-transfer-expiry-stream-name`,
    });

    new CfnOutput(this, 'ExpiryStreamArn', {
      value: this.expiryStream.streamArn,
      description: 'Transfer Expiry Kinesis Stream ARN',
      exportName: `${config.envName}-transfer-expiry-stream-arn`,
    });

    if (kinesisConfig.crossAccount.producerRoleArns.length > 0) {
      new CfnOutput(this, 'ProducerRoles', {
        value: kinesisConfig.crossAccount.producerRoleArns.join(','),
        description: 'Cross-account producer role ARNs with write access',
      });
    }

    if (consumerRoleArns.length > 0) {
      new CfnOutput(this, 'ConsumerRoles', {
        value: consumerRoleArns.join(','),
        description: 'Consumer role ARNs with read access',
      });
    }
  }
}
