import test from 'node:test';
import assert from 'node:assert/strict';
import { exportDimensions, scenePixelDensity, imagePixelDensity, generationDimensions, hasUpscaledImages } from './export-sizing.js';

const image = { type:'image',fileId:'a',width:960,height:540,opacity:100 };
const originals = { a:{width:4096,height:2304} };

test('4K original at 960 canvas units exports at original pixel density', () => {
  const density = scenePixelDensity([image],originals);
  const result = exportDimensions(960,540,'auto',density);
  assert.deepEqual([result.width,result.height],[4096,2304]);
  assert.equal(density,4096/960);
});
test('2K and 4K mean exact long edge for square, portrait and landscape', () => {
  for(const [w,h] of [[960,540],[540,960],[960,960]]) for(const [quality,edge] of [['2k',2048],['4k',4096]]) {
    const size = exportDimensions(w,h,quality);
    assert.equal(Math.max(size.width,size.height),edge);
    assert.ok(Math.abs(size.width/size.height - w/h)<.002);
  }
});
test('crop density uses visible original pixels, unaffected by rotation or flips', () => {
  const cropped = {...image,width:480,angle:Math.PI/2,scale:[-1,1],crop:{width:2048,height:2304,naturalWidth:4096,naturalHeight:2304}};
  assert.equal(imagePixelDensity(cropped,originals.a),4096/960);
  // Older scenes may store crop coordinates against a different intrinsic size.
  assert.equal(imagePixelDensity({...cropped,crop:{width:1024,height:1152,naturalWidth:2048,naturalHeight:1152}},originals.a),4096/960);
});
test('mixed image densities take the largest; deleted and transparent images are ignored', () => {
  const smaller = {...image,fileId:'b'};
  assert.equal(scenePixelDensity([smaller,image],{...originals,b:{width:1920,height:1080}}),4096/960);
  assert.equal(scenePixelDensity([{...image,isDeleted:true},{...image,opacity:0}],originals),0);
});
test('canvas bounds include annotations and padding, capped at 4K; pure vectors default to 2K', () => {
  assert.equal(exportDimensions(1800,1000,'auto',4096/960).width,4096);
  assert.equal(exportDimensions(300,700,'auto',0).height,2048);
  assert.equal(exportDimensions(8000,6000,'auto',1).width,4096);
  assert.equal(exportDimensions(8000,6000,'preview',1).width,1024);
});
test('annotation generation follows original, sketch follows whole canvas; align before display', () => {
  assert.deepEqual(generationDimensions({width:4096,height:1371}, originals.a,'auto','annotation'),{width:4096,height:2304});
  assert.deepEqual(generationDimensions({width:4096,height:1371}, originals.a,'auto','sketch'),{width:4096,height:1376});
  assert.deepEqual(generationDimensions({}, {width:1000,height:500},'2k','annotation'),{width:2048,height:1024});
});
test('low resolution images are not automatically upscaled; deliberate enlargement is detected', () => {
  const low = {a:{width:480,height:270}};
  const density = scenePixelDensity([image],low);
  assert.equal(exportDimensions(960,540,'auto',density).width,480);
  assert.equal(hasUpscaledImages([image],low,exportDimensions(960,540,'4k',density).scale),true);
  assert.equal(hasUpscaledImages([image],low,density),false);
});
test('invalid dimensions fail; rapid preset changes calculate independently without mutating input', () => {
  assert.throws(() => exportDimensions(0,Infinity));
  assert.throws(() => exportDimensions(200,100,'8k'));
  const values = ['4k','2k','auto','4k'].map(quality => exportDimensions(960,540,quality,4096/960).width);
  assert.deepEqual(values,[4096,2048,4096,4096]);
  assert.equal(image.width,960);
});
