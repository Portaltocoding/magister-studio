"""Las referencias de un proyecto se buscan después del roadmap, para los bloques del nivel 1 (sin red ni modelo)."""

import pytest

from magister.proyectos import roadmap as rm

pytestmark = pytest.mark.anyio


def _mapa() -> dict:
    paso = rm.PasoGen(titulo="Crear el usuario IAM", que_haces="Crea un usuario IAM de solo lectura.",
                      antes="IAM decide quién puede hacer qué.", hecho_si="aws sts get-caller-identity devuelve tu usuario",
                      minutos=30)
    bloques = [rm.BloqueGen(titulo=t, priming="…", pasos=[paso, paso.model_copy(update={"titulo": f"{t} 2"})])
               for t in ("Permisos con IAM", "Infraestructura con Terraform", "Leer la cuenta con boto3", "Otro")]
    r = rm.RoadmapGen(
        resumen="Línea.", que_es="Un agente.", por_que="Porque sí.",
        glosario=[rm.Termino(termino=t, definicion="…") for t in ("IAM", "Terraform", "boto3")],
        arquitectura="Agente y cuenta.",
        niveles=[rm.NivelGen(titulo="Solo lectura", objetivo="Lee.", priming="…", bloques=bloques),
                 rm.NivelGen(titulo="Aplicar", objetivo="Aplica.", priming="…", bloques=[rm.BloqueGen(titulo="Plan", priming="…")])],
        riesgos=[rm.Riesgo(riesgo="Coste", mitigacion="Un presupuesto."), rm.Riesgo(riesgo="Borrar", mitigacion="Simulacro.")],
    )
    return rm.montar(r)


DATOS = {"nombre": "Copiloto", "idea": "Un agente que opera mi cuenta de AWS.", "objetivo": None,
         "sabes": "Domino los agentes con LangGraph; de cloud casi nada.", "ritmo": None}


def test_la_busqueda_va_por_los_bloques_del_nivel_1_y_sabe_lo_que_ya_sabe() -> None:
    from magister.proyectos import trabajo

    leccion = trabajo.leccion_de_bloques(DATOS, _mapa())
    assert leccion["objetivos"] == ["Proyectos parecidos de código abierto", "Permisos con IAM",
                                    "Infraestructura con Terraform", "Leer la cuenta con boto3"]
    assert leccion["alumno"] == {"sabes": DATOS["sabes"]}
    assert trabajo.leccion_de_bloques(DATOS, None)["objetivos"] == trabajo.leccion_de(DATOS)["objetivos"]
    m = _mapa()
    assert trabajo.bloque_de({"objetivos": [1]}, m) == (None, None)
    assert trabajo.bloque_de({"objetivos": [3, 1]}, m) == (2, m["niveles"][0]["bloques"][1]["id"])
    assert trabajo.bloque_de({"objetivos": [9]}, m) == (None, None) and trabajo.bloque_de(None, m) == (None, None)


async def _proyecto(cliente, monkeypatch, research) -> tuple[int, list[str]]:
    from magister.proyectos import trabajo
    from magister.research import fijo

    orden: list[str] = []

    async def roadmap_falso(datos, referencias, **_):
        orden.append("roadmap")
        assert referencias == []
        return _mapa()

    async def sin_dibujo(datos, mapa):
        return None

    async def fase(*a):
        return None

    async def research_falso(leccion, h, **k):
        orden.append("research")
        return await research(leccion, h)

    monkeypatch.setattr(rm, "generar_roadmap", roadmap_falso)
    monkeypatch.setattr(rm, "dibujar_arquitectura", sin_dibujo)
    monkeypatch.setattr(trabajo.cola, "fase", fase)
    monkeypatch.setattr(fijo, "research_fijo", research_falso)
    pid = (await cliente.post("/api/proyectos", json={"nombre": "Copiloto", "idea": DATOS["idea"], "sabes": DATOS["sabes"],
                                                     "investigar": True})).json()["id"]
    tid = (await cliente.get(f"/api/proyectos/{pid}")).json()["trabajo"]["id"]
    await trabajo.ejecutar(tid, "proyecto_roadmap", {"proyecto_id": pid, "investigar": True})
    return pid, orden


async def test_primero_el_roadmap_y_despues_las_referencias_por_bloque(cliente, monkeypatch) -> None:
    from magister.research.herramientas import Lectura

    vistas: list[list[str]] = []

    async def research(leccion, h):
        vistas.append(leccion["objetivos"])
        for url, objetivos in (("https://github.com/a/agente", [1]), ("https://developer.hashicorp.com/terraform", [3])):
            h.leidas[url] = Lectura(url, titulo=url)
            await h.proponer_fuente(url, "8/9 · oficial · Terraform desde cero", {"objetivos": objetivos, "resumen": "Terraform desde cero"})
        return {}

    pid, orden = await _proyecto(cliente, monkeypatch, research)
    assert orden == ["roadmap", "research"] and vistas[0][1:] == ["Permisos con IAM", "Infraestructura con Terraform", "Leer la cuenta con boto3"]
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert p["estado"] == "listo"
    assert [(r["url"], r["bloque"]) for r in p["referencias"]] == [("https://github.com/a/agente", None),
                                                                   ("https://developer.hashicorp.com/terraform", 2)]
    assert p["referencias"][1]["motivo"] == "Terraform desde cero" and p["referencias"][1]["bloque_id"]


async def test_si_el_research_falla_el_proyecto_acaba_igual(cliente, monkeypatch) -> None:
    async def research(leccion, h):
        raise RuntimeError("sin red")

    pid, orden = await _proyecto(cliente, monkeypatch, research)
    p = (await cliente.get(f"/api/proyectos/{pid}")).json()
    assert orden == ["roadmap", "research"] and p["estado"] == "listo" and p["referencias"] == []
