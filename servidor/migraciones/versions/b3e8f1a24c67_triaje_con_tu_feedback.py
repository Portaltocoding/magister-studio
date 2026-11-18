"""triaje: tu comentario y los motivos al aceptar o descartar un candidato

Revision ID: b3e8f1a24c67
Revises: 5dbfa9d2a196
Create Date: 2026-11-18 17:30:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b3e8f1a24c67'
down_revision: Union[str, Sequence[str], None] = '5dbfa9d2a196'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('candidatos_banco', sa.Column('comentario', sa.Text(), nullable=True))
    op.add_column('candidatos_banco', sa.Column('motivos', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False))
    op.add_column('candidatos_banco', sa.Column('juez_acerto', sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column('candidatos_banco', 'juez_acerto')
    op.drop_column('candidatos_banco', 'motivos')
    op.drop_column('candidatos_banco', 'comentario')
