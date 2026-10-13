const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const resourceExport = require('../../static/js/canvas-resource-export.js');

const source = fs.readFileSync(path.join(__dirname, '../../static/js/canvas-list.js'), 'utf8');
const progressCode = source.slice(source.indexOf('/* ===== Persistent export progress'), source.indexOf('/* ===== Viewport math'));
const exportCode = source.slice(source.indexOf('/* ===== Export canvas ('), source.indexOf('/* ===== Cut / paste'));

function harness(fetchImpl, canvas = { id:'test', title:'测试画布', nodes:[] }){
    const elements = new Map();
    const updates = [];
    const downloads = [];
    const blobs = [];
    const timers = [];
    const notices = [];
    const document = {
        getElementById(id){
            if(!elements.has(id)){
                let text = '';
                elements.set(id, {
                    hidden:true, dataset:{}, value:0, attrs:{},
                    setAttribute(key, value){ this.attrs[key] = value; },
                    removeAttribute(key){ delete this.attrs[key]; if(key === 'value') this.value = 0; },
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
        },
        body:{ appendChild(){} },
        createElement(){ return { click(){ downloads.push(this.download); }, remove(){} }; },
    };
    class ExportURL extends URL {
        static createObjectURL(blob){ blobs.push(blob); return 'blob:test'; }
        static revokeObjectURL(){}
    }
    let yieldCount = 0;
    const context = vm.createContext({
        document, fetch:fetchImpl, canvases:[canvas], L:zh => zh,
        setStatus:text => notices.push(text),
        console:{error(){}}, URL:ExportURL, location:{origin:'http://localhost'},
        Blob, TextEncoder, Uint8Array, Uint32Array, DataView,
        window:{CanvasResourceExport:resourceExport},
        setTimeout(fn, delay){
            timers.push(delay);
            if(delay === 0){ yieldCount++; setImmediate(fn); }
        },
    });
    vm.runInContext(progressCode + '\n' + exportCode, context);
    return { context, elements, updates, downloads, blobs, notices, timers, get yieldCount(){ return yieldCount; } };
}

async function unzipStored(blob){
    const bytes = Buffer.from(await blob.arrayBuffer());
    const files = new Map();
    let offset = 0;
    while(bytes.readUInt32LE(offset) === 0x04034b50){
        assert.equal(bytes.readUInt16LE(offset + 8), 0, 'ZIP must preserve stored entries');
        const size = bytes.readUInt32LE(offset + 18);
        const nameLength = bytes.readUInt16LE(offset + 26);
        const extraLength = bytes.readUInt16LE(offset + 28);
        const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
        const start = offset + 30 + nameLength + extraLength;
        files.set(name, bytes.subarray(start, start + size));
        offset = start + size;
    }
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50, 'ZIP central directory is intact');
    assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
    assert.equal(bytes.readUInt16LE(bytes.length - 12), files.size);
    return files;
}

function assertMonotonic(updates){
    const values = updates.filter(u => u.percent).map(u => Number(u.percent.replace('%', '')));
    assert.equal(values.at(-1), 100);
    assert(values.slice(0, -1).every(value => value < 100), '100% is reserved for a generated download');
    assert.deepEqual(values, [...values].sort((a, b) => a - b));
}

test('progress is immediate, persistent, and duplicate exports do not create another request', async () => {
    let resolveFetch;
    let requests = 0;
    const h = harness(() => { requests++; return new Promise(resolve => { resolveFetch = resolve; }); });
    const task = h.context.exportCanvas('test');
    assert.equal(h.elements.get('exportProgress').hidden, false);
    assert.equal(h.elements.get('exportProgressClose').hidden, true);
    assert.equal(h.updates[0].percent, '');
    assert.match(h.updates[0].stage, /读取/);
    assert.equal(h.timers.length, 0, 'running progress must not auto-hide');
    h.elements.get('exportProgressClose').onclick();
    assert.equal(h.elements.get('exportProgress').hidden, false);
    await h.context.exportCanvasWithResources('test');
    assert.equal(requests, 1);
    assert.match(h.notices[0], /已有导出任务/);
    resolveFetch(Response.json({canvas:{title:'测试画布', nodes:[]}}));
    await task;
    assert.deepEqual(h.downloads, ['测试画布.json']);
    assert.equal(h.elements.get('exportProgress').dataset.state, 'complete');
    assert.equal(h.elements.get('exportProgress').hidden, false);
    assert.equal(h.elements.get('exportProgressClose').hidden, false);
    assertMonotonic(h.updates);
    h.elements.get('exportProgressClose').onclick();
    assert.equal(h.elements.get('exportProgress').hidden, true);
});

test('ZIP shows transfer and packaging progress, retains canvas/manifest and skips failed assets', async () => {
    const canvas = {id:'test', title:'测试画布', nodes:[
        {type:'image', url:'/assets/a.png'}, {type:'image', url:'/assets/b.png'}, {type:'image', url:'/assets/missing.png'},
    ]};
    const h = harness(async url => {
        if(url.startsWith('/api/')) return Response.json({canvas});
        if(url.includes('missing')) return new Response('', {status:404});
        const stream = new ReadableStream({start(controller){
            controller.enqueue(new Uint8Array([1, 2]));
            controller.enqueue(new Uint8Array([3, 4]));
            controller.close();
        }});
        return new Response(stream, {headers:url.includes('a.png') ? {'content-length':'4'} : {}});
    }, canvas);
    await h.context.exportCanvasWithResources('test');
    assert.deepEqual(h.downloads, ['测试画布.zip']);
    assert(h.updates.some(u => u.stage.includes('正在下载资源 1 / 3') && u.detail.includes('接收')));
    assert(h.updates.some(u => u.stage.includes('已处理资源 3 / 3') && u.detail.includes('跳过 1')));
    assert(h.updates.some(u => u.stage.includes('打包 ZIP')));
    assert.match(h.updates.at(-1).detail, /已包含 2 个资源，1 个资源下载失败/);
    assert(h.yieldCount > 3, 'packaging must yield to the browser');
    assertMonotonic(h.updates);
    const files = await unzipStored(h.blobs[0]);
    assert.deepEqual(JSON.parse(files.get('canvas.json')), canvas);
    assert.deepEqual(files.get('resources/a.png'), Buffer.from([1,2,3,4]));
    const manifest = JSON.parse(files.get('resources-manifest.json'));
    assert.equal(manifest.resources.length, 3);
    assert.equal(manifest.resources[2].skipped, true);
    assert.equal(manifest.resources[2].reason, 'HTTP 404');
});

test('resource-free canvas still packages successfully with finite progress', async () => {
    const h = harness(async () => Response.json({canvas:{nodes:[]}}));
    await h.context.exportCanvasWithResources('test');
    assertMonotonic(h.updates);
    assert.match(h.updates.at(-1).detail, /已包含 0 个资源/);
    assert.equal((await unzipStored(h.blobs[0])).size, 2);
});

test('request and malformed JSON failures release the export guard and allow retry', async () => {
    let mode = 'network';
    const h = harness(async () => {
        if(mode === 'network') throw new Error('offline');
        if(mode === 'json') return new Response('invalid json');
        return Response.json({canvas:{nodes:[]}});
    });
    for(mode of ['network', 'json']){
        await h.context.exportCanvasWithResources('test');
        assert.equal(h.elements.get('exportProgress').dataset.state, 'error');
        assert.equal(h.elements.get('exportProgressClose').hidden, false);
        assert.notEqual(h.updates.at(-1).percent, '100%');
        assert.equal(h.downloads.length, 0);
    }
    mode = 'success';
    await h.context.exportCanvas('test');
    assert.equal(h.downloads.length, 1);
    assert.equal(h.elements.get('exportProgress').dataset.state, 'complete');
});

test('streamed downloads report bytes without relying on inaccurate compressed lengths', async () => {
    const h = harness(async () => new Response(new Uint8Array([1,2,3,4]), {
        headers:{'content-length':'2', 'content-encoding':'gzip'},
    }));
    const reports = [];
    const bytes = await h.context.fetchResourceBytes('/assets/a.png', (received, total) => reports.push({received,total}));
    assert.equal(bytes.length, 4);
    assert.deepEqual(reports, [{received:4, total:0}]);
});

test('reader errors release the lock; all failed assets remain visible in the result', async () => {
    const canvas = {nodes:[{type:'image',url:'/assets/broken.png'}]};
    let released = false;
    const h = harness(async url => url.startsWith('/api/') ? Response.json({canvas}) : {
        ok:true, headers:new Headers(), body:{getReader:() => ({
            async read(){ throw new Error('stream interrupted'); },
            releaseLock(){ released = true; },
        })},
    });
    await h.context.exportCanvasWithResources('test');
    assert.equal(released, true);
    assert.match(h.updates.at(-1).detail, /已包含 0 个资源，1 个资源下载失败/);
    assert.equal((await unzipStored(h.blobs[0])).size, 2);
});

test('asynchronous CRC stays ZIP-compatible and yields for large individual resources', async () => {
    const h = harness(async () => {});
    const reports = [];
    const crc = await h.context.zipCrc32(new TextEncoder().encode('123456789'), n => reports.push(n));
    assert.equal(crc, 0xcbf43926);
    assert.deepEqual(reports, [9]);
    const bigReports = [];
    await h.context.zipCrc32(new Uint8Array(3 * 1024 * 1024 + 1), n => bigReports.push(n));
    assert.equal(bigReports.length, 4);
    assert.equal(bigReports.at(-1), 3 * 1024 * 1024 + 1);
    assert(h.yieldCount >= 5);
});
