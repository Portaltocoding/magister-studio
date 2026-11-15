"""Reciprocal Rank Fusion: suma 1/(k + rango) por fragmento_id en las listas donde aparece."""

from dataclasses import replace

from magister.cerebro.contratos import Recuperado


def rrf(*listas: list[Recuperado], k: int = 60) -> list[Recuperado]:
    puntos: dict[int, float] = {}
    primero: dict[int, Recuperado] = {}
    for lista in listas:
        for r in lista:
            puntos[r.fragmento_id] = puntos.get(r.fragmento_id, 0.0) + 1.0 / (k + r.rango)
            primero.setdefault(r.fragmento_id, r)
    orden = sorted(puntos, key=lambda fid: (-puntos[fid], fid))
    return [replace(primero[fid], rango=i + 1, puntuacion=round(puntos[fid], 6)) for i, fid in enumerate(orden)]
