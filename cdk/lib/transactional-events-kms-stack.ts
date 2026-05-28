import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
import { CfnOutput, RemovalPolicy } from "aws-cdk-lib";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Construct } from 'constructs';

import config from './config';

interface KMSConfig {
  kms: {
    keyAlias: string;
  };
  crossAccount: {
    /**
     * Role ARNs of EventBridge cross-account producers that write to the encrypted Kinesis stream.
     * Mirrors crossAccount.producerRoleArns in TransactionalEventsKinesisStack config so KMS
     * and Kinesis resource-policy grants scope to the same principals.
     * dev:  924341083046, 334617369240, 207848954651 (eventbus-custom-eventbus-cross-account)
     * test: 334617369240
     * prod: 380414489361
     */
    producerRoleArns: string[];
  };
}

function validate(raw: unknown): KMSConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('TransactionalEventsKMSStack config must be an object');
  }
  const c = raw as Record<string, unknown>;
  if (typeof c['kms'] !== 'object' || c['kms'] === null) {
    throw new Error('Config missing required "kms" section');
  }
  const k = c['kms'] as Record<string, unknown>;
  if (typeof k['keyAlias'] !== 'string' || !k['keyAlias']) {
    throw new Error('Config kms.keyAlias must be a non-empty string');
  }
  if (typeof c['crossAccount'] !== 'object' || c['crossAccount'] === null) {
    throw new Error('Config missing required "crossAccount" section');
  }
  const ca = c['crossAccount'] as Record<string, unknown>;
  if (!Array.isArray(ca['producerRoleArns'])) {
    throw new Error('Config crossAccount.producerRoleArns must be an array');
  }
  if (!ca['producerRoleArns'].every((a: unknown) => typeof a === 'string')) {
    throw new Error('Config crossAccount.producerRoleArns must be an array of strings');
  }
  return raw as KMSConfig;
}

export class TransactionalEventsKMSStack extends GDStack {
  public readonly kmsKey: kms.IKey;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    const configPath = path.join(__dirname, '..', 'config', 'TransactionalEventsKMSStack', `${config.envName}.json`);
    const kmsConfig = validate(JSON.parse(fs.readFileSync(configPath, 'utf8')));

    const key = new kms.Key(this, 'TransactionalEventsKmsKey', {
      alias: kmsConfig.kms.keyAlias,
      description: `KMS key for Transactional Events Kinesis stream encryption (${config.envName})`,
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Cross-account producers writing to the encrypted Kinesis stream need
    // kms:GenerateDataKey (to encrypt records) and kms:Decrypt (for re-encryption
    // during shard splits/merges). Scoped to the same role ARNs as the Kinesis
    // resource policy so both layers gate on identical principals.
    for (const roleArn of kmsConfig.crossAccount.producerRoleArns) {
      key.grantEncryptDecrypt(new iam.ArnPrincipal(roleArn));
    }

    this.kmsKey = key;

    new CfnOutput(this, 'KmsKeyArn', {
      value: key.keyArn,
      description: 'Transactional Events KMS Key ARN',
      exportName: `${config.envName}-transactional-events-kms-key-arn`,
    });

    new CfnOutput(this, 'KmsKeyId', {
      value: key.keyId,
      description: 'Transactional Events KMS Key ID',
      exportName: `${config.envName}-transactional-events-kms-key-id`,
    });

    new CfnOutput(this, 'KmsKeyAlias', {
      value: `alias/${kmsConfig.kms.keyAlias}`,
      description: 'Transactional Events KMS Key Alias',
    });
  }
}
