"""El arnés: la única pieza que escribe lo que propone el asesor, y solo cuando lo apruebas tú.

- `proponer` guarda la propuesta con la huella del proyecto en ese momento. No cambia nada.
- `aplicar` comprueba en código que sigue en «propuesta», que el proyecto no ha cambiado desde entonces y que las
  acciones siguen valiendo (`simular` otra vez); lo aplica en una transacción y guarda cómo deshacerlo.
- `deshacer` vuelve al proyecto de antes y borra lo que creó, si nada ha cambiado después.
- Aplicar o deshacer dos veces no hace nada la segunda: el estado ya no es el que toca.
- En el plan activo: mover y marcar se deshacen (vuelven a como estaban si el calendario no ha cambiado después), lo
  apuntado en la agenda se borra, y unos apuntes preparados no se deshacen (ya han gastado cuota).
"""

from collections.abc import Awaitable, Callable
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select, text

from magister.asesor import herramientas
from magister.asesor.cambios import (Cambios, Resultado, deshacer_hechos, deshacible, en_breve, hechos_tocados, huella,
                                     huella_de, simular, sin_ids, usa_plan)
from magister.config import ajustes
from magister.datos import plan as dp
from magister.datos.agenda import Evento
from magister.datos.asesor import CambioAsesor
from magister.datos.modelos import Tema
from magister.datos.notas import Nota
from magister.datos.plan import PlanFila, SesionFila
from magister.datos.proyectos import Decision, Proyecto
from magister.datos.sesion import nueva_sesion
from magister.proyectos.estado import GENERANDO, TrabajoDelProyecto, nivel_intacto, trabajo_de
from magister.proyectos.roadmap import ids_de

# Encola la preparación de los apuntes de una lección (plan_id, clave) y devuelve el id del trabajo. La pone la API,
# que es quien sabe encolar material (la misma función que el botón de Lecciones).
Preparador = Callable[[int, str], Awaitable[int]]
DIAS_AGENDA = 30  # lo apuntado en la agenda que se mira para no apuntarlo dos veces


class ErrorCambio(Exception):
    def __init__(self, codigo: int, detalle: str) -> None:
        super().__init__(detalle)
        self.codigo = codigo
        self.detalle = detalle


# «este cambio ya está aplicado», no «aplicada»: el estado se guarda en femenino (la propuesta), el texto habla del cambio.
_ESTADO_DICHO = {"propuesta": "propuesto", "aplicada": "aplicado", "descartada": "descartado", "deshecha": "deshecho",
                 "caducada": "caducado"}


def salida(c: CambioAsesor) -> dict:
    return {"id": c.id, "estado": c.estado, "resumen": c.resumen, "lineas": c.lineas, "mensaje_id": c.mensaje_id,
            # Lo que hace, contado en código a partir de las acciones (la tarjeta lo dice en lugar del chat).
            "en_breve": en_breve(c.acciones or []),
            "proyecto_id": c.proyecto_id, "motivo_estado": c.motivo_estado, "creado_en": c.creado_en.isoformat(),
            # Lo que miró antes de proponer, en palabras; y, ya aplicado, lo nuevo (para enseñártelo en la pantalla).
            "consultado": [herramientas.descripcion(x) for x in (c.lecturas or [])], "pendiente": c.pendiente,
            "nuevos": (c.deshacer or {}).get("nuevos", []) if c.estado == "aplicada" else [],
            # El plan que toca (las pantallas del plan se recargan al aplicarlo) y si «Deshacer» deshace algo.
            "plan_id": c.plan_id, "deshacible": deshacible(c.lineas or [])}


def _hhmm(t: time | None) -> str | None:
    return t.strftime("%H:%M") if t else None


def _hoy(momento: datetime) -> date:
    """Tu día, en tu zona (a las 00:30 en Madrid aún es el día anterior en UTC)."""
    return momento.astimezone(ZoneInfo(ajustes.zona)).date()


async def _plan_de(s, plan_id: int | None, hoy: date, bloquear: bool = False) -> dict | None:
    """El plan activo como lo simula `cambios`: lecciones, todas sus sesiones y tu agenda cercana. None si ya no es el
    aceptado de su tema (lo sustituyó otro o se borró)."""
    if plan_id is None:
        return None
    fila = await s.get(PlanFila, plan_id)
    if fila is None or fila.estado != "aceptado":
        return None
    tema = await s.get(Tema, fila.tema_id)
    deps = await dp.dependencias(s, plan_id)
    consulta = (select(SesionFila).where(SesionFila.plan_id == plan_id)
                .order_by(SesionFila.fecha, SesionFila.inicio, SesionFila.id))
    sesiones = (await s.scalars(consulta.with_for_update() if bloquear else consulta)).all()
    # Si cada lección tiene ya apuntes o se están preparando (para no gastar cuota en lo que ya hay).
    apuntes = {clave: ("listos" if estado in ("listo", "revisar") else "preparandose") for clave, estado in (await s.execute(text(
        "select leccion_clave, estado from materiales where plan_id = :p and tipo = 'apuntes' and estado <> 'bloqueado' "
        "order by id"), {"p": plan_id})).all()}
    for (clave,) in (await s.execute(text(
            "select leccion_clave from trabajos where plan_id = :p and tipo = 'material' and estado in ('pendiente', 'en_curso')"),
            {"p": plan_id})).all():
        apuntes.setdefault(clave, "preparandose")
    eventos = (await s.scalars(select(Evento).where(Evento.fecha >= hoy, Evento.fecha <= hoy + timedelta(days=DIAS_AGENDA))
                               .order_by(Evento.fecha, Evento.id))).all()
    perfil = fila.perfil or {}
    return {
        "plan_id": fila.id, "tema_id": fila.tema_id, "tema": tema.nombre if tema else None,
        "horas_por_dia": perfil.get("horas_por_dia"), "inicio_por_dia": perfil.get("inicio_por_dia"),
        "lecciones": [{"clave": x.clave, "titulo": x.titulo, "horas": x.horas,
                       "depende_de": [d.depende_de for d in deps if d.leccion_clave == x.clave], "apuntes": apuntes.get(x.clave)}
                      for x in await dp.lecciones(s, plan_id)],
        "sesiones": [{"id": x.id, "clave": x.leccion_clave, "fecha": x.fecha.isoformat(), "inicio": _hhmm(x.inicio),
                      "horas": x.horas, "estado": x.estado} for x in sesiones],
        "eventos": [{"id": e.id, "fecha": e.fecha.isoformat(), "hora": _hhmm(e.hora), "titulo": e.titulo, "tipo": e.tipo}
                    for e in eventos],
    }


async def leer_plan(plan_id: int | None, hoy: date) -> dict | None:
    """El plan activo que manda la pantalla, para preparar un cambio sobre él (None si no hay o ya no es el activo)."""
    if plan_id is None:
        return None
    async with nueva_sesion() as s:
        return await _plan_de(s, plan_id, hoy)


def _datos(p: Proyecto | None) -> dict | None:
    if p is None:
        return None
    return {"nombre": p.nombre, "roadmap": p.roadmap, "hechos": list(p.hechos or []), "hechos_en": dict(p.hechos_en or {})}


async def leer_proyecto(pid: int | None) -> dict | None:
    if pid is None:
        return None
    async with nueva_sesion() as s:
        p = await s.get(Proyecto, pid)
        t = await trabajo_de(s, p) if p is not None else None
    # Con su trabajo aún en la cola, se puede preparar un cambio (aplicarlo se comprueba al aplicar); mientras el
    # modelo escribe el roadmap o el nivel, no.
    if t is not None and t.ocupacion == GENERANDO:
        raise ErrorCambio(409, "el proyecto se está generando: espera a que acabe y pídemelo otra vez")
    return _datos(p)


async def proponer(conversacion_id: int, mensaje_id: int | None, proyecto_id: int | None, encargo: str, cambios: Cambios,
                   resultado: Resultado, proyecto: dict | None, prompt: str, lecturas: list[dict] | None = None,
                   plan: dict | None = None) -> dict:
    con_plan = plan if plan and usa_plan(cambios) else None
    roadmap = (proyecto or {}).get("roadmap")
    async with nueva_sesion() as s, s.begin():
        c = CambioAsesor(
            conversacion_id=conversacion_id, mensaje_id=mensaje_id, proyecto_id=proyecto_id if proyecto else None,
            plan_id=con_plan["plan_id"] if con_plan else None,
            # Lo que escribió el modelo, sin ids (n1-b2-p3): el alumno no los ve. Las líneas ya las escribe el código.
            encargo=encargo, resumen=sin_ids(cambios.resumen.strip(), roadmap),
            acciones=[a.model_dump(mode="json", exclude_none=True) for a in cambios.acciones],
            lineas=[{"texto": x.texto, "motivo": sin_ids(x.motivo, roadmap), **({} if x.deshace else {"deshace": False})}
                    for x in resultado.lineas],
            lecturas=lecturas or [], pendiente=sin_ids((cambios.pendiente or "").strip(), roadmap) or None,
            huella=huella_de(cambios, proyecto, con_plan), prompt=prompt)
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


async def _proyecto_bloqueado(s, c: CambioAsesor) -> tuple[Proyecto | None, TrabajoDelProyecto | None]:
    """El proyecto, con la fila bloqueada, y su trabajo de la cola si aún no ha empezado. Si ya está corriendo, 409."""
    if c.proyecto_id is None:
        return None, None
    p = await s.scalar(select(Proyecto).where(Proyecto.id == c.proyecto_id).with_for_update())
    if p is None:
        raise ErrorCambio(404, "el proyecto ya no existe")
    t = await trabajo_de(s, p)
    if t is not None and t.ocupacion == GENERANDO:
        raise ErrorCambio(409, "el proyecto se está generando: espera a que acabe")
    return p, t


def _choca_con_la_cola(t: TrabajoDelProyecto | None, antes: dict | None, despues: dict | None,
                       deshacer: bool = False) -> str | None:
    """Si el cambio pisa lo que va a hacer el trabajo que espera en la cola: el nivel que va a detallar (por su número)
    o, si va a rehacer el roadmap, cualquier cambio del roadmap. Marcar pasos, el diario y las notas no chocan."""
    if t is None:
        return None
    que, hazlo, hacerlo = (("deshacer este cambio", "deshazlo", "deshacerlo") if deshacer
                           else ("este cambio", "aplícalo", "aplicarlo"))
    if t.nivel is not None and not nivel_intacto(antes, despues, t.nivel):
        return (f"el nivel {t.nivel} está en la cola para detallarse y {que} lo toca (o lo corre de sitio): {hazlo} "
                "cuando acabe, o cancela el detalle")
    if t.nivel is None and (antes or {}).get("niveles") != (despues or {}).get("niveles"):
        return f"el roadmap está en la cola para rehacerse y {que} lo cambia: cancela el rehacer si quieres {hacerlo} antes"
    return None


def _estado_sesion(x: dict) -> dict:
    return {"id": x["id"], "fecha": x["fecha"], "inicio": x["inicio"], "estado": x["estado"]}


async def aplicar(cambio_id: int, momento: datetime, preparar: Preparador | None = None) -> dict:
    """`momento`: cuándo lo apruebas (la fecha de un paso que se marca como hecho; y tu día, para no mover nada al
    pasado). `preparar`: cómo se encolan unos apuntes, si el cambio lo pide."""
    async with nueva_sesion() as s, s.begin():
        c = await _bloquear(s, cambio_id)
        if c.estado != "propuesta":
            raise ErrorCambio(409, f"este cambio ya está {_ESTADO_DICHO.get(c.estado, c.estado)}")
        p, en_cola = await _proyecto_bloqueado(s, c)
        datos = _datos(p)
        cambios = Cambios.model_validate({"resumen": c.resumen, "acciones": c.acciones, "pendiente": c.pendiente})
        hoy = _hoy(momento)
        plan = await _plan_de(s, c.plan_id, hoy, bloquear=True)
        r = simular(cambios, datos, momento.isoformat(timespec="seconds"), plan, hoy)
        motivo = None
        if c.plan_id is not None and plan is None:
            motivo = "ese plan de estudio ya no es el activo (lo cambiaste o lo borraste): pídemelo otra vez"
        elif (datos or plan) and c.huella not in (huella_de(cambios, datos, plan), huella_de(cambios, datos, plan, antigua=True)):
            motivo = ("el proyecto ha cambiado desde que lo propuse: pídemelo otra vez y lo preparo sobre lo que hay ahora"
                      if not plan else "tu calendario ha cambiado desde que lo propuse (has marcado, movido o recalculado "
                      "algo): pídemelo otra vez y lo preparo sobre lo que hay ahora")
        elif r.errores:
            motivo = "ya no se puede aplicar: " + " ".join(r.errores[:3])
        if motivo:
            c.estado, c.motivo_estado, c.decidido_en = "caducada", motivo, momento
            await s.flush()
            return salida(c)
        if choque := _choca_con_la_cola(en_cola, (datos or {}).get("roadmap"), r.roadmap):
            # No caduca: sigue en «propuesta» y se puede aplicar cuando acabe el trabajo.
            raise ErrorCambio(409, choque)
        if r.preparar and preparar is None:
            raise ErrorCambio(409, "desde aquí no puedo preparar apuntes: pídelo en «Lecciones»")
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
        eventos = []
        for e in r.eventos:
            fila = Evento(fecha=date.fromisoformat(e["fecha"]), hora=time.fromisoformat(e["hora"]) if e["hora"] else None,
                          titulo=e["titulo"], tipo=e["tipo"])
            s.add(fila)
            eventos.append(fila)
        await s.flush()
        deshacer: dict = {"decisiones": [d.id for d in decisiones], "notas": [n.id for n in notas],
                          "eventos": [e.id for e in eventos]}
        if p is not None and datos is not None:
            antes = ids_de((datos["roadmap"] or {}).get("niveles", []))
            nuevos = [x["id"] for n in (r.roadmap or {}).get("niveles", []) for b in n["bloques"] for x in b["pasos"]
                      if x["id"] not in antes]
            # Para deshacer: el roadmap de antes entero y, de lo hecho, cómo estaba y cómo lo dejó (solo se devuelve lo
            # que tocó el cambio; lo que marques después en otros pasos se queda). `huella_roadmap`: sin lo hecho.
            deshacer |= {"roadmap": datos["roadmap"], "hechos": datos["hechos"], "hechos_en": datos["hechos_en"],
                         "hechos_despues": list(r.hechos), "hechos_en_despues": dict(r.hechos_en),
                         "huella_roadmap": huella(r.roadmap, None), "nuevos": nuevos}
            p.roadmap, p.hechos, p.hechos_en = r.roadmap, r.hechos, r.hechos_en
        marcar_hechas: list[str] = []
        if plan is not None and r.plan is not None:
            previas = {x["id"]: _estado_sesion(x) for x in plan["sesiones"]}
            tocadas = [_estado_sesion(x) for x in r.plan["sesiones"] if _estado_sesion(x) != previas[x["id"]]]
            deshacer |= {"sesiones": [previas[x["id"]] for x in tocadas], "sesiones_despues": tocadas}
            filas = {x.id: x for x in (await s.scalars(select(SesionFila).where(SesionFila.id.in_([x["id"] for x in tocadas])))).all()}
            for x in tocadas:
                f = filas[x["id"]]
                f.fecha, f.inicio = date.fromisoformat(x["fecha"]), time.fromisoformat(x["inicio"]) if x["inicio"] else None
                if x["estado"] == "pendiente":  # desmarcar; marcar hecha va por datos.plan, abajo
                    f.estado = "pendiente"
            marcar_hechas = [clave for clave, hecha in r.marcar if hecha]
            # Los apuntes, antes de confirmar: encolar es idempotente (si algo falla después y lo vuelves a aplicar,
            # sale el mismo trabajo). No se deshacen.
            if r.preparar:
                deshacer["trabajos"] = [await preparar(plan["plan_id"], clave) for clave in r.preparar]
        c.estado, c.deshacer, c.decidido_en, c.motivo_estado = "aplicada", deshacer, momento, None
        await s.flush()
        # Marcar una lección hecha es lo de su botón de Roadmap (`datos.plan`); confirma la transacción entera.
        for clave in marcar_hechas:
            await dp.marcar_leccion_hecha(s, plan["plan_id"], clave)
        return salida(c)


async def descartar(cambio_id: int, momento: datetime) -> dict:
    async with nueva_sesion() as s, s.begin():
        c = await _bloquear(s, cambio_id)
        if c.estado != "propuesta":
            raise ErrorCambio(409, f"este cambio ya está {_ESTADO_DICHO.get(c.estado, c.estado)}")
        c.estado, c.decidido_en = "descartada", momento
        await s.flush()
        return salida(c)


async def deshacer(cambio_id: int, momento: datetime) -> dict:
    async with nueva_sesion() as s, s.begin():
        c = await _bloquear(s, cambio_id)
        if c.estado != "aplicada" or not c.deshacer:
            raise ErrorCambio(409, f"solo se deshace un cambio aplicado (este está {_ESTADO_DICHO.get(c.estado, c.estado)})")
        info = c.deshacer
        if not deshacible(c.lineas or []):
            raise ErrorCambio(409, "esto no se deshace: los apuntes que se preparan se quedan (si no los quieres, se "
                                   "borran desde «Lecciones»)")
        if "roadmap" in info:
            p, en_cola = await _proyecto_bloqueado(s, c)
            if p is not None:
                cambiado = ErrorCambio(409, "el proyecto ha cambiado después de aplicarlo: deshazlo a mano desde el proyecto")
                ahora_ = (list(p.hechos or []), dict(p.hechos_en or {}))
                if "huella_roadmap" in info:
                    # El roadmap tiene que estar como lo dejó el cambio; de lo hecho, solo los pasos que tocó (marcar
                    # otros pasos después no impide deshacerlo, y esas marcas se quedan).
                    if huella(p.roadmap, None) != info["huella_roadmap"]:
                        raise cambiado
                    antes = (info["hechos"], info["hechos_en"])
                    despues = (info["hechos_despues"], info["hechos_en_despues"])
                    hechos = deshacer_hechos(ahora_, antes, despues, hechos_tocados(antes, despues, info.get("nuevos", [])))
                    if hechos is None:
                        raise ErrorCambio(409, "has marcado o desmarcado un paso que tocó este cambio después de aplicarlo: "
                                               "deshazlo a mano desde el proyecto")
                elif huella(p.roadmap, ahora_[0]) != info["huella_despues"]:  # aplicado antes de guardar lo hecho aparte
                    raise cambiado
                else:
                    hechos = (info["hechos"], info["hechos_en"])
                if choque := _choca_con_la_cola(en_cola, p.roadmap, info["roadmap"], deshacer=True):
                    raise ErrorCambio(409, choque)
                p.roadmap, (p.hechos, p.hechos_en) = info["roadmap"], hechos
        if info.get("sesiones"):
            ids = [x["id"] for x in info["sesiones"]]
            filas = {x.id: x for x in (await s.scalars(select(SesionFila).where(SesionFila.id.in_(ids)).with_for_update())).all()}
            ahora_ = [{"id": f.id, "fecha": f.fecha.isoformat(), "inicio": _hhmm(f.inicio), "estado": f.estado}
                      for i in ids if (f := filas.get(i)) is not None]
            if ahora_ != info["sesiones_despues"]:
                raise ErrorCambio(409, "tu calendario ha cambiado después de aplicarlo (o se ha recalculado): muévelo o "
                                       "márcalo a mano desde «Calendario» o «Roadmap»")
            for x in info["sesiones"]:
                f = filas[x["id"]]
                f.fecha, f.inicio = date.fromisoformat(x["fecha"]), time.fromisoformat(x["inicio"]) if x["inicio"] else None
                f.estado = x["estado"]
        if info.get("eventos"):
            await s.execute(delete(Evento).where(Evento.id.in_(info["eventos"])))
        if info.get("decisiones"):
            await s.execute(delete(Decision).where(Decision.id.in_(info["decisiones"])))
        if info.get("notas"):
            await s.execute(delete(Nota).where(Nota.id.in_(info["notas"])))
        c.estado, c.decidido_en = "deshecha", momento
        await s.flush()
        return salida(c)
