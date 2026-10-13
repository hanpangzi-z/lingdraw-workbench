"""Short-lived MySQL schemas for integration tests; never touches source data."""
import os
import uuid
from contextlib import contextmanager
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from mysql_runtime import engine_for

@contextmanager
def isolated_platform_database(variable='PLATFORM_DATABASE_URL'):
    url=make_url(os.environ['MYSQL_TEST_ADMIN_URL']).set(drivername='mysql+pymysql')
    if url.host not in {'localhost','127.0.0.1'}: raise RuntimeError('Local test database required')
    name='test_mysql_'+uuid.uuid4().hex[:20]
    admin=create_engine(url,hide_parameters=True)
    with admin.begin() as c: c.exec_driver_sql(f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin')
    target=url.set(database=name)
    try:
        with patch.dict(os.environ,{variable:target.render_as_string(hide_password=False)}): yield target
    finally:
        engine_for(target).dispose()
        with admin.begin() as c: c.exec_driver_sql(f'DROP DATABASE `{name}`')
        admin.dispose()
