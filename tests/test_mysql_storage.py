"""Integration tests: MYSQL_TEST_ADMIN_URL must point at a local MySQL 8.0 server."""
import contextvars
import json
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from mysql_runtime import engine_for
from platform_admin import PlatformStore, PlatformStoreError
from content_repository import ContentRepository, BusinessFiles, reset_context
from drawing_storage import make_router


@unittest.skipUnless(os.getenv('MYSQL_TEST_ADMIN_URL'), 'Requires isolated local MySQL 8.0')
class MySQLStorageTests(unittest.TestCase):
    def setUp(self):
        self.name='test_mysql_'+uuid.uuid4().hex[:20]
        admin_url=make_url(os.environ['MYSQL_TEST_ADMIN_URL']).set(drivername='mysql+pymysql')
        if admin_url.host not in {'127.0.0.1','localhost'}: raise RuntimeError('Tests only target localhost')
        self.admin=create_engine(admin_url,hide_parameters=True)
        with self.admin.begin() as c: c.exec_driver_sql(f'CREATE DATABASE `{self.name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin')
        self.url=admin_url.set(database=self.name)
        self.env=patch.dict(os.environ,{'PLATFORM_DATABASE_URL':self.url.render_as_string(hide_password=False)})
        self.env.start()
        self.engine=engine_for(self.url)
        self.store=PlatformStore('unused','unused')
        self.store.initialize()
        self.repo=ContentRepository(self.engine); self.repo.initialize()
        self.tmp=tempfile.TemporaryDirectory()
        self.files=BusinessFiles(self.tmp.name,self.repo)
        reset_context()

    def tearDown(self):
        self.engine.dispose()
        self.store.engine.dispose()
        self.env.stop()
        self.tmp.cleanup()
        assert self.name.startswith('test_mysql_')
        with self.admin.begin() as c: c.exec_driver_sql(f'DROP DATABASE `{self.name}`')
        self.admin.dispose()

    def member(self):
        self.store.create_admin('owner','password123')
        user=self.store.create_user('member','password123')
        self.store.set_user_status(user['id'],'enabled','owner')
        self.store.adjust_credit(user['id'],'owner','add',10,'test')
        return user

    def test_parallel_idempotent_debit_and_refund(self):
        user=self.member()
        def reserve(_): return self.store.reserve_usage_idempotent('same-key','member','image',1,'test','model')
        with ThreadPoolExecutor(max_workers=6) as pool: events=list(pool.map(reserve,range(12)))
        # API returns (event, created); all replays reference the original event.
        ids={event[0] for event in events}
        self.assertEqual(len(ids),1)
        ident=ids.pop()
        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(lambda _:self.store.finish_usage(ident,False,0,'synthetic'),range(12)))
        self.assertEqual(self.store.user_balance(user['id'])['balance'],10)

    def test_login_case_and_transaction_rollback(self):
        user=self.member()
        self.assertEqual(self.store.authenticate_user('MEMBER','password123')['id'],user['id'])
        with self.assertRaises(ValueError):
            with self.store.connect(immediate=True) as c:
                c.execute('UPDATE platform_users SET credit_balance=0 WHERE id=?',(user['id'],))
                raise ValueError('rollback')
        self.assertEqual(self.store.user_balance(user['id'])['balance'],10)

    def test_restart_preserves_pending_workflow_reservation(self):
        user=self.member()
        ident=self.store.reserve_usage('member','image',1,'pending-workflow')
        with self.store.connect(immediate=True) as c:
            c.execute('UPDATE platform_usage_events SET created_at=1 WHERE id=?',(ident,))
        self.store.initialize()
        self.assertEqual(self.store.user_balance(user['id'])['balance'],9)
        with self.store.connect() as c:
            self.assertEqual(c.execute('SELECT status FROM platform_usage_events WHERE id=?',(ident,)).fetchone()['status'],'reserved')

    def test_canvas_and_prompt_atomic_writer_suffixes_use_mysql(self):
        for filename, suffix in [
            ('data/canvases/test.json', '.document_tmp'),
            ('data/canvases/test.json', '.agent_session_tmp'),
            ('data/canvases/test.json', '.agent_tmp'),
            ('data/asset_classification_prompt.txt', '.tmp'),
        ]:
            with self.subTest(suffix=suffix):
                path = Path(self.tmp.name) / filename
                temp = str(path) + '.' + uuid.uuid4().hex + suffix
                payload = 'classification prompt' if path.suffix == '.txt' else {'nodes': [{'id': suffix}]}
                with self.files.open(temp, 'w', encoding='utf-8') as stream:
                    stream.write(payload) if isinstance(payload, str) else json.dump(payload, stream)
                self.files.replace(temp, path)
                reset_context()
                with self.files.open(path, encoding='utf-8') as stream:
                    actual = stream.read() if isinstance(payload, str) else json.load(stream)
                self.assertEqual(actual, payload)
                self.assertFalse(path.exists())
                self.assertFalse(Path(temp).exists())

    def test_content_atomic_write_and_no_filesystem_fallback(self):
        path=Path(self.tmp.name)/'data/canvases/test.json'
        path.parent.mkdir(parents=True)
        path.write_text('{"legacy":true}',encoding='utf-8')
        self.assertFalse(self.files.exists(path))
        temp=str(path)+'.temporary.tmp'
        with self.files.open(temp,'w') as f: json.dump({'id':'test','owner_user_id':1},f)
        self.assertFalse(self.files.exists(path))
        self.files.replace(temp,path)
        self.assertEqual(json.load(self.files.open(path))['id'],'test')
        self.assertEqual(json.loads(path.read_text()),{'legacy':True})
        self.assertEqual(self.files.listdir(path.parent),['test.json'])

    def test_stale_content_update_is_rejected(self):
        self.repo.put('canvases','data/canvases/test.json',{'v':1},expected=0)
        first=contextvars.copy_context(); second=contextvars.copy_context()
        first.run(self.repo.get,'canvases','data/canvases/test.json')
        second.run(self.repo.get,'canvases','data/canvases/test.json')
        first.run(self.repo.put,'canvases','data/canvases/test.json',{'v':2})
        with self.assertRaises(HTTPException) as raised:
            second.run(self.repo.put,'canvases','data/canvases/test.json',{'v':3})
        self.assertEqual(raised.exception.status_code,409)

    def test_entity_rows_preserve_documents_and_float_coordinates(self):
        from content_repository import ENTITIES
        from sqlalchemy import select
        payload={'projects':[{'id':'p1','owner_user_id':1,'name':'项目','point':1.2345678901234567},{'id':'p2','name':'其他'},{'id':'p1','owner_user_id':2,'name':'另一账号同名编号'}]}
        self.repo.put('projects','data/user_content/1/projects.json',payload,expected=0)
        self.assertEqual(self.repo.get('projects','data/user_content/1/projects.json')['payload'],payload)
        with self.engine.connect() as c:
            rows=c.execute(select(ENTITIES['projects'])).mappings().all()
        self.assertEqual({row['entity_id'] for row in rows},{'p1','p2'})
        self.assertEqual({row['owner_user_id'] for row in rows},{1,2})
        self.assertEqual(len(rows),3)
        from sqlalchemy.exc import SQLAlchemyError
        with self.assertRaises(SQLAlchemyError):
            self.repo.put('projects','data/user_content/1/projects.json',{'projects':[{'id':'bad','owner_user_id':'not-a-number'}]})
        self.assertEqual(self.repo.get('projects','data/user_content/1/projects.json')['payload'],payload)
        self.repo.remove('projects','data/user_content/1/projects.json')
        with self.engine.connect() as c: self.assertEqual(c.execute(select(ENTITIES['projects'])).all(),[])

    def test_drawing_import_isolation_revision_and_delete(self):
        app=FastAPI()
        app.include_router(make_router(self.engine,lambda r:{'id':int(r.headers['x-test-owner'])},
                           self.tmp.name,lambda *a:None,lambda *a:None))
        client=TestClient(app)
        headers={'x-test-owner':'1'}
        body={'payload':{'name':'画板','elements':[],'files':{}},'import_key':'browser-original'}
        first=client.post('/api/drawing/boards',json=body,headers=headers)
        self.assertEqual(first.status_code,200,first.text)
        record=first.json(); ident=record['id']
        self.assertEqual(client.post('/api/drawing/boards',json=body,headers=headers).json()['id'],ident)
        self.assertEqual(client.get('/api/drawing/boards/'+ident,headers={'x-test-owner':'2'}).status_code,404)
        update={'payload':{**body['payload'],'name':'changed'},'revision':1}
        self.assertEqual(client.put('/api/drawing/boards/'+ident,json=update,headers=headers).json()['revision'],2)
        self.assertEqual(client.put('/api/drawing/boards/'+ident,json=update,headers=headers).status_code,409)
        self.assertEqual(client.delete('/api/drawing/boards/'+ident+'?revision=1',headers=headers).status_code,409)
        self.assertEqual(client.delete('/api/drawing/boards/'+ident+'?revision=2',headers=headers).status_code,200)

    def test_collection_reads_are_consistent_during_replacement(self):
        key='data/user_content/1/projects.json'
        def payload(n): return {'marker':n,'projects':[{'id':str(i),'marker':n} for i in range(8)]}
        self.repo.put('projects',key,payload(0),expected=0)
        def write():
            for n in range(1,16): self.repo.put('projects',key,payload(n))
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending=pool.submit(write)
            for _ in range(30):
                value=self.repo.get('projects',key)['payload']
                self.assertEqual({item['marker'] for item in value['projects']},{value['marker']})
            pending.result()

if __name__=='__main__': unittest.main()
