"""El índice sencillo de un plan y el libro del tema.

- Índice: pocos temas con nombre llano («Conexiones», «Frontend»), de qué trata cada uno y un título corto por
  lección. Una sola llamada al modelo; se guarda y se reutiliza.
- Libro: todos los apuntes preparados (con su repaso) en un PDF, ordenados por esos temas, con portada e índice.
"""

import asyncio
import logging
import re
from datetime import datetime, timezone

from pydantic import BaseModel, Field
from sqlalchemy import text

from magister.cerebro.estructura import estructurar
from magister.cerebro.prompts import cargar
from magister.datos.sesion import nueva_sesion

registro = logging.getLogger(__name__)


class Tema(BaseModel):
    nombre: str = Field(max_length=40)
    lecciones: list[str]
    trata: list[str] = Field(min_length=1, max_length=6)


class TituloLeccion(BaseModel):
    clave: str
    titulo: str = Field(max_length=60)


class Indice(BaseModel):
    temas: list[Tema] = Field(min_length=1, max_length=8)
    titulos: list[TituloLeccion]


async def _guardar(clave: str, valor: dict) -> None:
    from sqlalchemy.dialects.postgresql import insert

    from magister.datos.produccion import Ajuste

    async with nueva_sesion() as s, s.begin():
        await s.execute(insert(Ajuste).values(clave=clave, valor=valor)
                        .on_conflict_do_update(index_elements=[Ajuste.clave], set_={"valor": valor}))


async def _leer(clave: str) -> dict | None:
    from magister.datos.produccion import Ajuste

    async with nueva_sesion() as s:
        fila = await s.get(Ajuste, clave)
    return fila.valor if fila else None


async def _lecciones(plan_id: int) -> list[tuple[str, str, list[str], list[str]]]:
    async with nueva_sesion() as s:
        filas = (await s.execute(text(
            "select l.clave, l.titulo, l.objetivos, coalesce(array_agg(c.nombre order by c.id) filter (where c.id is not null), '{}') "
            "from lecciones l left join conceptos c on c.plan_id = l.plan_id and c.leccion_clave = l.clave "
            "where l.plan_id = :p group by l.clave, l.titulo, l.objetivos, l.orden order by l.orden"), {"p": plan_id})).all()
    return [(c, t, list(o or []), list(n or [])) for c, t, o, n in filas]


def _reglas(claves: list[str]):
    def comprobar(ix: Indice) -> list[str]:
        errores = []
        repartidas = [c for t in ix.temas for c in t.lecciones]
        if sorted(repartidas) != sorted(claves):
            errores.append(f"cada lección en un solo tema y todas repartidas: {', '.join(claves)}")
        if {t.clave for t in ix.titulos} != set(claves):
            errores.append("un título por lección, con su clave")
        return errores
    return comprobar


async def indice(plan_id: int, rehacer: bool = False) -> dict:
    guardado = await _leer(f"indice_plan_{plan_id}")
    if guardado and not rehacer:
        return guardado
    lecciones = await _lecciones(plan_id)
    if not lecciones:
        raise ValueError("el plan no tiene lecciones")
    texto = "\n".join(f"- {c} · {t}. Objetivos: {'; '.join(o)}. Conceptos: {', '.join(n)}" for c, t, o, n in lecciones)
    ix = await estructurar(cargar("indice").rellenar(lecciones=texto), "Devuelve el índice.", Indice,
                           reglas=_reglas([c for c, *_ in lecciones]))
    valor = {"temas": [t.model_dump() for t in ix.temas], "titulos": {t.clave: t.titulo for t in ix.titulos},
             "fecha": datetime.now(timezone.utc).isoformat(timespec="minutes")}
    await _guardar(f"indice_plan_{plan_id}", valor)
    return valor


# ---- El libro ----

async def estado_libro(plan_id: int) -> dict | None:
    return await _leer(f"libro_plan_{plan_id}")


async def montar_libro(plan_id: int) -> dict:
    """Junta los apuntes preparados en un libro y lo pinta. Tarda lo que pintar un PDF largo."""
    from magister.material.almacen import carpeta_salidas
    from magister.material.render import pintar

    await _guardar(f"libro_plan_{plan_id}", {"estado": "haciendo", "fecha": datetime.now(timezone.utc).isoformat(timespec="minutes")})
    try:
        ix = await indice(plan_id)
        async with nueva_sesion() as s:
            tema = await s.scalar(text("select t.nombre from planes p join temas t on t.id = p.tema_id where p.id = :p"), {"p": plan_id})
            filas = (await s.execute(text(
                "select distinct on (leccion_clave) leccion_clave, texto from materiales where plan_id = :p and tipo = 'apuntes' "
                "and estado in ('listo', 'revisar') order by leccion_clave, id desc"), {"p": plan_id})).all()
        apuntes = {c: t for c, t in filas if t}
        lecciones = await _lecciones(plan_id)
        orden = [c for c, *_ in lecciones]
        temas = ix["temas"]
        partes, incluidas, faltan = [], [], []
        indice_md = []
        for t in temas:
            dentro = [c for c in orden if c in t["lecciones"]]
            hay = [c for c in dentro if c in apuntes]
            faltan += [c for c in dentro if c not in apuntes]
            if not hay:
                continue
            indice_md.append(f"**{t['nombre']}**: {', '.join(ix['titulos'].get(c, c) for c in hay)}. "
                             f"Trata de {', '.join(t['trata'])}.")
            for c in hay:
                cuerpo = re.sub(r"\A---\n.*?\n---\n", "", apuntes[c], count=1, flags=re.S)
                # El capítulo, con el título sencillo.
                sencillo = ix["titulos"].get(c)
                if sencillo:
                    cuerpo = re.sub(r"^# .+$", lambda _m, t=sencillo: f"# {t}", cuerpo, count=1, flags=re.M)
                partes.append(cuerpo.strip())
                incluidas.append(c)
        if not partes:
            raise ValueError("aún no hay ninguna lección con apuntes")
        salida = (carpeta_salidas(plan_id, "libro") / "libro.pdf").as_posix()
        portada = (f"---\ntitulo: {tema}\npie: Magister · {tema}\nsalida: {salida}\n---\n\n"
                   f"::: capitulo\n# {tema}\n\nEl libro de tu plan: {len(incluidas)} lecciones, ordenadas por temas.\n\n"
                   f"[{'; '.join(t['nombre'] for t in temas)}]{{.salir}}\n\n[·]{{.num}}\n:::\n\n"
                   "## Qué hay en este libro {etq=\"Índice\"}\n\n" + "\n\n".join(indice_md))
        md = portada + "\n\n" + "\n\n".join(partes)
        r = await pintar(md, plan_id, "libro", nombre="libro")
        valor = {"estado": "listo" if r.pdf else "error", "pdf": str(r.pdf) if r.pdf else None, "lecciones": incluidas,
                 "faltan": faltan, "paginas": r.paginas, "error": r.error,
                 "fecha": datetime.now(timezone.utc).isoformat(timespec="minutes")}
    except Exception as e:  # noqa: BLE001
        registro.exception("montar el libro")
        valor = {"estado": "error", "error": str(e), "fecha": datetime.now(timezone.utc).isoformat(timespec="minutes")}
    await _guardar(f"libro_plan_{plan_id}", valor)
    return valor


def lanzar_libro(plan_id: int) -> None:
    asyncio.create_task(montar_libro(plan_id))
