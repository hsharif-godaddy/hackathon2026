// Export new AgentFactory-based agents
export * from './color-scheme-agent.js';
export * from './commerce-agent.js';
export * from './database-agent.js';
export * from './design-agent.js';
export * from './develop-agent.js';
export * from './example-agent.js';
export * from './marketing-agent.js';
export * from './initial-agent.js';

// Export agent factory creation functions
export {
  createColorSchemeAgent,
  createColorSchemeAgentFactory,
  ColorSchemeAgent
} from './color-scheme-agent.js';

export {
  createCommerceAgent,
  createCommerceAgentFactory,
  CommerceAgent
} from './commerce-agent.js';

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

export {
  createMarketingAgent,
  createMarketingAgentFactory,
  MarketingAgent
} from './marketing-agent.js';
