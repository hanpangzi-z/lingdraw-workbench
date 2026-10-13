import os
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


app = FastAPI()
app.mount("/static", StaticFiles(directory=main.STATIC_DIR), name="static")
app.mount("/assets", StaticFiles(directory=main.ASSETS_DIR), name="assets")
stats = {"list_requests": 0, "thumbnail_requests": 0, "media_requests": 0, "thumbnail_bytes": 0}


@app.get("/")
def inspiration_page():
    return FileResponse(Path(main.STATIC_DIR) / "inspiration.html", media_type="text/html")


@app.get("/upload-qa")
def upload_qa_page():
    return HTMLResponse("""<!doctype html><meta charset="utf-8">
<script src="/static/js/image-upload-optimizer.js?v=qa"></script>
<pre id="result">running</pre>
<script>
window.addEventListener('load', async () => {
  const canvas=document.createElement('canvas'); canvas.width=6000; canvas.height=3000;
  const context=canvas.getContext('2d');
  const gradient=context.createLinearGradient(0,0,6000,3000);
  gradient.addColorStop(0,'#0a56d6'); gradient.addColorStop(.5,'#f4b942'); gradient.addColorStop(1,'#d62976');
  context.fillStyle=gradient; context.fillRect(0,0,6000,3000);
  context.fillStyle='white'; context.font='bold 360px sans-serif'; context.fillText('UPLOAD QA',520,1700);
  const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.98));
  const padding=new Uint8Array(Math.max(0,12*1024*1024-jpeg.size));
  const original=new File([jpeg,padding],'large-upload.jpg',{type:'image/jpeg'});
  const optimized=await window.LingDrawImageUpload.optimizeFile(original);
  const decoded=await createImageBitmap(optimized);
  const result={originalBytes:original.size,optimizedBytes:optimized.size,width:decoded.width,height:decoded.height,type:optimized.type,name:optimized.name};
  decoded.close(); document.getElementById('result').textContent=JSON.stringify(result);
});
</script>""")


@app.get("/api/inspirations")
def inspirations(category: str = "全部", limit: int = 24, offset: int = 0):
    stats["list_requests"] += 1
    items = sorted(main.load_inspiration_store()["items"], key=lambda item: int(item.get("created_at") or 0), reverse=True)
    if category != "全部":
        items = [item for item in items if item.get("category") == category]
    page = items[max(0, offset):max(0, offset) + max(1, min(300, limit))]
    return {
        "items": [main.public_inspiration_item(item) for item in page],
        "categories": list(main.INSPIRATION_CATEGORIES),
        "total": len(items),
        "can_moderate": False,
    }


@app.get("/api/inspirations/{item_id}/thumbnail")
async def thumbnail(item_id: str, v: str = Query(default="")):
    del v
    stats["thumbnail_requests"] += 1
    response = await main.get_inspiration_thumbnail(item_id)
    path = getattr(response, "path", "")
    if path and os.path.isfile(path):
        stats["thumbnail_bytes"] += os.path.getsize(path)
    return response


@app.get("/api/inspirations/{item_id}/media")
def media(item_id: str):
    stats["media_requests"] += 1
    return main.get_inspiration_media(item_id)


@app.get("/api/inspirations/{item_id}/download")
def download(item_id: str):
    return main.public_inspiration_media_response(main.inspiration_media_source(main.find_inspiration_item(item_id)))


@app.get("/__qa/status")
def status():
    return stats


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("QA_PORT", "38769")))
