-- Línea base de latencia: docker exec -i magister-studio-db psql -U magister -d magister < servidor/scripts/linea_base.sql
select percentile_cont(0.5)  within group (order by ms_primer_token) as p50,
       percentile_cont(0.95) within group (order by ms_primer_token) as p95,
       count(*) as respuestas
from mensajes where rol = 'tutor' and estado = 'completo';
