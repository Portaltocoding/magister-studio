"""asesor_cambios.plan_id: el plan de estudio que toca un cambio del asesor

El asesor ya no solo cambia proyectos: también mueve sesiones, marca lecciones y prepara sus apuntes en el plan activo
(ADR-0017, «Más sitios»). Nulo en los cambios de antes y en los que no tocan el plan.

Revision ID: b4e8d2a61c37
Revises: a7c3e91d5b20
Create Date: 2026-11-19 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b4e8d2a61c37'
down_revision: Union[str, Sequence[str], None] = 'a7c3e91d5b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('asesor_cambios', sa.Column('plan_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key('asesor_cambios_plan_id_fkey', 'asesor_cambios', 'planes', ['plan_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    op.drop_constraint('asesor_cambios_plan_id_fkey', 'asesor_cambios', type_='foreignkey')
    op.drop_column('asesor_cambios', 'plan_id')
