"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MySQLV2Stack = void 0;
const cdk = require("aws-cdk-lib");
const rds = require("aws-cdk-lib/aws-rds");
const ec2 = require("aws-cdk-lib/aws-ec2");
const kms = require("aws-cdk-lib/aws-kms");
const godaddy_constructs_1 = require("@gd-safeguard/godaddy-constructs");
const logs = require("aws-cdk-lib/aws-logs");
const config_1 = require("./config");
class MySQLV2Stack extends godaddy_constructs_1.GDStack {
    constructor(scope, id, props) {
        super(scope, id, props);
        this.clusters = [];
        const vpc = ec2.Vpc.fromLookup(this, 'VPC', { vpcId: this.gdTrustedLandingZone.networking.vpcId });
        if (['dev', 'prod'].includes(config_1.default.envName)) {
            config_1.default.databases.forEach(database => {
                // Create security group for MySQL
                const mysqlSecurityGroup = new ec2.SecurityGroup(this, `${database}-MySQLSecurityGroup`, {
                    vpc,
                    description: `[${database}] Security group for MySQL Aurora cluster`,
                    allowAllOutbound: true,
                });
                // Allow inbound MySQL traffic from VPC and VPN
                mysqlSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(3306), `[${database}] Allow MySQL access from VPC`);
                this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.forEach(subnet => {
                    mysqlSecurityGroup.addIngressRule(ec2.Peer.ipv4(subnet.ipv4CidrBlock), ec2.Port.tcp(3306), `[${database}] Allow MySQL access from VPC`);
                });
                Object.entries(config_1.default.vpnIps).forEach(([ip, description]) => {
                    mysqlSecurityGroup.addIngressRule(ec2.Peer.ipv4(ip), ec2.Port.tcp(3306), `[${database}] Allow MySQL access from ${description}`);
                });
                const subnetGroup = new rds.SubnetGroup(this, `${database}-MySQLSubnetGroup`, {
                    subnetGroupName: `${database}-mysql-v2-subnet-group`,
                    vpc,
                    description: `[${database}] Subnet group for MySQL Aurora cluster`,
                    vpcSubnets: this.gdTrustedLandingZone.networking.dxDbSubnets,
                });
                // Create parameter group for cluster
                const parameterGroup = new rds.ParameterGroup(this, `${database}-MySQLParameterGroup`, {
                    engine: rds.DatabaseClusterEngine.auroraMysql({
                        version: rds.AuroraMysqlEngineVersion.VER_3_08_2,
                    })
                });
                // Create parameter group for instances
                const instanceParameterGroup = new rds.ParameterGroup(this, `${database}-MySQLInstanceParameterGroup`, {
                    engine: rds.DatabaseClusterEngine.auroraMysql({
                        version: rds.AuroraMysqlEngineVersion.VER_3_08_2,
                    })
                });
                // Create database credentials
                const credentials = rds.Credentials.fromGeneratedSecret('mysqladmin', {
                    secretName: `${database}-mysql-v2-credentials`,
                });
                // Create the Aurora Serverless v2 MySQL cluster
                const cluster = new rds.DatabaseCluster(this, `${database}-MySQLCluster`, {
                    engine: rds.DatabaseClusterEngine.auroraMysql({
                        version: rds.AuroraMysqlEngineVersion.VER_3_08_2,
                    }),
                    defaultDatabaseName: 'airo_builder',
                    credentials,
                    parameterGroup,
                    storageEncrypted: true,
                    storageEncryptionKey: kms.Key.fromKeyArn(this, `${database}-MySQLKMSKey`, this.gdTrustedLandingZone.accountInfo.kms.cmkArn),
                    writer: rds.ClusterInstance.serverlessV2('writer', {
                        publiclyAccessible: false,
                        parameterGroup: instanceParameterGroup,
                    }),
                    readers: Array.from({ length: config_1.default.mysqlReadersCount }, (n, i) => i).map(i => rds.ClusterInstance.serverlessV2(`reader-${i + 1}`, {
                        publiclyAccessible: false,
                        enablePerformanceInsights: true,
                        performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
                        instanceIdentifier: `${database}-mysql-v2-reader-${i + 1}`,
                        scaleWithWriter: i === 0,
                        parameterGroup: instanceParameterGroup
                    })),
                    serverlessV2MinCapacity: config_1.default.serverlessV2MinCapacity,
                    serverlessV2MaxCapacity: config_1.default.serverlessV2MaxCapacity,
                    backup: {
                        retention: cdk.Duration.days(config_1.default.backupRetentionDays),
                        preferredWindow: '03:00-04:00',
                    },
                    clusterIdentifier: `${database}-mysql-v2-cluster`,
                    cloudwatchLogsExports: ['audit', 'general', 'error', 'slowquery'],
                    cloudwatchLogsRetention: logs.RetentionDays.ONE_WEEK,
                    enablePerformanceInsights: true,
                    performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
                    vpc,
                    subnetGroup,
                    securityGroups: [mysqlSecurityGroup],
                    removalPolicy: cdk.RemovalPolicy.RETAIN,
                });
                cluster.node.addDependency(parameterGroup);
                cluster.node.addDependency(instanceParameterGroup);
                cluster.node.addDependency(subnetGroup);
                cluster.node.addDependency(mysqlSecurityGroup);
                this.clusters.push(cluster);
                cdk.Tags.of(cluster).add('allowShutdownForCostOptimization', 'false');
            });
        }
        cdk.Tags.of(this).add("allowShutdownForCostOptimization", "false");
        // Outputs
        this.clusters.forEach((cluster, index) => {
            new cdk.CfnOutput(this, `${config_1.default.databases[index]}-MySQLV2ClusterEndpoint`, {
                value: cluster.clusterEndpoint.hostname,
                description: `[${config_1.default.databases[index]}] MySQL Aurora V2 cluster endpoint`,
                exportName: `mysql-v2-endpoint-${config_1.default.databases[index]}`,
            });
        });
    }
}
exports.MySQLV2Stack = MySQLV2Stack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibXlzcWwtdjItc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJteXNxbC12Mi1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MseUVBQXVFO0FBQ3ZFLDZDQUE2QztBQUM3QyxxQ0FBOEI7QUFFOUIsTUFBYSxZQUFhLFNBQVEsNEJBQU87SUFHdkMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFtQjtRQUMzRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUhWLGFBQVEsR0FBMEIsRUFBRSxDQUFDO1FBS25ELE1BQU0sR0FBRyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDO1FBRW5HLElBQUksQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLGdCQUFNLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUM3QyxnQkFBTSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLEVBQUU7Z0JBQ2xDLGtDQUFrQztnQkFDbEMsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLEdBQUcsUUFBUSxxQkFBcUIsRUFBRTtvQkFDdkYsR0FBRztvQkFDSCxXQUFXLEVBQUUsSUFBSSxRQUFRLDJDQUEyQztvQkFDcEUsZ0JBQWdCLEVBQUUsSUFBSTtpQkFDdkIsQ0FBQyxDQUFDO2dCQUVILCtDQUErQztnQkFDL0Msa0JBQWtCLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxJQUFJLFFBQVEsK0JBQStCLENBQUMsQ0FBQztnQkFDcEksSUFBSSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFBRTtvQkFDekUsa0JBQWtCLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxJQUFJLFFBQVEsK0JBQStCLENBQUMsQ0FBQztnQkFDNUksQ0FBQyxDQUFDLENBQUM7Z0JBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxnQkFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLFdBQVcsQ0FBQyxFQUFFLEVBQUU7b0JBQzFELGtCQUFrQixDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxJQUFJLFFBQVEsNkJBQTZCLFdBQVcsRUFBRSxDQUFDLENBQUM7Z0JBQ25JLENBQUMsQ0FBQyxDQUFDO2dCQUVILE1BQU0sV0FBVyxHQUFHLElBQUksR0FBRyxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsR0FBRyxRQUFRLG1CQUFtQixFQUFFO29CQUM1RSxlQUFlLEVBQUUsR0FBRyxRQUFRLHdCQUF3QjtvQkFDcEQsR0FBRztvQkFDSCxXQUFXLEVBQUUsSUFBSSxRQUFRLHlDQUF5QztvQkFDbEUsVUFBVSxFQUFFLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsV0FBVztpQkFDN0QsQ0FBQyxDQUFDO2dCQUVILHFDQUFxQztnQkFDckMsTUFBTSxjQUFjLEdBQUcsSUFBSSxHQUFHLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxHQUFHLFFBQVEsc0JBQXNCLEVBQUU7b0JBQ25GLE1BQU0sRUFBRSxHQUFHLENBQUMscUJBQXFCLENBQUMsV0FBVyxDQUFDO3dCQUM1QyxPQUFPLEVBQUUsR0FBRyxDQUFDLHdCQUF3QixDQUFDLFVBQVU7cUJBQ2pELENBQUM7aUJBQ0wsQ0FBQyxDQUFDO2dCQUVILHVDQUF1QztnQkFDdkMsTUFBTSxzQkFBc0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLEdBQUcsUUFBUSw4QkFBOEIsRUFBRTtvQkFDckcsTUFBTSxFQUFFLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQyxXQUFXLENBQUM7d0JBQzVDLE9BQU8sRUFBRSxHQUFHLENBQUMsd0JBQXdCLENBQUMsVUFBVTtxQkFDakQsQ0FBQztpQkFDSCxDQUFDLENBQUM7Z0JBRUgsOEJBQThCO2dCQUM5QixNQUFNLFdBQVcsR0FBRyxHQUFHLENBQUMsV0FBVyxDQUFDLG1CQUFtQixDQUFDLFlBQVksRUFBRTtvQkFDcEUsVUFBVSxFQUFFLEdBQUcsUUFBUSx1QkFBdUI7aUJBQy9DLENBQUMsQ0FBQztnQkFFSCxnREFBZ0Q7Z0JBQ2hELE1BQU0sT0FBTyxHQUFHLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQyxJQUFJLEVBQUUsR0FBRyxRQUFRLGVBQWUsRUFBRTtvQkFDeEUsTUFBTSxFQUFFLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQyxXQUFXLENBQUM7d0JBQzVDLE9BQU8sRUFBRSxHQUFHLENBQUMsd0JBQXdCLENBQUMsVUFBVTtxQkFDakQsQ0FBQztvQkFDRixtQkFBbUIsRUFBRSxjQUFjO29CQUNuQyxXQUFXO29CQUNYLGNBQWM7b0JBQ2QsZ0JBQWdCLEVBQUUsSUFBSTtvQkFDdEIsb0JBQW9CLEVBQUUsR0FBRyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLEdBQUcsUUFBUSxjQUFjLEVBQUUsSUFBSSxDQUFDLG9CQUFvQixDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDO29CQUMzSCxNQUFNLEVBQUUsR0FBRyxDQUFDLGVBQWUsQ0FBQyxZQUFZLENBQUMsUUFBUSxFQUFFO3dCQUNqRCxrQkFBa0IsRUFBRSxLQUFLO3dCQUN6QixjQUFjLEVBQUUsc0JBQXNCO3FCQUN2QyxDQUFDO29CQUNGLE9BQU8sRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsTUFBTSxFQUFFLGdCQUFNLENBQUMsaUJBQWlCLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFO3dCQUNsSSxrQkFBa0IsRUFBRSxLQUFLO3dCQUN6Qix5QkFBeUIsRUFBRSxJQUFJO3dCQUMvQiwyQkFBMkIsRUFBRSxHQUFHLENBQUMsMkJBQTJCLENBQUMsT0FBTzt3QkFDcEUsa0JBQWtCLEVBQUUsR0FBRyxRQUFRLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxFQUFFO3dCQUMxRCxlQUFlLEVBQUUsQ0FBQyxLQUFLLENBQUM7d0JBQ3hCLGNBQWMsRUFBRSxzQkFBc0I7cUJBQ3pDLENBQUMsQ0FBQztvQkFDRCx1QkFBdUIsRUFBRSxnQkFBTSxDQUFDLHVCQUF1QjtvQkFDdkQsdUJBQXVCLEVBQUUsZ0JBQU0sQ0FBQyx1QkFBdUI7b0JBQ3ZELE1BQU0sRUFBRTt3QkFDTixTQUFTLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsZ0JBQU0sQ0FBQyxtQkFBbUIsQ0FBQzt3QkFDeEQsZUFBZSxFQUFFLGFBQWE7cUJBQy9CO29CQUNELGlCQUFpQixFQUFFLEdBQUcsUUFBUSxtQkFBbUI7b0JBQ2pELHFCQUFxQixFQUFFLENBQUMsT0FBTyxFQUFFLFNBQVMsRUFBRSxPQUFPLEVBQUUsV0FBVyxDQUFDO29CQUNqRSx1QkFBdUIsRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVE7b0JBQ3BELHlCQUF5QixFQUFFLElBQUk7b0JBQy9CLDJCQUEyQixFQUFFLEdBQUcsQ0FBQywyQkFBMkIsQ0FBQyxPQUFPO29CQUNwRSxHQUFHO29CQUNILFdBQVc7b0JBQ1gsY0FBYyxFQUFFLENBQUMsa0JBQWtCLENBQUM7b0JBQ3BDLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07aUJBQ3hDLENBQUMsQ0FBQztnQkFFSCxPQUFPLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLENBQUMsQ0FBQztnQkFDM0MsT0FBTyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsc0JBQXNCLENBQUMsQ0FBQztnQkFDbkQsT0FBTyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLENBQUM7Z0JBQ3hDLE9BQU8sQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGtCQUFrQixDQUFDLENBQUM7Z0JBRS9DLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO2dCQUM1QixHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxHQUFHLENBQUMsa0NBQWtDLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFDeEUsQ0FBQyxDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLGtDQUFrQyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRW5FLFVBQVU7UUFDVixJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsRUFBRTtZQUN2QyxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLEdBQUcsZ0JBQU0sQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLHlCQUF5QixFQUFFO2dCQUMzRSxLQUFLLEVBQUUsT0FBTyxDQUFDLGVBQWUsQ0FBQyxRQUFRO2dCQUN2QyxXQUFXLEVBQUUsSUFBSSxnQkFBTSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsb0NBQW9DO2dCQUM1RSxVQUFVLEVBQUUscUJBQXFCLGdCQUFNLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxFQUFFO2FBQzNELENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUVGO0FBakhELG9DQWlIQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIHJkcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtcmRzJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIGttcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mta21zJztcbmltcG9ydCB7R0RTdGFjaywgR0RTdGFja1Byb3BzfSBmcm9tIFwiQGdkLXNhZmVndWFyZC9nb2RhZGR5LWNvbnN0cnVjdHNcIjtcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IGNvbmZpZyBmcm9tICcuL2NvbmZpZyc7XG5cbmV4cG9ydCBjbGFzcyBNeVNRTFYyU3RhY2sgZXh0ZW5kcyBHRFN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGNsdXN0ZXJzOiByZHMuRGF0YWJhc2VDbHVzdGVyW10gPSBbXTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogR0RTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB2cGMgPSBlYzIuVnBjLmZyb21Mb29rdXAodGhpcywgJ1ZQQycsIHsgdnBjSWQ6IHRoaXMuZ2RUcnVzdGVkTGFuZGluZ1pvbmUubmV0d29ya2luZy52cGNJZCB9KTtcblxuICAgIGlmIChbJ2RldicsICdwcm9kJ10uaW5jbHVkZXMoY29uZmlnLmVudk5hbWUpKSB7XG4gICAgICBjb25maWcuZGF0YWJhc2VzLmZvckVhY2goZGF0YWJhc2UgPT4ge1xuICAgICAgICAvLyBDcmVhdGUgc2VjdXJpdHkgZ3JvdXAgZm9yIE15U1FMXG4gICAgICAgIGNvbnN0IG15c3FsU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCBgJHtkYXRhYmFzZX0tTXlTUUxTZWN1cml0eUdyb3VwYCwge1xuICAgICAgICAgIHZwYyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogYFske2RhdGFiYXNlfV0gU2VjdXJpdHkgZ3JvdXAgZm9yIE15U1FMIEF1cm9yYSBjbHVzdGVyYCxcbiAgICAgICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBbGxvdyBpbmJvdW5kIE15U1FMIHRyYWZmaWMgZnJvbSBWUEMgYW5kIFZQTlxuICAgICAgICBteXNxbFNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoZWMyLlBlZXIuaXB2NCh2cGMudnBjQ2lkckJsb2NrKSwgZWMyLlBvcnQudGNwKDMzMDYpLCBgWyR7ZGF0YWJhc2V9XSBBbGxvdyBNeVNRTCBhY2Nlc3MgZnJvbSBWUENgKTtcbiAgICAgICAgdGhpcy5nZFRydXN0ZWRMYW5kaW5nWm9uZS5uZXR3b3JraW5nLmR4QXBwU3VibmV0cz8uc3VibmV0cz8uZm9yRWFjaChzdWJuZXQgPT4ge1xuICAgICAgICAgICAgbXlzcWxTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKGVjMi5QZWVyLmlwdjQoc3VibmV0LmlwdjRDaWRyQmxvY2spLCBlYzIuUG9ydC50Y3AoMzMwNiksIGBbJHtkYXRhYmFzZX1dIEFsbG93IE15U1FMIGFjY2VzcyBmcm9tIFZQQ2ApO1xuICAgICAgICB9KTtcbiAgICAgICAgT2JqZWN0LmVudHJpZXMoY29uZmlnLnZwbklwcykuZm9yRWFjaCgoW2lwLCBkZXNjcmlwdGlvbl0pID0+IHtcbiAgICAgICAgICBteXNxbFNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoZWMyLlBlZXIuaXB2NChpcCksIGVjMi5Qb3J0LnRjcCgzMzA2KSwgYFske2RhdGFiYXNlfV0gQWxsb3cgTXlTUUwgYWNjZXNzIGZyb20gJHtkZXNjcmlwdGlvbn1gKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3Qgc3VibmV0R3JvdXAgPSBuZXcgcmRzLlN1Ym5ldEdyb3VwKHRoaXMsIGAke2RhdGFiYXNlfS1NeVNRTFN1Ym5ldEdyb3VwYCwge1xuICAgICAgICAgIHN1Ym5ldEdyb3VwTmFtZTogYCR7ZGF0YWJhc2V9LW15c3FsLXYyLXN1Ym5ldC1ncm91cGAsXG4gICAgICAgICAgdnBjLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBgWyR7ZGF0YWJhc2V9XSBTdWJuZXQgZ3JvdXAgZm9yIE15U1FMIEF1cm9yYSBjbHVzdGVyYCxcbiAgICAgICAgICB2cGNTdWJuZXRzOiB0aGlzLmdkVHJ1c3RlZExhbmRpbmdab25lLm5ldHdvcmtpbmcuZHhEYlN1Ym5ldHMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBwYXJhbWV0ZXIgZ3JvdXAgZm9yIGNsdXN0ZXJcbiAgICAgICAgY29uc3QgcGFyYW1ldGVyR3JvdXAgPSBuZXcgcmRzLlBhcmFtZXRlckdyb3VwKHRoaXMsIGAke2RhdGFiYXNlfS1NeVNRTFBhcmFtZXRlckdyb3VwYCwge1xuICAgICAgICAgICAgZW5naW5lOiByZHMuRGF0YWJhc2VDbHVzdGVyRW5naW5lLmF1cm9yYU15c3FsKHtcbiAgICAgICAgICAgICAgdmVyc2lvbjogcmRzLkF1cm9yYU15c3FsRW5naW5lVmVyc2lvbi5WRVJfM18wOF8yLFxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIHBhcmFtZXRlciBncm91cCBmb3IgaW5zdGFuY2VzXG4gICAgICAgIGNvbnN0IGluc3RhbmNlUGFyYW1ldGVyR3JvdXAgPSBuZXcgcmRzLlBhcmFtZXRlckdyb3VwKHRoaXMsIGAke2RhdGFiYXNlfS1NeVNRTEluc3RhbmNlUGFyYW1ldGVyR3JvdXBgLCB7XG4gICAgICAgICAgZW5naW5lOiByZHMuRGF0YWJhc2VDbHVzdGVyRW5naW5lLmF1cm9yYU15c3FsKHtcbiAgICAgICAgICAgIHZlcnNpb246IHJkcy5BdXJvcmFNeXNxbEVuZ2luZVZlcnNpb24uVkVSXzNfMDhfMixcbiAgICAgICAgICB9KVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDcmVhdGUgZGF0YWJhc2UgY3JlZGVudGlhbHNcbiAgICAgICAgY29uc3QgY3JlZGVudGlhbHMgPSByZHMuQ3JlZGVudGlhbHMuZnJvbUdlbmVyYXRlZFNlY3JldCgnbXlzcWxhZG1pbicsIHtcbiAgICAgICAgICBzZWNyZXROYW1lOiBgJHtkYXRhYmFzZX0tbXlzcWwtdjItY3JlZGVudGlhbHNgLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDcmVhdGUgdGhlIEF1cm9yYSBTZXJ2ZXJsZXNzIHYyIE15U1FMIGNsdXN0ZXJcbiAgICAgICAgY29uc3QgY2x1c3RlciA9IG5ldyByZHMuRGF0YWJhc2VDbHVzdGVyKHRoaXMsIGAke2RhdGFiYXNlfS1NeVNRTENsdXN0ZXJgLCB7XG4gICAgICAgICAgZW5naW5lOiByZHMuRGF0YWJhc2VDbHVzdGVyRW5naW5lLmF1cm9yYU15c3FsKHtcbiAgICAgICAgICAgIHZlcnNpb246IHJkcy5BdXJvcmFNeXNxbEVuZ2luZVZlcnNpb24uVkVSXzNfMDhfMixcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBkZWZhdWx0RGF0YWJhc2VOYW1lOiAnYWlyb19idWlsZGVyJyxcbiAgICAgICAgICBjcmVkZW50aWFscyxcbiAgICAgICAgICBwYXJhbWV0ZXJHcm91cCxcbiAgICAgICAgICBzdG9yYWdlRW5jcnlwdGVkOiB0cnVlLFxuICAgICAgICAgIHN0b3JhZ2VFbmNyeXB0aW9uS2V5OiBrbXMuS2V5LmZyb21LZXlBcm4odGhpcywgYCR7ZGF0YWJhc2V9LU15U1FMS01TS2V5YCwgdGhpcy5nZFRydXN0ZWRMYW5kaW5nWm9uZS5hY2NvdW50SW5mby5rbXMuY21rQXJuKSxcbiAgICAgICAgICB3cml0ZXI6IHJkcy5DbHVzdGVySW5zdGFuY2Uuc2VydmVybGVzc1YyKCd3cml0ZXInLCB7XG4gICAgICAgICAgICBwdWJsaWNseUFjY2Vzc2libGU6IGZhbHNlLFxuICAgICAgICAgICAgcGFyYW1ldGVyR3JvdXA6IGluc3RhbmNlUGFyYW1ldGVyR3JvdXAsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgcmVhZGVyczogQXJyYXkuZnJvbSh7IGxlbmd0aDogY29uZmlnLm15c3FsUmVhZGVyc0NvdW50IH0sIChuLCBpKSA9PiBpKS5tYXAoaSA9PiByZHMuQ2x1c3Rlckluc3RhbmNlLnNlcnZlcmxlc3NWMihgcmVhZGVyLSR7aSArIDF9YCwge1xuICAgICAgICAgICAgcHVibGljbHlBY2Nlc3NpYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVuYWJsZVBlcmZvcm1hbmNlSW5zaWdodHM6IHRydWUsXG4gICAgICAgICAgICBwZXJmb3JtYW5jZUluc2lnaHRSZXRlbnRpb246IHJkcy5QZXJmb3JtYW5jZUluc2lnaHRSZXRlbnRpb24uREVGQVVMVCxcbiAgICAgICAgICAgIGluc3RhbmNlSWRlbnRpZmllcjogYCR7ZGF0YWJhc2V9LW15c3FsLXYyLXJlYWRlci0ke2kgKyAxfWAsXG4gICAgICAgICAgICBzY2FsZVdpdGhXcml0ZXI6IGkgPT09IDAsXG4gICAgICAgICAgICBwYXJhbWV0ZXJHcm91cDogaW5zdGFuY2VQYXJhbWV0ZXJHcm91cFxuICAgICAgICB9KSksXG4gICAgICAgICAgc2VydmVybGVzc1YyTWluQ2FwYWNpdHk6IGNvbmZpZy5zZXJ2ZXJsZXNzVjJNaW5DYXBhY2l0eSxcbiAgICAgICAgICBzZXJ2ZXJsZXNzVjJNYXhDYXBhY2l0eTogY29uZmlnLnNlcnZlcmxlc3NWMk1heENhcGFjaXR5LFxuICAgICAgICAgIGJhY2t1cDoge1xuICAgICAgICAgICAgcmV0ZW50aW9uOiBjZGsuRHVyYXRpb24uZGF5cyhjb25maWcuYmFja3VwUmV0ZW50aW9uRGF5cyksXG4gICAgICAgICAgICBwcmVmZXJyZWRXaW5kb3c6ICcwMzowMC0wNDowMCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBjbHVzdGVySWRlbnRpZmllcjogYCR7ZGF0YWJhc2V9LW15c3FsLXYyLWNsdXN0ZXJgLFxuICAgICAgICAgIGNsb3Vkd2F0Y2hMb2dzRXhwb3J0czogWydhdWRpdCcsICdnZW5lcmFsJywgJ2Vycm9yJywgJ3Nsb3dxdWVyeSddLFxuICAgICAgICAgIGNsb3Vkd2F0Y2hMb2dzUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICAgICAgZW5hYmxlUGVyZm9ybWFuY2VJbnNpZ2h0czogdHJ1ZSxcbiAgICAgICAgICBwZXJmb3JtYW5jZUluc2lnaHRSZXRlbnRpb246IHJkcy5QZXJmb3JtYW5jZUluc2lnaHRSZXRlbnRpb24uREVGQVVMVCxcbiAgICAgICAgICB2cGMsXG4gICAgICAgICAgc3VibmV0R3JvdXAsXG4gICAgICAgICAgc2VjdXJpdHlHcm91cHM6IFtteXNxbFNlY3VyaXR5R3JvdXBdLFxuICAgICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY2x1c3Rlci5ub2RlLmFkZERlcGVuZGVuY3kocGFyYW1ldGVyR3JvdXApO1xuICAgICAgICBjbHVzdGVyLm5vZGUuYWRkRGVwZW5kZW5jeShpbnN0YW5jZVBhcmFtZXRlckdyb3VwKTtcbiAgICAgICAgY2x1c3Rlci5ub2RlLmFkZERlcGVuZGVuY3koc3VibmV0R3JvdXApO1xuICAgICAgICBjbHVzdGVyLm5vZGUuYWRkRGVwZW5kZW5jeShteXNxbFNlY3VyaXR5R3JvdXApO1xuXG4gICAgICAgIHRoaXMuY2x1c3RlcnMucHVzaChjbHVzdGVyKTtcbiAgICAgICAgY2RrLlRhZ3Mub2YoY2x1c3RlcikuYWRkKCdhbGxvd1NodXRkb3duRm9yQ29zdE9wdGltaXphdGlvbicsICdmYWxzZScpO1xuICAgICAgfSlcbiAgICB9XG5cbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoXCJhbGxvd1NodXRkb3duRm9yQ29zdE9wdGltaXphdGlvblwiLCBcImZhbHNlXCIpO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIHRoaXMuY2x1c3RlcnMuZm9yRWFjaCgoY2x1c3RlciwgaW5kZXgpID0+IHtcbiAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIGAke2NvbmZpZy5kYXRhYmFzZXNbaW5kZXhdfS1NeVNRTFYyQ2x1c3RlckVuZHBvaW50YCwge1xuICAgICAgICB2YWx1ZTogY2x1c3Rlci5jbHVzdGVyRW5kcG9pbnQuaG9zdG5hbWUsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBgWyR7Y29uZmlnLmRhdGFiYXNlc1tpbmRleF19XSBNeVNRTCBBdXJvcmEgVjIgY2x1c3RlciBlbmRwb2ludGAsXG4gICAgICAgIGV4cG9ydE5hbWU6IGBteXNxbC12Mi1lbmRwb2ludC0ke2NvbmZpZy5kYXRhYmFzZXNbaW5kZXhdfWAsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG59XG4iXX0=