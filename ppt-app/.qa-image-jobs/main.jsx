import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useImageJobs} from '../components/studio/useImageJobs';
// Isolated synthetic test backend: never forwards image API calls to real services.
const rawFetch=window.fetch.bind(window);
const counters=JSON.parse(sessionStorage.getItem('qa-counts')||'{"posts":0,"gets":0,"applied":0}');
function saveCounts(){sessionStorage.setItem('qa-counts',JSON.stringify(counters));window.dispatchEvent(new Event('qa-counts'));}
window.fetch=async(url,options={})=>{
 if(String(url).includes('/api/ai/generate-product-image')){
  const id=options.body.get('jobId');counters.posts++;saveCounts();
  sessionStorage.setItem('qa-job:'+id,JSON.stringify({started:Date.now(),projectId:options.body.get('projectId')}));
  return new Response('<html>gateway timeout</html>',{status:504});
 }
 if(String(url).includes('/api/ai/image-jobs/')){
  counters.gets++;saveCounts();const id=String(url).split('/').pop();const job=JSON.parse(sessionStorage.getItem('qa-job:'+id)||'null');
  return job?Response.json({jobId:id,status:Date.now()-job.started>12000?'succeeded':'generating',result:Date.now()-job.started>12000?{imageUrl:'/synthetic-result.png'}:undefined}):Response.json({error:'missing'},{status:404});
 }
 return rawFetch(url,options);
};
function App(){
 const [project,setProject]=useState('qa-project-a');const [count,setCount]=useState({...counters});
 React.useEffect(()=>{const refresh=()=>setCount({...counters});window.addEventListener('qa-counts',refresh);return()=>window.removeEventListener('qa-counts',refresh)},[]);
 const tasks=useImageJobs(project,async(job,result,automatic)=>{counters.applied++;saveCounts();return true});
 const request={slideId:'slide-a',elementId:'product.a.image',label:'测试商品',prompt:'test',productName:'synthetic',referenceImages:[],aspectRatio:1,projectId:project,providerId:'mock',model:'mock'};
 return <main style={{fontFamily:'sans-serif',padding:30}}><h1>PPT 绘图任务本地验证（模拟服务）</h1><p>当前项目 {project}</p><p>POST {count.posts} / GET {count.gets} / APPLIED {count.applied}</p>
 <button onClick={()=>{tasks.start(request,'data:image/png;base64,'+'x'.repeat(6_000_000));tasks.start(request);}}>连续提交两次</button>
 <button onClick={()=>setProject(project==='qa-project-a'?'qa-project-b':'qa-project-a')}>切换项目</button>
 <button onClick={()=>location.reload()}>刷新恢复</button>
 <p role="alert">{tasks.storageError}</p>
 {Object.values(tasks.jobs).map(job=><section key={job.jobId}><h2>{job.label} · {job.status}</h2><p>{job.message||job.error} 已用时 {job.elapsedSeconds||0} 秒</p><p>编号 {job.jobId}</p>{job.status==='waiting'&&<button onClick={()=>tasks.resume(job)}>继续查询</button>}{job.status==='ready'&&<button onClick={()=>tasks.applyResult(job)}>应用生成结果</button>}</section>)}
 <p>本机任务记录大小 {new Blob([localStorage.getItem('ppt-image-jobs:'+project)||'']).size} 字节</p></main>
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
