import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// `mock.module` cannot remock the same specifier in a single process, and
// dynamic `await import(...)` is cached after the first call. We therefore
// install the module mock once with a mutable `mockImpl`, then reassign
// `mockImpl` per test to control behavior.
let mockImpl = async () => ({ StatusCode: 202 });
mock.module('@aws-sdk/client-lambda', {
  namedExports: {
    LambdaClient: class {
      send(...args) {
        return mockImpl(...args);
      }
    },
    InvokeCommand: class {
      constructor(input) {
        this.input = input;
      }
    },
  },
});

const { invokeInvestigator } = await import('./invoke-investigator.mjs');

await test('invokeInvestigator sends async invocation with payload', async () => {
  let capturedCmd = null;
  mockImpl = mock.fn(async (cmd) => {
    capturedCmd = cmd;
    return { StatusCode: 202 };
  });

  await invokeInvestigator({
    functionName: 'airo-investigator-test',
    payload: { investigationId: 'inv-1', customerId: 'c', appId: 'a' },
  });

  assert.equal(capturedCmd.input.FunctionName, 'airo-investigator-test');
  assert.equal(capturedCmd.input.InvocationType, 'Event');
  const decoded = JSON.parse(Buffer.from(capturedCmd.input.Payload).toString('utf-8'));
  assert.equal(decoded.investigationId, 'inv-1');
});

await test('invokeInvestigator throws on non-202', async () => {
  mockImpl = mock.fn(async () => ({ StatusCode: 500 }));
  await assert.rejects(
    () => invokeInvestigator({
      functionName: 'airo-investigator-test',
      payload: { investigationId: 'inv-2' },
    }),
    /InvokeAsync returned 500/,
  );
});
