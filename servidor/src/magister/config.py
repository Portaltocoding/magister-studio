import sys
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_archivo_env = Path(__file__).resolve().parents[2] / ".env"
RAIZ_SERVIDOR = Path(__file__).resolve().parents[2]

# Lo que depende del sistema: el ejecutable de Piper y el Chrome con el que se pinta el PDF (en Docker, Chromium).
_PIPER = "piper.exe" if sys.platform == "win32" else "piper"
_CHROME = {
    "win32": "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "darwin": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
}.get(sys.platform, "chromium")


class Ajustes(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MAGISTER_",
        env_file=_archivo_env,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Modelo
    motor: str = "cli"
    timeout_s: int = 180
    modelo: str = "sonnet"

    # Seguridad mínima
    token: str = ""

    # Bases de datos
    db_url: str = "postgresql+asyncpg://magister:magister@127.0.0.1:5433/magister"
    db_url_pruebas: str = "postgresql+asyncpg://magister:magister@127.0.0.1:5433/magister_pruebas"
    db_url_sim: str = "postgresql+asyncpg://magister:magister@127.0.0.1:5433/magister_sim"

    # LangGraph (conversación de diagnóstico)
    checkpoints: str = str(RAIZ_SERVIDOR / "checkpoints.sqlite")

    # Plan (Parte II)
    reintentos: int = 2  # reintentos dentro de estructurar (3 intentos)
    holgura: float = 0.15  # criterio general
    horas_max_leccion: float = 4.0  # criterio general
    partir_lecciones: bool = True  # una lección puede ocupar varios días

    # Fuentes y RAG (Parte III)
    embeddings: str = "local"  # local = sentence-transformers; falso = vectores por hash (pruebas)
    embeddings_modelo: str = "intfloat/multilingual-e5-small"
    # Tras arrancar, e5 tarda unos 20 s en cargar: una pregunta espera como mucho esto y, si aún no está, busca solo
    # por palabras en vez de dejarte 20 s sin respuesta.
    espera_embeddings_s: float = 5.0
    # Reescribir con el modelo un mensaje que depende del anterior («¿y eso?») añadía otra llamada a claude (5-7 s antes
    # de la primera palabra). Por defecto la búsqueda usa tu pregunta anterior más la de ahora, sin modelo; la respuesta
    # ya ve todo el hilo.
    reescribir_con_modelo: bool = False
    reranker_modelo: str = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"
    config_indice: str = "v1"
    crudo: str = str(RAIZ_SERVIDOR / "crudo")
    validez_min: float = 0.85
    paginas_min: float = 0.9
    umbral_apoyo: float = 0.85  # similitud densa mínima para contar un fragmento como apoyo (medido: lo ajeno da 0,78-0,81)
    min_apoyo: int = 2  # fragmentos por encima del umbral para no estar «sin material»
    umbral_fuentes: float = 0.85  # por debajo, la búsqueda no cuenta como «hay fuentes» (medido con e5-small)
    # Segunda puerta (ADR-0018): si el coseno no llega, el reranker puntúa los recuperados y hay fuentes si el mejor
    # pasa de esto. Medido con preguntas en español y fuentes en inglés: lo que contestan da 3,7 a 8,0; lo ajeno, -2,8 a
    # -6,5, y las 29 lecciones de tus planes (de otro tema) contra esos textos, -0,3 a -6,0.
    umbral_reranker: float = 1.5
    # Una cita sin palabras en común con el fragmento (otro idioma) vale si la similitud de e5 llega a esto (ADR-0018).
    umbral_cita_semantica: float = 0.85
    procesar_fondo: bool = True  # la API procesa las versiones recibidas y pendientes en segundo plano

    # Material (Parte IV)
    salidas: str = str(RAIZ_SERVIDOR.parent / "salidas")
    pandoc: str = str(Path.home() / "AppData" / "Local" / "Pandoc")  # carpeta de pandoc si no está en el PATH
    marp: str = "@marp-team/marp-cli@4.5.1"
    # El navegador del motor de PDF (MAGISTER_CHROME) y sus argumentos de más (en Docker, --no-sandbox).
    chrome: str = _CHROME
    chrome_args: str = ""
    trabajos_en_api: bool = True  # el trabajador corre dentro de la API (o aparte con magister-trabajador)
    trabajos_lease_s: int = 120
    trabajos_intentos: int = 5
    duracion_guion_min: int = 8

    # Producción (Parte VI)
    plazo_primer_token_s: int = 60  # sin primer trozo en este plazo, se corta (y se reintenta si toca)
    canario: str = ""  # cadena secreta que nunca debe salir en una respuesta; se genera al instalar
    modelo_fondo_a_la_vez: int = 4  # cuántas llamadas al modelo en segundo plano a la vez (material, jueces); ~390 MB cada una
    # Cuántos diagramas del chat (prompt diagrama_chat) se dibujan a la vez; los demás esperan en cola sin lanzar claude,
    # para no competir con el chat (el 18-11-2026 llegó a haber 16 a la vez, de 30 a 230 s cada uno).
    diagramas_a_la_vez: int = 2
    # El freno (cerebro/freno.py): tope de llamadas al modelo por prompt y en total en la ventana; al pasarlo, se para.
    freno_ventana_s: int = 600
    freno_por_prompt: int = 25
    freno_total: int = 80
    juez_muestra: float = 0.5  # tope de la fracción de explicaciones que juzga el juez online: 0 lo apaga, 1 lo fuerza
    # todo; entre medias, la confianza aprendida de tus valoraciones decide cuánto, sin pasar de este tope
    entorno: str = "produccion"  # produccion, desarrollo o evals
    permitir_atacante_local: bool = False  # solo para la suite de ataques
    buscador: str = "hibrido"  # hibrido o falso (mesa de ataque)
    dir_secretos: str = "/run/secrets"
    servir_web: bool = True  # la API sirve web/dist si existe: http://localhost:8000

    # Aprender (Parte V)
    programador: str = "fsrs"  # leitner, fsrs o modelo (ADR-0013)
    # Tope en los dos primeros intervalos de lo recién aprendido (3 y 9 días), por encima de FSRS.
    tope_inicial: bool = True
    retencion: float = 0.9
    inicio_dia: str = "04:00"
    zona: str = "Europe/Madrid"
    nuevos_dia: int = 10  # conceptos nuevos que entran en la cola cada día
    simulado: bool = False  # si es verdadero, la sesión usa la base de simulación

    # Voz local del tutor (Piper) y registro de las llamadas
    voz_piper: str = str(RAIZ_SERVIDOR.parent / "herramientas" / "piper" / "piper" / _PIPER)
    voz_dir: str = str(RAIZ_SERVIDOR.parent / "herramientas" / "piper" / "voces")
    # ffmpeg para descargar los vídeos en MP4 (MAGISTER_FFMPEG: el ejecutable, o su ruta si no está en el PATH)
    ffmpeg: str = "ffmpeg"
    registros: str = str(RAIZ_SERVIDOR / "registros")

    # Tus datos desde Ajustes: tope de los ficheros (salidas y crudo) que entran en «Descargar mis datos», y dónde
    # están las copias de la base (las de scripts/copia_db.sh) y el contenedor de Docker que tiene pg_dump. Con
    # contenedor_db vacío (todo en Docker), pg_dump, pg_restore y psql se lanzan aquí mismo y van a la base por PGHOST.
    exportar_max_mb: float = 500
    copias: str = str(RAIZ_SERVIDOR.parent / "copias")
    contenedor_db: str = "magister-studio-db"
    # La API hace sola la copia del día (y la rotación 7/4/12, como scripts/copia_db.sh). En Windows la hace la tarea
    # programada y arrancar.ps1; en Docker, esto (MAGISTER_COPIA_DIARIA=true).
    copia_diaria: bool = False

    # El asesor que propone cambios (ADR-0017): cuántas vueltas como mucho (la última solo puede proponer) y cuántas
    # lecturas por vuelta. Con 3 vueltas: leer, leer y proponer.
    asesor_vueltas: int = 3
    asesor_lecturas: int = 2
    # Research (Parte III)
    research_pasos: int = 12
    research_llamadas: int = 8
    research_propuestas: int = 5
    research_segundos: int = 180
    # Al acabar una tarea de research, sus propuestas entran solas en tus fuentes (trabajo «incorporar», sin modelo,
    # ADR-0019). Con false esperan tu aprobación, como antes.
    research_incorporar: bool = True
    # El juez ve de cada página este principio (con 1.500 apenas veía la introducción).
    research_extracto: int = 2500
    # Menos texto que esto no da para estudiar: de 214 páginas guardadas, 27 se quedaban por debajo (menús, portadas).
    research_min_texto: int = 1500
    # Dominios que no se leen nunca (coma entre ellos): copias de documentos, cursos de pago y cuadernos sin texto.
    research_fuera: str = "scribd.com,udemy.com,colab.research.google.com"
    # El research lee PDF (apuntes universitarios, artículos), hasta este tamaño; con false, solo HTML.
    research_pdf: bool = True
    research_pdf_max_mb: int = 20
    # Si un artículo está tras un muro de pago y tiene DOI, se busca su versión en abierto en Unpaywall, que pide un
    # correo de contacto. Vacío (por defecto): no se consulta.
    unpaywall_email: str = ""
    # El research automático (plan/horizonte.py): cada 10 minutos busca fuentes, como mucho 2 lecciones por vuelta, para
    # las que empiezan en los próximos días y aún no tienen; también en planes aceptados sin buscar. Nunca para las que
    # el plan marca `necesita_fuentes = no`. Con false, solo se busca cuando lo pides.
    research_auto: bool = True
    research_horizonte_dias: int = 7
    research_intervalo_s: int = 600  # cada cuánto da una vuelta el research automático
    research_por_vuelta: int = 2  # lecciones que se investigan solas en cada vuelta, entre todos los planes
    research_vieja_dias: int = 14  # una búsqueda acabada de hace más de esto, y la lección sigue sin material: se repite
    # De un PDF, el juez ve estas páginas a partir de la primera con prosa (se salta portada, agradecimientos e índice).
    research_paginas_pdf: int = 6
    # Topes de tiempo del research: una página HTML, cualquier descarga (un PDF), sacar el texto de un PDF y la tarea
    # entera del flujo fijo (al pasarlo, la tarea queda «cortada» y se puede reintentar).
    research_plazo_html_s: int = 30
    research_plazo_descarga_s: int = 60
    research_plazo_extraer_s: int = 30
    research_plazo_tarea_s: int = 900
    # El apoyo de una lección: fragmentos anclados (los que trajo el research) por objetivo, y tope por lección.
    apoyo_por_objetivo: int = 2
    apoyo_tope: int = 12
    # ¿Documento entero o un pedazo? Con menos caracteres de contenido que esto (fuera de bibliografía y notas), una
    # señal de muro de pago pesa (fuentes/extraer.py, parece_incompleta).
    incompleta_contenido_min: int = 6000
    # Los apuntes automáticos de una lección esperan a que lleguen sus fuentes (research en curso, propuestas por
    # incorporar o indexándose) como mucho estos minutos; pasado el plazo, se preparan igual.
    material_espera_fuentes: int = 20
    # Researcher (el agente mejorado): novedad, juez, cobertura y coste
    research_novedad: float = 0.9  # similitud coseno >= esto: la fuente repite una ya propuesta (redundante)
    research_juez_min: float = 2.0  # media de la rúbrica (0-3) por debajo de la cual no se propone
    research_dupes_max: int = 2  # redundancias seguidas en un subtema antes de darlo por saturado
    research_euros: float = 0.05  # tope de coste estimado por tarea; al pasarlo, para
    research_coste_llamada_eur: float = 0.003  # tarifa estimada por llamada al modelo (decidir, juez, subtemas)
    research_coste_busqueda_eur: float = 0.001  # tarifa estimada por búsqueda web


ajustes = Ajustes()


def leer_secretos(a: Ajustes) -> None:
    """En Docker, los secretos llegan como ficheros en MAGISTER_DIR_SECRETOS (/run/secrets)."""
    carpeta = Path(a.dir_secretos)
    if not carpeta.is_dir():
        return
    for nombre, campo in (("canario", "canario"), ("magister_token", "token")):
        f = carpeta / nombre
        if f.is_file() and not getattr(a, campo):
            setattr(a, campo, f.read_text(encoding="utf-8").strip())


leer_secretos(ajustes)
