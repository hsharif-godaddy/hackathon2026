# CDK Stack Documentation

This directory contains architecture and deployment documentation for each CDK stack.

## Stacks

| Stack                 | Environments | Description                                          |
| --------------------- | ------------ | ---------------------------------------------------- |
| [Qdrant](./qdrant.md) | dev, prod    | 3-node Qdrant vector database cluster on ECS Fargate |

## Documentation Template

When adding a new stack, create `{stack-name}.md` with the following sections:

1. **Overview** - Purpose, environments, source files
2. **Architecture** - ASCII diagram showing components and data flow
3. **Components** - Detailed breakdown of AWS resources created
4. **Configuration** - Environment-specific settings from `config.ts`
5. **Deployment** - Step-by-step deployment instructions
6. **Operations** - Health checks, scaling, common commands
7. **Troubleshooting** - Common issues and solutions
8. **Security** - Network access, authentication, compliance notes
9. **Stack Outputs** - CloudFormation exports and their usage
10. **Related Files** - Links to source code, Dockerfiles, CI/CD workflows
