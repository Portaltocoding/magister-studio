"""temas: el perfil de explicación de la materia (derecho, filosofía, exactas...)

Revision ID: c5d2a9e47b18
Revises: b3e8f1a24c67
Create Date: 2026-11-18 19:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c5d2a9e47b18'
down_revision: Union[str, Sequence[str], None] = 'b3e8f1a24c67'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nulo = sin elegir todavía: se elige la primera vez que hace falta y se guarda.
    op.add_column('temas', sa.Column('materia', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('temas', 'materia')
