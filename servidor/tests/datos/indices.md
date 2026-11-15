---
title: Índices en Postgres
tags: [bd, rendimiento]
---
# Índices en Postgres

Un índice B-tree guarda las claves ordenadas y permite buscar por igualdad y por rango sin recorrer toda la tabla. Es el tipo por defecto de CREATE INDEX y sirve para casi todo.

## Índices parciales

Un índice parcial solo indexa las filas que cumplen una condición, por ejemplo los pedidos pendientes. Ocupa menos y acelera las consultas que repiten esa condición en el WHERE. Ver también [[Transacciones|las transacciones]].

## Cuándo no ayudan

Si la consulta devuelve la mayor parte de la tabla, el planificador prefiere un recorrido secuencial, porque leer el índice y luego la tabla cuesta más que leer la tabla de una vez.
