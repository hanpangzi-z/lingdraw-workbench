import React, { Component, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, MainMenu, WelcomeScreen, CaptureUpdateAction, convertToExcalidrawElements, getCommonBounds, getDataURL, exportToSvg } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { documentState } from './persistence.js';
import { createServerBoardStore } from './serverPersistence.js';
import { createImportQueue, resolveImageSource, loadImageFile } from './image-import.js';
import { originalImageBlob } from './annotation-export.js';
import TransferDialog from './TransferDialog.jsx';
import ResetDialog from './ResetDialog.jsx';
import { prepareDrawingSnapshot, renderDrawing, renderDrawingCached } from './drawing-export.js';
import { assetReference, checkReferences, uploadFiles, transferProgress } from './transfer-upload.js';
import './styles.css';

const copy = {
  zh: { importing: '正在导入图片…', importDone: '图片已导入，可以开始标注', importError: '图片导入失败，请返回创意生图重试', reset: '重置画布', resetHelp: '彻底清空画板、图片缓存和历史记录，无法撤销', resetDone: '画板及缓存已清空，无法撤销', resetting: '正在清空画板和缓存…', resetError: '缓存清理失败，请重试', resetRetry: '重试清空', title: '绘画标注', untitled: '未命名画板', name: '画板名称', loading: '正在打开画板…', saved: '已保存到此浏览器', saving: '正在保存…', failed: '保存失败，请导出备份', retry: '重试保存', send: '导入创意生图', sending: '正在导入创意生图…', sendHelp: '将整张画布导出为图片并添加到创意生图附件', sendError: '导入创意生图失败，请重试。', openStudio: '请从灵绘工作台打开绘画标注后使用。', export: '导出图片', exporting: '正在导出…', empty: '画图、写字，或拖入图片开始标注', hint: '用画笔记录想法，用箭头和文字补充说明。', privacy: '保存到账号，本机保留恢复缓存', loadError: '暂时无法打开画板', loadHelp: '请检查登录状态和浏览器存储权限后重试。', reload: '重新打开', exportError: '导出失败，请重试。', exportHelp: '导出包含图片与标注的 PNG 图片', local: '本地画板', tools: '选择工具开始绘画', menu: '打开、保存或新建画板' },
  en: { importing: 'Importing image…', importDone: 'Image imported. Ready to annotate.', importError: 'Image import failed. Return to Creative Images and try again.', reset: 'Reset canvas', resetHelp: 'Permanently clear the board, cached images and history. Cannot be undone.', resetDone: 'Board and cache cleared. This cannot be undone.', resetting: 'Clearing board and cache…', resetError: 'Unable to clear the cache. Please retry.', resetRetry: 'Retry clearing', title: 'Draw & Annotate', untitled: 'Untitled drawing', name: 'Drawing name', loading: 'Opening drawing…', saved: 'Saved in this browser', saving: 'Saving…', failed: 'Save failed. Export a backup.', retry: 'Retry save', send: 'Use in Creative Images', sending: 'Sending to Creative Images…', sendHelp: 'Export the full canvas and attach it in Creative Images', sendError: 'Unable to send the canvas. Please try again.', openStudio: 'Open Draw & Annotate from the LingDraw workspace to use this action.', export: 'Export PNG', exporting: 'Exporting…', empty: 'Draw, write, or drop an image to annotate', hint: 'Sketch an idea. Add arrows and notes to make it clear.', privacy: 'Saved to your account with a local recovery cache', loadError: 'Unable to open your drawing', loadHelp: 'Check your sign-in and browser storage permissions, then retry.', reload: 'Try again', exportError: 'Export failed. Please try again.', exportHelp: 'Export your drawing and annotations as a PNG image', local: 'Local drawing', tools: 'Choose a tool to start drawing', menu: 'Open, save, or start a drawing' },
};

function preference(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function emptyBoard() {
  return { elements: [], appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: 2, scrollX: 0, scrollY: 0, zoom: { value: 1 }, gridModeEnabled: false }, files: {}, libraryItems: [], name: '' };
}

function Icon({ kind }) {
  const paths = {
    pen: <><path d="m16 3 5 5-12 12-6 1 1-6L16 3Z" /><path d="m13 6 5 5M3 21l4-4" /></>,
    send: <><path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1" /><path d="m3 16 5-5 4 4 4-6 5 8" /></>,
    reset: <><path d="M3 10a9 9 0 1 1 2.6 8.4" /><path d="M3 4v6h6" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

const downloadUrls = new Set();
function releaseDownloads() { downloadUrls.forEach(url => URL.revokeObjectURL(url)); downloadUrls.clear(); }
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  downloadUrls.add(url);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 30000);
}

class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="loading-screen" role="alert"><h1>画板加载失败</h1><p>请重新打开页面；已保存的画板会保留。</p><button onClick={() => location.reload()}>重新打开</button></div>;
    return this.props.children;
  }
}

function DrawingApp() {
  const [lang, setLang] = useState(() => preference('studio_lang', 'zh') === 'en' ? 'en' : 'zh');
  const [theme, setTheme] = useState(() => preference('studio_theme', 'light') === 'dark' ? 'dark' : 'light');
  const [initialData, setInitialData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('saved');
  const [hasElements, setHasElements] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [editorReady, setEditorReady] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingLock = useRef(false);
  const [transferStage, setTransferStage] = useState(null);
  const [transferElapsed, setTransferElapsed] = useState(0);
  const originalReferences = useRef(new Map());
  const uploadReceipts = useRef(new WeakMap());
  const snapshotCache = useRef(null);
  const [transferSnapshot, setTransferSnapshot] = useState(null);
  const [transferError, setTransferError] = useState('');
  const [exportIntent, setExportIntent] = useState('chat');
  const exportController = useRef(null);
  const [resetting, setResetting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [editorSession, setEditorSession] = useState(0);
  const [serverBoards, setServerBoards] = useState([]);
  const [resetFailed, setResetFailed] = useState(false);
  const resetInProgress = useRef(false);
  const chatTransfer = useRef(null);
  const api = useRef(null);
  const currentLang = useRef(lang);
  currentLang.current = lang;
  const importQueue = useRef(null);
  const bindEditor = useCallback(value => { api.current = value; setEditorReady(Boolean(value)); }, []);
  const preserveUploadedImage = useCallback(async file => {
    const editor = api.current;
    if (!editor || resetInProgress.current) throw new Error('画布暂不可用，请重试');
    if (file.size > 50 * 1024 * 1024) throw new Error('图片超过 50MB，请选择更小的文件');
    const id = crypto.randomUUID();
    if (/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) {
      const dataURL = await getDataURL(file);
      if (api.current !== editor || resetInProgress.current) throw new Error('画布已重置，请重新导入');
      // Excalidraw checks existing files after this hook. Preloading the original
      // prevents its native picker/drop/paste path from resizing images to 1440px.
      editor.addFiles([{ id, dataURL, mimeType: file.type, created: Date.now() }]);
    }
    return id;
  }, []);
  const store = useRef(null);
  const board = useRef(null);
  const timer = useRef(null);
  const version = useRef(0);
  const persistedVersion = useRef(0);
  const sceneSignature = useRef('');
  const saveQueue = useRef(Promise.resolve());
  const t = copy[lang];
  useEffect(() => {
    if (!sending) return;
    const start = Date.now(); setTransferElapsed(0);
    const timer = setInterval(() => setTransferElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [sending]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (resetInProgress.current || !board.current || !store.current || version.current === persistedVersion.current) return;
    const revision = version.current;
    const snapshot = { ...board.current, updatedAt: Date.now() };
    // Serialize writes so an older transaction cannot finish after a newer save.
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => store.current.save(snapshot)).then(result => {
      if (result?.localOnly) { setStatus('local'); return; }
      persistedVersion.current = revision;
      if (version.current === revision) setStatus('saved');
      store.current.list().then(setServerBoards).catch(() => {});
    }).catch(error => setStatus(error.status === 409 || error.status === 404 ? 'conflict' : 'failed'));
  }, []);

  const scheduleSave = useCallback(() => {
    version.current += 1;
    setStatus('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 250);
  }, [flush]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch('/api/auth/status', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('Sign-in unavailable');
        const account = await response.json();
        if (!account.authenticated || !account.username) throw new Error('Sign in required');
        const storage = createServerBoardStore(account.username, setStatus);
        const saved = await storage.load();
        if (cancelled) { storage.close(); return; }
        store.current = storage;
        storage.list().then(setServerBoards).catch(() => {});
        board.current = saved || emptyBoard();
        if (storage.isDirty()) { version.current += 1; setTimeout(flush, 1000); }
        setName(board.current.name || '');
        setHasElements(board.current.elements.some(element => !element.isDeleted));
        setInitialData({ elements: board.current.elements, appState: board.current.appState, files: board.current.files, libraryItems: board.current.libraryItems });
      } catch {
        if (!cancelled) setLoadError(true);
      }
    }
    load();
    const message = event => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      if (event.data?.type === 'lingdraw:chat-import-result' && event.data.requestId === chatTransfer.current?.requestId) {
        const pending = chatTransfer.current;
        chatTransfer.current = null;
        clearTimeout(pending.timer);
        if (event.data.ok) pending.resolve();
        else pending.reject(new Error(event.data.message || copy[currentLang.current].sendError));
      }
      if (event.data?.type === 'studio-theme') setTheme(event.data.theme === 'dark' ? 'dark' : 'light');
      if (event.data?.type === 'studio-lang') setLang(event.data.lang === 'en' ? 'en' : 'zh');
    };
    const hide = () => { if (document.visibilityState === 'hidden') flush(); };
    const pageHide = () => { flush(); exportController.current?.abort(); releaseDownloads(); };
    const leave = event => {
      if (version.current !== persistedVersion.current) {
        flush();
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('message', message);
    window.addEventListener('beforeunload', leave);
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('online', flush);
    const syncTimer = setInterval(() => { if (store.current?.isDirty()) flush(); }, 15000);
    document.addEventListener('visibilitychange', hide);
    return () => {
      cancelled = true;
      exportController.current?.abort();
      releaseDownloads();
      flush();
      window.removeEventListener('message', message);
      window.removeEventListener('beforeunload', leave);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('online', flush);
      clearInterval(syncTimer);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [flush]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    document.title = `${copy[lang].title} · 灵绘`;
  }, [theme, lang]);

  const onChange = useCallback((elements, appState, files) => {
    if (resetInProgress.current || !board.current) return;
    const state = documentState(appState);
    const signature = elements.map(element => `${element.id}:${element.version}:${element.versionNonce}:${element.isDeleted}`).join('|')
      + JSON.stringify(state) + Object.keys(files).join('|');
    if (signature === sceneSignature.current) return;
    sceneSignature.current = signature;
    // Excalidraw elements are immutable; preserve file data alongside the scene for image recovery.
    board.current = { ...board.current, elements, appState: state, files };
    setHasElements(elements.some(element => !element.isDeleted));
    scheduleSave();
  }, [scheduleSave]);

  const rename = event => {
    const nextName = event.target.value;
    setName(nextName);
    board.current = { ...board.current, name: nextName };
    scheduleSave();
  };

  useEffect(() => {
    if (!editorReady || !initialData) return;
    if (!importQueue.current) importQueue.current = createImportQueue(async payload => {
      const text = copy[currentLang.current];
      if (resetInProgress.current) return { ok: false, message: text.resetting };
      setImporting(true);
      setNotice('');
      try {
        const existingImport = api.current.getSceneElements().find(element => element.customData?.lingdrawImportId === payload.requestId);
        if (existingImport) return { ok: true };
        const sourceUrl = resolveImageSource(payload.sourceUrl, location.origin);
        const { blob, width, height } = await loadImageFile(sourceUrl);
        const dataURL = await getDataURL(blob);
        const elements = api.current.getSceneElements();
        const bounds = elements.length ? getCommonBounds(elements) : null;
        const fileId = crypto.randomUUID();
        const reference = assetReference(sourceUrl, String(payload.filename || '原图.png'), blob.type, location.origin);
        if (reference) {
          if (originalReferences.current.size >= 2) originalReferences.current.delete(originalReferences.current.keys().next().value);
          originalReferences.current.set(fileId, { dataURL, blob, reference });
        }
        const [image] = convertToExcalidrawElements([{
          type: 'image', fileId, x: bounds ? bounds[2] + 80 : 0, y: bounds ? bounds[1] : 0,
          width, height, status: 'saved', scale: [1, 1], crop: null,
          customData: { lingdrawImportId: payload.requestId, filename: String(payload.filename || '') },
        }]);
        api.current.addFiles([{ id: fileId, dataURL, mimeType: blob.type, created: Date.now() }]);
        api.current.setActiveTool({ type: 'selection' });
        api.current.updateScene({
          elements: [...api.current.getSceneElementsIncludingDeleted(), image],
          appState: { selectedElementIds: { [image.id]: true }, selectedGroupIds: {}, editingGroupId: null, openDialog: null },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        api.current.scrollToContent(image, { fitToViewport: true, viewportZoomFactor: .7, maxZoom: 1, animate: false });
        api.current.setToast({ message: text.importDone });
        return { ok: true };
      } catch {
        setNotice(text.importError);
        return { ok: false, message: text.importError };
      } finally { setImporting(false); }
    });
    const receive = event => {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'lingdraw:import-image') return;
      const payload = event.data;
      if (typeof payload.requestId !== 'string' || !payload.requestId || payload.requestId.length > 100) return;
      importQueue.current.enqueue(payload).then(result => {
        window.parent.postMessage({ type: 'lingdraw:drawing-import-result', requestId: payload.requestId, ...result }, location.origin);
      });
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'lingdraw:drawing-ready' }, location.origin);
    return () => window.removeEventListener('message', receive);
  }, [editorReady, initialData]);

  const resetCanvas = async () => {
    if (!store.current || resetInProgress.current || importing || sending || exporting) return;
    setResetConfirmOpen(false);
    resetInProgress.current = true;
    version.current += 1;
    setEditorSession(value => value + 1);
    setResetting(true);
    setResetFailed(false);
    setNotice('');
    exportController.current?.abort();
    setTransferSnapshot(null);
    setTransferError('');
    releaseDownloads();
    originalReferences.current.clear();
    uploadReceipts.current = new WeakMap();
    snapshotCache.current = null;
    clearTimeout(timer.current);
    // Unmount the editor to discard its file/image caches, library and both
    // history stacks. No deleted elements or previous initialData are retained.
    board.current = null;
    api.current = null;
    importQueue.current = null;
    setEditorReady(false);
    setInitialData(null);
    setName('');
    setHasElements(false);
    sceneSignature.current = '';
    try {
      // Delete after every already queued save, so an old snapshot cannot
      // repopulate IndexedDB after reset. New writes are blocked until done.
      saveQueue.current = saveQueue.current.catch(() => {}).then(() => store.current.clear());
      await saveQueue.current;
      const blank = emptyBoard();
      board.current = blank;
      persistedVersion.current = version.current;
      setStatus('saved');
      setInitialData(blank);
      setNotice(t.resetDone);
    } catch {
      setResetFailed(true);
    } finally {
      resetInProgress.current = false;
      setResetting(false);
    }
  };

  const fileName = () => (name.trim() || t.untitled).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  const closeTransfer = () => { exportController.current?.abort(); setTransferSnapshot(null); setTransferError(''); };
  const prepareTransfer = async (intent = 'chat') => {
    if (!api.current || !hasElements || exporting || sending || importing) return;
    setExporting(true);
    setExportIntent(intent);
    setNotice('');
    setTransferError('');
    if (intent === 'chat') window.parent.postMessage({ type: 'lingdraw:prepare-chat' }, location.origin);
    const controller = new AbortController();
    exportController.current = controller;
    try {
      const files = api.current.getFiles();
      const signature = sceneSignature.current + JSON.stringify(api.current.getAppState().selectedElementIds);
      const fileVersions = Object.entries(files).map(([id, file]) => [id, file.dataURL]);
      const cached = snapshotCache.current;
      const filesMatch = cached?.fileVersions.length === fileVersions.length && fileVersions.every(([id, data], index) => cached.fileVersions[index][0] === id && cached.fileVersions[index][1] === data);
      const snapshot = cached?.signature === signature && filesMatch ? cached.snapshot
        : await prepareDrawingSnapshot(api.current.getSceneElements(), api.current.getAppState(), api.current.getFiles(), controller.signal);
      snapshotCache.current = { signature, snapshot, fileVersions };
      setTransferSnapshot(snapshot);
    } catch (error) { if (error.name !== 'AbortError') setNotice(error.message || t.exportError); }
    finally { setExporting(false); }
  };

  const sendToChat = async ({ mode, source, prompt, quality, generationSize, lightweight }) => {
    if (!transferSnapshot || sendingLock.current) return;
    sendingLock.current = true;
    setSending(true);
    setTransferStage({ stage: '正在导出标注图' });
    setTransferError('');
    const controller = new AbortController();
    exportController.current = controller;
    const uploadTimeout = setTimeout(() => controller.abort(), 180000);
    try {
      if (window.parent === window) throw new Error(t.openStudio);
      const rendered = await renderDrawingCached(transferSnapshot, quality, controller.signal, mode === 'annotation' && lightweight);
      if (rendered.blob.size > 50 * 1024 * 1024) throw new Error('高清图片超过 50MB，请降低导出清晰度或缩小画布范围');
      const requestId = crypto.randomUUID();
      const items = [];
      if (mode === 'annotation') {
        const known = originalReferences.current.get(source.file.id);
        const unchanged = known?.dataURL === source.file.dataURL;
        const original = unchanged ? known.blob : originalImageBlob(source.file);
        items.push({ blob: original, name: `${fileName()}-原图.${original.type.split('/')[1]}`, reference: unchanged ? known.reference : undefined });
        if (!unchanged) {
          if (originalReferences.current.size >= 2) originalReferences.current.delete(originalReferences.current.keys().next().value);
          originalReferences.current.set(source.file.id, { dataURL: source.file.dataURL, blob: original });
        }
      }
      items.push({ blob: rendered.blob, name: `${fileName()}-${mode === 'annotation' ? '标注说明' : '草图'}.${rendered.blob.type === 'image/webp' ? 'webp' : 'png'}` });
      items.forEach(item => { item.reference = uploadReceipts.current.get(item.blob) || item.reference; });
      setTransferStage({ stage: '正在核对可复用图片' });
      const available = await checkReferences(items.map(item => item.reference).filter(Boolean), controller.signal);
      const pending = items.filter(item => !item.reference || !available.has(item.reference.url));
      if (pending.length) {
        setTransferStage({ stage: `正在上传 ${pending.length} 张图片` });
        const uploaded = await uploadFiles(pending, controller.signal, progress => setTransferStage({ stage: progress.total && progress.loaded >= progress.total ? '图片已发送，等待服务器确认' : `正在上传 ${pending.length} 张图片`, ...progress }));
        pending.forEach((item, index) => { item.reference = uploaded[index]; uploadReceipts.current.set(item.blob, item.reference); });
      }
      const references = items.map((item, index) => ({ ...item.reference, name: item.name, role: mode === 'annotation' ? (index === 0 ? 'source' : 'annotation') : 'sketch', annotation_group: mode === 'annotation' ? requestId : '' }));
      setTransferStage({ stage: pending.length ? '上传已完成，正在交接创意生图' : '图片已复用，正在交接创意生图' });
      clearTimeout(uploadTimeout);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          chatTransfer.current = null;
          reject(new Error(t.sendError));
        }, 70000);
        chatTransfer.current = { requestId, timer, resolve, reject };
        window.parent.postMessage({ type: 'lingdraw:open-chat', requestId, mode, references, prompt, canvasSize: rendered.size, generationSize }, location.origin);
      });
      setTransferSnapshot(null);
    } catch (error) {
      setTransferError(error.name === 'AbortError' ? t.sendError : (error.message || t.sendError));
    } finally {
      clearTimeout(uploadTimeout);
      sendingLock.current = false;
      setSending(false);
    }
  };
  const exportImage = async ({ quality }) => {
    if (!transferSnapshot || exporting || sending) return;
    setExporting(true);
    setTransferError('');
    const controller = new AbortController();
    exportController.current = controller;
    try {
      const { blob } = await renderDrawing(transferSnapshot, quality, controller.signal);
      download(blob, `${fileName()}.png`);
      setTransferSnapshot(null);
    } catch (error) { setTransferError(error.message || t.exportError); }
    finally { setExporting(false); }
  };
  const exportSvgImage = async () => {
    if (!api.current || !hasElements || exporting || sending || importing) return;
    setExporting(true);
    setNotice('');
    try {
      const svg = await exportToSvg({ elements: api.current.getSceneElements(), files: api.current.getFiles(), appState: { ...api.current.getAppState(), exportBackground: true, exportWithDarkMode: false }, exportPadding: 32 });
      download(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }), `${fileName()}.svg`);
    } catch (error) { setNotice(error.message || t.exportError); }
    finally { setExporting(false); }
  };

  if (resetting) return <main className="loading-screen" role="status"><span className="loading-dot" />{t.resetting}</main>;
  if (resetFailed) return <main className="loading-screen" role="alert"><Icon kind="reset" /><h1>{t.resetError}</h1><button onClick={resetCanvas}>{t.resetRetry}</button></main>;
  if (loadError) return <main className="loading-screen" role="alert"><Icon kind="pen" /><h1>{t.loadError}</h1><p>{t.loadHelp}</p><button onClick={() => location.reload()}>{t.reload}</button></main>;
  if (!initialData) return <main className="loading-screen" role="status"><span className="loading-dot" />{t.loading}</main>;

  return <main className="drawing-app">
    <header className="drawing-header">
      <div className="drawing-identity"><span className="drawing-mark"><Icon kind="pen" /></span><h1>{t.title}</h1><span className="header-divider" /><input className="drawing-name" aria-label={t.name} value={name} placeholder={t.untitled} maxLength={80} onChange={rename} onBlur={flush} /></div>
      <div className="header-actions">
        <button className="action-button" onClick={async () => {
          flush();
          resetInProgress.current = true;
          setInitialData(null);
          try {
            await saveQueue.current;
            if (store.current.isDirty()) throw new Error('Resolve the current drawing first');
            await store.current.saveCopy(emptyBoard());
            persistedVersion.current = version.current;
            location.reload();
          } catch {
            resetInProgress.current = false;
            setInitialData({ elements: board.current.elements, appState: board.current.appState, files: board.current.files, libraryItems: board.current.libraryItems });
            setNotice(lang === 'zh' ? '新建失败，请先同步当前修改或处理版本冲突' : 'Resolve current changes before creating a drawing');
          }
        }}>{lang === 'zh' ? '新建作品' : 'New drawing'}</button>
        {serverBoards.length > 0 && <select aria-label={lang === 'zh' ? '服务器作品' : 'Server drawings'} value={store.current?.currentId() || ''} onChange={async event => {
          const id = event.target.value;
          flush();
          resetInProgress.current = true;
          setInitialData(null);
          try {
            await saveQueue.current;
            if (store.current.isDirty()) throw new Error('Save local changes or resolve the conflict first');
            await store.current.loadServer(id);
            persistedVersion.current = version.current;
            location.reload();
          } catch {
            resetInProgress.current = false;
            setInitialData({ elements: board.current.elements, appState: board.current.appState, files: board.current.files, libraryItems: board.current.libraryItems });
            setNotice(lang === 'zh' ? '切换失败，请先同步本机修改或处理版本冲突' : 'Resolve local changes before switching drawings');
          }
        }}>
          <option value="" disabled>{lang === 'zh' ? '选择作品' : 'Choose a drawing'}</option>
          {serverBoards.map(item => <option key={item.id} value={item.id}>{item.name || t.untitled}</option>)}
        </select>}
        <span className={`save-state ${status}`} role="status" title={lang === 'zh' ? '保存到账号，可在其他设备读取' : 'Saved to your account'}><span className="status-dot" />{status === 'saved' ? (lang === 'zh' ? '已保存到服务器' : 'Saved to server') : status === 'local' ? (lang === 'zh' ? '仅保存在本机，等待同步' : 'Saved locally; waiting to sync') : status === 'conflict' ? (lang === 'zh' ? '服务器版本已更新，本机修改已保留' : 'Server version changed; local edits retained') : t[status]}</span>
        {['failed', 'local'].includes(status) && <button className="retry-button" onClick={flush}>{t.retry}</button>}
        {status === 'conflict' && <>
          <button className="retry-button" onClick={async () => {
            const revision = version.current;
            const snapshot = board.current;
            saveQueue.current = saveQueue.current.catch(() => {}).then(() => store.current.saveCopy(snapshot)).then(result => {
              if (!result.localOnly) { persistedVersion.current = revision; if (version.current === revision) setStatus('saved'); }
            }).catch(() => setNotice(lang === 'zh' ? '另存失败，本机副本仍保留' : 'Copy failed. Local edits retained.'));
            await saveQueue.current;
          }}>{lang === 'zh' ? '另存为副本' : 'Save a copy'}</button>
          <button className="retry-button" onClick={async () => {
            resetInProgress.current = true;
            clearTimeout(timer.current);
            try { await saveQueue.current.catch(() => {}); await store.current.loadServer(); persistedVersion.current = version.current; location.reload(); }
            catch { resetInProgress.current = false; setNotice(lang === 'zh' ? '载入失败，本机副本仍保留' : 'Unable to load. Local copy retained.'); }
          }}>{lang === 'zh' ? '载入服务器版本' : 'Load server version'}</button>
        </>}
        <button className="action-button chat-button" onClick={() => prepareTransfer('chat')} disabled={!hasElements || exporting || sending || importing} aria-busy={sending} aria-label={t.send} title={lang === 'zh' ? '选择标注改图或草图生图，检查原图与修改说明' : 'Choose how to use the drawing and review instructions'}><Icon kind="send" /><span>{sending ? t.sending : t.send}</span></button>
        <button className="action-button primary" onClick={() => prepareTransfer('download')} disabled={!hasElements || exporting || sending || importing} title={t.exportHelp}><Icon kind="image" /><span>{exporting ? t.exporting : t.export}</span></button>
      </div>
    </header>
    <section className="drawing-workspace" aria-label={t.title}>
      <Excalidraw
        key={editorSession}
        excalidrawAPI={bindEditor}
        generateIdForFile={preserveUploadedImage}
        initialData={initialData}
        onChange={onChange}
        onLibraryChange={libraryItems => { if (board.current) { board.current = { ...board.current, libraryItems }; scheduleSave(); } }}
        theme={theme}
        langCode={lang === 'zh' ? 'zh-CN' : 'en'}
        name={name.trim() || t.untitled}
        autoFocus
        handleKeyboardGlobally={false}
        aiEnabled={false}
        validateEmbeddable={() => false}
        renderTopRightUI={isMobile => <button type="button" className={`reset-canvas-button${isMobile ? ' is-mobile' : ''}`} onClick={() => setResetConfirmOpen(true)} disabled={importing || sending || exporting} aria-label={t.reset} title={t.resetHelp}><Icon kind="reset" /><span>{t.reset}</span></button>}
        UIOptions={{ canvasActions: { toggleTheme: false, saveAsImage: false }, tools: { image: true } }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveToActiveFile />
          <MainMenu.DefaultItems.Export />
          <MainMenu.Item icon={<Icon kind="image" />} onSelect={() => prepareTransfer('download')} disabled={!hasElements || exporting || sending || importing}>{t.export}</MainMenu.Item>
          <MainMenu.Item icon={<Icon kind="image" />} onSelect={exportSvgImage} disabled={!hasElements || exporting || sending || importing}>{lang === 'zh' ? '导出 SVG' : 'Export SVG'}</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.Item icon={<Icon kind="reset" />} onSelect={() => setResetConfirmOpen(true)} disabled={importing || sending || exporting}>{t.reset}</MainMenu.Item>
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Hints.MenuHint>{t.menu}</WelcomeScreen.Hints.MenuHint>
          <WelcomeScreen.Hints.ToolbarHint>{t.tools}</WelcomeScreen.Hints.ToolbarHint>
          <WelcomeScreen.Center>
            <div className="empty-board"><span className="empty-mark"><Icon kind="pen" /></span><h2>{t.empty}</h2><p>{t.hint}</p><span className="empty-local"><span className="status-dot" />{t.privacy}</span></div>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>
    </section>
    {resetConfirmOpen && <ResetDialog lang={lang} busy={importing || sending || exporting} onCancel={() => setResetConfirmOpen(false)} onConfirm={resetCanvas} />}
    {transferSnapshot && <TransferDialog snapshot={transferSnapshot} intent={exportIntent} lang={lang} busy={sending || exporting} progress={sending ? transferProgress(transferStage, transferElapsed) : ''} percent={sending && transferStage?.total ? Math.min(99, Math.floor(transferStage.loaded / transferStage.total * 100)) : undefined} error={transferError} onCancel={closeTransfer} onSubmit={exportIntent === 'download' ? exportImage : sendToChat} />}
    {exporting && !transferSnapshot && <div className="notice" role="status"><span className="loading-dot" />{lang === 'zh' ? '正在准备高清导出…' : 'Preparing export…'}</div>}
    {importing && <div className="notice" role="status"><span className="loading-dot" />{t.importing}</div>}
    {sending && <div className="notice" role="status"><span className="loading-dot" />{t.sending}</div>}
    {!importing && notice && <div className="notice" role="alert">{notice}<button onClick={() => setNotice('')} aria-label={lang === 'zh' ? '关闭提示' : 'Dismiss'}>×</button></div>}
  </main>;
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><DrawingApp /></ErrorBoundary>);
