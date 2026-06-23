import { describe, it, expect } from 'vitest';
import { addUserTableScenario } from '../add-user-table.js';
import { crudApiHandlerScenario } from '../crud-api-handler.js';
import { noReturningScenario } from '../no-returning.js';
import { foreignKeyRelationshipScenario } from '../foreign-key-relationship.js';
import { noRawSqlClientScenario } from '../no-raw-sql-client.js';
import { schemaEvolutionScenario } from '../schema-evolution.js';
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from '../../../../scenarios/__tests__/scenario-test-helpers.js';

const mockGocode = makeGocodeClient();
const mockCtrlPlane = makeCtrlPlaneClient();

const REQUIRED_EVALUATORS = [
  'bug-hit-rate',
  'tool-failure-rate',
  'prompt-efficiency',
  'tool-call-verification',
  'jtbd-completion',
  'tool-parallelism',
  'turn-duration',
  'token-usage',
  'llm-cost',
];

describe('database suite scenarios', () => {
  describe('database-add-user-table', () => {
    const scenario = addUserTableScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('database-add-user-table');
      expect(scenario.suite).toBe('database');
    });

    it('has 5 goals', () => {
      expect(scenario.goals).toHaveLength(5);
      expect(
        scenario.goals.every((g) => g.description.length > 0),
      ).toBe(true);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects skill and database__listTables tool calls', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'skill', called: true }),
      );
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'database__listTables', called: true }),
      );
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });

    it('uses a static first message', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('user accounts');
    });
  });

  describe('database-crud-api-handler', () => {
    const scenario = crudApiHandlerScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('database-crud-api-handler');
      expect(scenario.suite).toBe('database');
    });

    it('has 6 goals', () => {
      expect(scenario.goals).toHaveLength(6);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });

    it('uses a static first message about products', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('products');
    });
  });

  describe('database-no-returning', () => {
    const scenario = noReturningScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('database-no-returning');
      expect(scenario.suite).toBe('database');
    });

    it('has 3 goals', () => {
      expect(scenario.goals).toHaveLength(3);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('uses a static first message about returning created user', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('returns the created user');
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('database-foreign-key-relationship', () => {
    const scenario = foreignKeyRelationshipScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('database-foreign-key-relationship');
      expect(scenario.suite).toBe('database');
    });

    it('has 5 goals', () => {
      expect(scenario.goals).toHaveLength(5);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('uses a static first message about blog posts and authors', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('blog');
      expect(scenario.staticFirstMessage).toContain('authors');
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('database-no-raw-sql-client', () => {
    const scenario = noRawSqlClientScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('database-no-raw-sql-client');
      expect(scenario.suite).toBe('database');
    });

    it('uses a static first message mentioning mysql2', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('mysql2');
    });

    it('has 4 goals', () => {
      expect(scenario.goals).toHaveLength(4);
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('database-schema-evolution', () => {
    const scenario = schemaEvolutionScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('database-schema-evolution');
      expect(scenario.suite).toBe('database');
    });

    it('has 5 goals', () => {
      expect(scenario.goals).toHaveLength(5);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects skill and database__getSchema tool calls', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'skill', called: true }),
      );
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'database__getSchema', called: true }),
      );
    });

    it('uses a static first message about adding columns', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('avatar_url');
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });
});
