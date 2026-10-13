import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { completeChineseLocale } from './excalidraw-locale.js';

const dist = dirname(dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')));
for (const mode of ['dev', 'prod']) {
  test(`Chinese hints are completed in the real ${mode} locale, keeping existing translations`, async () => {
    const directory = join(dist, mode, 'locales');
    const filename = (await readdir(directory)).find(name => /^zh-CN-.*\.js$/.test(name));
    const path = join(directory, filename);
    const code = await readFile(path, 'utf8');
    const patched = completeChineseLocale(code, path).replace(/import\s*"([^"]+)"/g, (_, specifier) => `import "${new URL(specifier, pathToFileURL(path)).href}"`);
    const locale = await import(`data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`);
    const original = await import(pathToFileURL(path).href);
    assert.match(locale.hints.createFlowchart, /按住 CtrlOrCmd/);
    assert.match(locale.hints.enterCropEditor, /双击图片/);
    assert.match(locale.hints.leaveCropEditor, /完成裁剪/);
    assert.equal(locale.helpDialog.cropStart, '裁剪图片');
    assert.equal(locale.labels.imageCropping, '图片裁剪');
    assert.equal(locale.buttons.cancel, original.buttons.cancel);
    assert.equal(locale.default.hints, locale.hints);
    assert.equal(completeChineseLocale(code, path.replace('zh-CN-', 'en-')), null);
  });
}

test('an incompatible locale export fails visibly rather than silently dropping translations', () => {
  assert.throws(() => completeChineseLocale('export default {};', '/node_modules/@excalidraw/excalidraw/dist/prod/locales/zh-CN-new.js'), /format changed/);
});
