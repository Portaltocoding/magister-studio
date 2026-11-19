"""proyectos.roadmap_anterior: el roadmap de antes del último «rehacer», para poder volver a él

Una sola copia (la última), como {"roadmap", "arquitectura_svg", "trabajo_id"}. Nula en los proyectos de antes.

Revision ID: a7c3e91d5b20
Revises: fec91372e16c
Create Date: 2026-11-19 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a7c3e91d5b20'
down_revision: Union[str, Sequence[str], None] = 'fec91372e16c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("proyectos", sa.Column("roadmap_anterior", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("proyectos", "roadmap_anterior")
