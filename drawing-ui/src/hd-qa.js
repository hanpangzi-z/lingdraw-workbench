import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { prepareDrawingSnapshot, renderDrawing } from './drawing-export.js';
import { generationDimensions } from './export-sizing.js';

const result = document.querySelector('#results');
const previews = document.querySelector('#previews');
const urls = [];
const assert = (value, message) => { if (!value) throw new Error(message); };
const log = message => { result.textContent += `${message}\n`; };
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2,'0')).join('');
function fixture(width, height, id) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle='#edf2f9';ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#ee3344';ctx.fillRect(0,0,width/2,height/2);
  ctx.fillStyle='#228844';ctx.fillRect(width/2,height/2,width/2,height/2);
  ctx.font='18px sans-serif';ctx.fillStyle='#152333';
  for(let y=40;y<height;y+=48) ctx.fillText('4K fine print 0123456789 / 原图细小文字',30,y);
  const dataURL = canvas.toDataURL('image/png'); canvas.width=canvas.height=0;
  return {id,dataURL,mimeType:'image/png',created:1};
}
async function pngPixels(blob) {
  const bitmap = await createImageBitmap(blob);
  const size = {width:bitmap.width,height:bitmap.height};
  const canvas = document.createElement('canvas');canvas.width=100;canvas.height=100;
  const ctx = canvas.getContext('2d');ctx.drawImage(bitmap,0,0,100,100);bitmap.close();
  const data=ctx.getImageData(0,0,100,100).data;canvas.width=canvas.height=0;
  return {...size,data};
}
async function scene(name, skeletons, files) {
  const elements = convertToExcalidrawElements(skeletons);
  const original = JSON.stringify({elements,files});
  // A restored old board has only embedded files, with no pixel metadata.
  const saved = JSON.parse(original);
  const snapshot = await prepareDrawingSnapshot(saved.elements,{viewBackgroundColor:'#ffffff'},saved.files);
  const outputs = {};
  for(const quality of ['auto','2k','4k']) {
    const output = await renderDrawing(snapshot,quality);
    const pixels = await pngPixels(output.blob);
    assert(pixels.width===output.size.width && pixels.height===output.size.height,'PNG header differs from reported dimensions');
    assert(Math.max(pixels.width,pixels.height)===(quality==='2k'?2048:quality==='4k'?4096:Math.max(output.size.width,output.size.height)),'Wrong long edge');
    assert(Math.max(pixels.width,pixels.height)<=4096,'Export exceeds 4K cap');
    outputs[quality]=pixels;
    log(`PASS ${name} ${quality}: PNG ${pixels.width}×${pixels.height}`);
    if(quality==='4k') {const img=new Image();const url=URL.createObjectURL(output.blob);urls.push(url);img.src=url;img.alt=name;previews.append(img);}
  }
  // Compare normalized colors: object layout must agree across output scales.
  const classify=(data,i)=>data[i]>180&&data[i+1]<100?'red':data[i+1]>80&&data[i]<90?'green':data[i]>240&&data[i+1]>240?'white':'other';
  let differences=0;
  const colors={red:0,green:0};
  for(let i=0;i<40000;i+=4) if(classify(outputs['2k'].data,i)!==classify(outputs['4k'].data,i)) differences++;
  for(let i=0;i<40000;i+=4) {const color=classify(outputs['4k'].data,i);if(color in colors) colors[color]++;}
  assert(colors.red>100&&colors.green>100,`${name}: expected image/vector landmarks are missing`);
  assert(differences<300,`${name}: geometry differs across scales (${differences}/10000)`);
  assert(await hash(JSON.stringify(saved))===await hash(original),'Original image or vectors were mutated');
  const sketch=generationDimensions(outputs.auto,null,'auto','sketch');
  assert(sketch.width%16===0&&sketch.height%16===0,'Sketch dimensions not aligned');
  if(!skeletons.some(el=>el.type==='image')) assert(Math.max(outputs.auto.width,outputs.auto.height)===2048,'Pure drawing must default to 2K');
  return snapshot;
}
document.querySelector('#run').onclick=async event=>{
  event.target.disabled=true;urls.splice(0).forEach(URL.revokeObjectURL);previews.replaceChildren();result.textContent='';
  try {
    const files={landscape:fixture(4096,2304,'landscape'),portrait:fixture(2304,4096,'portrait')};
    await scene('4K 横图细字',[{type:'image',fileId:'landscape',x:0,y:0,width:960,height:540}],files);
    await scene('4K 竖图细字',[{type:'image',fileId:'portrait',x:0,y:0,width:540,height:960}],files);
    await scene('纯绘画',[{type:'rectangle',x:0,y:0,width:480,height:240,backgroundColor:'#ee3344',fillStyle:'solid',roughness:0},{type:'ellipse',x:600,y:320,width:160,height:160,backgroundColor:'#228844',fillStyle:'solid'}],{});
    const snapshot=await scene('多图、裁剪、旋转及画布外标注',[
      {type:'image',fileId:'landscape',x:0,y:0,width:480,height:540,crop:{x:0,y:0,width:2048,height:2304,naturalWidth:4096,naturalHeight:2304},angle:Math.PI/6},
      {type:'image',fileId:'portrait',x:620,y:60,width:270,height:480,angle:-Math.PI/9,scale:[-1,1]},
      {type:'arrow',x:-220,y:-100,points:[[0,0],[280,220]],strokeColor:'#8844dd',strokeWidth:4},
      {type:'text',x:980,y:720,text:'画布外修改说明 / Keep fine details',fontSize:24},
    ],files);
    const abort=new AbortController();abort.abort();
    for(const operation of [()=>prepareDrawingSnapshot(snapshot.elements,snapshot.appState,snapshot.files,abort.signal),()=>renderDrawing(snapshot,'4k',abort.signal)]) {
      await operation().then(()=>{throw new Error('Cancelled render unexpectedly succeeded');},error=>assert(error.name==='AbortError','Cancellation should report AbortError'));
    }
    log('PASS cancelled decode/render does not create a final file');
    const toBlob=HTMLCanvasElement.prototype.toBlob;let failedCanvas;
    try {
      HTMLCanvasElement.prototype.toBlob=function(callback){failedCanvas=this;callback(null);};
      await renderDrawing(snapshot,'4k').then(()=>{throw new Error('Failed encoding unexpectedly succeeded');},error=>assert(error.message.includes('导出失败'),'Encoding error was hidden'));
      assert(failedCanvas.width===0&&failedCanvas.height===0,'Failed export retained backing buffer');
    } finally { HTMLCanvasElement.prototype.toBlob=toBlob; }
    log('PASS encoding failure releases backing canvas; snapshot remains available');
    const recovered=await renderDrawing(snapshot,'4k');assert(Math.max(recovered.size.width,recovered.size.height)===4096,'Recovery changed quality');
    log('ALL CHECKS PASSED');
  } catch(error) {log(`FAIL ${error.stack}`);} finally {event.target.disabled=false;}
};
window.addEventListener('pagehide',()=>urls.splice(0).forEach(URL.revokeObjectURL));
