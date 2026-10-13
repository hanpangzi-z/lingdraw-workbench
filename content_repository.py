"""Business JSON repositories. Media and deployment files are never stored here.

The path adapter preserves legacy call sites while each business collection has
its own table. Managed paths have no filesystem fallback. Temporary JSON writes
are staged in the current context and become visible only at replace/commit.
"""
from __future__ import annotations

import builtins
import contextvars
import hashlib
import io
import json
import os
import re
import sys
import time
import fnmatch
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import BigInteger, Column, JSON, MetaData, String, Table, ForeignKey, select, delete, update, insert
from sqlalchemy.exc import SQLAlchemyError

from mysql_runtime import engine_for, required_url
from json_document import JSONDocument

SINGLETONS = {
    'history.json': 'history',
    'data/projects.json': 'projects',
    'data/asset_library.json': 'assets',
    'data/prompt_libraries.json': 'prompts',
    'data/inspirations.json': 'inspirations',
    'data/resource_ownership.json': 'ownership',
    'data/shared_folders.json': 'sharing',
    'data/api_providers.json': 'settings',
    'data/platform_auth.json': 'settings',
    'data/storage_settings.json': 'settings',
    'data/runninghub_workflows.json': 'workflows',
    'data/asset_classification_prompt.txt': 'settings',
}
PREFIXES = {'data/canvases/': 'canvases', 'data/conversations/': 'conversations',
            'data/user_content/': 'user_content', 'workflows/custom/': 'workflows',
            'workflows/自定义/': 'workflows'}
EXTRA_GLOBS = {'workflows/*.config.json': 'workflows',
               'assets/uploads/**/*.classification.json': 'assets',
               'assets/uploads/**/.linghui-owner.json': 'ownership',
               'assets/uploads/**/*.txt': 'assets'}
metadata = MetaData()
TABLES = {}
ENTITY_FIELDS = {'projects': ['projects'], 'assets': ['libraries', 'categories'],
                 'prompts': ['libraries'], 'inspirations': ['items'], 'history': ['$root']}
for kind in sorted(set(SINGLETONS.values()) | set(PREFIXES.values())):
    TABLES[kind] = Table('content_' + kind, metadata,
        Column('id', String(64), primary_key=True),
        Column('source_key', String(700), nullable=False),
        Column('owner_user_id', BigInteger, nullable=True, index=True),
        Column('payload', JSONDocument, nullable=False),
        Column('version', BigInteger, nullable=False),
        Column('created_at', BigInteger, nullable=False),
        Column('updated_at', BigInteger, nullable=False, index=True),
        mysql_charset='utf8mb4', mysql_collate='utf8mb4_bin', mysql_engine='InnoDB')

ENTITIES = {}
for kind in ENTITY_FIELDS:
    ENTITIES[kind] = Table('entities_'+kind,metadata,
        Column('id',String(64),primary_key=True),
        Column('document_id',String(64),ForeignKey('content_'+kind+'.id',ondelete='CASCADE',onupdate='CASCADE'),nullable=False,index=True),
        Column('entity_id',String(240),nullable=False,index=True),
        Column('collection',String(80),nullable=False), Column('position',BigInteger,nullable=False),
        Column('owner_user_id',BigInteger,nullable=True,index=True),
        Column('created_at',BigInteger,nullable=True), Column('updated_at',BigInteger,nullable=True),
        Column('version',BigInteger,nullable=False), Column('payload',JSONDocument,nullable=False),
        mysql_charset='utf8mb4',mysql_collate='utf8mb4_bin',mysql_engine='InnoDB')


def entity_timestamp(item, *keys):
    import datetime
    for key in keys:
        value=item.get(key)
        if value is None: continue
        if isinstance(value,(int,float)): return int(value if abs(value)>=100000000000 else value*1000)
        if isinstance(value,str):
            try:
                date=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
                if date.tzinfo is None: date=date.replace(tzinfo=datetime.timezone.utc)
                return int(date.timestamp()*1000)
            except ValueError: pass
    return None


def split_entities(kind,ident,payload,owner,version):
    if kind not in ENTITY_FIELDS: return payload,[]
    shell=dict(payload) if isinstance(payload,dict) else payload
    fields=[]; rows=[]; seen=set()
    for field in ENTITY_FIELDS[kind]:
        items=payload if field=='$root' else payload.get(field) if isinstance(payload,dict) else None
        if not isinstance(items,list): continue
        fields.append(field)
        if field=='$root': shell=[]
        else: shell[field]=[]
        for position,value in enumerate(items):
            item=value if isinstance(value,dict) else {}
            entity_id=str(item.get('id') or item.get('project_id') or f'legacy-position-{position}')
            if len(entity_id)>240: raise StorageFailure('Business entity ID exceeds 240 characters')
            entity_owner=item.get('owner_user_id',owner)
            row_id=hashlib.sha256((ident+'\0'+field+'\0'+str(entity_owner)+'\0'+entity_id).encode()).hexdigest()
            if row_id in seen: raise StorageFailure('Duplicate business entity ID in '+kind+'.'+field)
            seen.add(row_id)
            rows.append(dict(id=row_id,document_id=ident,entity_id=entity_id,collection=field,position=position,
                owner_user_id=entity_owner,version=version,payload=value,
                created_at=entity_timestamp(item,'created_at','createdAt'),updated_at=entity_timestamp(item,'updated_at','updatedAt','timestamp')))
    return {'repository_format':1,'shell':shell,'collections':fields},rows

# Deliberately excluded from TABLES, so ordinary path/list APIs cannot expose
# unclaimed legacy histories. Only the offline migration tool accesses this table.
UNCLAIMED = Table('content_unclaimed_conversations', metadata,
    Column('id',String(64),primary_key=True), Column('source_key',String(700),nullable=False),
    Column('payload',JSONDocument,nullable=False), Column('content_digest',String(64),nullable=False),
    Column('snapshot_id',String(64),nullable=False), Column('imported_at',BigInteger,nullable=False),
    mysql_charset='utf8mb4',mysql_collate='utf8mb4_bin',mysql_engine='InnoDB')

_versions = contextvars.ContextVar('content_read_versions', default=None)
_staged = contextvars.ContextVar('content_staged_writes', default=None)


def reset_context():
    _versions.set({})
    _staged.set({})


class StorageFailure(RuntimeError): pass


def propagate_storage_error():
    error = sys.exception()
    if isinstance(error, (SQLAlchemyError, StorageFailure)) or isinstance(error, HTTPException) and error.status_code == 409:
        raise error


class ContentRepository:
    def __init__(self, engine): self.engine = engine

    def initialize(self): metadata.create_all(self.engine)

    def get(self, kind, key, *, observe=True):
        table = TABLES[kind]
        ident = hashlib.sha256(key.encode()).hexdigest()
        with self.engine.connect().execution_options(isolation_level='REPEATABLE READ') as c:
            row = c.execute(select(table).where(table.c.id == ident)).mappings().first()
            if row:
                row=dict(row)
                document=row['payload']
                if kind in ENTITIES and isinstance(document,dict) and document.get('repository_format')==1:
                    shell=document['shell']
                    values=c.execute(select(ENTITIES[kind]).where(ENTITIES[kind].c.document_id==ident).order_by(ENTITIES[kind].c.position)).mappings().all()
                    for field in document['collections']:
                        collection=[value['payload'] for value in values if value['collection']==field]
                        if field=='$root': shell=collection
                        else: shell[field]=collection
                    row['payload']=shell
        if observe:
            versions = dict(_versions.get() or {})
            versions[(kind,key)] = row['version'] if row else 0
            _versions.set(versions)
        if row and row['source_key'] != key: raise StorageFailure('Document key collision')
        return dict(row) if row else None

    def put(self, kind, key, payload, *, expected=None):
        table = TABLES[kind]
        ident = hashlib.sha256(key.encode()).hexdigest()
        if expected is None: expected = (_versions.get() or {}).get((kind,key))
        owner = payload.get('owner_user_id') if isinstance(payload,dict) else None
        match = re.match(r'data/user_content/(\d+)/',key) or re.match(r'data/conversations/user-(\d+)/',key)
        if match: owner = int(match[1])
        now = int(time.time()*1000)
        with self.engine.begin() as c:
            row = c.execute(select(table).where(table.c.id == ident).with_for_update()).mappings().first()
            actual = row['version'] if row else 0
            if expected is not None and expected != actual:
                raise HTTPException(409, '内容已被其他操作更新，请刷新后重试')
            if row and row['source_key'] != key: raise StorageFailure('Document key collision')
            values = dict(payload=payload, owner_user_id=owner, version=actual+1, updated_at=now)
            values['payload'],entities=split_entities(kind,ident,payload,owner,actual+1)
            if row: c.execute(update(table).where(table.c.id == ident).values(**values))
            else: c.execute(insert(table).values(id=ident,source_key=key,created_at=now,**values))
            if kind in ENTITIES:
                c.execute(delete(ENTITIES[kind]).where(ENTITIES[kind].c.document_id==ident))
                if entities: c.execute(insert(ENTITIES[kind]),entities)
        versions = dict(_versions.get() or {})
        versions[(kind,key)] = actual+1
        _versions.set(versions)

    def remove(self, kind, key):
        table = TABLES[kind]
        ident = hashlib.sha256(key.encode()).hexdigest()
        expected = (_versions.get() or {}).get((kind,key))
        with self.engine.begin() as c:
            statement = delete(table).where(table.c.id == ident)
            if expected is not None: statement = statement.where(table.c.version == expected)
            if c.execute(statement).rowcount == 0:
                if c.execute(select(table.c.id).where(table.c.id==ident)).first():
                    raise HTTPException(409, '内容已更新，不能删除旧版本')
                raise FileNotFoundError(key)

    def keys(self):
        with self.engine.connect() as c:
            return [key for table in TABLES.values() for key in c.execute(select(table.c.source_key)).scalars()]


class JsonStream(io.StringIO):
    def __init__(self, adapter, path, mode, initial=''):
        super().__init__(initial)
        self.adapter, self.path, self.mode = adapter, path, mode
        self.name = str(path)

    def __exit__(self, kind, value, traceback):
        try:
            if kind is None and any(x in self.mode for x in 'wx'):
                try: payload = self.getvalue() if self.adapter.classify(self.path)[1].endswith('.txt') else json.loads(self.getvalue())
                except ValueError as exc: raise StorageFailure('Invalid JSON document write') from exc
                self.adapter.write(self.path, payload)
        finally: self.close()


class BusinessFiles:
    def __init__(self, root, repository):
        self.root = Path(root).resolve()
        self.repository = repository

    def relative(self, path):
        if not isinstance(path,(str,os.PathLike)): return None
        try: return Path(path).resolve().relative_to(self.root).as_posix()
        except ValueError: return None

    def classify(self, path):
        key = self.relative(path)
        if key is None: return None
        canonical = re.sub(
            r'(\.(?:json|txt))(?:\.[\w-]+)?\.(?:tmp|owner_tmp|document_tmp|agent_session_tmp|agent_tmp|update_tmp|rollback_tmp)$',
            r'\1', key,
        )
        kind = SINGLETONS.get(canonical)
        if not kind:
            kind = next((v for p,v in PREFIXES.items() if canonical.startswith(p) and canonical.endswith('.json')),None)
        if kind=='user_content':
            kind=SINGLETONS.get('data/'+canonical.rsplit('/',1)[-1],kind)
            if canonical.endswith('/history.json'): kind='history'
        if not kind:
            for pattern, candidate in EXTRA_GLOBS.items():
                if fnmatch.fnmatchcase(canonical,pattern) or ('/**/' in pattern and fnmatch.fnmatchcase(canonical,pattern.replace('/**/', '/'))):
                    kind=candidate
                    break
        return (kind,canonical,key!=canonical) if kind else None

    def directory(self,path):
        if self.classify(path): return False
        key=self.relative(path)
        return key is not None and any((key+'/').startswith(p) or p.startswith(key+'/') for p in PREFIXES)

    def open(self,path,mode='r',*args,**kwargs):
        info=self.classify(path)
        if not info: return builtins.open(path,mode,*args,**kwargs)
        if 'b' in mode or 'a' in mode or '+' in mode: raise StorageFailure('Business JSON requires read or atomic write mode')
        kind,key,temp=info
        initial=''
        if mode.startswith('r'):
            if temp:
                staged=(_staged.get() or {}).get(str(path))
                if staged is None: raise FileNotFoundError(path)
                value=staged
            else:
                row=self.repository.get(kind,key)
                if row is None: raise FileNotFoundError(path)
                value=row['payload']
            initial=value if key.endswith('.txt') else json.dumps(value,ensure_ascii=False)
        elif mode.startswith('x') and self.exists(path): raise FileExistsError(path)
        return JsonStream(self,path,mode,initial)

    def write(self,path,payload):
        kind,key,temp=self.classify(path)
        if temp:
            staged=dict(_staged.get() or {})
            staged[str(path)]=payload
            _staged.set(staged)
        else: self.repository.put(kind,key,payload)

    def exists(self,path):
        info=self.classify(path)
        if info:
            kind,key,temp=info
            return str(path) in (_staged.get() or {}) if temp else self.repository.get(kind,key,observe=False) is not None
        if self.directory(path): return True
        return os.path.exists(path)

    def isfile(self,path): return self.exists(path) if self.classify(path) else os.path.isfile(path)
    def isdir(self,path): return True if self.directory(path) else os.path.isdir(path)

    def listdir(self,path):
        if not self.directory(path): return os.listdir(path)
        prefix=(self.relative(path) or '')+'/'
        entries={k[len(prefix):].split('/')[0] for k in self.repository.keys() if k.startswith(prefix)}
        if os.path.isdir(path):
            entries.update(name for name in os.listdir(path) if not self.classify(Path(path)/name))
        return sorted(entries)

    def walk(self, path):
        entries=self.listdir(path)
        dirs=[name for name in entries if self.isdir(Path(path)/name)]
        files=[name for name in entries if not self.isdir(Path(path)/name)]
        yield str(path),dirs,files
        for name in dirs:
            yield from self.walk(Path(path)/name)

    def makedirs(self,path,*args,**kwargs):
        if not self.directory(path): return os.makedirs(path,*args,**kwargs)

    def remove(self,path):
        info=self.classify(path)
        if not info: return os.remove(path)
        kind,key,temp=info
        if temp:
            staged=dict(_staged.get() or {})
            if str(path) not in staged: raise FileNotFoundError(path)
            del staged[str(path)]
            _staged.set(staged)
        else: self.repository.remove(kind,key)

    def replace(self,source,target):
        info=self.classify(target)
        if not info: return os.replace(source,target)
        source_info=self.classify(source)
        if not source_info or not source_info[2]: raise StorageFailure('Expected staged JSON source')
        staged=dict(_staged.get() or {})
        if str(source) not in staged: raise FileNotFoundError(source)
        self.repository.put(info[0],info[1],staged[str(source)])
        del staged[str(source)]
        _staged.set(staged)

    def rename(self,source,target):
        info=self.classify(source)
        target_info=self.classify(target)
        if not info and not target_info:
            old_key,new_key=self.relative(source),self.relative(target)
            if not os.path.isdir(source) or old_key is None or new_key is None: return os.rename(source,target)
            prefix=old_key+'/'
            with self.repository.engine.begin() as c:
                moved=False
                try:
                    for table in TABLES.values():
                        rows=c.execute(select(table.c.id,table.c.source_key).where(table.c.source_key.startswith(prefix,autoescape=True)).with_for_update()).all()
                        for ident,key in rows:
                            new=new_key+'/'+key[len(prefix):]
                            c.execute(update(table).where(table.c.id==ident).values(id=hashlib.sha256(new.encode()).hexdigest(),source_key=new,version=table.c.version+1))
                    os.rename(source,target)
                    moved=True
                    c.commit()
                except Exception:
                    if moved and os.path.isdir(target) and not os.path.exists(source): os.rename(target,source)
                    raise
            return
        if not info or not target_info or info[0]!=target_info[0]: raise StorageFailure('Cannot move business metadata outside its collection')
        table=TABLES[info[0]]
        ident=hashlib.sha256(info[1].encode()).hexdigest()
        target_id=hashlib.sha256(target_info[1].encode()).hexdigest()
        with self.repository.engine.begin() as c:
            if c.execute(select(table.c.id).where(table.c.id==target_id)).first(): raise FileExistsError(target)
            if not c.execute(update(table).where(table.c.id==ident).values(id=target_id,source_key=target_info[1],version=table.c.version+1)).rowcount: raise FileNotFoundError(source)

    def sync(self,file):
        file.flush()
        if not isinstance(file,JsonStream): os.fsync(file.fileno())


def configure(root):
    repository=ContentRepository(engine_for(required_url()))
    repository.initialize()
    return BusinessFiles(root,repository)
