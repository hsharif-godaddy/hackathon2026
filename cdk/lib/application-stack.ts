import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
import config from "./config";

export class AiroBuilderStack extends GDStack {
  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    // Create IAM role for GoCode access that can be assumed by other roles
    const gocodeAccessRole = new iam.Role(this, 'GoCodeAccessRole', {
      roleName: `${config.envName}-airo-builder-gocode-access`,
      description: 'Role providing GoCode access for Airo Builder',
      assumedBy: new iam.CompositePrincipal(
        // Create ArnPrincipal for each ARN in the config
        ...config.gocodeAssumeRoleArns.map(arn => new iam.ArnPrincipal(arn)),
        // Add current account ops role
        new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`)
      ),
      inlinePolicies: {
        iamJwtAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "execute-api:Invoke"
              ],
              resources: config.awsIamJwtAccount.map(account =>
                `arn:aws:execute-api:*:${account}:*`
              )
            })
          ]
        })
      },
    });

    // Output GoCode role ARN
    new cdk.CfnOutput(this, 'GoCodeAccessRoleArn', {
      value: gocodeAccessRole.roleArn,
      description: 'ARN of the GoCode access role that can be assumed by other roles',
      exportName: `${config.envName}-gocode-access-role-arn`
    });
  }
}
