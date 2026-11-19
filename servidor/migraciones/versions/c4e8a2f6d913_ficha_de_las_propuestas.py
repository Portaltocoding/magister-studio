"""propuestas.ficha: lo que dijo el juez del research de cada página (ADR-0020)

{objetivos, tipo, profundidad, autoridad, cita, resumen, dominio}. Nula en las propuestas de antes.

Revision ID: c4e8a2f6d913
Revises: b4e8d2a61c37
Create Date: 2026-11-19 14:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'c4e8a2f6d913'
down_revision: Union[str, Sequence[str], None] = 'b4e8d2a61c37'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("propuestas", sa.Column("ficha", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("propuestas", "ficha")
