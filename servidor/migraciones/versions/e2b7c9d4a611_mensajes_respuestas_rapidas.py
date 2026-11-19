"""mensajes.respuestas_rapidas: las respuestas rápidas del diagnóstico, guardadas con el mensaje del tutor

Antes solo viajaban por SSE y al recargar se perdían. JSONB con {campo, opciones: [{valor, etiqueta}]}; nula en el resto.

Revision ID: e2b7c9d4a611
Revises: d6f1b3a8c240
Create Date: 2026-11-19 20:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'e2b7c9d4a611'
down_revision: Union[str, Sequence[str], None] = 'd6f1b3a8c240'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("mensajes", sa.Column("respuestas_rapidas", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("mensajes", "respuestas_rapidas")
