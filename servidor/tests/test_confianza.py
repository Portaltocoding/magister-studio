from magister.tono import confianza as cf


def test_sin_datos_se_juzga_casi_todo():
    assert cf.muestra(None) > 0.75


def test_si_todo_va_bien_se_juzga_cada_vez_menos_pero_nunca_nada():
    e = None
    previa = cf.muestra(e)
    for _ in range(40):
        e = cf.registrar_juez(e, {"razonamiento": True, "economia": True, "trato": True})
        e = cf.registrar_usuario(e, True)
    assert cf.muestra(e) < previa
    assert cf.muestra(e) == cf.MUESTRA_MINIMA


def test_una_queja_tuya_hace_volver_a_juzgar():
    e = None
    for _ in range(40):
        e = cf.registrar_juez(e, {d: True for d in cf.DIMENSIONES})
    antes = cf.muestra(e)
    e = cf.registrar_usuario(e, False, ["largo"])
    e = cf.registrar_usuario(e, False, ["largo"])
    assert cf.muestra(e) > antes
    # La queja es de economía: es la que baja.
    assert cf.confianza(e, "economia") < cf.confianza(e, "trato")


def test_tu_voz_pesa_mas_que_la_del_juez():
    a = cf.registrar_juez(None, {"economia": False})
    b = cf.registrar_usuario(None, False, ["largo"])
    assert cf.confianza(b, "economia") < cf.confianza(a, "economia")


def test_lo_que_repites_se_vuelve_regla_y_lo_que_quitas_no_vuelve():
    e = cf.registrar_usuario(None, False, ["sin_ejemplo"])
    assert cf.reglas(e) == []
    e = cf.registrar_usuario(e, False, ["sin_ejemplo"])
    e = cf.registrar_usuario(e, False, ["sin_ejemplo"])
    assert cf.reglas(e) == [cf.MOTIVOS["sin_ejemplo"][2]]
    e["descartadas"] = ["sin_ejemplo"]
    assert cf.reglas(e) == []


def test_un_error_no_es_una_preferencia():
    e = None
    for _ in range(5):
        e = cf.registrar_usuario(e, False, ["error"])
    assert cf.reglas(e) == [] and cf.confianza(e, "razonamiento") < 0.2


def test_la_decision_es_determinista_por_clave():
    e = None
    for _ in range(40):
        e = cf.registrar_juez(e, {d: True for d in cf.DIMENSIONES})
    assert cf.toca_juzgar(e, "L4/b2") == cf.toca_juzgar(e, "L4/b2")
    juzgadas = sum(cf.toca_juzgar(e, f"bloque-{i}") for i in range(2000))
    assert abs(juzgadas / 2000 - cf.muestra(e)) < 0.04


def test_motivos_desconocidos_se_ignoran():
    assert cf.registrar_usuario(None, False, ["inventado"])["motivos"] == {}


def test_el_tope_limita_cuanto_se_juzga():
    claves = [f"t{i}" for i in range(2000)]
    sin_tope = sum(cf.toca_juzgar(None, c) for c in claves) / 2000
    con_tope = sum(cf.toca_juzgar(None, c, tope=0.3) for c in claves) / 2000
    assert sin_tope > 0.7 and abs(con_tope - 0.3) < 0.04
    assert not any(cf.toca_juzgar(None, c, tope=0.0) for c in claves)
