import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { DataLakeLocalAdmins } from '@gd-datalake/local-admins';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';
import { Construct } from 'constructs';

type EnvName = 'dev' | 'test' | 'prod';

interface LakeFormationAdminsStackProps extends GDStackProps {
  /**
   * IAM role names to register as Lake Formation admins.
   * GD-AWS-DataLakeAutomationRole and ServiceCatalogLaunchConstraintRole are
   * automatically included via includeBaselineRoles (handled by the library).
   */
  readonly roleNames: ReadonlyArray<string>;
  /** Environment name — controls bucket naming and removal policy. */
  readonly envName: EnvName;
}

/**
 * Registers Lake Formation data lake administrators and provisions an Athena
 * query results bucket for the account.
 *
 * Creates:
 * - AWS::LakeFormation::DataLakeSettings with the provided roles as admins.
 *   Baseline roles (GD-AWS-DataLakeAutomationRole, ServiceCatalogLaunchConstraintRole)
 *   are automatically included by @gd-datalake/local-admins when includeBaselineRoles=true.
 * - S3 bucket for Athena query results with 30-day auto-expiry.
 *
 * Deployed to all environments — Lake Formation admin settings and Athena access
 * are required in test to allow data lake access.
 *
 * Role access by environment:
 * - Dev:  GD-AWS-USA-GD-AiroBuilde-Ops + GD-AWS-USA-GD-AiroBuilde-Dev-Private-PowerUser
 * - Test: GD-AWS-USA-GD-AiroBuilde-Ops
 * - Prod: GD-AWS-USA-GD-AiroBuilde-Ops
 */
export class LakeFormationAdminsStack extends GDStack {
  constructor(scope: Construct, id: string, props: LakeFormationAdminsStackProps) {
    super(scope, id, props);

    this.node.addValidation({
      validate: () => {
        const errors: string[] = [];
        if (!props.roleNames.length) {
          errors.push('roleNames must contain at least one role name');
        }
        if (props.roleNames.some(n => !n.trim() || n !== n.trim())) {
          errors.push('roleNames contains blank or padded entries');
        }
        if (props.roleNames.some(n => /^arn:/i.test(n))) {
          errors.push('roleNames must be role names, not ARNs');
        }
        return errors.map(e => `LakeFormationAdminsStack: ${e}`);
      },
    });

    new DataLakeLocalAdmins(this, 'LocalAdmins', {
      roleNames: Array.from(props.roleNames),
      includeBaselineRoles: true,
    });

    // Athena requires a dedicated S3 bucket to store query results.
    // Results are transient — auto-expire after 30 days.
    // Orphaned multipart upload parts (interrupted queries) are aborted after 1 day.
    // No bucket resource policy is needed: Athena writes results using the calling
    // principal's credentials (Ops/PowerUser roles), which already have broad IAM-level
    // S3 access in this account. Unlike FeedbackS3Stack, there is no cross-account
    // reader (Lake Formation/Glue catalog) that requires an explicit bucket policy grant.
    const athenaResultsBucket = new s3.Bucket(this, 'AthenaResultsBucket', {
      bucketName: `airo-builder-athena-results-${props.envName}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
          id: 'expire-query-results',
        },
      ],
      removalPolicy: props.envName === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.envName !== 'prod',
    });

    new cdk.CfnOutput(this, 'AthenaResultsBucketName', {
      value: athenaResultsBucket.bucketName,
      description: 'S3 bucket for Athena query results — configure this in Athena Settings → Query result location',
    });
  }
}
