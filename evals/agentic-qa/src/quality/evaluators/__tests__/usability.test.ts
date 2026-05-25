import assume from 'assume';
import { describe, it } from 'node:test';

import { evaluate } from '../usability.js';

describe('usability', function packageTests() {
  describe('#evaluate', function evaluateTests() {
    it('should return default score when no screenshots provided', async function noScreenshots() {
      const result = await evaluate({});
      assume(result.success).is.true();
      assume(result.data!.score).equals(70);
      assume(result.data!.issues).has.length(0);
      assume(result.data!.heuristics.h1).equals(1);
      assume(result.data!.heuristics.h10).equals(1);
    });

    it('should return default score when no API key provided', async function noApiKey() {
      const result = await evaluate({
        screenshots: [{ path: '/tmp/screenshot.png', type: 'preview' }],
      });
      assume(result.success).is.true();
      assume(result.data!.score).equals(70);
    });

    it('should return default score when screenshots array is empty', async function emptyScreenshots() {
      const result = await evaluate({
        screenshots: [],
        anthropicApiKey: 'test-key',
      });
      assume(result.success).is.true();
      assume(result.data!.score).equals(70);
    });

    it('should have all 10 heuristics in default score', async function defaultHeuristics() {
      const result = await evaluate({});
      assume(result.success).is.true();
      const h = result.data!.heuristics;
      assume(h.h1).is.a('number');
      assume(h.h2).is.a('number');
      assume(h.h3).is.a('number');
      assume(h.h4).is.a('number');
      assume(h.h5).is.a('number');
      assume(h.h6).is.a('number');
      assume(h.h7).is.a('number');
      assume(h.h8).is.a('number');
      assume(h.h9).is.a('number');
      assume(h.h10).is.a('number');
    });

    it('should include duration in result', async function duration() {
      const result = await evaluate({});
      assume(result.success).is.true();
      assume(result.duration).is.a('number');
      assume(result.duration).is.least(0);
    });
  });
});
