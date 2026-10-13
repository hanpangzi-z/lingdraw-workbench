import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { prepareDrawingSnapshot, renderDrawingCached } from './drawing-export.js';
const out=document.querySelector('#results');
const log=value=>out.textContent+=value+'\n';
const assert=(value,message)=>{if(!value)throw Error(message);};
const urls=[];
document.querySelector('#run').onclick=async event=>{
  event.target.disabled=true;out.textContent='';
  try {
    const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1000;
    const ctx=canvas.getContext('2d');
    const gradient=ctx.createLinearGradient(0,0,1600,1000);gradient.addColorStop(0,'#dce8e1');gradient.addColorStop(1,'#876563');ctx.fillStyle=gradient;ctx.fillRect(0,0,1600,1000);
    ctx.font='20px sans-serif';ctx.fillStyle='#111';for(let y=50;y<950;y+=50)ctx.fillText('牛肉礼盒 · 立即购买 · Fine print 0123456789',70,y);
    const file={id:'test',dataURL:canvas.toDataURL('image/png'),mimeType:'image/png',created:1};canvas.width=canvas.height=0;
    const elements=convertToExcalidrawElements([{type:'image',fileId:'test',x:0,y:0,width:1600,height:1000},{type:'arrow',x:1700,y:300,points:[[0,0],[-500,200]],strokeColor:'#ff0000',strokeWidth:3},{type:'text',x:1620,y:200,text:'文案换成：牛肉礼盒\n文案换成：立即购买',fontSize:24,strokeColor:'#ff0000'}]);
    const snap=await prepareDrawingSnapshot(elements,{viewBackgroundColor:'#ffffff'},{test:file});
    let start=performance.now();const png=await renderDrawingCached(snap,'2k');const first=performance.now()-start;
    start=performance.now();const cached=await renderDrawingCached(snap,'2k');const second=performance.now()-start;
    assert(png===cached,'Unchanged snapshot must reuse exact export');
    const light=await renderDrawingCached(snap,'2k',undefined,true);
    assert(light.size.width===png.size.width&&light.size.height===png.size.height,'Lightweight path changed pixel dimensions');
    assert(light.blob.size<=png.blob.size,'Lightweight path enlarged the file');
    assert(snap.files.test.dataURL===file.dataURL,'Original bytes changed');
    const revised={...snap,elements:[...snap.elements,{...snap.elements.at(-1),text:'新的修改要求',originalText:'新的修改要求',version:2}]};
    const changed=await renderDrawingCached(revised,'2k');assert(changed!==png,'Changed scene reused stale export');
    const large=await renderDrawingCached(snap,'4k');assert(Math.max(large.size.width,large.size.height)===4096,'Quality change reused stale size');
    for(const [name,image] of [['PNG 保真',png],['轻量标注',light]]) {const figure=document.createElement('figure');const caption=document.createElement('figcaption');caption.textContent=name;const img=document.createElement('img');const url=URL.createObjectURL(image.blob);urls.push(url);img.src=url;img.alt=name;img.style.width='700px';figure.append(caption,img);document.querySelector('#previews').append(figure);}
    log(JSON.stringify({firstExportMs:Math.round(first),cachedExportMs:Number(second.toFixed(2)),pngBytes:png.blob.size,lightBytes:light.blob.size,lightMime:light.blob.type,pixels:light.size},null,2));
    log('PASS 缓存复用、修改失效、清晰度切换、原图不变、轻量图尺寸不变');
  } catch(error) {log('FAIL '+error.stack);} finally {event.target.disabled=false;}
};
window.addEventListener('pagehide',()=>urls.forEach(URL.revokeObjectURL));
