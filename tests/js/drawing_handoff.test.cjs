const {test} = require('node:test');
const assert = require('node:assert/strict');
const {validate, mergeDraft, removeReference} = require('../../static/js/drawing-handoff.js');
const origin = 'http://localhost:37621';
const incoming = () => ({requestId:'pair-one',mode:'annotation',prompt:'苹果改绿色',references:[{url:'/assets/source.jpg',name:'原图.jpg',mime:'image/jpeg',role:'source'},{url:'/assets/guide.png',role:'annotation'}]});

test('bridge round trip preserves roles, pair, original MIME and order', () => {
  const first = validate(incoming(), origin);
  assert.deepEqual(validate(first, origin), first);
  assert.deepEqual(first.references.map(ref => ref.role), ['source','annotation']);
  assert.equal(first.references[0].mime, 'image/jpeg');
  assert.equal(first.references[0].annotation_group, first.references[1].annotation_group);
});
test('malformed, foreign-origin and swapped references cannot enter draft', () => {
  for(const patch of [{references:[incoming().references[0]]}, {prompt:''}, {references:incoming().references.toReversed()}, {references:[{url:'https://example.com/a.png',role:'source'},incoming().references[1]]}]) {
    assert.throws(() => validate({...incoming(),...patch},origin));
  }
});
test('import is atomic at attachment limit and preserves existing text and attachments', () => {
  const oldRefs = [{url:'/assets/old.png'}];
  const payload = validate(incoming(),origin);
  assert.throws(() => mergeDraft(oldRefs,'旧的要求',payload,2));
  assert.equal(oldRefs.length,1);
  const next = mergeDraft(oldRefs,'旧的要求',payload,20);
  assert.equal(next.refs.length,3);
  assert.equal(next.prompt,'旧的要求\n\n苹果改绿色');
  assert.throws(() => mergeDraft(next.refs,next.prompt,payload,20), /已有一组/);
});
test('removing either half removes the pair, leaving ordinary references intact', () => {
  const old = {url:'/assets/old.png'};
  const refs = [old,...validate(incoming(),origin).references];
  assert.deepEqual(removeReference(refs,1),[old]);
  assert.deepEqual(removeReference(refs,2),[old]);
  assert.equal(refs.length,3);
});
test('sketch and previous single-image imports remain supported', () => {
  assert.equal(validate({requestId:'old',reference:{url:'/assets/old.png'}},origin).references.length,1);
  const sketch = validate({requestId:'sketch',mode:'sketch',prompt:'制作海报',references:[{url:'/assets/sketch.png',role:'sketch'}]},origin);
  assert.equal(sketch.references[0].annotation_group,'');
});
test('pixel dimensions survive both bridge hops without mapping to legacy presets', () => {
  const payload = {...incoming(),canvasSize:{width:4096,height:1371},generationSize:{width:4096,height:2304}};
  const first = validate(payload,origin);
  assert.deepEqual(validate(first,origin),first);
  assert.deepEqual(first.generationSize,{width:4096,height:2304});
});
test('invalid or unpaired dimensions fail before draft mutation', () => {
  for(const size of [{width:9000,height:3000},{width:NaN,height:3000},{width:4000,height:1234}]) {
    assert.throws(() => validate({...incoming(),canvasSize:{width:4096,height:2304},generationSize:size},origin));
  }
  assert.throws(() => validate({...incoming(),canvasSize:{width:4096,height:2304}},origin));
});
