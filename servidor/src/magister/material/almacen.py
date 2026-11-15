"""Guardar y cargar el progreso del material en `materiales` y `bloques_material` (asyncpg)."""

from pathlib import Path

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert

from magister.config import ajustes
from magister.datos.material import BloqueMaterial, Material, Pregunta
from magister.datos.modelos import Tema
from magister.datos.plan import LeccionFila, PlanFila
from magister.datos.sesion import nueva_sesion
from magister.material.plantillas import montar_apuntes


def carpeta_salidas(plan_id: int, clave: str) -> Path:
    p = Path(ajustes.salidas) / f"{plan_id}-{clave}"
    p.mkdir(parents=True, exist_ok=True)
    return p


async def nuevo_material(plan_id: int, clave: str, tipo: str, trabajo_id: int | None) -> int:
    """Crea (o recupera, por el único (trabajo_id, tipo)) la fila del material."""
    async with nueva_sesion() as s, s.begin():
        if trabajo_id is not None:
            existente = await s.scalar(select(Material.id).where(Material.trabajo_id == trabajo_id, Material.tipo == tipo))
            if existente:
                return existente
        m = Material(plan_id=plan_id, leccion_clave=clave, tipo=tipo, estado="generando", trabajo_id=trabajo_id)
        s.add(m)
        await s.flush()
        return m.id


async def guardar_contrato(material_id: int, contrato: dict) -> None:
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(Material).where(Material.id == material_id).values(contrato=contrato, actualizado_en=func.now()))


async def guardar_bloque(material_id: int, clave: str, titulo: str, texto: str, refinados: int, marcado: bool,
                         version_prompt: str) -> None:
    valores = {"material_id": material_id, "clave": clave, "titulo": titulo, "texto": texto, "refinados": refinados,
               "marcado": marcado, "version_prompt": version_prompt}
    async with nueva_sesion() as s, s.begin():
        await s.execute(insert(BloqueMaterial).values(**valores).on_conflict_do_update(
            index_elements=["material_id", "clave"], set_={k: v for k, v in valores.items() if k not in ("material_id", "clave")}))


async def cargar_progreso(material_id: int) -> tuple[dict | None, dict[str, str], list[str]]:
    async with nueva_sesion() as s:
        m = await s.get(Material, material_id)
        bloques = (await s.scalars(select(BloqueMaterial).where(BloqueMaterial.material_id == material_id))).all()
    return (m.contrato if m else None), {b.clave: b.texto for b in bloques}, [b.clave for b in bloques if b.marcado]


async def bloques(material_id: int) -> list[BloqueMaterial]:
    async with nueva_sesion() as s:
        filas = (await s.scalars(select(BloqueMaterial).where(BloqueMaterial.material_id == material_id))).all()
    return sorted(filas, key=lambda b: int(b.clave[1:]) if b.clave[1:].isdigit() else 99)


async def datos_leccion(plan_id: int, clave: str) -> tuple[str, str]:
    async with nueva_sesion() as s:
        lec = await s.get(LeccionFila, (plan_id, clave))
        plan = await s.get(PlanFila, plan_id)
        tema = await s.get(Tema, plan.tema_id) if plan else None
    return (lec.titulo if lec else clave), (tema.nombre if tema else "")


async def montar_markdown(material_id: int) -> str:
    async with nueva_sesion() as s:
        m = await s.get(Material, material_id)
        preguntas = (await s.scalars(select(Pregunta).where(
            Pregunta.plan_id == m.plan_id, Pregunta.leccion_clave == m.leccion_clave, Pregunta.estado != "retirada"
        ).order_by(Pregunta.id))).all()
    titulo, tema = await datos_leccion(m.plan_id, m.leccion_clave)
    contrato = m.contrato or {}
    titulos = {b["clave"]: b["titulo"] for b in contrato.get("bloques", [])}
    lista = [(titulos.get(b.clave, b.titulo), b.texto) for b in await bloques(material_id)]
    md = montar_apuntes(
        titulo=titulo, pie=f"Magister · {tema}", salida=str(carpeta_salidas(m.plan_id, m.leccion_clave) / "apuntes.pdf"),
        definiciones=contrato.get("definiciones", []), bloques=lista,
        repaso=[{"enunciado": p.enunciado, "fantasma": p.fantasma} for p in preguntas if not p.sonda],
    )
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(Material).where(Material.id == material_id).values(texto=md, actualizado_en=func.now()))
    return md


async def escribir_markdown(material_id: int) -> Path:
    async with nueva_sesion() as s:
        m = await s.get(Material, material_id)
    ruta = carpeta_salidas(m.plan_id, m.leccion_clave) / "apuntes.md"
    ruta.write_text(m.texto or "", encoding="utf-8")
    return ruta


async def cerrar_apuntes(material_id: int, final: dict) -> None:
    estado, motivo = "listo", None
    if final.get("vetado"):
        estado, motivo = "bloqueado", final["vetado"]
    elif final.get("marcados"):
        estado, motivo = "revisar", f"bloques por revisar: {', '.join(final['marcados'])}"
    ultimo_completitud = next((x for x in reversed(final.get("informes", [])) if x.get("nodo") == "completitud"), None)
    if estado == "listo" and ultimo_completitud and ultimo_completitud.get("faltan_nucleo") and final.get("ampliado"):
        estado, motivo = "revisar", "faltan conceptos del núcleo tras ampliar"
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(Material).where(Material.id == material_id).values(
            estado=estado, motivo=motivo, informes=final.get("informes", []), actualizado_en=func.now()))


async def actualizar(material_id: int, **valores) -> None:
    async with nueva_sesion() as s, s.begin():
        await s.execute(update(Material).where(Material.id == material_id).values(**valores, actualizado_en=func.now()))


async def material(material_id: int) -> Material | None:
    async with nueva_sesion() as s:
        return await s.get(Material, material_id)
