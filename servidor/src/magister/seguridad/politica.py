"""Mínimo privilegio del research: qué herramientas tiene y qué URLs puede leer.

Leer una URL solo si salió del buscador en esa ejecución o la diste tú; se resuelve el nombre
y se rechazan direcciones privadas, de bucle local y de enlace local (también tras una
redirección). Con `MAGISTER_PERMITIR_ATACANTE_LOCAL=1` se deja pasar solo
`http://127.0.0.1:8765`, la web atacante de la suite.
"""

import ipaddress
import socket
from urllib.parse import urlparse

from magister.config import ajustes

HERRAMIENTAS = {"research": {"buscar_web", "leer_pagina", "proponer_fuente"}}
PRESUPUESTO_PETICIONES = 30
PRESUPUESTO_LLAMADAS = 20
ATACANTE = ("127.0.0.1", 8765)


class UrlProhibida(Exception):
    pass


def comprobar_url(url: str) -> None:
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise UrlProhibida(f"esquema o dirección no válidos: {url}")
    if ajustes.permitir_atacante_local and (u.hostname, u.port) == ATACANTE:
        return
    try:
        direcciones = {info[4][0] for info in socket.getaddrinfo(u.hostname, u.port or 443)}
    except socket.gaierror as e:
        raise UrlProhibida(f"no se resuelve {u.hostname}") from e
    for d in direcciones:
        ip = ipaddress.ip_address(d.split("%")[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise UrlProhibida(f"{u.hostname} apunta a una dirección interna ({ip})")


def herramienta_permitida(agente: str, herramienta: str) -> bool:
    return herramienta in HERRAMIENTAS.get(agente, set())
