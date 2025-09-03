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
        // Allow other roles in the same account to assume this role
        new iam.AccountRootPrincipal(),
        // Allow V2 Cell AWS account to assume this role
          new iam.AccountPrincipal(config.v2CellAccount),
        // Allow specific service principals if needed
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
      ),
      managedPolicies: [
        // Use AWS managed policy for Bedrock access
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockLimitedAccess')
      ],
    });

    // Output Bedrock role ARN
    new cdk.CfnOutput(this, 'BedrockAccessRoleArn', {
      value: bedrockAccessRole.roleArn,
      description: 'ARN of the Bedrock access role that can be assumed by other roles',
      exportName: `${config.envName}-bedrock-access-role-arn`
    });
  }
} 