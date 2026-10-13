const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const api = require('../../static/js/chat-request-recovery.js');
const html = fs.readFileSync(require.resolve('../../static/gpt-chat.html'), 'utf8');
const response = (body, status=200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status});

test('HTML proxy errors retain HTTP status without JSON parser text', async () => {
  for(const status of [200,401,403,404,502,504]) {
    await assert.rejects(api.readResponse(response('<html><h1>Gateway Timeout</h1>',status)), error => {
      assert.equal(error.httpStatus,status);
      assert.equal(error.apiError,false);
      assert.doesNotMatch(error.message,/Unexpected token|<html>/);
      assert.equal(api.definitiveFailure(error),false);
      return true;
    });
  }
});
test('JSON API error code, message, and unknown-outcome protection survive', async () => {
  for(const unknown of [true,false]) {
    await assert.rejects(api.readResponse(response({detail:{code:'image_failed',message:'模型拒绝',upstream_outcome:unknown?'unknown':'failed'}},400)), e => {
      assert.equal(e.code,'image_failed'); assert.equal(e.message,'模型拒绝');
      assert.equal(api.definitiveFailure(e),!unknown); return true;
    });
  }
});
async function sequence(items, duration=600000) {
  let clock=0,calls=0;
  const notices=[];
  const result=await api.poll('original', {maxDuration:duration,now:()=>clock,sleep:async ms=>{clock+=ms;},
    onProgress:msg=>notices.push(msg),fetch:async (url,options)=>{
      assert.match(url,/\/original\?surface=gpt_chat$/); assert.equal(options.method,undefined);
      const item=items[Math.min(calls++,items.length-1)];
      if(item instanceof Error) throw item;
      return response(item.body,item.status);
    }});
  return {result,calls,clock,notices};
}
test('network/HTML/temporary 404 recover through original GET to one completed image',async()=>{
  const r=await sequence([{body:'<html>',status:504},new TypeError('offline'),{body:{detail:'not found'},status:404},
    {body:{status:'running'}},{body:{status:'succeeded',request_id:'original',message:{image_url:'/assets/done.png'}}}]);
  assert.equal(r.result.status,'succeeded'); assert.equal(r.calls,5);
});
test('long generation continues past 60 seconds',async()=>{
  const r=await sequence([...Array(20).fill({body:{status:'running'}}),{body:{status:'succeeded',message:{id:'done'}}}]);
  assert.ok(r.clock>60000); assert.equal(r.result.status,'succeeded');
});
test('401 and 403 stop immediately, retain paused status',async()=>{
  for(const status of [401,403]) {
    const r=await sequence([{body:'<html>login',status}]);
    assert.equal(r.calls,1); assert.equal(r.result.status,'paused'); assert.equal(r.result.httpStatus,status);
  }
});
test('404, malformed success and never-ending running stop at ten minutes, not failure',async()=>{
  for(const body of [{status:'running'},'<html>',{status:'succeeded'}]) {
    const r=await sequence([{body}]); assert.equal(r.clock,600000); assert.equal(r.result.status,'paused');
    assert.ok(r.calls<80);
  }
  const r=await sequence([{body:{detail:'not found'},status:404}]);
  assert.equal(r.clock,600000); assert.equal(r.result.status,'paused');
});
test('known failure is terminal but unknown outcome is never retryable',async()=>{
  assert.equal((await sequence([{body:{status:'failed',detail:{message:'rejected'}}}])).result.status,'failed');
  assert.equal((await sequence([{body:{status:'outcome_unknown'}}])).result.status,'paused');
});
test('mismatched request ID never displays another task result',async()=>{
  const r=await sequence([{body:{status:'succeeded',request_id:'another',message:{}}}],100);
  assert.equal(r.result.status,'paused');
});
test('receipt fingerprint protects refresh/duplicate but permits different requests',()=>{
  const record={conversationId:'one',sendKey:'same',message:'prompt',attachments:[{url:'/a'}]};
  assert.equal(api.matches(record,'one','same','prompt',[]),true);
  assert.equal(api.matches(record,'one','different','prompt',[]),false);
  assert.equal(api.matches(record,'two','same','prompt',[]),false);
  delete record.sendKey;
  assert.equal(api.matches(record,'one','x','prompt',[{url:'/a'}]),true);
  assert.equal(api.matches(record,'one','x','prompt',[{url:'/b'}]),false);
});
test('receipt restoration preserves fingerprint, references/options and paused state',()=>{
  const values=new Map();
  const context=vm.createContext({localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}});
  const start=html.indexOf('        function pendingRequestRecords()');
  const end=html.indexOf('        const ACTIVE_GENERATION_STATUSES',start);
  vm.runInContext("const CHAT_PENDING_REQUESTS_KEY='qa';\n"+html.slice(start,end),context);
  vm.runInContext(`persistPendingRequest({requestId:'one',conversationId:'c',sendKey:'fingerprint',recoveryState:'paused',requestOptions:{imageModel:'model'},attachments:[{url:'/source',role:'source'},{url:'/guide',role:'annotation'}]});
    persistPendingRequest({requestId:'one',conversationId:'c',restoredFromServer:true});`,context);
  const [record]=JSON.parse(values.get('qa'));
  assert.equal(record.sendKey,'fingerprint'); assert.equal(record.recoveryState,'paused');
  assert.equal(record.attachments.length,2); assert.equal(record.requestOptions.imageModel,'model');
});
test('all inline scripts parse and refresh does not recursively restart recovery',()=>{
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  const refresh=html.slice(html.indexOf('async function refreshConversationAfterRequests'),html.indexOf('async function resumePendingRequest('));
  assert.doesNotMatch(refresh,/resumePendingRequests\(/);
});

function pageHarness(mode, reply) {
  const values=new Map(), elements=new Map(), posts=[], recovered=[];
  const element=()=>({value:'请改字',dataset:{},classList:{add(){},remove(){}},appendChild(){}});
  const context=vm.createContext({console,Date,JSON,Map,Set,ChatRequestRecovery:{...api},
    localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},
    document:{getElementById:id=>{if(!elements.has(id)) elements.set(id,element());return elements.get(id);},createElement:element},
    window:{setTimeout(){}},
    fetch:async(url,options)=>{posts.push(JSON.parse(options.body));return reply();},
    tr:x=>x,autoGrow(){},renderRefs(){},syncSendBusyState(){},scrollBottom(){},renderRecoveryNotices(){},renderConversationState(){},clearRequestError(){},
    ensureConversationForSend:async()=>({id:'c'}),
    refreshConversationAfterRequests:async()=>{},loadConversations:async()=>{},
    resumePendingRequest:async r=>{recovered.push(r);},showRequestResult(){},
    addMessageBubble:()=>({row:{isConnected:true},bubble:{classList:{add(){},remove(){}}},text:{textContent:''}}),
    currentSystemPrompt:()=>'',hasExplicitChatSize:()=>false,chatSizeFromPrompt:()=> '1024x1024',
  });
  vm.runInContext(`const CHAT_PENDING_REQUESTS_KEY='qa'; const userId='qa'; const headers=()=>({});
    let mode=${JSON.stringify(mode)},provider='mock',msModel='',activeChatModel='chat',activeImageProvider='mock',activeImageModel='image',imageCount=1;
    let refs=[{url:'/source',role:'source'},{url:'/guide',role:'annotation'}],drawingSize=null,drawingSizeActive=false,config={},currentConversation={id:'c'};
    const activeRequests=new Map(),activeSendKeys=new Set(); let id=0; function createChatRequestId(){return 'r'+ ++id;}`,context);
  vm.runInContext(html.slice(html.indexOf('        function sendFingerprint('),html.indexOf('        const ACTIVE_GENERATION_STATUSES')),context);
  vm.runInContext(html.slice(html.indexOf('        async function sendMessage('),html.indexOf('        async function streamChatMessage(')),context);
  return {context,posts,recovered,elements,values,send:()=>vm.runInContext('sendMessage()',context)};
}
for(const mode of ['image','auto','agent']) test(`${mode} actual send handler retains receipt after HTML and blocks duplicate`,async()=>{
  const h=pageHarness(mode,()=>response('<html>timeout',504));
  await h.send();
  assert.equal(h.posts.length,1); assert.equal(h.recovered.length,1);
  const record=h.recovered[0];
  assert.equal(record.requestId,h.posts[0].request_id); assert.equal(record.attachments.length,2);
  assert.equal(record.recoveryState,'querying');
  h.elements.get('messageInput').value='请改字';
  vm.runInContext("refs=[{url:'/source',role:'source'},{url:'/guide',role:'annotation'}]",h.context);
  await h.send(); assert.equal(h.posts.length,1);
  assert.equal(h.elements.get('messageInput').value,'请改字');
  h.elements.get('messageInput').value='另一个不同要求';
  await h.send(); assert.equal(h.posts.length,2);
});
test('actual send handler pauses authentication error, does not regenerate or restore as failure',async()=>{
  const h=pageHarness('image',()=>response('<html>login',401)); await h.send();
  assert.equal(h.posts.length,1);assert.equal(h.recovered.length,0);
  assert.equal(JSON.parse(h.values.get('qa'))[0].recoveryState,'paused');
});
test('definite rejection keeps both editable references; a newer draft is never overwritten',async()=>{
  const h=pageHarness('image',()=>response({detail:{message:'模型拒绝',code:'invalid_size'}},400));
  await h.send(); assert.equal(h.recovered.length,0); assert.equal(h.values.has('qa'),false);
  assert.equal(h.elements.get('messageInput').value,'请改字'); assert.equal(vm.runInContext('refs.length',h.context),2);
  const h2=pageHarness('image',()=>{h2.elements.get('messageInput').value='后来写的新草稿';return response({detail:'reject'},400);});
  await h2.send(); assert.equal(h2.elements.get('messageInput').value,'后来写的新草稿');
});

test('actual recovery handler deduplicates concurrent polls, merges result once and removes receipt',async()=>{
  const h=pageHarness('image',()=>response('<html>',504)); await h.send();
  let finish,calls=0;
  h.context.ChatRequestRecovery.poll=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  vm.runInContext(html.slice(html.indexOf('        async function resumePendingRequest('),html.indexOf('        function clearRequestError(')),h.context);
  const p=vm.runInContext('resumePendingRequest(pendingRequestRecords()[0])',h.context);
  await vm.runInContext('resumePendingRequest(pendingRequestRecords()[0])',h.context);
  assert.equal(calls,1);
  finish({status:'succeeded',message:{role:'assistant',request_id:'r1',type:'image',image_url:'/done'}});
  await p;
  assert.equal(h.values.has('qa'),false);
  assert.equal(vm.runInContext("currentConversation.messages.filter(m=>m.role==='assistant').length",h.context),1);
  assert.equal(vm.runInContext("currentConversation.messages.find(m=>m.role==='user').attachments.length",h.context),2);
  assert.equal(vm.runInContext('activeRequests.size',h.context),0);
});
test('unknown recovery remains paused through refresh and auto-resume calls',async()=>{
  const h=pageHarness('image',()=>response('<html>',504)); await h.send();
  let calls=0;
  h.context.ChatRequestRecovery.poll=async()=>{calls++;return {status:'paused',reason:'结果未知'};};
  vm.runInContext(html.slice(html.indexOf('        async function resumePendingRequest('),html.indexOf('        function clearRequestError(')),h.context);
  await vm.runInContext('resumePendingRequest(pendingRequestRecords()[0])',h.context);
  vm.runInContext('resumePendingRequests()',h.context);
  assert.equal(calls,1);
  assert.equal(JSON.parse(h.values.get('qa'))[0].recoveryState,'paused');
});
test('failed-result edit action restores pair/options without overwriting a newer draft; unknown has no retry action',()=>{
  const start=html.indexOf("            if(msg.role === 'assistant' && msg.type === 'error' && msg.status === 'failed')");
  const block=html.slice(start,html.indexOf('            if(msg.attachments?.length)',start));
  const input={value:''}, buttons=[];
  const context=vm.createContext({msg:{role:'assistant',type:'error',status:'failed'},context:{},
    imageRegenerationRequest:()=>({message:'改字',references:[{url:'/source'},{url:'/guide'}],size:'2048x2048',requestOptions:{sizeIsExplicit:true,imageProvider:'mock',imageModel:'model',imageCount:2}}),
    document:{createElement:()=>({}),getElementById:()=>input},bubble:{appendChild:b=>buttons.push(b)},
    alert(){},renderRefs(){},renderModelPicker(){},autoGrow(){},setMode(){},setImageCount(){}});
  vm.runInContext('let refs=[],drawingSize=null,drawingSizeActive=false,activeImageProvider,activeImageModel;'+block,context);
  assert.equal(buttons.length,1);
  input.value='新草稿'; buttons[0].onclick(); assert.equal(input.value,'新草稿');
  input.value=''; buttons[0].onclick(); assert.equal(input.value,'改字');
  assert.equal(vm.runInContext('refs.length',context),2); assert.equal(vm.runInContext('drawingSize.width',context),2048);
  assert.equal(vm.runInContext('activeImageModel',context),'model');
  context.msg.status='outcome_unknown'; vm.runInContext(block,context); assert.equal(buttons.length,1);
});
