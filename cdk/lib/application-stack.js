"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiroBuilderStack = void 0;
const cdk = require("aws-cdk-lib");
const iam = require("aws-cdk-lib/aws-iam");
const godaddy_constructs_1 = require("@gd-safeguard/godaddy-constructs");
const config_1 = require("./config");
class AiroBuilderStack extends godaddy_constructs_1.GDStack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create IAM role for Bedrock access that can be assumed by other roles
        if (config_1.default.bedrockAssumeRoleArns.length > 0) {
            const bedrockAccessRole = new iam.Role(this, 'BedrockAccessRole', {
                roleName: `${config_1.default.envName}-airo-builder-bedrock-access`,
                description: 'Role providing AWS Bedrock access for Airo Builder',
                assumedBy: new iam.CompositePrincipal(
                // Create ArnPrincipal for each ARN in the config
                ...config_1.default.bedrockAssumeRoleArns.map(arn => new iam.ArnPrincipal(arn)), 
                // Add current account ops role
                new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`)),
                inlinePolicies: {
                    BedrockAccess: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'bedrock:InvokeModel',
                                    'bedrock:InvokeModelWithResponseStream',
                                ],
                                resources: ["*"]
                            })
                        ]
                    })
                },
                permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(this, 'BedrockPermissionBoundary', 'GD-AWS-SSG-PB-BEDROCK'),
            });
            // Output Bedrock role ARN
            new cdk.CfnOutput(this, 'BedrockAccessRoleArn', {
                value: bedrockAccessRole.roleArn,
                description: 'ARN of the Bedrock access role that can be assumed by other roles',
                exportName: `${config_1.default.envName}-bedrock-access-role-arn`
            });
        }
        // Create IAM role for GoCode access that can be assumed by other roles
        const gocodeAccessRole = new iam.Role(this, 'GoCodeAccessRole', {
            roleName: `${config_1.default.envName}-airo-builder-gocode-access`,
            description: 'Role providing GoCode access for Airo Builder',
            assumedBy: new iam.CompositePrincipal(
            // Create ArnPrincipal for each ARN in the config
            ...config_1.default.gocodeAssumeRoleArns.map(arn => new iam.ArnPrincipal(arn)), 
            // Add current account ops role
            new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`)),
            inlinePolicies: {
                iamJwtAccess: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "execute-api:Invoke"
                            ],
                            resources: [
                                `arn:aws:execute-api:*:${config_1.default.awsIamJwtAccount}:*`
                            ]
                        })
                    ]
                })
            },
        });
        // Output GoCode role ARN
        new cdk.CfnOutput(this, 'GoCodeAccessRoleArn', {
            value: gocodeAccessRole.roleArn,
            description: 'ARN of the GoCode access role that can be assumed by other roles',
            exportName: `${config_1.default.envName}-gocode-access-role-arn`
        });
    }
}
exports.AiroBuilderStack = AiroBuilderStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb24tc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhcHBsaWNhdGlvbi1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLHlFQUF5RTtBQUN6RSxxQ0FBOEI7QUFFOUIsTUFBYSxnQkFBaUIsU0FBUSw0QkFBTztJQUMzQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQW1CO1FBQzNELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLHdFQUF3RTtRQUN4RSxJQUFJLGdCQUFNLENBQUMscUJBQXFCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzVDLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtnQkFDaEUsUUFBUSxFQUFFLEdBQUcsZ0JBQU0sQ0FBQyxPQUFPLDhCQUE4QjtnQkFDekQsV0FBVyxFQUFFLG9EQUFvRDtnQkFDakUsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGtCQUFrQjtnQkFDbkMsaURBQWlEO2dCQUNqRCxHQUFHLGdCQUFNLENBQUMscUJBQXFCLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsSUFBSSxHQUFHLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNyRSwrQkFBK0I7Z0JBQy9CLElBQUksR0FBRyxDQUFDLFlBQVksQ0FBQyxnQkFBZ0IsR0FBRyxDQUFDLEdBQUcsQ0FBQyxVQUFVLG9DQUFvQyxDQUFDLENBQzdGO2dCQUNELGNBQWMsRUFBRTtvQkFDZCxhQUFhLEVBQUUsSUFBSSxHQUFHLENBQUMsY0FBYyxDQUFDO3dCQUNwQyxVQUFVLEVBQUU7NEJBQ1YsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dDQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dDQUN4QixPQUFPLEVBQUU7b0NBQ1AscUJBQXFCO29DQUNyQix1Q0FBdUM7aUNBQ3hDO2dDQUNELFNBQVMsRUFBRSxDQUFFLEdBQUcsQ0FBRTs2QkFDbkIsQ0FBQzt5QkFDSDtxQkFDRixDQUFDO2lCQUNIO2dCQUNELG1CQUFtQixFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMscUJBQXFCLENBQzFELElBQUksRUFDSiwyQkFBMkIsRUFDM0IsdUJBQXVCLENBQ3hCO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsMEJBQTBCO1lBQzFCLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7Z0JBQzlDLEtBQUssRUFBRSxpQkFBaUIsQ0FBQyxPQUFPO2dCQUNoQyxXQUFXLEVBQUUsbUVBQW1FO2dCQUNoRixVQUFVLEVBQUUsR0FBRyxnQkFBTSxDQUFDLE9BQU8sMEJBQTBCO2FBQ3hELENBQUMsQ0FBQztRQUNMLENBQUM7UUFFRCx1RUFBdUU7UUFDdkUsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzlELFFBQVEsRUFBRSxHQUFHLGdCQUFNLENBQUMsT0FBTyw2QkFBNkI7WUFDeEQsV0FBVyxFQUFFLCtDQUErQztZQUM1RCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsa0JBQWtCO1lBQ25DLGlEQUFpRDtZQUNqRCxHQUFHLGdCQUFNLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsSUFBSSxHQUFHLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3BFLCtCQUErQjtZQUMvQixJQUFJLEdBQUcsQ0FBQyxZQUFZLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxHQUFHLENBQUMsVUFBVSxvQ0FBb0MsQ0FBQyxDQUM3RjtZQUNELGNBQWMsRUFBRTtnQkFDZCxZQUFZLEVBQUUsSUFBSSxHQUFHLENBQUMsY0FBYyxDQUFDO29CQUNuQyxVQUFVLEVBQUU7d0JBQ1YsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDOzRCQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLOzRCQUN4QixPQUFPLEVBQUU7Z0NBQ1Asb0JBQW9COzZCQUNyQjs0QkFDRCxTQUFTLEVBQUU7Z0NBQ1QseUJBQXlCLGdCQUFNLENBQUMsZ0JBQWdCLElBQUk7NkJBQ3JEO3lCQUNGLENBQUM7cUJBQ0g7aUJBQ0YsQ0FBQzthQUNIO1NBQ0YsQ0FBQyxDQUFDO1FBRUgseUJBQXlCO1FBQ3pCLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDN0MsS0FBSyxFQUFFLGdCQUFnQixDQUFDLE9BQU87WUFDL0IsV0FBVyxFQUFFLGtFQUFrRTtZQUMvRSxVQUFVLEVBQUUsR0FBRyxnQkFBTSxDQUFDLE9BQU8seUJBQXlCO1NBQ3ZELENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTlFRCw0Q0E4RUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBHRFN0YWNrLCBHRFN0YWNrUHJvcHMgfSBmcm9tIFwiQGdkLXNhZmVndWFyZC9nb2RhZGR5LWNvbnN0cnVjdHNcIjtcbmltcG9ydCBjb25maWcgZnJvbSBcIi4vY29uZmlnXCI7XG5cbmV4cG9ydCBjbGFzcyBBaXJvQnVpbGRlclN0YWNrIGV4dGVuZHMgR0RTdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBHRFN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIENyZWF0ZSBJQU0gcm9sZSBmb3IgQmVkcm9jayBhY2Nlc3MgdGhhdCBjYW4gYmUgYXNzdW1lZCBieSBvdGhlciByb2xlc1xuICAgIGlmIChjb25maWcuYmVkcm9ja0Fzc3VtZVJvbGVBcm5zLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGJlZHJvY2tBY2Nlc3NSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdCZWRyb2NrQWNjZXNzUm9sZScsIHtcbiAgICAgICAgcm9sZU5hbWU6IGAke2NvbmZpZy5lbnZOYW1lfS1haXJvLWJ1aWxkZXItYmVkcm9jay1hY2Nlc3NgLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1JvbGUgcHJvdmlkaW5nIEFXUyBCZWRyb2NrIGFjY2VzcyBmb3IgQWlybyBCdWlsZGVyJyxcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkNvbXBvc2l0ZVByaW5jaXBhbChcbiAgICAgICAgICAvLyBDcmVhdGUgQXJuUHJpbmNpcGFsIGZvciBlYWNoIEFSTiBpbiB0aGUgY29uZmlnXG4gICAgICAgICAgLi4uY29uZmlnLmJlZHJvY2tBc3N1bWVSb2xlQXJucy5tYXAoYXJuID0+IG5ldyBpYW0uQXJuUHJpbmNpcGFsKGFybikpLFxuICAgICAgICAgIC8vIEFkZCBjdXJyZW50IGFjY291bnQgb3BzIHJvbGVcbiAgICAgICAgICBuZXcgaWFtLkFyblByaW5jaXBhbChgYXJuOmF3czppYW06OiR7Y2RrLkF3cy5BQ0NPVU5UX0lEfTpyb2xlL0dELUFXUy1VU0EtR0QtQWlyb0J1aWxkZS1PcHNgKVxuICAgICAgICApLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIEJlZHJvY2tBY2Nlc3M6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsJyxcbiAgICAgICAgICAgICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsV2l0aFJlc3BvbnNlU3RyZWFtJyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWyBcIipcIiBdXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdXG4gICAgICAgICAgfSlcbiAgICAgICAgfSxcbiAgICAgICAgcGVybWlzc2lvbnNCb3VuZGFyeTogaWFtLk1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lOYW1lKFxuICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgJ0JlZHJvY2tQZXJtaXNzaW9uQm91bmRhcnknLFxuICAgICAgICAgICdHRC1BV1MtU1NHLVBCLUJFRFJPQ0snXG4gICAgICAgICksXG4gICAgICB9KTtcblxuICAgICAgLy8gT3V0cHV0IEJlZHJvY2sgcm9sZSBBUk5cbiAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdCZWRyb2NrQWNjZXNzUm9sZUFybicsIHtcbiAgICAgICAgdmFsdWU6IGJlZHJvY2tBY2Nlc3NSb2xlLnJvbGVBcm4sXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBCZWRyb2NrIGFjY2VzcyByb2xlIHRoYXQgY2FuIGJlIGFzc3VtZWQgYnkgb3RoZXIgcm9sZXMnLFxuICAgICAgICBleHBvcnROYW1lOiBgJHtjb25maWcuZW52TmFtZX0tYmVkcm9jay1hY2Nlc3Mtcm9sZS1hcm5gXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgSUFNIHJvbGUgZm9yIEdvQ29kZSBhY2Nlc3MgdGhhdCBjYW4gYmUgYXNzdW1lZCBieSBvdGhlciByb2xlc1xuICAgIGNvbnN0IGdvY29kZUFjY2Vzc1JvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0dvQ29kZUFjY2Vzc1JvbGUnLCB7XG4gICAgICByb2xlTmFtZTogYCR7Y29uZmlnLmVudk5hbWV9LWFpcm8tYnVpbGRlci1nb2NvZGUtYWNjZXNzYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUm9sZSBwcm92aWRpbmcgR29Db2RlIGFjY2VzcyBmb3IgQWlybyBCdWlsZGVyJyxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5Db21wb3NpdGVQcmluY2lwYWwoXG4gICAgICAgIC8vIENyZWF0ZSBBcm5QcmluY2lwYWwgZm9yIGVhY2ggQVJOIGluIHRoZSBjb25maWdcbiAgICAgICAgLi4uY29uZmlnLmdvY29kZUFzc3VtZVJvbGVBcm5zLm1hcChhcm4gPT4gbmV3IGlhbS5Bcm5QcmluY2lwYWwoYXJuKSksXG4gICAgICAgIC8vIEFkZCBjdXJyZW50IGFjY291bnQgb3BzIHJvbGVcbiAgICAgICAgbmV3IGlhbS5Bcm5QcmluY2lwYWwoYGFybjphd3M6aWFtOjoke2Nkay5Bd3MuQUNDT1VOVF9JRH06cm9sZS9HRC1BV1MtVVNBLUdELUFpcm9CdWlsZGUtT3BzYClcbiAgICAgICksXG4gICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICBpYW1Kd3RBY2Nlc3M6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgXCJleGVjdXRlLWFwaTpJbnZva2VcIlxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpleGVjdXRlLWFwaToqOiR7Y29uZmlnLmF3c0lhbUp3dEFjY291bnR9OipgXG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgXVxuICAgICAgICB9KVxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIE91dHB1dCBHb0NvZGUgcm9sZSBBUk5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR29Db2RlQWNjZXNzUm9sZUFybicsIHtcbiAgICAgIHZhbHVlOiBnb2NvZGVBY2Nlc3NSb2xlLnJvbGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FSTiBvZiB0aGUgR29Db2RlIGFjY2VzcyByb2xlIHRoYXQgY2FuIGJlIGFzc3VtZWQgYnkgb3RoZXIgcm9sZXMnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7Y29uZmlnLmVudk5hbWV9LWdvY29kZS1hY2Nlc3Mtcm9sZS1hcm5gXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==