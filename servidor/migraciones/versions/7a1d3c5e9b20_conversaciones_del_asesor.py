"""conversaciones del asesor: la mascota flotante, una por sección

Revision ID: 7a1d3c5e9b20
Revises: 35055a4aa14d
Create Date: 2026-11-18 14:10:00

"""
from typing import Sequence, Union

from alembic import op

revision: str = '7a1d3c5e9b20'
down_revision: Union[str, Sequence[str], None] = '35055a4aa14d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('ck_conversaciones_tipo', 'conversaciones', type_='check')
    op.create_check_constraint('ck_conversaciones_tipo', 'conversaciones', "tipo in ('libre', 'plan', 'tutor', 'asesor')")


def downgrade() -> None:
    op.execute("delete from conversaciones where tipo = 'asesor'")
    op.drop_constraint('ck_conversaciones_tipo', 'conversaciones', type_='check')
    op.create_check_constraint('ck_conversaciones_tipo', 'conversaciones', "tipo in ('libre', 'plan', 'tutor')")
