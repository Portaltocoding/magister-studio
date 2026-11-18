"""puntuaciones: con qué versión de la rúbrica se puso la nota del juez

Revision ID: d8a41c6e2f90
Revises: c5d2a9e47b18
Create Date: 2026-11-18 21:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd8a41c6e2f90'
down_revision: Union[str, Sequence[str], None] = 'c5d2a9e47b18'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nulo en las notas de antes: no se sabe con qué rúbrica se pusieron y la alerta de tono no las cuenta.
    op.add_column('puntuaciones', sa.Column('version', sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column('puntuaciones', 'version')
