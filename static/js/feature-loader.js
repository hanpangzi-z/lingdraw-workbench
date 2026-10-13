(function(){
    'use strict';
    if(window.LingDrawFeatures) return;

    const pending = new Map();
    const registered = new Map();

    function versionedUrl(path, sourceHint=''){
        const target = new URL(path, location.href);
        if(target.search) return target.href;
        const source = [...document.scripts].find(script => sourceHint && script.src.includes(sourceHint));
        if(source){
            const sourceUrl = new URL(source.src, location.href);
            target.search = sourceUrl.search;
        }
        return target.href;
    }

    function load(name, path, sourceHint=''){
        if(registered.has(name)) return Promise.resolve(registered.get(name));
        if(pending.has(name)) return pending.get(name);
        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = versionedUrl(path, sourceHint);
            script.async = true;
            script.dataset.lingdrawFeature = name;
            script.onload = () => {
                if(!registered.has(name)) {
                    reject(new Error(`功能脚本初始化失败：${name}`));
                    return;
                }
                resolve(registered.get(name));
            };
            script.onerror = () => reject(new Error(`功能脚本加载失败：${name}`));
            document.head.appendChild(script);
        }).catch(error => {
            pending.delete(name);
            document.querySelector(`script[data-lingdraw-feature="${CSS.escape(name)}"]`)?.remove();
            throw error;
        });
        pending.set(name, promise);
        return promise;
    }

    function register(name, api=true){
        registered.set(name, api);
        return api;
    }

    window.LingDrawFeatures = {load, register, get:name => registered.get(name)};
})();
