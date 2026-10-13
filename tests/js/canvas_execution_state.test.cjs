const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

async function testComfyBusyStateClears() {
  const source = fs.readFileSync('static/js/canvas.js', 'utf8');
  const functionSource = sourceBetween(
    source,
    'async function runComfyNode(nodeId, opts={}){',
    'async function callCanvasLLM',
  );
  const node = { id: 'comfy-1', type: 'comfy', mode: 'text', width: 512, height: 512 };
  const output = { id: 'output-1', _pending: [], images: [] };
  const refreshStates = [];
  const alerts = [];
  let attempt = 0;
  const context = {
    CLIENT_ID: 'test-client',
    nodes: [node],
    orderedSources: (_node, sources) => sources,
    generatorSources: () => [{ prompt: 'test prompt', refs: [] }],
    imageRefsOnly: refs => refs,
    videoRefsOnly: () => [],
    audioRefsOnly: () => [],
    outputForNode: () => output,
    uid: () => 'pending-1',
    runSnapshot: () => ({}),
    comfyRunLabel: () => 'test',
    makePendingForRun: () => ({ id: 'pending-1', startedAt: Date.now() }),
    cascadeTargetIdFromOptions: () => '',
    refreshRunNodes: current => refreshStates.push(Boolean(current.running)),
    runQueuedComfyGenerate: async () => {
      attempt += 1;
      if (attempt === 3) throw new Error('mock comfy failure');
      return { images: [{ url: `/assets/output/test-${attempt}.png` }] };
    },
    requestMetaFromResult: () => ({}),
    comfyResultOutputs: result => result.images || [],
    collectRunMeta: () => ({ runMs: 1 }),
    appendOutputImages: (out, images) => { out.images.push(...images); },
    mergeGeneratedOutputs: () => {},
    addGenerationLog: () => {},
    scheduleSave: () => {},
    tr: key => key,
    alert: message => alerts.push(message),
    actionFailed: key => key,
    isCascadeAbortError: () => false,
    console,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.runComfyNode = runComfyNode;`, context);
  await context.runComfyNode(node.id);
  assert.equal(node.running, false);
  await context.runComfyNode(node.id);
  assert.equal(node.running, false);
  assert.equal(output.images.length, 2);
  assert.equal(attempt, 2);
  await context.runComfyNode(node.id);
  assert.equal(node.running, false);
  assert.equal(attempt, 3);
  assert.equal(alerts.at(-1), 'mock comfy failure');
  assert.equal(refreshStates.at(-1), false);
}

function testSmartCascadeRunsSiblingBranches() {
  const source = fs.readFileSync('static/js/smart-canvas.js', 'utf8');
  const functionSource = sourceBetween(
    source,
    'function smartCascadeGraphForTail(tail){',
    'function smartCascadePromptDependenciesFor',
  );
  const root = { id: 'root', type: 'smart-image' };
  const tail = { id: 'tail', type: 'smart-image' };
  const sibling = { id: 'sibling', type: 'smart-image' };
  const context = {
    smartImageChainTo: () => [root, tail],
    isSmartImageNode: node => node?.type === 'smart-image',
    isHistoryGroupNode: () => false,
    resolveSmartCascadeLoop: () => null,
    downstreamImageTargetsFor: () => [],
    upstreamNodesForId: () => [root],
    downstreamCascadeTargetsFor: node => node.id === root.id ? [tail, sibling] : [],
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.smartCascadeGraphForTail = smartCascadeGraphForTail;`, context);
  const graph = context.smartCascadeGraphForTail(tail);
  assert.equal([...graph.children.get(root.id)].map(node => node.id).join(','), 'tail,sibling');
  assert.equal(graph.edges.map(edge => edge.key).join(','), 'root->tail,root->sibling');
}

function testSmartCascadeRunsEightConnectedBranchesOnly() {
  const source = fs.readFileSync('static/js/smart-canvas.js', 'utf8');
  const functionSource = sourceBetween(
    source,
    'function smartCascadeGraphForTail(tail){',
    'function smartCascadePromptDependenciesFor',
  );
  const root = { id: 'root', type: 'smart-image' };
  const branches = Array.from({ length: 8 }, (_, index) => ({
    id: `branch-${index + 1}`,
    type: 'smart-image',
  }));
  const disconnected = { id: 'disconnected', type: 'smart-image' };
  const context = {
    smartImageChainTo: () => [root, branches[0]],
    isSmartImageNode: node => node?.type === 'smart-image',
    isHistoryGroupNode: () => false,
    resolveSmartCascadeLoop: () => null,
    downstreamImageTargetsFor: () => [],
    upstreamNodesForId: () => [root],
    downstreamCascadeTargetsFor: node => node.id === root.id ? branches : [],
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.smartCascadeGraphForTail = smartCascadeGraphForTail;`, context);
  const graph = context.smartCascadeGraphForTail(branches[0]);
  assert.deepEqual(
    [...graph.children.get(root.id)].map(node => node.id),
    branches.map(node => node.id),
  );
  assert.equal(graph.edges.length, 8);
  assert.equal(
    [...graph.children.values()].flat().some(node => node.id === disconnected.id),
    false,
  );
}

async function testSmartCascadeUsesTargetRecipe() {
  const source = fs.readFileSync('static/js/smart-canvas.js', 'utf8');
  const functionSource = sourceBetween(
    source,
    'async function runCascadeStepIntoNode(sourceNode, targetNode, inputRefs, ctx=smartLoopContext){',
    'async function runLoopRoundIntoSlot',
  );
  const sourceNode = { id: 'source', type: 'smart-image', images: [{ url: '/assets/input.png' }] };
  const targetNode = {
    id: 'target',
    type: 'smart-image',
    images: [{ url: '/assets/old.png' }],
    runPrompt: 'target prompt',
    runSettings: { engine: 'api', model: 'target-model' },
  };
  let requestedNode = null;
  let usedSettings = null;
  let usedRefs = null;
  const context = {
    smartLoopContext: null,
    settings: { engine: 'api', model: 'global-model' },
    cloneSmartSettings: value => ({ ...(value || {}) }),
    smartLoopRoundSettings: value => value,
    smartSettingsForNode: node => node.runSettings,
    validOutpaintSize: () => null,
    outputImagesForNode: node => node.images || [],
    buildPromptRequestForNode: (node, refs) => {
      requestedNode = node;
      usedRefs = refs;
      return { prompt: node.runPrompt, displayPrompt: node.runPrompt, refs };
    },
    smartRunNeedsPrompt: () => true,
    isApiLikeEngine: () => true,
    smartRunSnapshot: () => ({}),
    nowMs: () => 100,
    beginSmartMediaRun: () => {},
    rememberRecentSmartSettings: () => {},
    render: () => {},
    generateUrlsForCurrentSettings: async (_node, _prompt, refs, settings) => {
      usedRefs = refs;
      usedSettings = settings;
      return { urls: [{ url: '/assets/new.png' }], kind: 'image' };
    },
    smartMediaRunIsCurrent: () => true,
    addSmartGenerationLog: () => {},
    copyMediaSizeFields: (_item, value) => value,
    stripImageGenerationMeta: value => value,
    replaceOutputsToNodeWithHistory: (node, additions) => { node.images = additions; },
    rememberRoundOutputs: (_ctx, _node, additions) => additions,
    handleJimengPendingSignal: () => false,
    console,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.runCascadeStepIntoNode = runCascadeStepIntoNode;`, context);
  await context.runCascadeStepIntoNode(sourceNode, targetNode, sourceNode.images, null);
  assert.equal(requestedNode.id, targetNode.id);
  assert.equal(usedSettings.model, 'target-model');
  assert.deepEqual(usedRefs.map(ref => ref.url), ['/assets/input.png']);
  assert.equal(targetNode.images[0].url, '/assets/new.png');
}

async function testSmartCascadePromptDependenciesFanOutAfterSharedStages() {
  const source = fs.readFileSync('static/js/smart-canvas.js', 'utf8');
  const functionSource = sourceBetween(
    source,
    'async function runSmartCascadePromptDependencies(node, executedPromptRuns, ctx, runState){',
    'function cascadeTailForLoop',
  );
  const common1 = { id: 'common-1' };
  const common2 = { id: 'common-2' };
  const branchA = { id: 'branch-a' };
  const branchB = { id: 'branch-b' };
  const events = [];
  const delays = { 'common-1': 8, 'common-2': 8, 'branch-a': 20, 'branch-b': 20 };
  const context = {
    smartCascadePromptDependenciesFor: node => node.id === 'target-a'
      ? [common1, common2, branchA]
      : [common1, common2, branchB],
    throwIfSmartCascadeStopRequested: () => {},
    runPromptLLMNode: async nodeId => {
      events.push(`start:${nodeId}`);
      await new Promise(resolve => setTimeout(resolve, delays[nodeId]));
      events.push(`end:${nodeId}`);
    },
    console,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.runSmartCascadePromptDependencies = runSmartCascadePromptDependencies;`, context);
  const runs = new Map();
  await Promise.all([
    context.runSmartCascadePromptDependencies({ id: 'target-a' }, runs, null, {}),
    context.runSmartCascadePromptDependencies({ id: 'target-b' }, runs, null, {}),
  ]);
  assert.equal(events.filter(event => event === 'start:common-1').length, 1);
  assert.equal(events.filter(event => event === 'start:common-2').length, 1);
  assert.ok(events.indexOf('end:common-1') < events.indexOf('start:common-2'));
  assert.ok(events.indexOf('end:common-2') < events.indexOf('start:branch-a'));
  assert.ok(events.indexOf('end:common-2') < events.indexOf('start:branch-b'));
  assert.ok(events.indexOf('start:branch-b') < events.indexOf('end:branch-a'));
}

async function testSmartCascadeBranchConcurrencyIsBounded() {
  const source = fs.readFileSync('static/js/smart-canvas.js', 'utf8');
  const functionSource = sourceBetween(
    source,
    'async function runSmartCascadeItemsWithLimit(items, limit, runner, runState=null){',
    'function smartCascadeExecutableNodes',
  );
  let active = 0;
  let maxActive = 0;
  const context = { smartCascadeStopRequested: false, console };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.runSmartCascadeItemsWithLimit = runSmartCascadeItemsWithLimit;`, context);
  await context.runSmartCascadeItemsWithLimit([1, 2, 3, 4], 2, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 8));
    active -= 1;
  });
  assert.equal(maxActive, 2);
}

(async () => {
  await testComfyBusyStateClears();
  testSmartCascadeRunsSiblingBranches();
  testSmartCascadeRunsEightConnectedBranchesOnly();
  await testSmartCascadeUsesTargetRecipe();
  await testSmartCascadePromptDependenciesFanOutAfterSharedStages();
  await testSmartCascadeBranchConcurrencyIsBounded();
  console.log('canvas execution state tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
