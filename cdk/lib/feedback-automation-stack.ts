import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";

import config from "./config";

/**
 * Stack for the feedback automation IAM role.
 *
 * Creates an assumable role with Secrets Manager list + read access,
 * used by the feedback automation pipeline.
 */
export class FeedbackAutomationStack extends GDStack {
  public readonly feedbackAutomationRole: iam.Role;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    this.feedbackAutomationRole = new iam.Role(this, 'FeedbackAutomationRole', {
      roleName: `${config.envName}-feedback-automation-role`,
      description: 'Role for feedback automation with Secrets Manager list and read access',
      assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`),
      inlinePolicies: {
        SecretsManagerReadAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'secretsmanager:ListSecrets',
              ],
              resources: ['*'],
            }),
            // Wildcard intentional: role ARN is a prerequisite for JIRA service
            // account creation, and secret names are not deterministic yet.
            // Scope to a prefix once the automation secrets exist.
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'secretsmanager:GetSecretValue',
                'secretsmanager:DescribeSecret',
              ],
              resources: [`arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'kms:Decrypt',
              ],
              resources: ['*'],
              conditions: {
                StringEquals: {
                  'kms:ViaService': `secretsmanager.${cdk.Aws.REGION}.amazonaws.com`,
                },
              },
            }),
          ],
        }),
      },
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(
        this,
        'PermissionsBoundary',
        'GD-AWS-SSG-PB-DEFAULT',
      ),
    });

    new cdk.CfnOutput(this, 'FeedbackAutomationRoleArn', {
      value: this.feedbackAutomationRole.roleArn,
      description: 'ARN of the feedback automation role',
      exportName: `${config.envName}-feedback-automation-role-arn`,
    });
  }
}
