# AWS Bedrock Examples

This directory contains examples for using AWS Bedrock with the AI Library, including both embeddings and image generation.

## Prerequisites

### Installation
```bash
npm install @ai-sdk/amazon-bedrock
```

### AWS Credentials
Set up your AWS credentials using one of these methods:

#### Option 1: Environment Variables
```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-east-1
```

#### Option 2: AWS Credentials File
```bash
aws configure
```

#### Option 3: IAM Roles (when running on AWS)
No additional setup needed if your EC2 instance or Lambda function has the appropriate IAM role.

### Required AWS Permissions
Your AWS credentials need access to Bedrock services:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream"
            ],
            "Resource": "*"
        }
    ]
}
```

## Examples

### 1. Bedrock Embeddings (`bedrock-embeddings.ts`)

Demonstrates how to:
- Generate embeddings using Amazon Titan Embed Text V2
- Calculate cosine similarity between embeddings
- Analyze text similarity relationships
- Handle both single and multiple text inputs

**Run:** `npm run example:bedrock-embeddings`

**Key Features:**
- Uses Amazon Titan Embed Text V2 model
- Supports up to 1536 dimensions
- Includes similarity analysis
- Shows token usage information

### 2. Bedrock Image Generation (`bedrock-image-generation.ts`)

Demonstrates how to:
- Generate images using Amazon Titan Image Generator
- Generate images using Stability AI SDXL
- Save generated images to files
- Handle different image generation models

**Run:** `npm run example:bedrock-images`

**Key Features:**
- Multiple model support (Titan, Stability AI)
- Base64 image handling and file saving
- Different image sizes and configurations
- Batch image generation

## Available Bedrock Models

### Text Generation Models
- `anthropic.claude-3-sonnet-20240229-v1:0` - Claude 3 Sonnet
- `anthropic.claude-3-haiku-20240307-v1:0` - Claude 3 Haiku
- `anthropic.claude-3-5-sonnet-20241022-v2:0` - Claude 3.5 Sonnet

### Embedding Models
- `amazon.titan-embed-text-v1` - Amazon Titan Embed Text V1
- `amazon.titan-embed-text-v2:0` - Amazon Titan Embed Text V2
- `cohere.embed-english-v3` - Cohere English Embeddings
- `cohere.embed-multilingual-v3` - Cohere Multilingual Embeddings

### Image Generation Models
- `amazon.titan-image-generator-v1` - Amazon Titan Image Generator
- `stability.stable-diffusion-xl-v1` - Stability AI SDXL

## Usage Examples

### Basic Embeddings
```typescript
import { Agent, bedrockModels } from '@airo/ai-lib'

const agent = new Agent({
  name: 'Embedding Agent',
  systemPrompt: 'You are an embedding agent.',
  model: bedrockModels.titanEmbedTextV2(),
  temperature: 0
})

const result = await agent.generateEmbeddings([
  'Hello world',
  'How are you?'
], {
  dimensions: 1536
})

console.log(`Generated ${result.embeddings.length} embeddings`)
```

### Basic Image Generation
```typescript
import { Agent, bedrockModels } from '@airo/ai-lib'

const agent = new Agent({
  name: 'Image Agent',
  systemPrompt: 'You are an image generation agent.',
  model: bedrockModels.titanImage(),
  temperature: 0
})

const result = await agent.generateImage({
  prompt: 'A beautiful sunset over mountains',
  size: '1024x1024',
  n: 1
})

console.log(`Generated ${result.images.length} images`)
```

## Troubleshooting

### Common Issues

1. **Missing @ai-sdk/amazon-bedrock package**
   ```
   Error: AWS Bedrock provider requires @ai-sdk/amazon-bedrock package
   ```
   **Solution:** Run `npm install @ai-sdk/amazon-bedrock`

2. **AWS Credentials not found**
   ```
   Error: Unable to load AWS credentials
   ```
   **Solution:** Set up AWS credentials using one of the methods above

3. **Model access denied**
   ```
   Error: Access denied to model
   ```
   **Solution:** Request access to the specific Bedrock models in your AWS console

4. **Region issues**
   ```
   Error: Model not available in region
   ```
   **Solution:** Use a supported region (us-east-1, us-west-2, etc.)

### Getting Help

- Check the [AWS Bedrock documentation](https://docs.aws.amazon.com/bedrock/)
- Verify model availability in your region
- Ensure proper IAM permissions
- Check the AI SDK documentation for additional configuration options

## Cost Considerations

- Embedding models charge per input token
- Image generation models charge per image generated
- Different models have different pricing tiers
- Monitor your AWS Bedrock usage in the AWS console

Refer to [AWS Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/) for current rates.
