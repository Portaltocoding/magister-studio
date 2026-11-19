"""El arnés: la única pieza que escribe lo que propone el asesor, y solo cuando lo apruebas tú.

- `proponer` guarda la propuesta con la huella del proyecto en ese momento. No cambia nada.
- `aplicar` comprueba en código que sigue en «propuesta», que el proyecto no ha cambiado desde entonces y que las
  acciones siguen valiendo (`simular` otra vez); lo aplica en una transacción y guarda cómo deshacerlo.
- `deshacer` vuelve al proyecto de antes y borra lo que creó, si nada ha cambiado después.
- Aplicar o deshacer dos veces no hace nada la segunda: el estado ya no es el que toca.
"""

from datetime import datetime, timezone

from sqlalchemy import delete, select

from magister.asesor import herramientas
from magister.asesor.cambios import Cambios, Resultado, huella, simular
from magister.datos.asesor import CambioAsesor
from magister.datos.notas import Nota
from magister.datos.proyectos import Decision, Proyecto
from magister.datos.sesion import nueva_sesion
from magister.proyectos.roadmap import ids_de


class ErrorCambio(Exception):
    def __init__(self, codigo: int, detalle: str) -> None:
        super().__init__(detalle)
        self.codigo = codigo
        self.detalle = detalle


def salida(c: CambioAsesor) -> dict:
    return {"id": c.id, "estado": c.estado, "resumen": c.resumen, "lineas": c.lineas, "mensaje_id": c.mensaje_id,
            "proyecto_id": c.proyecto_id, "motivo_estado": c.motivo_estado, "creado_en": c.creado_en.isoformat(),
            # Lo que miró antes de proponer, en palabras; y, ya aplicado, lo nuevo (para enseñártelo en la pantalla).
            "consultado": [herramientas.descripcion(x) for x in (c.lecturas or [])], "pendiente": c.pendiente,
            "nuevos": (c.deshacer or {}).get("nuevos", []) if c.estado == "aplicada" else []}


def _datos(p: Proyecto | None) -> dict | None:
    if p is None:
        return None
    return {"nombre": p.nombre, "roadmap": p.roadmap, "hechos": list(p.hechos or []), "hechos_en": dict(p.hechos_en or {})}


async def leer_proyecto(pid: int | None) -> dict | None:
    if pid is None:
        return None
    async with nueva_sesion() as s:
        p = await s.get(Proyecto, pid)
    if p is not None and p.estado == "generando":
        raise ErrorCambio(409, "el proyecto se está generando: espera a que acabe y pídemelo otra vez")
    return _datos(p)


async def proponer(conversacion_id: int, mensaje_id: int | None, proyecto_id: int | None, encargo: str, cambios: Cambios,
                   resultado: Resultado, proyecto: dict | None, prompt: str, lecturas: list[dict] | None = None) -> dict:
    async with nueva_sesion() as s, s.begin():
        c = CambioAsesor(
            conversacion_id=conversacion_id, mensaje_id=mensaje_id, proyecto_id=proyecto_id if proyecto else None,
            encargo=encargo, resumen=cambios.resumen.strip(),
            acciones=[a.model_dump(mode="json", exclude_none=True) for a in cambios.acciones],
            lineas=[{"texto": x.texto, "motivo": x.motivo} for x in resultado.lineas], lecturas=lecturas or [],
            pendiente=(cambios.pendiente or "").strip() or None,
            huella=huella(proyecto["roadmap"], proyecto["hechos"]) if proyecto else None, prompt=prompt)
        s.add(c)
        await s.flush()
        await s.refresh(c)
        return salida(c)


async def de_conversacion(cid: int) -> list[dict]:
    async with nueva_sesion() as s:
        filas = (await s.scalars(select(CambioAsesor).where(CambioAsesor.conversacion_id == cid).order_by(CambioAsesor.id))).all()
    return [salida(c) for c in filas]


async def _bloquear(s, cambio_id: int) -> CambioAsesor:
    c = await s.scalar(select(CambioAsesor).where(CambioAsesor.id == cambio_id).with_for_update())
    if c is None:
        raise ErrorCambio(404, "ese cambio no existe")
    return c


async def _proyecto_bloqueado(s, c: CambioAsesor) -> Proyecto | None:
    if c.proyecto_id is None:
        return None
    p = await s.scalar(select(Proyecto).where(Proyecto.id == c.proyecto_id).with_for_update())
    if p is None:
        raise ErrorCambio(404, "el proyecto ya no existe")
    if p.estado == "generando":
        raise ErrorCambio(409, "el proyecto se está generando: espera a que acabe")
    return p


async def aplicar(cambio_id: int, momento: datetime) -> dict:
    """`momento`: cuándo lo apruebas (la fecha de un paso que se marca como hecho)."""
    async with nueva_sesion() as s, s.begin():
        c = await _bloquear(s, cambio_id)
        if c.estado != "propuesta":
            raise ErrorCambio(409, f"este cambio ya está {c.estado}")
        p = await _proyecto_bloqueado(s, c)
        datos = _datos(p)
        cambios = Cambios.model_validate({"resumen": c.resumen, "acciones": c.acciones, "pendiente": c.pendiente})
        r = simular(cambios, datos, momento.isoformat(timespec="seconds"))
        motivo = None
        if datos and huella(datos["roadmap"], datos["hechos"]) != c.huella:
            motivo = "el proyecto ha cambiado desde que lo propuse: pídemelo otra vez y lo preparo sobre lo que hay ahora"
        elif r.errores:
            motivo = "ya no se puede aplicar: " + " ".join(r.errores[:3])
        if motivo:
            c.estado, c.motivo_estado, c.decidido_en = "caducada", motivo, momento
            await s.flush()
            return salida(c)
        decisiones, notas = [], []
        for d in r.decisiones:
            fila = Decision(proyecto_id=p.id, **d)
            s.add(fila)
            decisiones.append(fila)
        for texto in r.notas:
            fila = Nota(texto=texto, conversacion_id=c.conversacion_id, mensaje_id=c.mensaje_id,
                        origen="Tu asesor", completa=False)
            s.add(fila)
            notas.append(fila)
        await s.flush()
        deshacer: dict = {"decisiones": [d.id for d in decisiones], "notas": [n.id for n in notas]}
        if p is not None and datos is not None:
            antes = ids_de((datos["roadmap"] or {}).get("niveles", []))
            nuevos = [x["id"] for n in (r.roadmap or {}).get("niveles", []) for b in n["bloques"] for x in b["pasos"]
                      if x["id"] not in antes]
            deshacer |= {"roadmap": datos["roadmap"], "hechos": datos["hechos"], "hechos_en": datos["hechos_en"],
                         "huella_despues": huella(r.roadmap, r.hechos), "nuevos": nuevos}
            p.roadmap, p.hechos, p.hechos_en = r.roadmap, r.hechos, r.hechos_en
        c.estado, c.deshacer, c.decidido_en, c.motivo_estado = "aplicada", deshacer, momento, None
        await s.flush()
        return salida(c)


async def descartar(cambio_id: int, momento: datetime) -> dict:
    async with nueva_sesion() as s, s.begin():
        c = await _bloquear(s, cambio_id)
        if c.estado != "propuesta":
            raise ErrorCambio(409, f"este cambio ya está {c.estado}")
        c.estado, c.decidido_en = "descartada", momento
        await s.flush()
        return salida(c)


async def deshacer(cambio_id: int, momento: datetime) -> dict:
    async with nueva_sesion() as s, s.begin():
        c = await _bloquear(s, cambio_id)
        if c.estado != "aplicada" or not c.deshacer:
            raise ErrorCambio(409, f"solo se deshace un cambio aplicado (este está {c.estado})")
        info = c.deshacer
        if "roadmap" in info:
            p = await _proyecto_bloqueado(s, c)
            if p is not None:
                if huella(p.roadmap, list(p.hechos or [])) != info["huella_despues"]:
                    raise ErrorCambio(409, "el proyecto ha cambiado después de aplicarlo: deshazlo a mano desde el proyecto")
                p.roadmap, p.hechos, p.hechos_en = info["roadmap"], info["hechos"], info["hechos_en"]
        if info.get("decisiones"):
            await s.execute(delete(Decision).where(Decision.id.in_(info["decisiones"])))
        if info.get("notas"):
            await s.execute(delete(Nota).where(Nota.id.in_(info["notas"])))
        c.estado, c.decidido_en = "deshecha", momento
        await s.flush()
        return salida(c)
