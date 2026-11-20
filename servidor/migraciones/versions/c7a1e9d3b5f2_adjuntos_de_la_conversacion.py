"""los documentos adjuntos de una conversación (ids de versión)

Estudio libre: lo que adjuntas con «+» viaja con el mensaje y la conversación lo recuerda en los turnos siguientes
(«y ahora un proyecto de esto»). Una lista JSON de `versiones.id`: lo que viaja son ids, el texto se trae por id.

Revision ID: c7a1e9d3b5f2
Revises: b5e2d8f4a6c1
Create Date: 2026-11-20 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'c7a1e9d3b5f2'
down_revision: Union[str, Sequence[str], None] = 'b5e2d8f4a6c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("conversaciones", sa.Column("adjuntos", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False))


def downgrade() -> None:
    op.drop_column("conversaciones", "adjuntos")
