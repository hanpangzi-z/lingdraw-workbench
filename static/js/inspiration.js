(function(){
    const categories = ['全部','banner','大霸屏','礼品册','创意','IP','其他'];
    const PAGE_SIZE = 24;
    const state = {category:'全部', items:[], offset:0, total:0, loading:false, hasMore:true, generation:0, canModerate:false};
    const gallery = document.getElementById('inspirationGallery');
    const filters = document.getElementById('inspirationFilters');
    const loading = document.getElementById('inspirationLoading');
    const empty = document.getElementById('inspirationEmpty');
    const error = document.getElementById('inspirationError');
    const count = document.getElementById('inspirationCount');
    const toast = document.getElementById('inspirationToast');
    const sentinel = document.getElementById('inspirationSentinel');
    let activeController = null;
    let toastTimer = 0;
    let galleryLayoutFrame = 0;
    let ratioLayoutTimer = 0;
    let lastLayoutWidth = 0;
    let lastLayoutColumns = 0;

    function preferredColumnCount(){
        const width = window.innerWidth;
        if(width >= 1280) return 5;
        if(width > 1020) return 4;
        if(width > 760) return 3;
        if(width > 520) return 2;
        return 1;
    }

    function layoutGallery(force=false){
        galleryLayoutFrame = 0;
        const cards = Array.from(gallery.querySelectorAll('.inspiration-card'));
        if(!cards.length || gallery.hidden){ gallery.style.height=''; return; }
        const galleryWidth = Math.round(gallery.clientWidth);
        const columns = Math.max(1, Math.min(preferredColumnCount(), cards.length));
        if(!force && galleryWidth === lastLayoutWidth && columns === lastLayoutColumns) return;
        lastLayoutWidth = galleryWidth;
        lastLayoutColumns = columns;
        const gap = 12;
        const cardWidth = (galleryWidth - gap * (columns - 1)) / columns;
        const heights = Array(columns).fill(0);
        const placements = cards.map((card, index) => {
            const ratio = Math.max(.25, Math.min(4, Number(card.dataset.aspectRatio) || 1));
            const height = cardWidth / ratio;
            const column = index < columns ? index : heights.indexOf(Math.min(...heights));
            const placement = {card, width:cardWidth, height, left:column*(cardWidth+gap), top:heights[column]};
            heights[column] += height + gap;
            return placement;
        });
        placements.forEach(({card,width,height,left,top}) => {
            card.style.width=`${width}px`; card.style.height=`${height}px`;
            card.style.left=`${left}px`; card.style.top=`${top}px`;
        });
        gallery.style.height = `${Math.max(...heights)-gap}px`;
        gallery.classList.add('is-layout-ready');
    }

    function scheduleGalleryLayout(force=false){
        if(galleryLayoutFrame) cancelAnimationFrame(galleryLayoutFrame);
        galleryLayoutFrame = requestAnimationFrame(() => layoutGallery(force));
    }

    function scheduleRatioLayout(){
        clearTimeout(ratioLayoutTimer);
        ratioLayoutTimer = setTimeout(() => scheduleGalleryLayout(true), 80);
    }

    function showToast(message){
        toast.textContent=message; toast.classList.add('show'); clearTimeout(toastTimer);
        toastTimer=setTimeout(()=>toast.classList.remove('show'),2200);
    }

    function setStateView(name){
        loading.hidden = name !== 'loading'; empty.hidden = name !== 'empty';
        error.hidden = name !== 'error'; gallery.hidden = !['gallery','loading-more'].includes(name);
    }

    function renderFilters(){
        filters.replaceChildren(...categories.map(category => {
            const button=document.createElement('button'); button.type='button';
            button.className=`inspiration-filter${state.category===category?' active':''}`;
            button.textContent=category; button.setAttribute('aria-pressed',String(state.category===category));
            button.onclick=()=>{ if(state.category===category) return; state.category=category; renderFilters(); loadInspirations(true); };
            return button;
        }));
    }

    function icon(name){ const node=document.createElement('i'); node.setAttribute('data-lucide',name); return node; }

    function loadReferenceImages(card){
        card.querySelectorAll('img[data-lazy-src]').forEach(image => { image.src=image.dataset.lazySrc; image.removeAttribute('data-lazy-src'); });
    }

    function cardFor(item, eager=false){
        const card=document.createElement('article'); card.className='inspiration-card';
        const storedRatio = Number(item.width) > 0 && Number(item.height) > 0 ? Number(item.width) / Number(item.height) : 0;
        card.dataset.inspirationId=item.id; card.dataset.aspectRatio=storedRatio || 1;
        card.tabIndex=0; card.setAttribute('aria-label',`${item.category||'其他'}灵感，上传者 ${item.uploader_name||'用户'}`);
        card.setAttribute('aria-expanded','false');
        card.addEventListener('mouseenter',()=>loadReferenceImages(card),{once:true});
        card.addEventListener('focusin',()=>loadReferenceImages(card),{once:true});
        const toggleCard = () => {
            const next = !card.classList.contains('is-active');
            gallery.querySelectorAll('.inspiration-card.is-active').forEach(activeCard => {
                if(activeCard !== card){ activeCard.classList.remove('is-active'); activeCard.setAttribute('aria-expanded','false'); }
            });
            card.classList.toggle('is-active',next);
            card.setAttribute('aria-expanded',String(next));
            if(next) loadReferenceImages(card);
        };
        card.addEventListener('click',event=>{ if(event.target.closest('button,a')) return; toggleCard(); });
        card.addEventListener('keydown',event=>{ if(event.target.closest('button,a')||(event.key!=='Enter'&&event.key!==' ')) return; event.preventDefault(); toggleCard(); });
        const imageWrap=document.createElement('div'); imageWrap.className='inspiration-image-wrap';
        const image=document.createElement('img'); image.className='inspiration-image';
        image.src=item.thumbnail_url||item.image_url; image.alt=item.prompt?`灵感作品：${item.prompt.slice(0,80)}`:'灵感作品';
        image.loading=eager?'eager':'lazy'; image.fetchPriority=eager?'high':'low'; image.decoding='async';
        if(item.thumbnail_url&&item.thumbnail_url!==item.image_url){
            image.addEventListener('error',()=>{ if(image.dataset.originalFallback)return; image.dataset.originalFallback='1'; image.src=item.image_url; },{once:true});
        }
        image.addEventListener('load',()=>{
            const naturalRatio = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 0;
            const currentRatio = Number(card.dataset.aspectRatio) || 1;
            if(!naturalRatio || Math.abs(naturalRatio-currentRatio)<.002) return;
            card.dataset.aspectRatio=String(naturalRatio);
            scheduleRatioLayout();
        },{once:true});
        imageWrap.appendChild(image);
        const top=document.createElement('div'); top.className='inspiration-card-top';
        const author=document.createElement('span'); author.className='inspiration-author';
        const authorName=document.createElement('span'); authorName.textContent=item.uploader_name||'用户';
        author.append(icon('circle-user-round'),authorName); top.append(author); imageWrap.appendChild(top);
        const hover=document.createElement('div'); hover.className='inspiration-card-hover';
        const actions=document.createElement('div'); actions.className='inspiration-card-actions';
        const remix=document.createElement('button'); remix.type = 'button'; remix.className='inspiration-remix';
        remix.append(icon('wand-sparkles'),document.createTextNode('一键同款'));
        remix.onclick=()=>{ window.parent.postMessage({type:'lingdraw:inspiration-remix',payload:{inspiration_id:item.id,prompt:item.prompt||'',reference_images:item.reference_images||[]}},location.origin); showToast(item.reference_images?.length?'已带入提示词与原始参考图':'已带入提示词'); };
        const download=document.createElement('a'); download.className='inspiration-download'; download.href=item.download_url;
        download.title='下载图片'; download.setAttribute('aria-label','下载图片'); download.appendChild(icon('download'));
        actions.append(remix,download);
        if(state.canModerate){
            actions.classList.add('has-delete');
            const remove=document.createElement('button'); remove.type='button'; remove.className='inspiration-delete';
            remove.title='从灵感广场删除'; remove.setAttribute('aria-label','从灵感广场删除'); remove.appendChild(icon('trash-2'));
            remove.onclick=async event=>{
                event.stopPropagation();
                if(!window.confirm('确定从灵感广场删除这张图片吗？原始素材不会被删除。')) return;
                remove.disabled=true;
                try{
                    const response=await fetch(`/api/inspirations/${encodeURIComponent(item.id)}`,{method:'DELETE'});
                    const data=await response.json().catch(()=>({}));
                    if(!response.ok) throw new Error(data.detail||'删除失败');
                    state.items=state.items.filter(entry=>entry.id!==item.id);
                    state.offset=state.items.length; state.total=Math.max(0,state.total-1);
                    state.hasMore=state.offset<state.total;
                    card.remove();
                    count.textContent=state.items.length?`${state.items.length} / ${state.total} 个公开灵感`:'等待第一份灵感';
                    if(!state.items.length) setStateView('empty'); else scheduleGalleryLayout(true);
                    showToast('已从灵感广场删除');
                    if(state.hasMore) loadInspirations(false);
                }catch(err){
                    remove.disabled=false;
                    showToast(err.message||'删除失败，请稍后重试');
                }
            };
            actions.appendChild(remove);
        }
        hover.appendChild(actions);
        if(Array.isArray(item.reference_images)&&item.reference_images.length){
            const refs=document.createElement('div'); refs.className='inspiration-references';
            const label=document.createElement('span'); label.className='inspiration-reference-label'; label.textContent='参考图'; refs.appendChild(label);
            item.reference_images.slice(0,4).forEach(ref=>{ const wrap=document.createElement('span'); wrap.className='inspiration-reference'; const refImage=document.createElement('img'); refImage.dataset.lazySrc=ref.url; refImage.alt=ref.name||'参考图'; refImage.loading='lazy'; wrap.appendChild(refImage); refs.appendChild(wrap); });
            hover.appendChild(refs);
        }
        const prompt=document.createElement('p'); prompt.className=`inspiration-prompt${item.prompt?'':' empty'}`;
        prompt.textContent=item.prompt||'这件作品暂未附带提示词'; prompt.title=item.prompt||'';
        hover.appendChild(prompt); imageWrap.appendChild(hover); card.appendChild(imageWrap); return card;
    }

    function appendGallery(items, reset){
        const fragment=document.createDocumentFragment();
        const eagerCount=reset?preferredColumnCount():0;
        items.forEach((item,index)=>fragment.appendChild(cardFor(item,index<eagerCount)));
        if(reset) gallery.replaceChildren(fragment); else gallery.appendChild(fragment);
        setStateView(state.items.length?'gallery':'empty');
        if(window.lucide) lucide.createIcons();
        scheduleGalleryLayout(true);
    }

    async function loadInspirations(reset=false){
        if(reset){
            state.generation+=1; activeController?.abort(); state.loading=false; state.items=[]; state.offset=0; state.total=0; state.hasMore=true;
            gallery.replaceChildren(); lastLayoutWidth=0; lastLayoutColumns=0;
        }
        if(state.loading||!state.hasMore) return;
        const generation=state.generation; state.loading=true; activeController=new AbortController();
        if(reset) setStateView('loading');
        count.textContent=state.items.length?`${state.items.length} 个公开灵感`:'正在加载灵感…';
        try{
            const url=`/api/inspirations?category=${encodeURIComponent(state.category)}&limit=${PAGE_SIZE}&offset=${state.offset}`;
            const response=await fetch(url,{cache:'no-store',signal:activeController.signal});
            const data=await response.json(); if(!response.ok) throw new Error(data.detail||'加载失败');
            if(generation!==state.generation) return;
            const page=Array.isArray(data.items)?data.items:[];
            state.canModerate=data.can_moderate===true;
            state.items.push(...page); state.offset=state.items.length; state.total=Number(data.total)||state.items.length;
            state.hasMore=state.offset<state.total && page.length>0;
            count.textContent=state.items.length?`${state.items.length} / ${state.total} 个公开灵感`:'等待第一份灵感';
            appendGallery(page,reset);
        }catch(err){
            if(err.name==='AbortError') return;
            count.textContent=state.items.length?`${state.items.length} / ${state.total} 个公开灵感`:'加载失败';
            if(!state.items.length) setStateView('error'); else showToast('后续灵感加载失败，滚动到底部可重试');
        }finally{
            if(generation===state.generation) state.loading=false;
            if(window.lucide) lucide.createIcons();
        }
    }

    document.getElementById('inspirationRetry').onclick=()=>loadInspirations(!state.items.length);
    document.addEventListener('click',event=>{
        if(event.target.closest?.('.inspiration-card')) return;
        gallery.querySelectorAll('.inspiration-card.is-active').forEach(card=>{ card.classList.remove('is-active'); card.setAttribute('aria-expanded','false'); });
    });
    window.addEventListener('message',event=>{ if(event.origin!==location.origin)return; if(event.data?.type === 'inspiration-refresh') loadInspirations(true); });
    if(window.ResizeObserver){ let width=0; new ResizeObserver(entries=>{ const next=Math.round(entries[0]?.contentRect?.width||0); if(next&&next!==width){width=next;scheduleGalleryLayout(true);} }).observe(gallery); }
    else window.addEventListener('resize',()=>scheduleGalleryLayout(true),{passive:true});
    if(window.IntersectionObserver){ new IntersectionObserver(entries=>{ if(entries.some(entry=>entry.isIntersecting)) loadInspirations(false); },{rootMargin:'800px 0px'}).observe(sentinel); }
    renderFilters(); if(window.lucide) lucide.createIcons(); loadInspirations(true);
})();
