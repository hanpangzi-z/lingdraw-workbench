import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('import dialogs start at 2K with or without originals; download defaults stay unchanged', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { default: TransferDialog } = await server.ssrLoadModule('/src/TransferDialog.jsx');
    for (const hasImage of [false, true]) {
      const snapshot = {
        elements: hasImage ? [{ id: 'image', type: 'image', fileId: 'f', width: 1000, height: 500 }] : [],
        files: hasImage ? { f: { dataURL: 'data:image/png;base64,AQID' } } : {},
        appState: {}, logicalSize: { width: 1000, height: 500 }, density: 4.096,
        imageDimensions: { f: { width: 4096, height: 2048 } }, imagePreviews: {},
      };
      for (const intent of ['chat', 'download']) {
        // Each fresh mount represents a newly opened dialog, not a saved preset.
        for (let open = 0; open < 2; open++) {
          const html = renderToStaticMarkup(React.createElement(TransferDialog, { snapshot, intent, lang: 'zh' }));
          const selected = html.match(/<option value="([^"]+)" selected=""/);
          assert.equal(selected?.[1], intent === 'download' && hasImage ? 'auto' : '2k');
          assert.match(html, /value="auto"/);
          assert.match(html, /value="4k"/);
          if (intent === 'chat') assert.match(html, /2048 × 1024/);
          if (intent === 'chat' && hasImage) assert.match(html, /原图保持.*4096 × 2048/);
        }
      }
    }
  } finally {
    await server.close();
  }
});
