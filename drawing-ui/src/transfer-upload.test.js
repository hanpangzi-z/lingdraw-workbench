import test from 'node:test';
import assert from 'node:assert/strict';
import { assetReference, checkReferences, uploadFiles, transferProgress } from './transfer-upload.js';
const origin = 'https://example.test';
test('reuse only allows same-origin asset references', () => {
  assert.equal(assetReference('https://other.test/assets/a.png','a','image/png',origin), null);
  assert.equal(assetReference('/api/private','a','image/png',origin), null);
  assert.equal(assetReference('/assets/../api/private','a','image/png',origin), null);
  assert.equal(assetReference('/assets/a.png','a','image/png',origin).url, '/assets/a.png');
});
test('reuse checks permissions and existence; missing assets are not reused', async () => {
  const refs = [{url:'/assets/a.png'},{url:'/assets/b.png'}];
  const found = await checkReferences(refs, undefined, async (url, init) => {
    assert.equal(url, '/api/canvas-assets/check'); assert.equal(init.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(init.body).urls, refs.map(ref => ref.url));
    return Response.json({exists:{'/assets/a.png':true,'/assets/b.png':false}});
  });
  assert.deepEqual([...found], ['/assets/a.png']);
});
test('auth and malformed lookup stop transfer instead of bypassing checks', async () => {
  for (const response of [new Response('login',{status:401}),new Response('denied',{status:403}),new Response('<html>'),Response.json({})])
    await assert.rejects(checkReferences([{url:'/assets/a.png'}], undefined, async()=>response));
});
test('no lookup request for new local files', async () => {
  assert.equal((await checkReferences([], undefined, ()=>{throw Error('unexpected')})).size, 0);
});
test('upload preserves ordering, reports bytes and rejects HTML without raw parser errors', async () => {
  globalThis.location = {origin};
  const files = [{blob:new Blob(['first'],{type:'image/png'}), name:'original.png'}, {blob:new Blob(['second'],{type:'image/png'}), name:'guide.png'}];
  let status = 200, body = JSON.stringify({files:[{url:'/assets/one.png'},{url:'/assets/two.png'}]});
  const progress=[];
  class XHR {
    upload={}; open(method,url) { assert.equal(method,'POST'); assert.equal(url,'/api/ai/upload'); }
    send(form) { assert.deepEqual(form.getAll('files').map(file=>file.name),files.map(file=>file.name)); this.status=status; this.responseText=body; this.upload.onprogress({loaded:5,total:11,lengthComputable:true}); this.onload(); }
  }
  const refs=await uploadFiles(files,undefined,event=>progress.push(event),XHR);
  assert.deepEqual(refs.map(ref=>ref.url),['/assets/one.png','/assets/two.png']); assert.equal(progress[0].loaded,5);
  status=504;body='<html>gateway</html>';
  await assert.rejects(uploadFiles(files,undefined,undefined,XHR),error=>!error.message.includes('Unexpected token')&&error.message.includes('504'));
  status=200;body=JSON.stringify({files:[{url:'https://evil.test/assets/a'},{url:'/assets/b'}]});
  await assert.rejects(uploadFiles(files,undefined,undefined,XHR),/无效图片地址/);
  body=JSON.stringify({files:[null,{url:'/assets/b'}]});
  await assert.rejects(uploadFiles(files,undefined,undefined,XHR),/无效图片地址/);
  delete globalThis.location;
});
test('cancelled upload never sends and progress never claims full confirmation', async () => {
  const controller=new AbortController();controller.abort();
  await assert.rejects(uploadFiles([],controller.signal,undefined,class {constructor(){throw Error('must not construct')}}),{name:'AbortError'});
  assert.match(transferProgress({stage:'上传',loaded:1048576,total:1048576},4),/99%.*4 秒/);
});
test('abort during upload settles the request without resubmission', async () => {
  const controller=new AbortController();let sent=0;
  class XHR { upload={};open(){}send(){sent++;controller.abort();}abort(){this.onabort();} }
  await assert.rejects(uploadFiles([{blob:new Blob(['x']),name:'x.png'}],controller.signal,undefined,XHR),{name:'AbortError'});
  assert.equal(sent,1);
});
