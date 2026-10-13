import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationSources, annotationText, originalImageBlob, drawingPrompt } from './annotation-export.js';

test('source selection excludes deleted images and missing files', () => {
  const file = { dataURL:'data:image/png;base64,AQID' };
  const elements = [{id:'a', type:'image', fileId:'f', customData:{filename:'商品.png'}}, {id:'b',type:'image',fileId:'f',isDeleted:true}, {id:'c',type:'image',fileId:'missing'}];
  assert.deepEqual(annotationSources(elements, {f:file}), [{id:'a',file,name:'商品.png'}]);
});

test('extracts original text without line wrapping or deleted notes; never guesses shapes', () => {
  assert.equal(annotationText([{type:'text',text:'苹果改\n绿色',originalText:'苹果改绿色'}, {type:'text',text:'保留背景'}, {type:'text',text:'保留背景'}, {type:'text',text:'删除苹果',isDeleted:true}, {type:'arrow'}, {type:'ellipse'}]), '苹果改绿色\n保留背景');
});

test('original bytes and MIME are preserved without a canvas re-encode', async () => {
  const blob = originalImageBlob({dataURL:'data:image/jpeg;base64,AQIDBA=='});
  assert.equal(blob.type, 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1,2,3,4]);
  assert.throws(() => originalImageBlob({dataURL:'https://example.com/image.png'}));
});

test('annotation requires concrete text; sketch can be sent without edit instructions', () => {
  assert.throws(() => drawingPrompt('annotation', '  '), /具体修改要求/);
  assert.match(drawingPrompt('annotation', '苹果改绿色'), /修改要求：\n苹果改绿色/);
  assert.match(drawingPrompt('sketch', ''), /草图生成/);
});
