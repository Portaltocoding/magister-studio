"""índice v4 (tus notas por secciones, las cortas juntas) activa por defecto

v4 son los parámetros de v3 más `vault_por_secciones` y `seccion_minima` (ADR-0018, nota del 20-11-2026). v3 no se
edita: una configuración tiene id y no cambia. Idempotente: si v4 ya existe, no se duplica; solo se activa. No
reindexa nada: lo que ya estuviera «lista» con v3 se reindexa con `uv run magister indexar` (dilo antes con
`--en-seco`).

Revision ID: b5e2d8f4a6c1
Revises: f4c8a2e6b913
Create Date: 2026-11-20 09:00:00

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b5e2d8f4a6c1'
down_revision: Union[str, Sequence[str], None] = 'f4c8a2e6b913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NUEVOS = {"vault_por_secciones": True, "seccion_minima": 50}


def upgrade() -> None:
    c = op.get_bind()
    if c.execute(sa.text("select id from configuraciones where nombre = 'v4'")).scalar() is None:
        base = c.execute(sa.text("select params from configuraciones where nombre = 'v3'")).scalar()
        if base is None:
            base = c.execute(sa.text("select params from configuraciones where activa")).scalar()
        if isinstance(base, str):
            base = json.loads(base)
        if base is None:
            raise RuntimeError("no hay v3 ni configuración activa de la que partir")
        params = {**base, **NUEVOS}
        c.execute(sa.text("insert into configuraciones (nombre, params, activa) values ('v4', cast(:p as jsonb), false)"),
                  {"p": json.dumps(params, ensure_ascii=False)})
    # Solo una activa (índice único parcial): primero se apaga la que hubiera.
    c.execute(sa.text("update configuraciones set activa = false where activa and nombre <> 'v4'"))
    c.execute(sa.text("update configuraciones set activa = true where nombre = 'v4'"))


def downgrade() -> None:
    c = op.get_bind()
    if c.execute(sa.text("select id from configuraciones where nombre = 'v3'")).scalar() is not None:
        c.execute(sa.text("update configuraciones set activa = false where activa and nombre <> 'v3'"))
        c.execute(sa.text("update configuraciones set activa = true where nombre = 'v3'"))
    # v4 se borra solo si no tiene fragmentos; si los tiene, se queda a un lado, sin activar.
    c.execute(sa.text("delete from configuraciones g where g.nombre = 'v4' "
                      "and not exists (select 1 from fragmentos f where f.config_id = g.id)"))
