(function(root, factory){
    const api = factory();
    if(typeof module !== 'undefined' && module.exports) module.exports = api;
    root.CanvasResourceExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
    function isObject(value){
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function isCanvasResourceUrl(value){
        const url = String(value || '').trim();
        return Boolean(url) && (
            url.startsWith('/assets/')
            || url.startsWith('/output/')
            || /^https?:\/\//i.test(url)
        );
    }

    function addUrl(value, out, seen){
        const url = String(value || '').trim();
        if(!isCanvasResourceUrl(url) || seen.has(url)) return;
        seen.add(url);
        out.push(url);
    }

    function addDirectImage(value, out, seen){
        if(typeof value === 'string'){
            addUrl(value, out, seen);
            return;
        }
        if(!isObject(value)) return;
        addUrl(value.url, out, seen);
        addUrl(value.src, out, seen);
        addUrl(value.image_url, out, seen);
        addUrl(value.imageUrl, out, seen);
    }

    function collectNodeImages(node, out, seen){
        if(!isObject(node) || node.deleted === true || node.isDeleted === true) return;
        const type = String(node.type || '').toLowerCase();
        const mediaKind = String(node.mediaKind || node.kind || '').toLowerCase();
        const isNonImageNode = type.includes('video') || type.includes('audio') || mediaKind === 'video' || mediaKind === 'audio';

        if(!isNonImageNode){
            addUrl(node.url, out, seen);
            addUrl(node.image_url, out, seen);
            addUrl(node.imageUrl, out, seen);
        }
        if(Array.isArray(node.images)) node.images.forEach(item => addDirectImage(item, out, seen));

        const props = isObject(node.props) ? node.props : null;
        if(props && (type === 'design-image' || type === 'design-generator' || String(node.typeName || '').toLowerCase() === 'shape')){
            addUrl(props.url, out, seen);
            addUrl(props.image_url, out, seen);
            addUrl(props.imageUrl, out, seen);
            if(type === 'design-generator') addUrl(props.resultUrl, out, seen);
        }
    }

    function collectActiveCanvasImageUrls(canvas){
        const out = [];
        const seen = new Set();
        const activeNodes = Array.isArray(canvas?.nodes) ? canvas.nodes : [];
        activeNodes.forEach(node => collectNodeImages(node, out, seen));

        const snapshot = canvas?.document?.snapshot;
        const snapshotObjects = Array.isArray(snapshot?.objects) ? snapshot.objects : [];
        snapshotObjects.forEach(node => collectNodeImages(node, out, seen));

        const snapshotStore = isObject(snapshot?.store) ? Object.values(snapshot.store) : [];
        snapshotStore
            .filter(record => record?.typeName === 'shape')
            .forEach(node => collectNodeImages(node, out, seen));
        return out;
    }

    return { collectActiveCanvasImageUrls, isCanvasResourceUrl };
});
