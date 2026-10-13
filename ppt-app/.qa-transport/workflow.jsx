import React,{useState} from 'react';
import {useProjectStore} from '../src/store/projectStore';
export function CatalogWorkflow(props) {
 const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const count=useProjectStore(state=>state.products.length);
 return <section><p>已保留 {count} 个商品及图片</p><button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await props.onConfirmGeneration()}catch(e){setError(e.message)}finally{setBusy(false)}}}>生成产品手册</button>
 <button disabled={busy} onClick={async()=>{setBusy(true);try{await Promise.all([props.onConfirmGeneration(),props.onConfirmGeneration()])}catch(e){setError(e.message)}finally{setBusy(false)}}}>连续点击两次</button>
 <p role="alert">{error}</p><p>{props.pendingSaveMessage}</p></section>
}
