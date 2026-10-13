import json
import math
import os
import unittest
from sqlalchemy import Column, Integer, JSON, MetaData, Table, insert, select
from mysql_runtime import engine_for
from ops.mysql.migrate import digest, mysql_json_value
from tests.mysql_support import isolated_platform_database


class JsonEncodingTests(unittest.TestCase):
    def test_non_floating_payload_unchanged(self):
        value = {'string': '1.2', 'null': None, 'boolean': True, 'int': 2}
        self.assertIs(mysql_json_value(value), value)

    def test_nonfinite_fails_closed(self):
        for value in [math.nan, math.inf, -math.inf]:
            with self.assertRaises(ValueError): mysql_json_value({'x': value})


@unittest.skipUnless(os.getenv('MYSQL_TEST_ADMIN_URL'), 'Requires an isolated MySQL 8.0 server')
class JsonRoundTripTests(unittest.TestCase):
    def test_exact_native_json_numbers_and_special_keys(self):
        values = [
            {'requestedAspectRatio': 1.3090313340526085},
            {'空白.键"\\': [1.3090313340526085, {'*': 1.0, '0': -0.25}]},
            {'values': [1e-100, 1e100, 5e-324, 1.7976931348623157e308]},
            1.3090313340526085,
            [True, False, None, 3, '1.3090313340526085', 1.0],
        ]
        original = json.dumps(values, ensure_ascii=False)
        with isolated_platform_database() as url:
            engine = engine_for(url)
            table = Table('roundtrip', MetaData(), Column('id', Integer, primary_key=True, autoincrement=False), Column('payload', JSON))
            table.create(engine)
            with engine.begin() as c:
                for index, value in enumerate(values):
                    c.execute(insert(table).values(id=index, payload=mysql_json_value(value)))
                actual = c.execute(select(table.c.payload).order_by(table.c.id)).scalars().all()
                self.assertEqual(digest(actual), digest(values))
                self.assertIsInstance(actual[0]['requestedAspectRatio'], float)
        self.assertEqual(json.dumps(values, ensure_ascii=False), original)


if __name__ == '__main__': unittest.main()
