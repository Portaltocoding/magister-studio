"""Comprobar y ordenar las dependencias entre lecciones."""

import re
from graphlib import CycleError, TopologicalSorter

from magister.plan.esquemas import Plan

FORMATO_ID = re.compile(r"^[a-z0-9-]+$")


def comprobar(plan: Plan) -> list[str]:
    errores: list[str] = []
    claves = [lec.clave for lec in plan.lecciones]
    vistas: set[str] = set()
    for c in claves:
        if c in vistas:
            errores.append(f"la clave {c} está repetida")
        vistas.add(c)
    existentes = set(claves)
    for lec in plan.lecciones:
        for d in lec.depende_de:
            if d == lec.clave:
                errores.append(f"{lec.clave} depende de sí misma")
            elif d not in existentes:
                errores.append(f"{lec.clave} depende de {d}, que no existe")
        if not lec.conceptos:
            errores.append(f"{lec.clave} no tiene conceptos")
    ids: dict[str, str] = {}
    for lec in plan.lecciones:
        for con in lec.conceptos:
            if not FORMATO_ID.match(con.id):
                errores.append(f"el concepto «{con.id}» de {lec.clave} no va en minúsculas con guiones")
            if con.id in ids:
                errores.append(f"el concepto «{con.id}» está en {ids[con.id]} y en {lec.clave}; tiene que ser único")
            ids.setdefault(con.id, lec.clave)
    if not errores:
        grafo = {lec.clave: set(lec.depende_de) for lec in plan.lecciones}
        try:
            tuple(TopologicalSorter(grafo).static_order())
        except CycleError as e:
            ciclo = " → ".join(e.args[1])
            errores.append(f"hay un ciclo de dependencias: {ciclo}")
    return errores


def orden(plan: Plan) -> list[str]:
    """Orden topológico que desempata por la posición en el plan, no por el texto de la clave."""
    posicion = {lec.clave: i for i, lec in enumerate(plan.lecciones)}
    pendientes = {lec.clave: set(lec.depende_de) & posicion.keys() for lec in plan.lecciones}
    salida: list[str] = []
    while pendientes:
        listas = sorted((c for c, deps in pendientes.items() if not deps), key=posicion.__getitem__)
        if not listas:
            raise ValueError("hay un ciclo de dependencias")
        elegida = listas[0]
        salida.append(elegida)
        del pendientes[elegida]
        for deps in pendientes.values():
            deps.discard(elegida)
    return salida
