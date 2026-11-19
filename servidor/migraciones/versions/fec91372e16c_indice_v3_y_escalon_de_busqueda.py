"""índice v3 (sin bibliografía ni notas) activa por defecto y escalón de cada búsqueda

v3 son los parámetros de v1 más `secciones_fuera` (ADR-0018). v1 no se edita: una configuración tiene id y no cambia.
Idempotente: si v3 ya existe (la creó `magister indexar --activar v3`), no se duplica; solo se activa. No reindexa
nada: lo que ya estuviera «lista» con v1 se reindexa con `uv run magister indexar` (dilo antes con `--en-seco`).

`busquedas.escalon`: dónde se resolvió «hay fuentes» (lexica, densa, reranker o nada). Nulo en las de antes.

Revision ID: fec91372e16c
Revises: bcc3bf09bacc
Create Date: 2026-11-19 09:00:00

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'fec91372e16c'
down_revision: Union[str, Sequence[str], None] = 'bcc3bf09bacc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Los de la migración que creó v1, por si v1 no estuviera (una base a medio montar).
V1 = {
    "modelo": "intfloat/multilingual-e5-small", "dimension": 384, "prefijo_pasaje": "passage: ",
    "prefijo_consulta": "query: ", "normalizar": True, "tokens": 400, "solape": 50, "vault_por_parrafos": True,
    "encabezado_contextual": True,
}
# Copia fija de `fuentes.trocear.SECCIONES_FUERA` de hoy: v3 trocea siempre igual aunque esa lista cambie.
SECCIONES_FUERA = [
    "references", "reference list", "bibliography", "select bibliography", "notes", "footnotes", "endnotes",
    "notes and references", "references and notes", "works cited", "literature cited", "further reading",
    "external links", "see also", "related entries", "cite this article", "cite this chapter",
    "how to cite this entry", "download citation", "copyright information", "rights and permissions",
    "academic tools", "other internet resources", "about this article", "about this chapter", "publishers note",
    "additional information", "editor information", "editors and affiliations", "authors and affiliations",
    "author information", "similar content being viewed by others", "acknowledgements", "acknowledgments",
    "referencias", "referencias bibliograficas", "bibliografia", "bibliografia seleccionada", "notas",
    "notas al pie", "notas y referencias", "obras citadas", "lecturas recomendadas", "lecturas adicionales",
    "otras lecturas", "enlaces externos", "vease tambien", "como citar", "como citar este articulo",
    "citar este articulo", "agradecimientos",
]


def upgrade() -> None:
    op.add_column('busquedas', sa.Column('escalon', sa.String(length=10), nullable=True))
    c = op.get_bind()
    if c.execute(sa.text("select id from configuraciones where nombre = 'v3'")).scalar() is None:
        base = c.execute(sa.text("select params from configuraciones where nombre = 'v1'")).scalar()
        if isinstance(base, str):
            base = json.loads(base)
        params = {**(base or V1), "secciones_fuera": SECCIONES_FUERA}
        c.execute(sa.text("insert into configuraciones (nombre, params, activa) values ('v3', cast(:p as jsonb), false)"),
                  {"p": json.dumps(params, ensure_ascii=False)})
    # Solo una activa (índice único parcial): primero se apaga la que hubiera.
    c.execute(sa.text("update configuraciones set activa = false where activa and nombre <> 'v3'"))
    c.execute(sa.text("update configuraciones set activa = true where nombre = 'v3'"))


def downgrade() -> None:
    c = op.get_bind()
    if c.execute(sa.text("select id from configuraciones where nombre = 'v1'")).scalar() is not None:
        c.execute(sa.text("update configuraciones set activa = false where activa and nombre <> 'v1'"))
        c.execute(sa.text("update configuraciones set activa = true where nombre = 'v1'"))
    # v3 se borra solo si no tiene fragmentos; si los tiene, se queda a un lado, sin activar, como cualquier otra.
    c.execute(sa.text("delete from configuraciones g where g.nombre = 'v3' "
                      "and not exists (select 1 from fragmentos f where f.config_id = g.id)"))
    op.drop_column('busquedas', 'escalon')
