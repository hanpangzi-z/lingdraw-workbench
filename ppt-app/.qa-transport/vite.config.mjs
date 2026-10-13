import {defineConfig} from 'vite';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
let project=null,asset=null,slow=false; const counts={create:0,upload:0,save:0,queries:0};
function mock(){return {name:'isolated-ppt-transport',configureServer(server){server.middlewares.use(async(req,res,next)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/qa/reset'){project=null;asset=null;slow=true;Object.keys(counts).forEach(k=>counts[k]=0);res.end('ok');return;}
 if(url.pathname==='/qa/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(counts));return;}
 if(!url.pathname.startsWith('/ppt/api/'))return next();
 res.setHeader('Content-Type','application/json');
 const send=(body,status=200)=>{res.statusCode=status;res.end(JSON.stringify(body))};
 const read=async()=>{let body='';for await(const chunk of req)body+=chunk;return body};
 if(req.method==='GET'){
  counts.queries++;
  if(url.searchParams.has('creationKey'))return send({project});
  if(url.pathname.endsWith('/assets'))return send({asset});
  return send(project);
 }
 if(req.method==='POST'&&url.pathname==='/ppt/api/projects'){
  const input=JSON.parse(await read()); counts.create++;project={id:'qa-project',revision:1,snapshot:{},name:input.name};
  res.statusCode=504;res.setHeader('Content-Type','text/html');res.end('<html>gateway timeout after commit</html>');return;
 }
 if(req.method==='POST'&&url.pathname.endsWith('/assets')){
  await read();counts.upload++;asset={id:'qa-image',url:'/ppt/api/assets/qa-image/content',type:'product_image',fileName:'test.png',mimeType:'image/png',size:68};
  // Long enough to inspect the real disabled creation UI, but no paid upstream.
  await new Promise(resolve=>setTimeout(resolve,slow?20000:4000));res.statusCode=502;res.setHeader('Content-Type','text/html');res.end('<html>bad gateway after upload</html>');return;
 }
 if(req.method==='PUT'){
  const input=JSON.parse(await read());counts.save++;
  if(input.expectedRevision!==project.revision)return send({error:'conflict',code:'REVISION_CONFLICT'},409);
  project={...project,revision:project.revision+1,snapshot:input.snapshot};
  project.snapshot.products=project.snapshot.products.map(p=>({...p,featured:false,images:[p.image],rawData:null}));
  res.statusCode=504;res.setHeader('Content-Type','text/html');res.end('<html>gateway timeout after save</html>');return;
 }
 send({error:'No real service is reachable from this harness'},404);
})}}}
export default defineConfig({root,esbuild:{jsx:'automatic'},resolve:{alias:[
 {find:'@/components/workflow/CatalogWorkflow',replacement:path.join(root,'workflow.jsx')},
 {find:'next/navigation',replacement:path.join(root,'navigation.jsx')},
 {find:'@',replacement:path.dirname(root)}]},plugins:[mock()],server:{host:'127.0.0.1',port:46753,strictPort:true,fs:{allow:[path.dirname(root)]}}});
