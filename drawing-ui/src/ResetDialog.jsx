import React, { useEffect, useRef } from 'react';

export default function ResetDialog({ lang, busy, onCancel, onConfirm }) {
  const dialog = useRef(null);
  const zh = lang === 'zh';
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="transfer-dialog reset-dialog" aria-labelledby="reset-title" aria-describedby="reset-description" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="reset-title">{zh ? '确认重置画布？' : 'Reset this drawing?'}</h2>
    <p id="reset-description" className="transfer-help">{zh ? '此操作会删除当前画板的全部图形、图片、图形库和名称，并清空撤销与重做历史，无法恢复。需要保留内容时，请先取消并导出备份。' : 'This permanently deletes all shapes, images, library items and the drawing name, including undo and redo history. Cancel and export a backup first if you need to keep your work.'}</p>
    <div className="transfer-actions">
      <button type="button" className="action-button" autoFocus onClick={onCancel}>{zh ? '取消' : 'Cancel'}</button>
      <button type="button" className="action-button danger" disabled={busy} onClick={onConfirm}>{zh ? '确认清空' : 'Delete drawing'}</button>
    </div>
  </dialog>;
}
