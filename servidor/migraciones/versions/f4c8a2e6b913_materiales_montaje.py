"""materiales.montaje: con qué versión del montaje (plantillas de los apuntes) se montó y pintó cada material

Nula en los materiales de antes: al servirlos se vuelve a montar su markdown y se encola el repintado del PDF.

Revision ID: f4c8a2e6b913
Revises: e2b7c9d4a611
Create Date: 2026-11-20 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f4c8a2e6b913'
down_revision: Union[str, Sequence[str], None] = 'e2b7c9d4a611'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("materiales", sa.Column("montaje", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("materiales", "montaje")
