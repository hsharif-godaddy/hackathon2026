# Image Search

## Getty Images Integration

The image search tool provides professional stock photos using the Getty Images API for licensed commercial imagery.

### Configuration

Requires the following environment variables:

- `SSO_JWT` - JWT token for authentication
- `GETTY_API_URL` - Getty Images API endpoint
- `GETTY_APP_KEY` - Getty application key

### Implementation

The `ImageSearchTool` class provides a unified interface for searching images using the Getty Images driver. It supports:

- Single image searches
- Multiple images per search
- Parallel searches with multiple prompts
- Configurable result counts

### Getty Image Tool (`GettyImageTool`)

The underlying Getty API integration is implemented in `GettyImageTool`. This is used internally by `ImageSearchTool` and should not be used directly by LLM agents.
