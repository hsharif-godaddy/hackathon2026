import { describe, it, expect, beforeEach } from 'vitest'
import { AgentFactory, createAgentFactory, defaultAgentFactory } from '../core/agent-factory.js'
import { Agent } from '../core/agent.js'
import type { AgentConfig } from '../core/types.js'

describe('AgentFactory', () => {
  let factory: AgentFactory

  beforeEach(() => {
    factory = new AgentFactory()
  })

  describe('Agent Definition', () => {
    it('should define and retrieve single agent', () => {
      const config: AgentConfig = {
        name: 'Test Agent',
        systemPrompt: 'You are helpful.',
        model: 'gpt-4o'
      }

      const agents = factory.defineAgents({
        testAgent: config
      })

      expect(agents.get('testAgent')).toBeInstanceOf(Agent)
      expect(agents.get('testAgent').getConfig().name).toBe('Test Agent')
    })

    it('should define multiple agents', () => {
      const configs = {
        agent1: {
          name: 'Agent 1',
          systemPrompt: 'First agent'
        },
        agent2: {
          name: 'Agent 2', 
          systemPrompt: 'Second agent'
        }
      }

      const agents = factory.defineAgents(configs)

      expect(agents.get('agent1')).toBeInstanceOf(Agent)
      expect(agents.get('agent2')).toBeInstanceOf(Agent)
      expect(agents.get('agent1').getConfig().name).toBe('Agent 1')
      expect(agents.get('agent2').getConfig().name).toBe('Agent 2')
    })

    it('should throw error for undefined agent', () => {
      const agents = factory.defineAgents({
        testAgent: { name: 'Test' }
      })

      expect(() => agents.get('nonexistent' as any)).toThrow('Agent config not found for id: nonexistent')
    })

    it('should list available agent keys', () => {
      const agents = factory.defineAgents({
        agent1: { name: 'Agent 1' },
        agent2: { name: 'Agent 2' },
        agent3: { name: 'Agent 3' }
      })

      const keys = agents.list()
      expect(keys).toEqual(['agent1', 'agent2', 'agent3'])
    })

    it('should check if agent exists', () => {
      const agents = factory.defineAgents({
        testAgent: { name: 'Test' }
      })

      expect(agents.has('testAgent')).toBe(true)
      expect(agents.has('nonexistent' as any)).toBe(false)
    })
  })

  describe('Global Configuration', () => {
    it('should apply global config to agents', () => {
      factory.updateGlobalConfig({
        defaultModel: 'global-model',
        defaultTemperature: 0.5,
        defaultMaxTokens: 1500
      })

      const agents = factory.defineAgents({
        testAgent: {
          name: 'Test Agent',
          systemPrompt: 'Test prompt'
        }
      })

      const config = agents.get('testAgent').getConfig()
      expect(config.model).toBe('global-model')
      expect(config.temperature).toBe(0.5)
      expect(config.maxTokens).toBe(1500)
    })

    it('should allow agent-specific overrides', () => {
      factory.updateGlobalConfig({
        defaultModel: 'global-model',
        defaultTemperature: 0.5
      })

      const agents = factory.defineAgents({
        testAgent: {
          name: 'Test Agent',
          systemPrompt: 'Test prompt',
          temperature: 0.8, // Override global
          model: 'agent-specific-model' // Override global
        }
      })

      const config = agents.get('testAgent').getConfig()
      expect(config.model).toBe('agent-specific-model')
      expect(config.temperature).toBe(0.8)
    })

    it('should merge global and agent configs correctly', () => {
      factory.updateGlobalConfig({
        defaultModel: 'global-model',
        defaultTemperature: 0.5,
        defaultMaxTokens: 1000
      })

      const agents = factory.defineAgents({
        testAgent: {
          name: 'Test Agent',
          systemPrompt: 'Test prompt',
          temperature: 0.8 // Only override temperature
        }
      })

      const config = agents.get('testAgent').getConfig()
      expect(config.model).toBe('global-model') // From global
      expect(config.temperature).toBe(0.8) // From agent
      expect(config.maxTokens).toBe(1000) // From global
      // enableLoopControl defaults to false since it's not in global config
    })
  })

  describe('Agent Registry', () => {
    it('should track agents within same definition', () => {
      const agents = factory.defineAgents({
        agent1: { name: 'Agent 1' },
        agent2: { name: 'Agent 2' }
      })

      expect(agents.has('agent1')).toBe(true)
      expect(agents.has('agent2')).toBe(true)
      expect(agents.list()).toEqual(['agent1', 'agent2'])
    })

    it('should allow access to defined agents', () => {
      const agents = factory.defineAgents({
        agent1: { name: 'Agent 1' },
        agent2: { name: 'Agent 2' }
      })

      expect(agents.get('agent1')).toBeInstanceOf(Agent)
      expect(agents.get('agent2')).toBeInstanceOf(Agent)
    })
  })

  describe('Factory Functions', () => {
    it('should create factory via createAgentFactory', () => {
      const customFactory = createAgentFactory({
        defaultModel: 'custom-model',
        defaultTemperature: 0.3
      })

      const agents = customFactory.defineAgents({
        testAgent: { name: 'Test' }
      })

      const config = agents.get('testAgent').getConfig()
      expect(config.model).toBe('custom-model')
      expect(config.temperature).toBe(0.3)
    })

    it('should use default factory', () => {
      const agents = defaultAgentFactory.defineAgents({
        testAgent: { name: 'Test' }
      })

      expect(agents.get('testAgent')).toBeInstanceOf(Agent)
    })
  })

  describe('Error Handling', () => {
    it('should throw error for missing agent config', () => {
      const agents = factory.defineAgents({})
      
      expect(() => agents.get('missing' as never)).toThrow('Agent config not found for id: missing')
    })

    it('should handle empty agent definitions', () => {
      const agents = factory.defineAgents({})
      
      expect(agents.list()).toEqual([])
      expect(agents.has('anything' as never)).toBe(false)
    })
  })

  describe('Configuration Defaults', () => {
    it('should apply sensible defaults when no global config set', () => {
      const agents = factory.defineAgents({
        testAgent: { name: 'Test' }
      })

      const config = agents.get('testAgent').getConfig()
      expect(config.model).toBe('gpt-4o')
      expect(config.temperature).toBe(0.7)
      expect(config.maxTokens).toBe(2000)
      expect(config.enableLoopControl).toBe(false)
    })
  })
})
