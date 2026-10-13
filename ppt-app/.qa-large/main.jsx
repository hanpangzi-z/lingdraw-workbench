import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PendingProjectEntry } from '@/components/cloud/PendingProjectEntry';
import { readDraft, writeDraft } from '@/src/lib/cloud/localDraft';
import { encodeDraft, DRAFT_PART_BYTES } from '@/src/lib/cloud/draftCodec';
import { catalogMeta } from '@/data/catalog';
import { mockProducts } from '@/data/mock-products';
import { emptyEditorState } from '@/types/editor';
import '../app/cloud.css';
const slot = 'ppt-pending:qa-large:隔离大草稿';
const mib = 1024 * 1024;
async function legacyPut(key, value) {
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open('lingdraw-ppt-local-drafts', 1); r.onupgradeneeded = () => r.result.createObjectStore('drafts'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { await new Promise((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); try { tx.objectStore('drafts').put(value, key); } catch (e) { tx.abort(); reject(e); } }); } finally { db.close(); }
}
function fixture() {
  const image = 'data:image/png;base64,' + btoa('*'.repeat(3 * mib));
  return { files: [new File([new Uint8Array(39 * mib).fill(19)], '39MiB-合成源文件.xlsx', { lastModified: 1234 })], sourceFilesComplete: true,
    state: { project: {...catalogMeta, projectName: '大草稿编辑结果'}, step: 'confirm', products: Array.from({length:10}, (_, i) => ({...mockProducts[0], id: 'qa-' + i, name: '保留编辑-' + i, image, images: Array(8).fill(image), rawData: { image }})), editorState: emptyEditorState(), layoutOverrides: {} }, batch: {} };
}
const checksum = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2,'0')).join('');
function App() {
  const [result, setResult] = useState('等待验证'); const [busy, setBusy] = useState(false); const [entry, setEntry] = useState(false); const [run, setRun] = useState(0); const [draftId, setDraftId] = useState(new URL(location.href).searchParams.get('draft') || undefined);
  useEffect(() => { const update = () => { setDraftId(new URL(location.href).searchParams.get('draft') || undefined); setRun(x => x + 1); }; window.addEventListener('qa-navigation', update); return () => window.removeEventListener('qa-navigation', update); }, []);
  const task = async action => { setBusy(true); setResult('测试中…'); const start = performance.now(); try { setResult(JSON.stringify({ ...await action(), elapsedSeconds: ((performance.now()-start)/1000).toFixed(2) },null,2)); } catch(e) { setResult(String(e)); } finally { setBusy(false); } };
  const seed = async () => {
    const data = fixture(); data.files = [new File(['legacy-source'], '旧资料.xlsx')]; data.state.products = [data.state.products[0]];
    await legacyPut(`${slot}:legacy-qa`, data); sessionStorage.setItem(slot, 'legacy-qa');
    history.replaceState({}, '', '/'); setDraftId(undefined); setRun(x=>x+1); setEntry(true); return {legacySeeded: true};
  };
  return <><h1>仅本机合成数据，不连接生产 API</h1><div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
    <button disabled={busy} onClick={()=>task(async()=>{try { await legacyPut('oversize-proof',fixture()); return {unexpected:'旧版没有报错'}; } catch(e) {return {oldVersionError: String(e), repeatedImageTextMiB:400, sourceFileMiB:39}; }})}>复现旧版超限</button>
    <button disabled={busy} onClick={()=>task(async()=>{const data=fixture(); const encoded=await encodeDraft(data); await writeDraft('large-proof',data); return {saved:true, repeatedImageTextMiB:400, sourceFileMiB:39, metadataBytes:encoded.metadata.size, uniqueAssets:encoded.assets.size, binaryAssetsMiB:[...encoded.assets.values()].reduce((n,b)=>n+b.size,0)/mib, maxPartMiB:DRAFT_PART_BYTES/mib};})}>保存新版大草稿</button>
    <button disabled={busy} onClick={()=>task(async()=>{const restored=await readDraft('large-proof'); const expected=fixture(); return {restored:!!restored, products:restored.state.products.length, editsIntact:restored.state.products.every((p,i)=>p.name==='保留编辑-'+i), imagesIntact:restored.state.products.every(p=>p.image===expected.state.products[0].image && p.images.every(v=>v===p.image) && p.rawData.image===p.image), sourceFile:restored.files[0].name, sourceBytes:restored.files[0].size, sourceChecksumMatches:await checksum(restored.files[0])===await checksum(expected.files[0]), lastModified:restored.files[0].lastModified};})}>读取并核对大草稿</button>
    <button disabled={busy} onClick={()=>task(seed)}>准备旧第三步草稿</button>
    <button disabled={busy} onClick={()=>{setEntry(true); history.replaceState({},'','/');setDraftId(undefined);setRun(x=>x+1);}}>打开新建入口</button>
    <button disabled={busy} onClick={()=>{setEntry(true);setRun(x=>x+1);}}>挂载当前页面草稿</button>
  </div><pre style={{whiteSpace:'pre-wrap'}}>{result}</pre>{entry && <PendingProjectEntry key={run} userId="qa-large" initialName="隔离大草稿" draftId={draftId} />}</>;
}
createRoot(document.getElementById('root')).render(<App/>);
