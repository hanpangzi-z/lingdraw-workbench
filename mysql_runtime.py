"""MySQL 8.0 connections shared by the synchronous application repositories."""
from __future__ import annotations

import os
import hashlib
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url


def required_url(name="PLATFORM_DATABASE_URL"):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required; configure MySQL 8.0 before starting the application")
    url = make_url(value)
    if url.get_backend_name() != "mysql" or not url.database:
        raise RuntimeError(f"{name} must point to a MySQL database")
    return url


@lru_cache(maxsize=8)
def engine_for(value):
    url = make_url(value)
    if url.get_backend_name() != 'mysql' or not url.database:
        raise RuntimeError('A MySQL 8.0 database URL is required')
    url = url.set(drivername="mysql+pymysql")
    engine = create_engine(url, pool_pre_ping=True, pool_recycle=1800,
                           isolation_level="READ COMMITTED", hide_parameters=True,
                           connect_args={"charset": "utf8mb4", "connect_timeout": 10})

    @event.listens_for(engine, "connect")
    def configure(dbapi, _):
        with dbapi.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'")
            cursor.execute("SELECT VERSION()")
            if not str(cursor.fetchone()[0]).startswith("8.0."):
                raise RuntimeError("This application requires MySQL 8.0.x")
    return engine


class Record(dict):
    def __getitem__(self, key):
        return tuple(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


class Result:
    def __init__(self, result):
        self.result = result
        self.rowcount = result.rowcount
        self.lastrowid = result.lastrowid

    def fetchone(self):
        row = self.result.mappings().fetchone()
        return Record(row) if row is not None else None

    def fetchall(self):
        return [Record(row) for row in self.result.mappings().all()]

    def __iter__(self):
        return iter(self.fetchall())


class Connection:
    """Keep the existing repository's positional parameter and record contract."""
    def __init__(self, connection):
        self.raw = connection

    def execute(self, sql, parameters=()):
        # Application SQL uses ? binds. MySQL DBAPI uses %s; literal percent signs
        # must be escaped before binding. SQL text never contains user values.
        sql = sql.replace("%", "%%").replace("?", "%s")
        return Result(self.raw.exec_driver_sql(sql, tuple(parameters)))

    def executemany(self, sql, rows):
        return Result(self.raw.exec_driver_sql(sql.replace('%','%%').replace('?','%s'), [tuple(row) for row in rows]))


@contextmanager
def platform_connection(engine, immediate=False):
    # Preserve the old BEGIN IMMEDIATE guarantee for compound account/ledger
    # operations, across processes as well as threads. Only write transactions
    # acquire this database-specific lock; readers use READ COMMITTED snapshots.
    with engine.connect() as raw:
        lock_name = "platform-write:" + hashlib.sha256(engine.url.database.encode()).hexdigest()[:40]
        acquired = False
        try:
            if immediate:
                acquired = raw.exec_driver_sql("SELECT GET_LOCK(%s, 15)", (lock_name,)).scalar() == 1
                raw.commit()
                if not acquired:
                    raise TimeoutError("Timed out waiting for platform write transaction")
            with raw.begin():
                yield Connection(raw)
        finally:
            if acquired:
                try:
                    raw.exec_driver_sql("SELECT RELEASE_LOCK(%s)", (lock_name,))
                    raw.commit()
                except Exception:
                    raw.invalidate()
                    raise
