# KnowB Knowledge Base

KnowB is GoDaddy's internal knowledge base service used for RAG (Retrieval-Augmented Generation) operations.

## Environment Configuration

### Certificates (AWS Secrets Manager)

| Environment | Certificate Secret                                       | Key Secret                                               |
| ----------- | -------------------------------------------------------- | -------------------------------------------------------- |
| **TEST**    | `getty.airo-builder.test.authclient.int.godaddy.com.crt` | `getty.airo-builder.test.authclient.int.godaddy.com.key` |
| **PROD**    | `getty.airo-builder.authclient.int.godaddy.com.crt`      | `getty.airo-builder.authclient.int.godaddy.com.key`      |

### API Endpoints

| Environment | KnowB API                                | SSO Endpoint                                       |
| ----------- | ---------------------------------------- | -------------------------------------------------- |
| **TEST**    | `https://knowb.api.int.test-godaddy.com` | `https://sso.test-godaddy.com/v1/secure/api/token` |
| **PROD**    | `https://knowb.api.int.godaddy.com`      | `https://sso.godaddy.com/v1/secure/api/token`      |

## Upload

### KB Strategy Options

| Strategy               | Description                                                            |
| ---------------------- | ---------------------------------------------------------------------- |
| `KNOWB002`             | No chunking, keeps document as single unit (recommended for retrieval) |
| `KNOWBAOSSSEMANTIC300` | Semantic chunking into smaller pieces                                  |

**Recommendation:** Use `KNOWB002` for documents that should be retrieved as complete units.

### GitHub Actions Upload

The `knowledge_base.yml` workflow uploads markdown files from `knowledge-base/` directory:

## Search

### Default Configuration

- **KB Node ID:** `/airo_info`
- **Max Results:** 5
- **Score Threshold:** 0.35

### Usage

```typescript
import { knowBDriver } from "./tools/ai-lib-tools/drivers/knowb-driver";

const result = await knowBDriver.search({
  query: "How do I deploy an application?",
  kbNodeIds: ["/airo_info"],
  maxResults: 5,
  scoreThreshold: 0.35,
});

if (result.success) {
  const markdown = knowBDriver.formatResultsAsMarkdown(result.results);
}
```

### Authentication

- **Hosted (S2S):** Set `GOCODE_USE_S2S_AUTH=true` (uses gd-auth-client)
- **Local:** Set `SSO_JWT` environment variable
