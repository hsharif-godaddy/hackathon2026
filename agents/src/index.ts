// Core exports
export * from './base/index.js';
export * from './registry/index.js';
export * from './agents/index.js';
export * from './tools/index.js';

// Server exports (optional - for programmatic use)
export * from './server/app.js';
export * from './server/middleware/index.js';

// Eval/tooling support: chat-upload classifier (placementIntent accuracy evals)
export { classifyUploadImage, type UploadClassification } from './services/renderers/FileUploadContextRenderer.js';
