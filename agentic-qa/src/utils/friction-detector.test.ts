import assume from 'assume';
import { describe, it } from 'node:test';

import { detectFriction, _detectors } from './friction-detector.js';
import type { OrderedObservation } from './langfuse.js';

// Helper to create a minimal ordered observation
function obs(
  index: number,
  overrides: Partial<OrderedObservation> = {}
): OrderedObservation {
  return {
    index,
    id: `obs-${index}`,
    traceId: 't1',
    type: 'SPAN',
    startTime: new Date(1700000000000 + index * 10000).toISOString(),
    ...overrides,
  };
}

function editObs(index: number, error = false): OrderedObservation {
  return obs(index, {
    name: 'str_replace_editor',
    level: error ? 'ERROR' : 'DEFAULT',
    statusMessage: error ? 'No match found for old_str' : undefined,
  });
}

function readObs(index: number, file?: string): OrderedObservation {
  return obs(index, {
    name: 'readFile',
    input: file ? { path: file } : undefined,
  });
}

function grepObs(index: number): OrderedObservation {
  return obs(index, { name: 'grep_search' });
}

function genObs(index: number, cost = 0.01): OrderedObservation {
  return obs(index, {
    type: 'GENERATION',
    name: undefined,
    model: 'gpt-4',
    usage: { input: 100, output: 50 },
    totalCost: cost,
  });
}

function errorSpan(index: number, name: string, msg?: string): OrderedObservation {
  return obs(index, {
    name,
    level: 'ERROR',
    statusMessage: msg ?? `${name} failed`,
  });
}

describe('friction-detector', function frictionDetectorTests() {

  describe('#detectEditLoops', function editLoopTests() {
    it('should detect 2 consecutive str_replace errors', function twoErrors() {
      const observations = [
        readObs(0),
        editObs(1, true),
        editObs(2, true),
        readObs(3),
      ];
      const patterns = _detectors.detectEditLoops(observations);
      assume(patterns).length(1);
      assume(patterns[0].type).equals('EDIT_LOOP');
      assume(patterns[0].count).equals(2);
      assume(patterns[0].startIndex).equals(1);
      assume(patterns[0].endIndex).equals(2);
    });

    it('should not detect when edit errors are non-consecutive', function nonConsecutive() {
      const observations = [
        editObs(0, true),
        readObs(1),
        editObs(2, true),
      ];
      const patterns = _detectors.detectEditLoops(observations);
      assume(patterns).length(0);
    });

    it('should detect multiple edit loop instances', function multipleLoops() {
      const observations = [
        editObs(0, true),
        editObs(1, true),
        readObs(2),
        editObs(3, true),
        editObs(4, true),
        editObs(5, true),
      ];
      const patterns = _detectors.detectEditLoops(observations);
      assume(patterns).length(2);
      assume(patterns[0].count).equals(2);
      assume(patterns[1].count).equals(3);
    });

    it('should mark severity as high for 4+ consecutive errors', function highSeverity() {
      const observations = [
        editObs(0, true),
        editObs(1, true),
        editObs(2, true),
        editObs(3, true),
      ];
      const patterns = _detectors.detectEditLoops(observations);
      assume(patterns).length(1);
      assume(patterns[0].severity).equals('high');
    });
  });

  describe('#detectGrepSpirals', function grepSpiralTests() {
    it('should detect 4 consecutive searches without edit', function fourSearches() {
      const observations = [
        grepObs(0),
        grepObs(1),
        grepObs(2),
        grepObs(3),
      ];
      const patterns = _detectors.detectGrepSpirals(observations);
      assume(patterns).length(1);
      assume(patterns[0].type).equals('GREP_SPIRAL');
      assume(patterns[0].count).equals(4);
    });

    it('should not trigger when edit breaks the streak', function editBreaks() {
      const observations = [
        grepObs(0),
        grepObs(1),
        grepObs(2),
        editObs(3, false),
        grepObs(4),
      ];
      const patterns = _detectors.detectGrepSpirals(observations);
      assume(patterns).length(0);
    });

    it('should not count fewer than 4 searches', function belowThreshold() {
      const observations = [
        grepObs(0),
        grepObs(1),
        grepObs(2),
      ];
      const patterns = _detectors.detectGrepSpirals(observations);
      assume(patterns).length(0);
    });

    it('should ignore non-tool observations in between', function ignoresGenerations() {
      const observations = [
        grepObs(0),
        genObs(1),
        grepObs(2),
        grepObs(3),
        genObs(4),
        grepObs(5),
      ];
      const patterns = _detectors.detectGrepSpirals(observations);
      assume(patterns).length(1);
      assume(patterns[0].count).equals(4);
    });
  });

  describe('#detectReadSpirals', function readSpiralTests() {
    it('should detect same file read 4 times in 6 observations', function sameFile4() {
      const observations = [
        readObs(0, '/app/src/App.tsx'),
        readObs(1, '/app/src/App.tsx'),
        readObs(2, '/app/src/App.tsx'),
        genObs(3),
        readObs(4, '/app/src/App.tsx'),
        genObs(5),
      ];
      const patterns = _detectors.detectReadSpirals(observations);
      assume(patterns).length(1);
      assume(patterns[0].type).equals('READ_SPIRAL');
      assume(patterns[0].count).equals(4);
    });

    it('should not trigger when edit is present in window', function editInWindow() {
      const observations = [
        readObs(0, '/app/src/App.tsx'),
        readObs(1, '/app/src/App.tsx'),
        editObs(2, false),
        readObs(3, '/app/src/App.tsx'),
        readObs(4, '/app/src/App.tsx'),
        genObs(5),
      ];
      const patterns = _detectors.detectReadSpirals(observations);
      assume(patterns).length(0);
    });

    it('should not trigger for different files', function differentFiles() {
      const observations = [
        readObs(0, '/app/src/A.tsx'),
        readObs(1, '/app/src/B.tsx'),
        readObs(2, '/app/src/C.tsx'),
        readObs(3, '/app/src/D.tsx'),
        genObs(4),
        genObs(5),
      ];
      const patterns = _detectors.detectReadSpirals(observations);
      assume(patterns).length(0);
    });
  });

  describe('#detectNoProgressLoops', function noProgressTests() {
    it('should detect 4 consecutive generations with no tool calls', function noTools() {
      const observations = [
        genObs(0),
        genObs(1),
        genObs(2),
        genObs(3),
      ];
      const patterns = _detectors.detectNoProgressLoops(observations);
      assume(patterns).length(1);
      assume(patterns[0].type).equals('NO_PROGRESS_LOOP');
    });

    it('should not trigger when tool calls are present', function withTools() {
      const observations = [
        genObs(0),
        readObs(1),
        genObs(2),
        readObs(3),
        genObs(4),
        readObs(5),
      ];
      const patterns = _detectors.detectNoProgressLoops(observations);
      assume(patterns).length(0);
    });
  });

  describe('#detectRedundantExploration', function redundantTests() {
    it('should detect 3+ reads after last successful edit', function afterEdit() {
      const observations = [
        readObs(0),
        editObs(1, false),
        readObs(2),
        grepObs(3),
        readObs(4),
      ];
      const patterns = _detectors.detectRedundantExploration(observations);
      assume(patterns).length(1);
      assume(patterns[0].type).equals('REDUNDANT_EXPLORATION');
      assume(patterns[0].count).equals(3);
    });

    it('should not trigger with fewer than 3 post-edit reads', function fewReads() {
      const observations = [
        editObs(0, false),
        readObs(1),
        readObs(2),
      ];
      const patterns = _detectors.detectRedundantExploration(observations);
      assume(patterns).length(0);
    });

    it('should not trigger if no successful edit exists', function noEdit() {
      const observations = [
        readObs(0),
        readObs(1),
        readObs(2),
        readObs(3),
      ];
      const patterns = _detectors.detectRedundantExploration(observations);
      assume(patterns).length(0);
    });
  });

  describe('#detectErrorLoops', function errorLoopTests() {
    it('should detect 3 consecutive tool errors with same signature', function threeErrors() {
      const observations = [
        errorSpan(0, 'readFile', 'not found'),
        errorSpan(1, 'readFile', 'not found'),
        errorSpan(2, 'readFile', 'not found'),
      ];
      const patterns = _detectors.detectErrorLoops(observations);
      assume(patterns).length(1);
      assume(patterns[0].type).equals('ERROR_LOOP');
      assume(patterns[0].count).equals(3);
    });

    it('should not trigger for 2 consecutive errors', function twoErrors() {
      const observations = [
        errorSpan(0, 'readFile', 'not found'),
        errorSpan(1, 'str_replace_editor', 'no match'),
      ];
      const patterns = _detectors.detectErrorLoops(observations);
      assume(patterns).length(0);
    });

    it('should allow generations between errors without breaking streak', function gensInBetween() {
      const observations = [
        errorSpan(0, 'readFile', 'not found'),
        genObs(1),
        errorSpan(2, 'readFile', 'not found'),
        genObs(3),
        errorSpan(4, 'readFile', 'not found'),
      ];
      const patterns = _detectors.detectErrorLoops(observations);
      assume(patterns).length(1);
      assume(patterns[0].count).equals(3);
    });
  });

  describe('#detectUserCorrections', function userCorrectionTests() {
    it('should detect correction when agent worked between messages', function correction() {
      const msgTime1 = 1700000000000;
      const msgTime2 = 1700000100000;

      const observations = [
        obs(0, { startTime: new Date(msgTime1 + 5000).toISOString(), name: 'readFile' }),
        obs(1, { startTime: new Date(msgTime1 + 10000).toISOString(), name: 'str_replace_editor' }),
        obs(2, { startTime: new Date(msgTime1 + 15000).toISOString(), name: 'readFile' }),
      ];

      const patterns = _detectors.detectUserCorrections(observations, [msgTime1, msgTime2]);
      assume(patterns).length(1);
      assume(patterns[0].type).equals('USER_CORRECTION');
    });

    it('should not trigger with only one message', function singleMessage() {
      const observations = [readObs(0), editObs(1, false)];
      const patterns = _detectors.detectUserCorrections(observations, [1700000000000]);
      assume(patterns).length(0);
    });

    it('should not trigger without timestamps', function noTimestamps() {
      const observations = [readObs(0), editObs(1, false)];
      const patterns = _detectors.detectUserCorrections(observations);
      assume(patterns).length(0);
    });

    it('should detect multiple corrections in multi-message session', function multiCorrection() {
      const t1 = 1700000000000;
      const t2 = 1700000060000;
      const t3 = 1700000120000;

      const observations = [
        // Work after msg 1
        obs(0, { startTime: new Date(t1 + 5000).toISOString(), name: 'readFile' }),
        obs(1, { startTime: new Date(t1 + 10000).toISOString(), name: 'str_replace_editor' }),
        // Work after msg 2
        obs(2, { startTime: new Date(t2 + 5000).toISOString(), name: 'readFile' }),
        obs(3, { startTime: new Date(t2 + 10000).toISOString(), name: 'str_replace_editor' }),
      ];

      const patterns = _detectors.detectUserCorrections(observations, [t1, t2, t3]);
      assume(patterns).length(2);
    });
  });

  describe('#detectFriction (integrated)', function integratedTests() {
    it('should return empty report for no observations', function empty() {
      const report = detectFriction([]);
      assume(report.patternCount).equals(0);
      assume(report.score).equals(0);
      assume(report.maxSeverity).equals('low');
      assume(report.patterns).deep.equals([]);
    });

    it('should return empty report for clean session', function clean() {
      const observations = [
        genObs(0),
        readObs(1),
        genObs(2),
        editObs(3, false),
        genObs(4),
      ];
      const report = detectFriction(observations);
      assume(report.patternCount).equals(0);
      assume(report.score).equals(0);
    });

    it('should aggregate patterns from multiple detectors', function multiDetector() {
      const observations = [
        // Edit loop
        editObs(0, true),
        editObs(1, true),
        editObs(2, true),
        // Recovery reads
        grepObs(3),
        grepObs(4),
        grepObs(5),
        grepObs(6),
      ];
      const report = detectFriction(observations);
      // Should find at least EDIT_LOOP + GREP_SPIRAL
      assume(report.patternCount).gte(2);
      assume(report.score).gt(0);

      const types = report.patterns.map(p => p.type);
      assume(types).includes('EDIT_LOOP');
      assume(types).includes('GREP_SPIRAL');
    });

    it('should classify transient retries from timeout errors', function transientRetries() {
      const observations = [
        obs(0, { name: 'terminalCommand', level: 'ERROR', statusMessage: 'Operation timeout after 15s' }),
        obs(1, { name: 'terminalCommand', level: 'ERROR', statusMessage: 'ECONNREFUSED' }),
        obs(2, { name: 'terminalCommand', level: 'ERROR', statusMessage: 'rate limit exceeded' }),
      ];
      const report = detectFriction(observations);
      assume(report.retryTransient).equals(3);
      assume(report.retryAgent).equals(0);
    });

    it('should classify agent retries from non-transient errors', function agentRetries() {
      const observations = [
        obs(0, { name: 'str_replace_editor', level: 'ERROR', statusMessage: 'No match found for old_str' }),
        obs(1, { name: 'readFile', level: 'ERROR', statusMessage: 'file not found at /app/foo.ts' }),
        obs(2, { name: 'str_replace_editor', level: 'ERROR', statusMessage: 'Ambiguous match' }),
      ];
      const report = detectFriction(observations);
      assume(report.retryAgent).equals(3);
      assume(report.retryTransient).equals(0);
    });

    it('should count user-induced retries from corrections', function userInduced() {
      const t1 = 1700000000000;
      const t2 = 1700000060000;

      const observations = [
        obs(0, { startTime: new Date(t1 + 5000).toISOString(), name: 'str_replace_editor' }),
      ];

      const report = detectFriction(observations, { chatMessageTimestamps: [t1, t2] });
      assume(report.retryUserInduced).equals(1);
    });

    it('should calculate friction score proportional to severity', function scoring() {
      // High-severity session
      const highFriction = [
        editObs(0, true), editObs(1, true), editObs(2, true), editObs(3, true),
        editObs(4, true), editObs(5, true), editObs(6, true),
      ];
      const highReport = detectFriction(highFriction);

      // Low-severity session
      const lowFriction = [
        editObs(0, true), editObs(1, true),
        readObs(2), readObs(3), readObs(4),
        genObs(5), genObs(6), genObs(7),
      ];
      const lowReport = detectFriction(lowFriction);

      assume(highReport.score).gt(lowReport.score);
    });
  });
});
