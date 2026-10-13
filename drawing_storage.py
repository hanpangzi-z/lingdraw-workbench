"""Authenticated, revision-checked drawing documents and local asset persistence."""
import base64
import hashlib
import io
import os
import tempfile
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from PIL import Image
from sqlalchemy import BigInteger, Column, JSON, MetaData, String, Table, UniqueConstraint, select, insert, update, delete
from sqlalchemy.exc import IntegrityError
from json_document import JSONDocument

metadata = MetaData()
boards = Table('drawing_boards',metadata,
    Column('id',String(36),primary_key=True), Column('owner_user_id',BigInteger,nullable=False,index=True),
    Column('revision',BigInteger,nullable=False), Column('payload',JSONDocument,nullable=False),
    Column('import_key',String(160),nullable=True), Column('created_at',BigInteger,nullable=False),
    Column('updated_at',BigInteger,nullable=False),
    UniqueConstraint('owner_user_id','import_key',name='uq_drawing_import'),
    mysql_charset='utf8mb4',mysql_collate='utf8mb4_bin',mysql_engine='InnoDB')


class BoardCreate(BaseModel):
    payload: dict
    import_key: str | None = Field(default=None,max_length=160)


class BoardUpdate(BaseModel):
    payload: dict
    revision: int = Field(ge=1)


def make_router(engine, account_for, media_dir, claim_media, require_media):
    metadata.create_all(engine)
    router=APIRouter(prefix='/api/drawing/boards')

    def owner(request): return int(account_for(request)['id'])

    def row_for(c,ident,user_id,lock=False):
        stmt=select(boards).where(boards.c.id==ident,boards.c.owner_user_id==user_id)
        if lock: stmt=stmt.with_for_update()
        row=c.execute(stmt).mappings().first()
        if not row: raise HTTPException(404,'绘图板不存在')
        return dict(row)

    def serialize(row): return {k:v for k,v in row.items() if k != 'owner_user_id'}

    def prepare(payload,user_id):
        if not isinstance(payload.get('elements',[]),list) or not isinstance(payload.get('files',{}),dict):
            raise HTTPException(422,'无效的绘图板数据')
        require_media(payload,user_id)
        prepared=dict(payload)
        files={}
        total=0
        for ident,file in payload.get('files',{}).items():
            if not isinstance(file,dict): raise HTTPException(422,'无效的图片记录')
            file=dict(file)
            url=str(file.get('dataURL') or '')
            if url.startswith('data:'):
                try:
                    header,encoded=url.split(',',1)
                    if not header.startswith('data:image/') or not header.endswith(';base64'): raise ValueError()
                    if len(encoded)>70*1024*1024: raise HTTPException(413,'图片超过 50MB')
                    data=base64.b64decode(encoded,validate=True)
                    total+=len(data)
                    if len(data)>50*1024*1024 or total>100*1024*1024: raise HTTPException(413,'绘图板图片过大')
                    with Image.open(io.BytesIO(data)) as image:
                        kind=image.format
                        image.verify()
                    extension={'PNG':'png','JPEG':'jpg','WEBP':'webp','GIF':'gif','BMP':'bmp'}.get(kind)
                    if not extension: raise ValueError()
                except (ValueError,OSError) as exc: raise HTTPException(422,'图片数据损坏或格式不支持') from exc
                filename=f'drawing-{user_id}-{hashlib.sha256(data).hexdigest()}.{extension}'
                target=Path(media_dir)/filename
                target.parent.mkdir(parents=True,exist_ok=True)
                if not target.exists():
                    fd,tmp=tempfile.mkstemp(prefix='.drawing-',dir=target.parent)
                    try:
                        with os.fdopen(fd,'wb') as stream: stream.write(data)
                        os.replace(tmp,target)
                    finally:
                        if os.path.exists(tmp): os.remove(tmp)
                file['dataURL']='/assets/input/'+filename
                claim_media(file,user_id)
            files[ident]=file
        prepared['files']=files
        return prepared

    @router.get('')
    def list_boards(request:Request):
        user_id=owner(request)
        with engine.connect() as c:
            rows=c.execute(select(boards).where(boards.c.owner_user_id==user_id).order_by(boards.c.updated_at.desc())).mappings()
            return {'boards':[{'id':r['id'],'revision':r['revision'],'name':r['payload'].get('name',''),
                               'created_at':r['created_at'],'updated_at':r['updated_at']} for r in rows]}

    @router.get('/{ident}')
    def get_board(ident:str,request:Request):
        with engine.connect() as c: return serialize(row_for(c,ident,owner(request)))

    @router.post('')
    def create_board(body:BoardCreate,request:Request):
        user_id=owner(request)
        payload=prepare(body.payload,user_id)
        now=int(time.time()*1000)
        values=dict(id=str(uuid.uuid4()),owner_user_id=user_id,revision=1,payload=payload,
                    import_key=body.import_key,created_at=now,updated_at=now)
        try:
            with engine.begin() as c: c.execute(insert(boards).values(**values))
        except IntegrityError:
            if not body.import_key: raise
            with engine.connect() as c:
                old=c.execute(select(boards).where(boards.c.owner_user_id==user_id,boards.c.import_key==body.import_key)).mappings().first()
            if not old: raise
            # Repeated legacy import returns its original document, including edits
            # made after import; it never overwrites that document.
            return serialize(dict(old))
        return serialize(values)

    @router.put('/{ident}')
    def save_board(ident:str,body:BoardUpdate,request:Request):
        user_id=owner(request)
        with engine.connect() as c: row_for(c,ident,user_id)
        payload=prepare(body.payload,user_id)
        with engine.begin() as c:
            row=row_for(c,ident,user_id,lock=True)
            if row['revision']!=body.revision: raise HTTPException(409,'绘图板已在其他页面更新，请另存副本或载入服务器版本')
            values=dict(payload=payload,revision=body.revision+1,updated_at=int(time.time()*1000))
            c.execute(update(boards).where(boards.c.id==ident).values(**values))
            row.update(values)
        return serialize(row)

    @router.delete('/{ident}')
    def delete_board(ident:str,revision:int,request:Request):
        with engine.begin() as c:
            row=row_for(c,ident,owner(request),lock=True)
            if row['revision']!=revision: raise HTTPException(409,'绘图板已更新，不能删除旧版本')
            c.execute(delete(boards).where(boards.c.id==ident))
        # Assets can be referenced by other documents. Do not delete their files.
        return {'deleted':True}
    return router
