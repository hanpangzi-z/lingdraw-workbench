const assert = require('node:assert/strict');
const { collectActiveCanvasImageUrls } = require('../../static/js/canvas-resource-export.js');

const canvas = {
  nodes: [
    { type: 'image', url: '/assets/input/current.png' },
    {
      type: 'output',
      images: [
        { url: '/assets/output/result-a.png', run: { refs: [{ url: '/assets/input/deleted-ref.png' }] } },
        '/assets/output/result-b.jpg',
      ],
    },
    { type: 'generator', generatedOutputs: ['/assets/output/deleted-output.png'] },
    { type: 'image', url: '/assets/input/deleted-node.png', deleted: true },
    { type: 'video', url: '/assets/output/movie.mp4' },
  ],
  document: {
    snapshot: {
      objects: [
        { type: 'design-image', props: { url: '/assets/output/design-current.webp' } },
        { type: 'design-generator', props: { resultUrl: '/assets/output/generator-current.png' } },
      ],
      store: {
        'shape:current': { typeName: 'shape', type: 'design-image', props: { url: '/assets/input/store-current.png' } },
        'asset:unused': { typeName: 'asset', props: { src: '/assets/input/unused-asset.png' } },
      },
    },
    agent_session: {
      turns: [{ references: [{ url: '/assets/input/agent-history.png' }] }],
    },
  },
  logs: [{ url: '/assets/output/log-history.png' }],
};

assert.deepEqual(collectActiveCanvasImageUrls(canvas), [
  '/assets/input/current.png',
  '/assets/output/result-a.png',
  '/assets/output/result-b.jpg',
  '/assets/output/design-current.webp',
  '/assets/output/generator-current.png',
  '/assets/input/store-current.png',
]);

console.log('canvas resource export tests passed');
