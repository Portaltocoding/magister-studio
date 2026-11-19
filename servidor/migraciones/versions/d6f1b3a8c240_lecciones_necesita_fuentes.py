"""lecciones.necesita_fuentes y fuentes_por_que: si hace falta buscar fuentes para cada lección (ADR-0021)

no | conviene | imprescindible, y una frase para el alumno. Nulas en las lecciones de antes: se leen como «conviene».

Revision ID: d6f1b3a8c240
Revises: c4e8a2f6d913
Create Date: 2026-11-19 18:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd6f1b3a8c240'
down_revision: Union[str, Sequence[str], None] = 'c4e8a2f6d913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("lecciones", sa.Column("necesita_fuentes", sa.String(16), nullable=True))
    op.add_column("lecciones", sa.Column("fuentes_por_que", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_lecciones_necesita_fuentes", "lecciones",
        "necesita_fuentes is null or necesita_fuentes in ('no', 'conviene', 'imprescindible')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_lecciones_necesita_fuentes", "lecciones", type_="check")
    op.drop_column("lecciones", "fuentes_por_que")
    op.drop_column("lecciones", "necesita_fuentes")
