const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../static/js/image-upload-optimizer.js'), 'utf8');

function optimizerHarness({width=6000, height=3000, blobSize=2 * 1024 * 1024, decodeError=false, delay=0}={}){
  const canvases = [];
  let active = 0;
  let maxActive = 0;
  class FakeFile {
    constructor(parts, name, options={}){
      this.size = parts.reduce((total, part) => total + Number(part?.size || 0), 0);
      this.name = name;
      this.type = options.type || '';
      this.lastModified = options.lastModified || 0;
    }
  }
  const window = {
    createImageBitmap: async () => {
      if(decodeError) throw new Error('decode failed');
      active += 1;
      maxActive = Math.max(maxActive, active);
      if(delay) await new Promise(resolve => setTimeout(resolve, delay));
      return {width, height, close(){ active -= 1; }};
    },
  };
  const context = {
    window,
    File: FakeFile,
    Image: class {},
    document: {
      createElement(name){
        assert.equal(name, 'canvas');
        const canvas = {
          width: 0,
          height: 0,
          getContext(){ return {drawImage(){}}; },
          toBlob(callback, type){ setTimeout(() => callback({size:blobSize, type}), delay); },
        };
        canvases.push(canvas);
        return canvas;
      },
    },
    Promise,
    Set,
    Array,
    Number,
    String,
    Date,
    Math,
    setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {optimizer:window.LingDrawImageUpload, canvases, getMaxActive:() => maxActive};
}

function file(name, type, size){
  return {name, type, size, lastModified:123};
}

test('large JPEG is resized to 4096 and encoded smaller', async () => {
  const harness = optimizerHarness();
  const result = await harness.optimizer.optimizeFile(file('photo.jpeg', 'image/jpeg', 12 * 1024 * 1024));
  assert.equal(result.name, 'photo.jpg');
  assert.equal(result.type, 'image/jpeg');
  assert.equal(result.size, 2 * 1024 * 1024);
  assert.deepEqual([harness.canvases[0].width, harness.canvases[0].height], [4096, 2048]);
});

test('PNG uses transparency-capable WebP while small images and GIF stay original', async () => {
  const harness = optimizerHarness({width:5000, height:5000});
  const png = file('art.png', 'image/png', 8 * 1024 * 1024);
  const optimized = await harness.optimizer.optimizeFile(png);
  assert.equal(optimized.name, 'art.webp');
  assert.equal(optimized.type, 'image/webp');
  const small = file('small.jpg', 'image/jpeg', 1024 * 1024);
  assert.equal(await optimizerHarness({width:1200, height:800}).optimizer.optimizeFile(small), small);
  const gif = file('motion.gif', 'image/gif', 12 * 1024 * 1024);
  assert.equal(await harness.optimizer.optimizeFile(gif), gif);
});

test('failed or ineffective optimization falls back to the original file', async () => {
  const original = file('photo.jpg', 'image/jpeg', 10 * 1024 * 1024);
  assert.equal(await optimizerHarness({decodeError:true}).optimizer.optimizeFile(original), original);
  assert.equal(await optimizerHarness({blobSize:9.5 * 1024 * 1024}).optimizer.optimizeFile(original), original);
});

test('multi-file optimization preserves order and limits concurrency to two', async () => {
  const harness = optimizerHarness({delay:5});
  const input = ['one.jpg','two.jpg','three.jpg'].map(name => file(name, 'image/jpeg', 10 * 1024 * 1024));
  const output = await harness.optimizer.optimizeFiles(input);
  assert.deepEqual(output.map(item => item.name), ['one.jpg','two.jpg','three.jpg']);
  assert.ok(harness.getMaxActive() <= 2);
});
