-- Fase 4: lo que necesita la app de campo.

-- Las asignaciones de predios a funcionarios se editan como lista en la ficha del predio.
alter table predio_asignaciones add column id uuid not null default gen_random_uuid() unique;

-- Copia de la versión del servidor que quedó reemplazada cuando el funcionario decidió conservar la suya en un conflicto.
alter table visitas_campo add column conflicto_resuelto jsonb;

create index if not exists visitas_actualizado_idx on visitas_campo (funcionario_id, actualizado_en);
