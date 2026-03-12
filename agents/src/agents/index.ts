// Export new AgentFactory-based agents
export * from './design-agent.js';
export * from './develop-agent.js';
export * from './example-agent.js';
export * from './marketing-agent.js';
export * from './initial-agent.js';

// Export agent factory creation functions

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
