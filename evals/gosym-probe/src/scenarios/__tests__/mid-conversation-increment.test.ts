import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  midConversationIncrementScenario,
  MID_CONVERSATION_SUITE,
} from '../mid-conversation-increment.js';
import { makeGocodeClient, makeCtrlPlaneClient } from './scenario-test-helpers.js';
import type { Config } from '../../../config/environments/types.js';

function makeConfig(): Config {
  return {
    env: 'local.test',
    aab: {
      agentsUrl: 'https://local.gasket.dev-godaddy.com:4000',
      bffUrl: 'https://local',
      controlPlaneUrl: 'http://localhost:4100',
    },
  } as unknown as Config;
}

const FIXED_BASE_ENV = {
  EVAL_INCREMENT_APP_ID: 'prebuilt-app',
  EVAL_INCREMENT_PREVIEW_URL: 'https://preview/prebuilt',
  EVAL_INCREMENT_RESET_COMMIT: 'base-sha',
};

describe('midConversationIncrementScenario', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of Object.keys(FIXED_BASE_ENV)) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns null when the fixed-base env is not configured', () => {
    expect(
      midConversationIncrementScenario(makeGocodeClient(), makeCtrlPlaneClient(), makeConfig()),
    ).toBeNull();
  });

  it('returns null when only some of the fixed-base env is set', () => {
    process.env.EVAL_INCREMENT_APP_ID = 'prebuilt-app';
    expect(
      midConversationIncrementScenario(makeGocodeClient(), makeCtrlPlaneClient(), makeConfig()),
    ).toBeNull();
  });

  describe('when the fixed base is configured', () => {
    beforeEach(() => {
      Object.assign(process.env, FIXED_BASE_ENV);
    });

    it('builds a serial stateful scenario reusing the pinned base with seeded state', () => {
      const scenario = midConversationIncrementScenario(
        makeGocodeClient(), makeCtrlPlaneClient(), makeConfig(),
      );

      expect(scenario).not.toBeNull();
      expect(scenario!.name).toBe('mid-conversation-increment');
      expect(scenario!.suite).toBe(MID_CONVERSATION_SUITE);
      // Stateful injection shares one app across trials → must be serial.
      expect(scenario!.requiresSerialTrials).toBe(true);
      expect(scenario!.setup).toBeTypeOf('function');
    });

    it('throws if no agentsUrl is available to seed against', () => {
      expect(() =>
        midConversationIncrementScenario(
          makeGocodeClient(),
          makeCtrlPlaneClient(),
          { env: 'x', aab: { agentsUrl: '', bffUrl: '', controlPlaneUrl: '' } } as unknown as Config,
        ),
      ).toThrow(/agentsUrl/i);
    });
  });
});
