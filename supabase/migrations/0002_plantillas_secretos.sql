-- Fase 2: plantillas que se pueden subir en cualquier momento, secretos del servidor (clave de IA)
-- y campos que necesita el banco de proyecciones.

-- Plantillas de documentos (carta de respuesta, diagnóstico F-RE-08…) y logos. Cada carga es una versión nueva;
-- la activa es la que usa el sistema. Si no hay ninguna, se usa el formato genérico incorporado.
create table plantillas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('respuesta_proyeccion', 'diagnostico', 'logo')),
  nombre text not null,
  archivo_ruta text not null,
  archivo_nombre text not null,
  version integer not null default 1,
  activa boolean not null default true,
  notas text,
  subida_por uuid references perfiles (id),
  creado_en timestamptz not null default now()
);
create unique index plantilla_una_activa on plantillas (tipo) where activa;

-- Secretos cifrados (clave de la API de IA). Sin políticas: ningún usuario los lee por la API;
-- solo el servidor, que además los guarda cifrados con su propia llave.
create table secretos (
  clave text primary key,
  valor_cifrado text not null,
  actualizado_por uuid references perfiles (id),
  actualizado_en timestamptz not null default now()
);

alter table plantillas enable row level security;
alter table secretos enable row level security;
create policy lectura on plantillas for select to authenticated using (rol_actual() is not null);
create policy edicion on plantillas for all to authenticated using (tiene_rol('administrador', 'coordinador')) with check (tiene_rol('administrador', 'coordinador'));
create trigger plantillas_auditoria after insert or update or delete on plantillas for each row execute function registrar_auditoria();

-- Proyecciones: texto completo del archivo de origen (para buscar parecidas) y el archivo importado.
alter table proyecciones add column texto_fuente text;
alter table proyecciones add column archivo_origen_ruta text;
alter table proyecciones add column archivo_origen_nombre text;
alter table proyecciones add column municipio text;
alter table proyecciones add column vereda text;
alter table proyecciones add column asunto text;
create index proyecciones_texto_trgm on proyecciones using gin (texto_fuente gin_trgm_ops);

-- Los titulares del predio necesitan un identificador propio para editarse como lista.
alter table predio_titulares add column id uuid not null default gen_random_uuid() unique;
