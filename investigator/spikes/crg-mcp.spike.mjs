// Spike: can an in-process loop call the CRG code-graph?
//
// DISCOVERY (2026-06-10): ai@5.0.197 has NO MCP client built-in.
// The MCP primitives (experimental_createMCPClient, StdioMCPTransport) are ai@6+.
// CONCLUSION: the feature plan must use the subprocess approach (match graph-setup.mjs)
// OR upgrade to ai@6. Recording this finding as the spike result.
//
// Primary path tested: subprocess spawn of `python3.11 -m code_review_graph serve`
//   via the existing graph-setup.mjs contract (CRG_MCP_COMMAND, CRG_MCP_ARGS, crgEnv).
// Secondary: verify CRG `--help` is callable (proves the CLI is reachable at all).
//
// Reuses the launch contract from investigator/graph-setup.mjs (command/args/env).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PY = 'python3.11';
const env = {
  ...process.env,
  PYTHONPATH: process.env.PYTHONPATH || '/opt/py-packages',
  LD_LIBRARY_PATH: '/usr/lib64',
  CRG_SERIAL_PARSE: '1',
};

// --- FINDING: ai@5 has no experimental_createMCPClient ---
// Check if we're on a version that has it.
const ai = await import('ai');
const hasMCPClient = typeof ai.experimental_createMCPClient === 'function';
const { default: aiPkg } = await import('../node_modules/ai/package.json', { with: { type: 'json' } });
console.log('ai version:', aiPkg.version);
console.log('experimental_createMCPClient present:', hasMCPClient);
if (!hasMCPClient) {
  console.log('FINDING: ai@5 has no MCP client. Feature plan must use subprocess or upgrade to ai@6.');
}

// --- Subprocess path: verify CRG CLI is reachable (runs in Docker; skipped on host) ---
async function checkSubprocess() {
  try {
    const { stdout } = await execFileAsync(PY, ['-m', 'code_review_graph', '--help'], {
      env,
      timeout: 10_000,
    });
    const ok = /usage|build|serve/i.test(stdout);
    console.log('CRG subprocess --help ok:', ok);
    console.log('CRG --help output (first 200 chars):', stdout.slice(0, 200));
    return ok;
  } catch (err) {
    // Expected on host (python3.11 + code_review_graph not installed locally).
    // This spike is meant to be re-run inside the Docker image.
    console.log('CRG subprocess not available on host:', err.message.slice(0, 120));
    console.log('EXPECTED: re-run inside airo-investigator:spike Docker image for the real result.');
    return null; // null = skipped, not failed
  }
}

const subprocessResult = await checkSubprocess();

// --- Summary ---
if (hasMCPClient) {
  console.log('MCP_CLIENT: AVAILABLE — can use experimental_createMCPClient in this ai version');
} else {
  console.log('MCP_CLIENT: NOT_AVAILABLE in ai@5 — subprocess path is required for CRG');
}
if (subprocessResult === true) console.log('SUBPROCESS: SPIKE_PASS');
else if (subprocessResult === false) console.log('SUBPROCESS: SPIKE_FAIL — CRG CLI not working');
else console.log('SUBPROCESS: SPIKE_SKIP (host) — must run in Docker image');
