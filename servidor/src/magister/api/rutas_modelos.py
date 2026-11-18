"""El mapa de modelos: quién hace qué, en qué modelo y con qué resultado (solo lectura)."""

from fastapi import APIRouter, Query

from magister.observar.mapa_modelos import mapa

rutas = APIRouter(prefix="/api/modelos")


@rutas.get("/mapa")
async def ver_mapa(dias: int = Query(30, ge=1, le=365)) -> dict:
    return await mapa(dias)
