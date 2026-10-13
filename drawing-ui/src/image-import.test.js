import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImportQueue, resolveImageSource, fitImageSize } from './image-import.js';

test('queues first-load deliveries, inserts once on duplicate, and preserves order', async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = createImportQueue(async ({ requestId }) => {
    calls.push(requestId);
    if (requestId === 'a') await gate;
    return { ok: true, id: requestId };
  });
  const first = queue.enqueue({ requestId: 'a' });
  const duplicate = queue.enqueue({ requestId: 'a' });
  const second = queue.enqueue({ requestId: 'b' });
  await Promise.resolve();
  assert.deepEqual(calls, ['a']);
  assert.equal(first, duplicate);
  release();
  await Promise.all([first, second]);
  await queue.enqueue({ requestId: 'a' });
  assert.deepEqual(calls, ['a', 'b']);
});

test('an unsuccessful import does not block following images', async () => {
  const queue = createImportQueue(async ({ requestId }) => {
    if (requestId === 'bad') throw new Error('bad image');
    return { ok: true };
  });
  const bad = queue.enqueue({ requestId: 'bad' });
  const good = queue.enqueue({ requestId: 'good' });
  await assert.rejects(bad, /bad image/);
  assert.deepEqual(await good, { ok: true });
});

test('only authenticated same-origin media addresses are accepted', () => {
  const origin = 'http://127.0.0.1:37621';
  assert.equal(resolveImageSource('/output/apple.png', origin), origin + '/output/apple.png');
  assert.equal(resolveImageSource('/api/download-output?url=https%3A%2F%2Fimages.example%2Fapple.png', origin), origin + '/api/download-output?url=https%3A%2F%2Fimages.example%2Fapple.png');
  for (const url of ['//external.example/image.png', 'javascript:alert(1)', 'file:///tmp/image.png', 'http://user:pass@127.0.0.1:37621/image.png', '']) {
    assert.throws(() => resolveImageSource(url, origin));
  }
});

test('landscape, portrait and small images keep their aspect ratio', () => {
  assert.deepEqual(fitImageSize(2048, 1024), { width: 960, height: 480 });
  assert.deepEqual(fitImageSize(1024, 2048), { width: 480, height: 960 });
  assert.deepEqual(fitImageSize(120, 80), { width: 120, height: 80 });
  assert.throws(() => fitImageSize(0, 400));
});
