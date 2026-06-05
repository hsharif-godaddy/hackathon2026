import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  writeMcpConfig,
  buildCustomerGraph,
  isGraphAvailable,
  CRG_MCP_COMMAND,
  CRG_MCP_ARGS,
  CRG_BUILD_ARGS,
  PY_PACKAGES,
} from './graph-setup.mjs';

describe('graph-setup', function graphSetupTests() {
  describe('#writeMcpConfig', function writeMcpConfigTests() {
    it('writes valid stdio MCP JSON with the crg server, serve args, and the python env', async function writesConfig() {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crg-mcp-'));
      const outPath = path.join(dir, 'mcp.json');

      const returned = await writeMcpConfig(outPath);
      assert.equal(returned, outPath, 'writeMcpConfig returns the path it wrote');

      const raw = await fs.readFile(outPath, 'utf-8');
      const config = JSON.parse(raw); // throws if not valid JSON
      const crg = config.mcpServers.crg;

      assert.equal(crg.command, 'python3.11');
      assert.equal(crg.command, CRG_MCP_COMMAND);
      // args must launch the package CLI's `serve` stdio entrypoint.
      assert.deepEqual(crg.args, CRG_MCP_ARGS);
      assert.equal(crg.args[crg.args.length - 1], 'serve');
      assert.equal(crg.args[0], '-m');
      assert.equal(crg.args[1], 'code_review_graph');
      // env must carry both PYTHONPATH (so -m resolves) and LD_LIBRARY_PATH
      // (so the python ssl import resolves against AL2023 OpenSSL — see spike).
      assert.equal(crg.env.PYTHONPATH, PY_PACKAGES);
      assert.equal(crg.env.LD_LIBRARY_PATH, '/usr/lib64');
      // CRG_SERIAL_PARSE=1 avoids the multiprocessing SemLock that fails on
      // Lambda (no /dev/shm). Required for both serve and build.
      assert.equal(crg.env.CRG_SERIAL_PARSE, '1');

      await fs.rm(dir, { recursive: true, force: true });
    });
  });

  describe('#buildCustomerGraph', function buildCustomerGraphTests() {
    it('returns true and invokes python with the build args + --repo <dir> on exit 0', async function buildOk() {
      const calls = [];
      const runner = async (command, args, options) => {
        calls.push({ command, args, options });
        return { stdout: 'built', stderr: '' };
      };

      const res = await buildCustomerGraph('/tmp/inv-1/app', { runner });
      assert.equal(res.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].command, CRG_MCP_COMMAND);
      // The constant build args are passed first, then the repo flag.
      assert.deepEqual(calls[0].args.slice(0, CRG_BUILD_ARGS.length), CRG_BUILD_ARGS);
      // Build args use the confirmed --skip-flows fast build (no --postprocess).
      assert.ok(CRG_BUILD_ARGS.includes('--skip-flows'), 'build args include --skip-flows');
      assert.ok(!CRG_BUILD_ARGS.includes('--postprocess'), 'build args do not use --postprocess');
      const repoFlagIdx = calls[0].args.indexOf('--repo');
      assert.ok(repoFlagIdx >= 0, 'build invocation includes --repo');
      assert.equal(calls[0].args[repoFlagIdx + 1], '/tmp/inv-1/app');
      // Confirmed CLI uses --repo, not the old --repo-root spelling.
      assert.ok(!calls[0].args.includes('--repo-root'), 'build invocation does not use --repo-root');
      // The MCP server env must be present so python can import/run.
      assert.equal(calls[0].options.env.PYTHONPATH, PY_PACKAGES);
      assert.equal(calls[0].options.env.LD_LIBRARY_PATH, '/usr/lib64');
      // Serial parse — no ProcessPoolExecutor/SemLock (no /dev/shm on Lambda).
      assert.equal(calls[0].options.env.CRG_SERIAL_PARSE, '1');
    });

    it('passes a SCOPED env that excludes run secrets to the build spawn', async function scopedEnv() {
      const prev = process.env.LOKI_API_KEY;
      process.env.LOKI_API_KEY = 'super-secret';
      try {
        const calls = [];
        const runner = async (command, args, options) => {
          calls.push({ command, args, options });
          return { stdout: '', stderr: '' };
        };
        await buildCustomerGraph('/tmp/inv-1/app', { runner });
        // The run's in-memory secret must NOT be inherited by the CRG child.
        assert.equal(calls[0].options.env.LOKI_API_KEY, undefined, 'secret must not reach the CRG child');
        // The CRG overrides + a PATH passthrough are still present.
        assert.equal(calls[0].options.env.PYTHONPATH, PY_PACKAGES);
        assert.equal(calls[0].options.env.CRG_SERIAL_PARSE, '1');
      } finally {
        if (prev === undefined) delete process.env.LOKI_API_KEY;
        else process.env.LOKI_API_KEY = prev;
      }
    });

    it('returns false (soft-fail) when the build process exits non-zero / throws', async function buildFails() {
      const runner = async () => {
        const err = new Error('non-zero exit');
        err.code = 1;
        err.stderr = 'Traceback: boom';
        throw err;
      };

      const res = await buildCustomerGraph('/tmp/inv-1/app', { runner });
      assert.equal(res.ok, false, 'a failing build soft-fails to ok:false, never throws');
      assert.ok(res.detail.includes('exit=1'), 'detail surfaces the exit code');
      assert.ok(res.detail.includes('boom'), 'detail surfaces stderr tail');
    });

    it('returns false when the build times out (runner rejects with a timeout error)', async function buildTimesOut() {
      const runner = async () => {
        const err = new Error('spawn timeout');
        err.killed = true;
        err.signal = 'SIGTERM';
        throw err;
      };

      const res = await buildCustomerGraph('/tmp/inv-1/app', { runner });
      assert.equal(res.ok, false);
      assert.ok(res.detail.includes('timeout'), 'detail flags the timeout');
    });
  });

  describe('#isGraphAvailable', function isGraphAvailableTests() {
    it('returns true when <root>/code_review_graph exists (CRG deps baked into the image)', async function present() {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crg-avail-'));
      await fs.mkdir(path.join(dir, 'code_review_graph'));

      const available = await isGraphAvailable({ root: dir });
      assert.equal(available, true);

      await fs.rm(dir, { recursive: true, force: true });
    });

    it('returns false when the CRG package dir is absent (build without the python deps)', async function absent() {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crg-avail-'));
      // Intentionally do NOT create code_review_graph under it.

      const available = await isGraphAvailable({ root: dir });
      assert.equal(available, false, 'a missing CRG dir gates the MCP off');

      await fs.rm(dir, { recursive: true, force: true });
    });

    it('returns false (never throws) when the root path itself does not exist', async function missingRoot() {
      const available = await isGraphAvailable({ root: '/nonexistent/py-packages-xyz' });
      assert.equal(available, false);
    });
  });
});
