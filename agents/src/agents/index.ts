// Export new ExperimentalAgentFactory-based agents
export * from './color-scheme-agent.js';
export * from './database-agent.js';
export * from './design-agent.js';
export * from './develop-agent.js';
export * from './example-agent.js';

// Export agent factory creation functions
export {
  createColorSchemeAgent,
  createColorSchemeAgentFactory,
  ColorSchemeAgent
} from './color-scheme-agent.js';

export {
  createDatabaseAgent,
  createDatabaseAgentFactory,
  DatabaseAgent
} from './database-agent.js';

export {
  createDesignAgent,
  createDesignAgentFactory,
  DesignAgent
} from './design-agent.js';

export {
  createDevelopAgent,
  createDevelopAgentFactory,
  DevelopAgent
} from './develop-agent.js';

export {
  createExampleAgent,
  createExampleAgentFactory,
  ExampleAgent
} from './example-agent.js';
