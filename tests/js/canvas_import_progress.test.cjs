const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../static/js/canvas-list.js'), 'utf8');
const progressCode = source.slice(source.indexOf('/* ===== Persistent export progress'), source.indexOf('/* ===== Viewport math'));
const importCode = source.slice(source.indexOf('/* ===== Import canvas ('), source.indexOf('/* ===== Card context menu'));

function harness(){
    const elements = new Map();
    const updates = [];
    const requests = [];
    const notices = [];
    let renders = 0;
    const document = {getElementById(id){
        if(!elements.has(id)){
            let text = '';
            elements.set(id, {
                hidden:true, dataset:{}, value:0,
                setAttribute(){}, removeAttribute(key){ if(key === 'value') this.value = 0; },
                get textContent(){ return text; },
                set textContent(value){
                    text = value;
                    if(id === 'exportProgressDetail') updates.push({
                        stage:elements.get('exportProgressStage').textContent,
                        percent:elements.get('exportProgressPercent').textContent,
                        detail:value,
                    });
                },
            });
        }
        return elements.get(id);
    }};
    class FakeXHR {
        constructor(){this.upload = {}; requests.push(this);}
        open(method, url){this.method = method; this.url = url;}
        send(form){this.form = form;}
        progress(loaded, total, lengthComputable = true){this.upload.onprogress({loaded,total,lengthComputable});}
        uploaded(){this.upload.onload();}
        respond(status, response){this.status = status; this.response = response; this.onload();}
    }
    const context = vm.createContext({
        document, XMLHttpRequest:FakeXHR, FormData,
        importCanvasBtn:{disabled:false}, importCanvasInput:{value:'fixture.json'},
        canvases:[], currentProjectId:'original-project', currentProject:() => ({name:'原项目'}),
        boardCenterWorld:() => ({x:12.5,y:18.2}),
        renderBoard(){renders++;}, renderProjects(){renders++;},
        L:zh => zh, setStatus:text => notices.push(text), console:{error(){}},
    });
    vm.runInContext(progressCode + '\n' + importCode, context);
    return {context,elements,updates,requests,notices,get renders(){return renders;}};
}

const file = () => new File(['{"nodes":[]}'], '测试画布.json', {type:'application/json'});
const result = () => ({canvas:{id:'new-canvas',title:'测试画布',project:'original-project',nodes:[]},imported_resources:3});

test('upload shows byte progress, then indeterminate processing until server confirms success', async () => {
    const h = harness();
    const task = h.context.importCanvasFile(file());
    const xhr = h.requests[0];
    assert.equal(h.context.importCanvasBtn.disabled, true);
    assert.equal(h.elements.get('exportProgress').hidden, false);
    assert.equal(h.elements.get('exportProgressTitle').textContent, '导入画布');
    assert.equal(h.elements.get('exportProgressCanvas').textContent, '测试画布.json');
    assert.equal(h.updates[0].percent, '0%');
    assert.equal(xhr.method, 'POST');
    assert.equal(xhr.url, '/api/canvases/import');
    assert.equal(xhr.responseType, 'json');
    assert.equal(xhr.form.get('project'), 'original-project');
    assert.equal(xhr.form.get('board_x'), '13');
    xhr.progress(512, 1024);
    assert.equal(h.updates.at(-1).percent, '50%');
    assert.match(h.updates.at(-1).detail, /已上传/);
    xhr.progress(1024, 1024);
    assert.equal(h.elements.get('exportProgress').dataset.state, 'running');
    xhr.uploaded();
    assert.equal(h.updates.at(-1).percent, '');
    assert.match(h.updates.at(-1).stage, /解析画布并恢复资源/);
    assert.equal(h.context.canvases.length, 0, 'upload completion alone must not imply import success');
    assert.equal(h.elements.get('exportProgressClose').hidden, true);
    xhr.respond(200, result());
    await task;
    assert.equal(h.updates.at(-1).percent, '100%');
    assert.equal(h.updates.at(-1).stage, '画布导入完成');
    assert.match(h.updates.at(-1).detail, /原项目.*恢复 3 个资源/);
    assert.equal(h.context.canvases.length, 1);
    assert.equal(h.renders, 2);
    assert.equal(h.elements.get('exportProgress').hidden, false, 'result stays visible until dismissed');
    assert.equal(h.context.importCanvasBtn.disabled, false);
    assert.equal(h.context.importCanvasInput.value, '');
    h.elements.get('exportProgressClose').onclick();
    assert.equal(h.elements.get('exportProgress').hidden, true);
});

test('unknown upload size shows received bytes without a fabricated percentage', async () => {
    const h = harness();
    const task = h.context.importCanvasFile(file());
    h.requests[0].progress(4096, 0, false);
    assert.equal(h.updates.at(-1).percent, '');
    assert.match(h.updates.at(-1).detail, /4 KB/);
    h.requests[0].respond(200, result());
    await task;
    assert.equal(h.elements.get('exportProgress').dataset.state, 'complete');
});

test('duplicate import and concurrent export cannot replace the active import panel', async () => {
    const h = harness();
    const task = h.context.importCanvasFile(file());
    await h.context.importCanvasFile(file());
    assert.equal(h.requests.length, 1);
    assert.equal(h.context.beginCanvasExport({title:'other'}, true), false);
    assert.equal(h.elements.get('exportProgressTitle').textContent, '导入画布');
    assert.match(h.notices[0], /已有导入任务/);
    h.elements.get('exportProgressClose').onclick();
    assert.equal(h.elements.get('exportProgress').hidden, false);
    h.requests[0].respond(200, result());
    await task;
    assert.equal(h.context.beginCanvasExport({title:'other'}, true), true);
});

test('import is blocked during export without disabling the import button permanently', async () => {
    const h = harness();
    h.context.beginCanvasExport({title:'other'}, true);
    await h.context.importCanvasFile(file());
    assert.equal(h.requests.length, 0);
    assert.equal(h.context.importCanvasBtn.disabled, false);
    assert.equal(h.context.importCanvasInput.value, '');
    assert.match(h.notices[0], /已有导出任务/);
});

test('server errors and invalid responses keep useful details and allow same-file retry', async () => {
    const h = harness();
    for(const [status, response, detail] of [
        [400, {detail:'压缩包中没有 canvas.json'}, /没有 canvas.json/],
        [413, {detail:{message:'文件太大'}}, /文件太大/],
        [502, null, /HTTP 502/],
        [200, null, /导入结果无效/],
        [200, {canvas:{}}, /导入结果无效/],
    ]){
        const task = h.context.importCanvasFile(file());
        h.requests.at(-1).uploaded();
        h.requests.at(-1).respond(status, response);
        await task;
        assert.equal(h.elements.get('exportProgress').dataset.state, 'error');
        assert.match(h.updates.at(-1).detail, detail);
        assert.notEqual(h.updates.at(-1).percent, '100%');
        assert.equal(h.context.importCanvasBtn.disabled, false);
        assert.equal(h.context.importCanvasInput.value, '');
        assert.equal(h.context.canvases.length, 0);
    }
    const task = h.context.importCanvasFile(file());
    h.requests.at(-1).respond(200, result());
    await task;
    assert.equal(h.context.canvases.length, 1);
});

test('network errors, aborts and timeouts unlock the UI without silently retrying the POST', async () => {
    for(const event of ['onerror','onabort','ontimeout']){
        const h = harness();
        const task = h.context.importCanvasFile(file());
        h.requests[0][event]();
        await task;
        assert.equal(h.requests.length, 1);
        assert.equal(h.context.importCanvasBtn.disabled, false);
        assert.equal(h.elements.get('exportProgressClose').hidden, false);
        assert.match(h.updates.at(-1).detail, /刷新项目列表确认后再重试/);
    }
});

test('project switching and list refresh during upload preserve destination and avoid duplicate cards', async () => {
    const h = harness();
    const task = h.context.importCanvasFile(file());
    h.context.currentProjectId = 'different-project';
    h.context.canvases.push({id:'new-canvas',title:'older record'});
    h.requests[0].respond(200, result());
    await task;
    assert.equal(h.context.canvases.length, 1);
    assert.equal(h.context.canvases[0].title, '测试画布');
    assert.equal(h.requests[0].form.get('project'), 'original-project');
    assert.match(h.updates.at(-1).detail, /原项目/);
});

test('cancelling the file chooser does not start an import', async () => {
    const h = harness();
    await h.context.importCanvasFile(null);
    assert.equal(h.requests.length, 0);
    assert.equal(h.elements.get('exportProgress').hidden, true);
});
