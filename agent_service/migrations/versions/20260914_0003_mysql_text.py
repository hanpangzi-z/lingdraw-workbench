"""Preserve PostgreSQL/SQLite unbounded text capacity on MySQL."""
from alembic import op
from sqlalchemy import inspect, Text
from sqlalchemy.dialects.mysql import LONGTEXT

revision='20260914_0003'
down_revision='20260722_0002'
branch_labels=None
depends_on=None

def upgrade():
    connection=op.get_bind()
    if connection.dialect.name != 'mysql': raise RuntimeError('MySQL 8.0 is required')
    inspector=inspect(connection)
    for name in inspector.get_table_names():
        if name=='alembic_version': continue
        for column in inspector.get_columns(name):
            if isinstance(column['type'],Text) and not isinstance(column['type'],LONGTEXT):
                op.alter_column(name,column['name'],existing_type=column['type'],type_=LONGTEXT(),existing_nullable=column['nullable'])

def downgrade():
    raise RuntimeError('Text narrowing could lose data; restore the isolated source snapshot instead')
