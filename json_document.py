"""Lossless JSON documents, including IEEE float values used by canvas geometry.

MySQL's binary JSON rewrites some double values by one ULP. Canonical UTF-8 JSON
text keeps Python/JavaScript round trips exact while remaining SQL JSON-readable.
"""
import json
from sqlalchemy.types import TypeDecorator
from sqlalchemy.dialects.mysql import LONGTEXT


class JSONDocument(TypeDecorator):
    impl = LONGTEXT
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))

    def process_result_value(self, value, dialect):
        return json.loads(value) if isinstance(value, str) else value
