import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('handler bootstrap ordering', function handlerBootstrapTests() {
  it('marks the state as entered before running bootstrap', async function bootstrapOrdering() {
    const source = await readFile(new URL('./handler.mjs', import.meta.url), 'utf8');

    const handlerStart = source.indexOf('export async function handler(event)');
    const bootstrapCall = source.indexOf('await bootstrap();', handlerStart);
    const firstEntryEvent = source.indexOf("lastEvent: 'lambda handler entered'", handlerStart);

    assert.notEqual(handlerStart, -1);
    assert.notEqual(bootstrapCall, -1);
    assert.notEqual(firstEntryEvent, -1);
    assert.ok(
      firstEntryEvent < bootstrapCall,
      'handler should update investigation state before bootstrap can fail or hang',
    );
  });

  it('gates result metadata on successful report upload', async function resultUploadGating() {
    const source = await readFile(new URL('./handler.mjs', import.meta.url), 'utf8');

    assert.match(source, /let reportUploaded = false;/);
    assert.match(source, /console\.error\('\[investigator\] report upload failed'/);
    assert.match(source, /reportUploaded = true;/);
    assert.match(source, /resultKey: reportUploaded \? resultKey : null/);
    assert.match(source, /reportFilename: reportUploaded \? reportName : null/);
    assert.match(source, /if \(reportUploaded\) \{/);
  });

});
