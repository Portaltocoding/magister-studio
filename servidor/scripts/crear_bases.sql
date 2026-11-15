-- Se ejecuta solo la primera vez que arranca el contenedor (volumen vacío).
-- Base de pruebas (los tests) y base de simulación (las órdenes con --simulado).
CREATE DATABASE magister_pruebas OWNER magister;
CREATE DATABASE magister_sim OWNER magister;
