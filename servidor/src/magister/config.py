from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_archivo_env = Path(__file__).resolve().parents[2] / ".env"
RAIZ_SERVIDOR = Path(__file__).resolve().parents[2]


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
    reranker_modelo: str = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"
    config_indice: str = "v1"
    crudo: str = str(RAIZ_SERVIDOR / "crudo")
    validez_min: float = 0.85
    paginas_min: float = 0.9
    umbral_apoyo: float = 0.85  # similitud densa mínima para contar un fragmento como apoyo (medido: lo ajeno da 0,78-0,81)
    min_apoyo: int = 2  # fragmentos por encima del umbral para no estar «sin material»
    umbral_fuentes: float = 0.85  # por debajo, la búsqueda no cuenta como «hay fuentes» (medido con e5-small)
    procesar_fondo: bool = True  # la API procesa las versiones recibidas y pendientes en segundo plano

    # Material (Parte IV)
    salidas: str = str(RAIZ_SERVIDOR.parent / "salidas")
    pandoc: str = str(Path.home() / "AppData" / "Local" / "Pandoc")  # carpeta de pandoc si no está en el PATH
    marp: str = "@marp-team/marp-cli@4.5.1"
    trabajos_en_api: bool = True  # el trabajador corre dentro de la API (o aparte con magister-trabajador)
    trabajos_lease_s: int = 120
    trabajos_intentos: int = 5
    duracion_guion_min: int = 8

    # Producción (Parte VI)
    plazo_primer_token_s: int = 60  # sin primer trozo en este plazo, se corta (y se reintenta si toca)
    canario: str = ""  # cadena secreta que nunca debe salir en una respuesta; se genera al instalar
    modelo_fondo_a_la_vez: int = 4  # cuántas llamadas al modelo en segundo plano a la vez (material, jueces); ~390 MB cada una
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
    voz_piper: str = str(RAIZ_SERVIDOR.parent / "herramientas" / "piper" / "piper" / "piper.exe")
    voz_dir: str = str(RAIZ_SERVIDOR.parent / "herramientas" / "piper" / "voces")
    registros: str = str(RAIZ_SERVIDOR / "registros")

    # Research (Parte III)
    research_pasos: int = 12
    research_llamadas: int = 8
    research_propuestas: int = 5
    research_segundos: int = 180
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
