const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../static/index.html'), 'utf8');
const start = html.indexOf('        let pptAuthCheckInFlight = false;');
const end = html.indexOf('\n        try {\n            const studioApiChannel', start);
assert.ok(start > 0 && end > start);
const script = html.slice(start, end);
const origin = 'http://127.0.0.1:37621';

function setup(fetch) {
    const redirects = [];
    const frame = {contentWindow:{}};
    let listener;
    const context = vm.createContext({
        fetch,
        console: {warn() {}},
        window: {
            location:{origin, replace: url => redirects.push(url)},
            addEventListener: (type, callback) => { listener = callback; },
        },
        document: {getElementById: id => id === 'frame-ppt' ? frame : null},
    });
    vm.runInContext(script, context);
    return {
        redirects,
        check: () => vm.runInContext('checkPptHostSession()', context),
        notify: (overrides = {}) => listener({origin, source:frame.contentWindow, data:{type:'ppt:auth-required'}, ...overrides}),
    };
}

test('PPT authentication errors never redirect an authenticated host', async () => {
    const app = setup(async () => ({ok:true, json:async () => ({authenticated:true})}));
    await app.check();
    await app.check();
    assert.deepEqual(app.redirects, []);
});

test('an explicitly expired host session redirects to login', async () => {
    const app = setup(async () => ({ok:true, json:async () => ({authenticated:false})}));
    await app.check();
    assert.deepEqual(app.redirects, ['/login']);
});

test('network errors, server errors and malformed auth responses do not reload the host', async () => {
    for(const fetch of [
        async () => { throw new Error('offline'); },
        async () => ({ok:false, json:async () => ({authenticated:false})}),
        async () => ({ok:true, json:async () => { throw new Error('invalid JSON'); }}),
        async () => ({ok:true, json:async () => ({})}),
    ]) {
        const app = setup(fetch);
        await app.check();
        assert.deepEqual(app.redirects, []);
    }
});

test('simultaneous PPT errors share one auth check and later checks still work', async () => {
    let finish;
    let calls = 0;
    const app = setup(() => {
        calls++;
        return new Promise(resolve => { finish = resolve; });
    });
    const first = app.check();
    app.notify();
    await app.check();
    assert.equal(calls, 1);
    finish({ok:true, json:async () => ({authenticated:true})});
    await first;
    const second = app.check();
    assert.equal(calls, 2);
    finish({ok:true, json:async () => ({authenticated:false})});
    await second;
    assert.deepEqual(app.redirects, ['/login']);
});

test('only the same-origin PPT iframe can initiate a host auth check', async () => {
    let calls = 0;
    const app = setup(async () => { calls++; return {ok:true, json:async () => ({authenticated:true})}; });
    app.notify({origin:'https://example.com'});
    app.notify({source:{}});
    assert.equal(calls, 0);
    app.notify();
    await new Promise(setImmediate);
    assert.equal(calls, 1);
    assert.deepEqual(app.redirects, []);
});
