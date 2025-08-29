# Image Search Drivers

## Getty Images (`GettyImageSearchDriver`)

Getty Images provides professional stock photos and licensed imagery for commercial use, and is the only driver used for production since it serves licensed images.

## OpenAI Image Search (`OpenAIImageSearchDriver`)

OpenAI Image Search uses OpenAI's web search capabilities to find images from across the internet, but is experimental with performance issues and concerns about its ability to return images with safe licenses.

## Unsplash (`UnsplashImageSearchDriver`)

Unsplash provides stock photos through their API with file-based caching, but is just for use in development and as a comparison point with Getty - it is not planned to be a production driver since we already have a contract with Getty.

## Getty Image Tool (`GettyImageTool`)

Do not use directly, we are only exposing a single configurable tool to the LLM

