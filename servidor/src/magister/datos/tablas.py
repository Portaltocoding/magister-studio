"""Importa todos los módulos de tablas para que Alembic vea el esquema entero."""

from magister.datos.modelos import Base  # noqa: F401
from magister.datos import plan  # noqa: F401,E402
from magister.datos import fuentes  # noqa: F401,E402
from magister.datos import material  # noqa: F401,E402
from magister.datos import aprender  # noqa: F401,E402
from magister.datos import produccion  # noqa: F401,E402
from magister.datos import agenda  # noqa: F401,E402
