(function(global){
    'use strict';

    const SIZE_THRESHOLD = 4 * 1024 * 1024;
    const MAX_EDGE = 4096;
    const QUALITY = 0.88;
    const MIN_SAVING_RATIO = 0.10;
    const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

    function normalizedType(file){
        return String(file?.type || '').split(';', 1)[0].trim().toLowerCase();
    }

    function optimizedName(name, mime){
        const base = String(name || 'image').replace(/\.[^.]+$/, '') || 'image';
        return `${base}${mime === 'image/jpeg' ? '.jpg' : '.webp'}`;
    }

    function canvasBlob(canvas, mime){
        return new Promise(resolve => canvas.toBlob(resolve, mime, QUALITY));
    }

    async function decodeImage(file){
        if(typeof global.createImageBitmap === 'function'){
            return global.createImageBitmap(file, {imageOrientation:'from-image'});
        }
        return new Promise((resolve, reject) => {
            const url = global.URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
                global.URL.revokeObjectURL(url);
                resolve(image);
            };
            image.onerror = () => {
                global.URL.revokeObjectURL(url);
                reject(new Error('image_decode_failed'));
            };
            image.src = url;
        });
    }

    async function optimizeFile(file){
        const sourceType = normalizedType(file);
        if(!SUPPORTED_TYPES.has(sourceType)) return file;
        let image = null;
        try{
            image = await decodeImage(file);
            const sourceWidth = Math.max(1, Number(image.width || image.naturalWidth) || 1);
            const sourceHeight = Math.max(1, Number(image.height || image.naturalHeight) || 1);
            const sourceEdge = Math.max(sourceWidth, sourceHeight);
            if(Number(file.size || 0) <= SIZE_THRESHOLD && sourceEdge <= MAX_EDGE) return file;
            const scale = Math.min(1, MAX_EDGE / sourceEdge);
            const width = Math.max(1, Math.round(sourceWidth * scale));
            const height = Math.max(1, Math.round(sourceHeight * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d', {alpha:true});
            if(!context) return file;
            context.drawImage(image, 0, 0, width, height);
            const outputType = sourceType === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
            const blob = await canvasBlob(canvas, outputType);
            if(!blob || blob.size > Number(file.size || 0) * (1 - MIN_SAVING_RATIO)) return file;
            return new File([blob], optimizedName(file.name, outputType), {
                type:outputType,
                lastModified:Number(file.lastModified || Date.now()),
            });
        }catch(_){
            return file;
        }finally{
            if(image && typeof image.close === 'function') image.close();
        }
    }

    async function optimizeFiles(files){
        const input = Array.from(files || []);
        const output = new Array(input.length);
        let nextIndex = 0;
        async function worker(){
            while(nextIndex < input.length){
                const index = nextIndex++;
                output[index] = await optimizeFile(input[index]);
            }
        }
        await Promise.all(Array.from({length:Math.min(2, input.length)}, () => worker()));
        return output;
    }

    global.LingDrawImageUpload = {
        optimizeFile,
        optimizeFiles,
        optimizedName,
        limits:{sizeThreshold:SIZE_THRESHOLD, maxEdge:MAX_EDGE, quality:QUALITY},
    };
})(window);
