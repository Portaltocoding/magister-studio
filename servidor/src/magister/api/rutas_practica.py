"""Práctica y progreso (Parte V)."""

import asyncio
import time
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from magister.aprender import andamiajes, practica, progreso
from magister.aprender.corrector import Correccion, corregir
from magister.cerebro.modelo import ErrorModelo, Turno, generar
from magister.datos.aprender import Intento
from magister.datos.material import PreguntaConcepto
from magister.datos.sesion import nueva_sesion, sesion_por_peticion
from magister.tono.lint import revisar, vetos

rutas = APIRouter(prefix="/api")

MAX_RESPUESTA = 8000


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def _miles(n: int) -> str:
    return f"{n:,}".replace(",", ".")


class IntentoEntrada(BaseModel):
    pregunta_id: str
    concepto_id: str
    # Se recorta y se valida en `_entrada_valida` (con un mensaje en castellano y sin devolver el texto entero);
    # aquí, solo un tope que ningún uso de verdad alcanza.
    respuesta: str = Field(max_length=200_000)
    # Sin apuesta (un examen en el que no la marcaste): no entra en la calibración, en vez de inventarse un 0,5.
    confianza: Literal[0.25, 0.5, 0.75, 0.95] | None = None
    clave: str = Field(min_length=8, max_length=80)
    tipo: Literal["espaciado", "reintento"] = "espaciado"
    latencia_ms: int | None = None

    @field_validator("respuesta")
    @classmethod
    def _recortar(cls, v: str) -> str:
        return v.strip()


async def _entrada_valida(cuerpo: IntentoEntrada) -> IntentoEntrada:
    """Antes de abrir el flujo: una respuesta vacía (o de solo espacios) o demasiado larga es un 422 con un motivo
    que se entiende, no un «Correcta, lo cubriste» ni el texto entero de vuelta."""
    if not cuerpo.respuesta:
        raise HTTPException(422, "Escribe tu respuesta antes de enviarla (aunque sea a medias).")
    if len(cuerpo.respuesta) > MAX_RESPUESTA:
        raise HTTPException(422, f"Tu respuesta tiene {_miles(len(cuerpo.respuesta))} caracteres y el máximo es "
                                 f"{_miles(MAX_RESPUESTA)}: recórtala y envíala otra vez.")
    return cuerpo


class NotaUsuario(BaseModel):
    nota_usuario: Literal["fallo", "parcial", "bien", "perfecta"]


@rutas.get("/practica/cola")
async def ver_cola() -> list[dict]:
    return await practica.cola(ahora())


@rutas.get("/practica/siguiente")
async def ver_siguiente(concepto_id: str | None = None) -> dict | None:
    return await practica.siguiente(ahora(), concepto_id)


def _limpiar(texto: str) -> str:
    """El guardián del tono: un veto (la raya larga) no llega al alumno."""
    if vetos(revisar(texto)):
        texto = texto.replace("—", ", ").replace("–", ", ")
    return texto


async def _existente(clave: str) -> Intento | None:
    async with nueva_sesion() as s:
        return await s.scalar(select(Intento).where(Intento.clave_idempotencia == clave))


# Correcciones en marcha, por clave: siguen aunque el cliente se vaya (recargar a mitad), y quien repite la clave o
# pide el último intento las espera. Guardarlas aquí evita también que el recolector se las lleve a medias.
_en_curso: dict[str, asyncio.Task] = {}


def explicacion_fija(c: Correccion, referencia: str) -> str | None:
    """La explicación que no pide el modelo: la perfecta y el fallo sin errores citados. En ese fallo el modelo no
    tiene a qué agarrarse y llegaba a decir «Correcta… lo cubriste»: un texto sobrio que no contradice la nota."""
    if c.nota == "perfecta":
        return "Perfecta: lo tienes."
    if c.nota == "fallo" and not c.errores:
        motivo = ("Tu respuesta no contesta a lo que se pregunta, así que cuenta como fallo." if c.tipo_error == "fuera_de_tema"
                  or not c.ideas_ausentes else f"Cuenta como fallo: faltaba {'; '.join(c.ideas_ausentes)}.")
        return f"{motivo}\n\nLa respuesta de referencia: {referencia}"
    return None


def _evento_nota(nota: str, correccion: dict) -> ServerSentEvent:
    return ServerSentEvent(data={"nota": nota, "ideas_ausentes": correccion.get("ideas_ausentes", []),
                                 "errores": correccion.get("errores", [])}, event="nota")


async def _corregir_y_guardar(cuerpo: IntentoEntrada, cola: asyncio.Queue) -> None:
    """Corrige, explica y guarda, dejando cada evento en `cola`. Va en su propia tarea, no en la de la petición: si
    recargas a mitad, la explicación se acaba de escribir igual y el intento se inserta entero (`intentos` no se
    actualiza después, así que no se puede completar luego). Siempre acaba con `None` en la cola."""
    try:
        t0 = time.perf_counter()
        momento = ahora()
        servida = await practica.ultima_servida(cuerpo.pregunta_id)
        try:
            enunciado, referencia, fragmentos = await practica.contexto_pregunta(cuerpo.pregunta_id)
        except LookupError:  # la pregunta se borró mientras la tenías delante
            await cola.put(ServerSentEvent(data={"detalle": "Esa pregunta ya no existe (se regeneró el material). Pasa a la siguiente."}, event="error"))
            return
        try:
            c, version_corrector = await corregir(enunciado, referencia, fragmentos, cuerpo.respuesta)
        except Exception as e:  # noqa: BLE001
            await cola.put(ServerSentEvent(data={"detalle": f"no se pudo corregir: {e}"}, event="error"))
            return
        await cola.put(_evento_nota(c.nota, {"ideas_ausentes": c.ideas_ausentes, "errores": [e.model_dump() for e in c.errores]}))
        aviso = await _aviso_confianza(cuerpo.confianza, c.nota, cuerpo.tipo)
        if aviso:
            await cola.put(ServerSentEvent(data={"texto": aviso}, event="aviso"))
        partes: list[str] = []
        fija = explicacion_fija(c, referencia)
        if fija is not None:
            partes.append(fija)
            await cola.put(ServerSentEvent(data={"t": fija}, event="delta"))
        else:
            from magister.aprender.corrector import respuesta_delimitada
            from magister.flujo.comun import para_explicar

            molde = andamiajes.molde(c.tipo_error).format(
                pregunta=enunciado, respuesta=respuesta_delimitada(cuerpo.respuesta), nota=c.nota,
                ideas_ausentes="; ".join(c.ideas_ausentes) or "nada",
                errores="; ".join(f"{e.afirmacion} ({e.por_que})" for e in c.errores) or "ninguno",
                extension=andamiajes.extension(cuerpo.confianza, c.nota))
            try:
                ajustes_alumno = await para_explicar()
                sistema_explicar = molde + f"\n\nRespuesta de referencia: {referencia}" + (
                    f"\n\nCómo quiere el alumno que le expliques (lo ha ajustado él):\n{ajustes_alumno}" if ajustes_alumno else "")
                async for trozo in generar(sistema_explicar, [Turno("usuario", "Explícaselo.")]):
                    trozo = _limpiar(trozo)
                    partes.append(trozo)
                    await cola.put(ServerSentEvent(data={"t": trozo}, event="delta"))
            except ErrorModelo:
                pass
        intento_id, proxima = await registrar(
            pregunta_id=cuerpo.pregunta_id, concepto_id=cuerpo.concepto_id, momento=momento, tipo=cuerpo.tipo,
            respuesta=cuerpo.respuesta, explicacion="".join(partes), confianza=cuerpo.confianza,
            latencia_ms=cuerpo.latencia_ms or int((time.perf_counter() - t0) * 1000), nota=c.nota,
            correccion=c.model_dump(), version_corrector=version_corrector, clave=cuerpo.clave, servida=servida)
        await cola.put(ServerSentEvent(data={"intento_id": intento_id, "proxima_fecha": proxima.isoformat() if proxima else None},
                                       event="fin"))
    except Exception as e:  # noqa: BLE001
        await cola.put(ServerSentEvent(data={"detalle": f"no se pudo guardar la corrección: {e}"}, event="error"))
    finally:
        await cola.put(None)


def lanzar_correccion(cuerpo: IntentoEntrada) -> tuple[asyncio.Task, asyncio.Queue]:
    cola: asyncio.Queue = asyncio.Queue()
    tarea = asyncio.create_task(_corregir_y_guardar(cuerpo, cola))
    _en_curso[cuerpo.clave] = tarea
    tarea.add_done_callback(lambda _t: _en_curso.pop(cuerpo.clave, None))
    return tarea, cola


async def esperar_en_curso(plazo_s: float = 120) -> None:
    """Espera (con plazo) a las correcciones que siguen en marcha: lo que se pide después ya las ve guardadas."""
    pendientes = list(_en_curso.values())
    if pendientes:
        await asyncio.wait(pendientes, timeout=plazo_s)


@rutas.post("/practica/intentos", response_class=EventSourceResponse)
async def intentar(cuerpo: IntentoEntrada = Depends(_entrada_valida)) -> AsyncIterator[ServerSentEvent]:
    en_marcha = _en_curso.get(cuerpo.clave)
    if en_marcha is not None:  # la misma clave mientras aún se corrige (un reenvío): se espera y se repite lo guardado
        await asyncio.wait([en_marcha], timeout=180)
    previo = await _existente(cuerpo.clave)
    if previo is not None:
        yield _evento_nota(previo.nota_corrector, previo.correccion or {})
        yield ServerSentEvent(data={"t": previo.explicacion or ""}, event="delta")
        yield ServerSentEvent(data={"intento_id": str(previo.id), "proxima_fecha": None}, event="fin")
        return
    _, cola = lanzar_correccion(cuerpo)
    while (ev := await cola.get()) is not None:
        yield ev


@rutas.get("/practica/ultimo")
async def ver_ultimo(minutos: int = 120) -> dict | None:
    """El último intento de Repaso (de las últimas `minutos`), con su nota y su explicación: lo que enseña la
    interfaz si recargaste mientras se corregía. Espera antes a las correcciones que sigan en marcha."""
    await esperar_en_curso()
    return await practica.ultimo_intento(ahora() - timedelta(minutes=max(1, min(minutos, 24 * 60))))


async def registrar(*, pregunta_id: str, concepto_id: str, momento: datetime, tipo: str, respuesta: str, explicacion: str | None,
                    confianza: float | None, latencia_ms: int | None, nota: str, correccion: dict, version_corrector: str,
                    clave: str, servida=None) -> tuple[str, datetime | None]:
    """Guarda un intento y devuelve su id y la próxima fecha de repaso. Lo usan el repaso, el examen y las fichas.

    Idempotente por `clave`: si ya hay un intento con ella (un examen corregido dos veces), devuelve ese y no
    inserta otro."""
    previo = await _existente(clave)
    if previo is not None:
        return str(previo.id), None
    plan_id = servida.plan_id if servida else await progreso.plan_de_pregunta(pregunta_id)
    estado, prog = await practica.estado_y_programador(plan_id or 0, concepto_id, momento)
    proxima = None
    if tipo == "espaciado":
        _, proxima = prog.siguiente(estado, nota, momento)
    async with nueva_sesion() as s, s.begin():
        i = Intento(plan_id=plan_id, concepto_id=concepto_id, pregunta_id=pregunta_id, momento=momento, tipo=tipo,
                    respuesta=respuesta, explicacion=explicacion, confianza=confianza, latencia_ms=latencia_ms,
                    nota_corrector=nota, correccion=correccion,
                    p_predicha=servida.p_predicha if servida and tipo == "espaciado" else None,
                    version_programador=prog.version, version_corrector=version_corrector, clave_idempotencia=clave)
        s.add(i)
        await s.flush()
        return str(i.id), proxima


class Autoevaluacion(BaseModel):
    pregunta_id: str
    nota: Literal["fallo", "parcial", "bien", "perfecta"]
    clave: str = Field(min_length=8, max_length=80)
    # «ficha»: te la marcas tú; «test»: elegiste una opción y se corrigió sola.
    origen: Literal["ficha", "test"] = "ficha"
    respuesta: str = Field(default="", max_length=2000)
    # «reintento»: la vuelta de hoy a algo que fallaste; no mueve el repaso ni entra en el modelo.
    tipo: Literal["espaciado", "reintento"] = "espaciado"


@rutas.post("/practica/autoevaluacion")
async def autoevaluar(cuerpo: Autoevaluacion) -> dict:
    """Una ficha marcada o un test respondido: cuenta para el repaso espaciado sin llamar al modelo.

    Va sin seguridad apostada, así que no entra en la calibración.
    """
    previo = await _existente(cuerpo.clave)
    if previo is not None:
        return {"intento_id": str(previo.id), "proxima_fecha": None}
    async with nueva_sesion() as s:
        concepto = await s.scalar(select(PreguntaConcepto.concepto_id).where(PreguntaConcepto.pregunta_id == cuerpo.pregunta_id))
    if concepto is None:
        raise HTTPException(404, "pregunta no encontrada")
    servida = await practica.ultima_servida(cuerpo.pregunta_id)
    intento_id, proxima = await registrar(
        pregunta_id=cuerpo.pregunta_id, concepto_id=concepto, momento=ahora(), tipo=cuerpo.tipo,
        respuesta=cuerpo.respuesta or f"({cuerpo.origen})", explicacion=None, confianza=None, latencia_ms=None,
        nota=cuerpo.nota, correccion={"origen": cuerpo.origen}, version_corrector=cuerpo.origen, clave=cuerpo.clave,
        servida=servida if cuerpo.origen == "test" else None)
    return {"intento_id": intento_id, "proxima_fecha": proxima.isoformat() if proxima else None}


@rutas.patch("/practica/intentos/{intento_id}")
async def corregir_nota(intento_id: uuid.UUID, cuerpo: NotaUsuario, s: AsyncSession = Depends(sesion_por_peticion)) -> dict:
    """La única escritura que admite `intentos`. Dice además si cambia algo: solo el primer intento espaciado del día
    de cada concepto es un repaso; tu nota en los demás queda apuntada pero no mueve el programador."""
    r = await s.execute(update(Intento).where(Intento.id == intento_id).values(nota_usuario=cuerpo.nota_usuario))
    await s.commit()
    if not r.rowcount:
        raise HTTPException(404, "intento no encontrado")
    i = await s.get(Intento, intento_id)
    cuenta = await practica.cuenta_para_el_repaso(i) if i is not None else False
    return {"id": str(intento_id), "nota_usuario": cuerpo.nota_usuario, "cuenta": cuenta,
            "aviso": "Anotado: tu nota manda sobre la del corrector y tu próximo repaso se recalcula con ella." if cuenta else
            "Anotado, pero no cambia tu repaso: de cada concepto solo cuenta el primer intento del día, y los reintentos no cuentan."}


@rutas.get("/progreso/conceptos")
async def conceptos() -> list[dict]:
    return await progreso.conceptos(ahora())


@rutas.get("/progreso/carga")
async def carga(dias: int = 14, plan_id: int | None = None) -> list[dict]:
    from magister.aprender.reajuste import prever_carga

    return [x.__dict__ | {"fecha": x.fecha.isoformat()} for x in await prever_carga(ahora(), dias, plan_id)]


@rutas.get("/progreso/calibracion")
async def calibracion(fuente: Literal["usuario", "modelo"] = "usuario", plan_id: int | None = None) -> list[dict]:
    return await progreso.calibracion(fuente, ahora() - timedelta(weeks=8), plan_id)


@rutas.get("/progreso/resumen")
async def resumen(plan_id: int | None = None) -> dict:
    return await progreso.resumen(ahora(), plan_id)


class RespuestaTest(BaseModel):
    pregunta_id: str
    opcion: str = Field(max_length=2000)
    confianza: Literal[0.25, 0.5, 0.75, 0.95] | None = None
    clave: str = Field(min_length=8, max_length=80)
    # «reintento»: la vuelta de hoy a un concepto que fallaste. No mueve el repaso ni entra en el modelo.
    tipo: Literal["espaciado", "reintento"] = "espaciado"


@rutas.post("/practica/test")
async def responder_test(cuerpo: RespuestaTest) -> dict:
    """Una pregunta tipo test: se corrige al momento, sin modelo, y cuenta para el repaso (y la calibración si apostaste)."""
    from magister.datos.material import Pregunta

    async with nueva_sesion() as s:
        p = await s.get(Pregunta, cuerpo.pregunta_id)
        concepto = await s.scalar(select(PreguntaConcepto.concepto_id).where(PreguntaConcepto.pregunta_id == cuerpo.pregunta_id))
    if p is None or not p.opciones or concepto is None:
        raise HTTPException(404, "pregunta tipo test no encontrada")
    buena = next((o["texto"] for o in p.opciones if o.get("buena")), "")
    acierto = cuerpo.opcion.strip() == buena.strip()
    previo = await _existente(cuerpo.clave)
    if previo is None:
        servida = await practica.ultima_servida(cuerpo.pregunta_id)
        _, proxima = await registrar(
            pregunta_id=p.id, concepto_id=concepto, momento=ahora(), tipo=cuerpo.tipo, respuesta=cuerpo.opcion,
            explicacion=p.fantasma, confianza=cuerpo.confianza, latencia_ms=None, nota="bien" if acierto else "fallo",
            correccion={"origen": "test", "buena": buena}, version_corrector="test", clave=cuerpo.clave, servida=servida)
    else:
        proxima = None
    return {"acierto": acierto, "buena": buena, "porque": p.fantasma, "proxima_fecha": proxima.isoformat() if proxima else None,
            "tipo": cuerpo.tipo}



@rutas.get("/progreso/modelo")
async def ver_modelo() -> dict:
    """En qué escalón está tu modelo de olvido y con cuántos datos."""
    from magister.aprender import personal

    return await personal.estado()


@rutas.post("/progreso/modelo/ajustar")
async def ajustar_modelo() -> dict:
    from magister.aprender import personal, red

    r = await personal.ajustar()
    rr = await red.entrenar()
    return {**r, "red": {k: v for k, v in rr.items() if not k.startswith("_")}, "estado": await personal.estado()}



async def _aviso_confianza(confianza: float | None, nota: str, tipo: str = "espaciado") -> str | None:
    """Solo si apostaste alto, fallaste y te pasa a menudo en tus últimos 30 días (al menos 2 de cada 5). Cuenta
    solo respuestas espaciadas: un reintento (la vuelta de hoy, con la explicación reciente) no dice nada de tu
    seguridad, ni cuenta ni dispara el aviso. Es de todos tus planes: la seguridad es tuya, no de un tema."""
    if tipo != "espaciado" or confianza is None or confianza < 0.75 or nota not in ("fallo", "parcial"):
        return None
    from sqlalchemy import text as sql

    async with nueva_sesion() as s:
        altos, mal = (await s.execute(sql(
            "select count(*), count(*) filter (where coalesce(nota_usuario, nota_corrector) in ('fallo', 'parcial')) "
            "from intentos where tipo = 'espaciado' and confianza >= 0.75 and momento > now() - interval '30 days'"))).one()
    if altos < 3 or mal / altos < 0.4:
        return None
    return (f"Ojo con la seguridad: este mes, de {altos} veces que dijiste estar seguro, {mal} no lo tenías del todo. "
            "Antes de responder, prueba a decirte qué parte no tienes clara.")
