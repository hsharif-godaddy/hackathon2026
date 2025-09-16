import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
import config from "./config";

export class AiroBuilderStack extends GDStack {
  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    // Create IAM role for Bedrock access that can be assumed by other roles
    const bedrockAccessRole = new iam.Role(this, 'BedrockAccessRole', {
      roleName: `${config.envName}-airo-builder-bedrock-access`,
      description: 'Role providing AWS Bedrock access for Airo Builder',
      assumedBy: new iam.CompositePrincipal(
        // Create ArnPrincipal for each ARN in the config
        ...config.bedrockAssumeRoleArns.map(arn => new iam.ArnPrincipal(arn)),
        // Add current account ops role
        new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`)
      ),
      inlinePolicies: {
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
              ],
              resources: [ "*" ]
            })
          ]
        })
      },
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(
        this,
        'BedrockPermissionBoundary',
        'GD-AWS-SSG-PB-BEDROCK'
      ),
    });

    // Output Bedrock role ARN
    new cdk.CfnOutput(this, 'BedrockAccessRoleArn', {
      value: bedrockAccessRole.roleArn,
      description: 'ARN of the Bedrock access role that can be assumed by other roles',
      exportName: `${config.envName}-bedrock-access-role-arn`
    });
  }
} 
