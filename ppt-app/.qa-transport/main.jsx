import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PendingProjectWorkspace} from '../components/cloud/PendingProjectWorkspace';
import {useProjectStore} from '../src/store/projectStore';
const key=new URLSearchParams(location.search).has('refresh')?'00000000-0000-4000-8000-000000000018':'00000000-0000-4000-8000-000000000017';
function App(){
 const [info,setInfo]=useState('');
 const setup=()=>{
  useProjectStore.setState({products:[{id:'test',productNumber:'1',sku:'T',packageCode:'T',name:'恢复测试商品',details:['保留手动编辑'],price:{currency:'CNY',package:500},deliveryRegions:[],categoryId:'uncategorized',image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6DqsAAAAASUVORK5CYII='}]});
  setInfo('已准备本地合成资料，无用户文件、无付费模型');
 };
 return <main style={{padding:32,fontFamily:'sans-serif',maxWidth:1000}}><h1>PPT 创建恢复验收（隔离模拟服务）</h1><p>实际 PendingProjectWorkspace + 实际上传、保存、草稿代码；仅后端和导航为测试桩。</p>
 <button onClick={setup}>准备测试资料</button><button onClick={()=>location.reload()}>刷新恢复草稿</button>
 <button onClick={async()=>{await fetch('/qa/reset',{method:'POST'});location.href='/?refresh=1'}}>开始刷新场景</button>
 <button onClick={async()=>setInfo(await (await fetch('/qa/status')).text())}>查看请求计数</button><p>{info}</p><div id="destination"/>
 <PendingProjectWorkspace userId="qa-only" initialName="传输恢复测试" draftId={key}/></main>
}
createRoot(document.getElementById('root')).render(<App/>);
