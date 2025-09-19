// Export new ExperimentalAgentFactory-based agents
export * from './example-agent.js';
export * from './develop-agent.js';
export * from './database-agent.js';
export * from './color-scheme-agent.js';

// Export agent factory creation functions
export { 
  createExampleAgent, 
  createExampleAgentFactory,
  ExampleAgent 
} from './example-agent.js';

export { 
  createDevelopAgent, 
  createDevelopAgentFactory,
  DevelopAgent 
} from './develop-agent.js';

export { 
  createDatabaseAgent, 
  createDatabaseAgentFactory,
  DatabaseAgent 
} from './database-agent.js';

export { 
  createColorSchemeAgent, 
  createColorSchemeAgentFactory,
  ColorSchemeAgent 
} from './color-scheme-agent.js';
