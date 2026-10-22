-- =====================================================================================
-- Sistema PSA · Esquema de base de datos (Supabase: PostgreSQL + PostGIS)
-- Gestión de Pagos por Servicios Ambientales. Zona horaria America/Bogota, moneda COP.
--
-- Convenciones
--   · Llaves primarias uuid generadas en el servidor o en el teléfono (la app trabaja sin conexión).
--   · Todas las tablas de negocio tienen creado_en, actualizado_en y eliminado_en (borrado lógico),
--     que es lo que usa la sincronización del móvil para traer solo lo que cambió.
--   · Geometrías en EPSG:4326; las áreas se calculan sobre el elipsoide (geography) en hectáreas.
--   · Los datos de la fuente que se contradicen NO se rechazan: se guardan y generan una alerta
--     de calidad (tabla alertas_calidad). Solo los formatos (FMI, catastral) se validan en firme.
-- =====================================================================================

create extension if not exists postgis;
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ------------------------------------------------------------------ Tipos enumerados

create type rol_usuario as enum ('administrador', 'coordinador', 'funcionario_campo', 'financiero', 'consulta');
create type estado_convenio as enum ('en_estructuracion', 'vigente', 'suspendido', 'terminado', 'liquidado');
create type tipo_beneficiario as enum ('persona_natural', 'jac', 'asociacion_acueducto', 'comunidad_etnica', 'entidad');
create type tipo_documento_identidad as enum ('CC', 'NIT', 'CE', 'PASAPORTE');
create type regimen_tenencia as enum ('propietario', 'poseedor', 'ocupante');
create type modalidad_psa as enum ('hidrico', 'biodiversidad', 'carbono', 'otros');
create type estado_acuerdo as enum ('borrador', 'activo', 'suspendido', 'terminado', 'incumplido');
create type periodicidad_pago as enum ('unico', 'mensual', 'trimestral', 'semestral', 'anual');
create type aplicacion_costo as enum ('aplica', 'no_aplica', 'valor_especial');
create type estado_costo as enum ('borrador', 'vigente', 'reemplazado', 'anulado');
create type estado_proyeccion as enum ('borrador', 'en_revision', 'aprobada', 'enviada');
create type origen_proyeccion as enum ('manual', 'importada_excel', 'solicitud_ia');
create type estado_pago as enum ('pendiente', 'pagado', 'retenido_incumplimiento', 'anulado');
create type estado_documento as enum ('pendiente', 'recibido', 'vencido', 'rechazado');
create type ambito_expediente as enum ('beneficiario', 'predio', 'acuerdo');
create type estado_diagnostico as enum ('borrador', 'en_revision', 'aprobado');
create type grupo_especie as enum ('flora', 'fauna');
create type estado_sincronizacion as enum ('pendiente', 'sincronizada', 'conflicto');
create type severidad_alerta as enum ('informativa', 'advertencia', 'error');
create type resultado_respaldo as enum ('en_curso', 'exitoso', 'fallido');

-- ------------------------------------------------------------------ Usuarios y roles

-- Perfil de cada persona con acceso. La cuenta (correo y contraseña) vive en auth.users de Supabase.
create table perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null,
  documento text,
  cargo text,
  rol rol_usuario not null default 'consulta',
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Rol de quien hace la consulta; null si no tiene perfil o está inactivo.
-- "security definer" para que las políticas puedan leer perfiles sin caer en recursión.
create or replace function rol_actual() returns rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;

create or replace function tiene_rol(variadic roles rol_usuario[]) returns boolean
language sql stable as $$
  select coalesce(rol_actual() = any (roles), false)
$$;

-- ------------------------------------------------------------------ Convenios

create table convenios (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,                       -- ej. CNV 2025-012
  entidad_contratante text not null,
  operador text not null,
  objeto text not null,
  proyecto_marco text,
  fecha_inicio date,
  fecha_fin date,
  valor numeric(16, 2) check (valor >= 0),
  estado estado_convenio not null default 'vigente',
  observaciones text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  constraint convenio_fechas check (fecha_fin is null or fecha_fin >= fecha_inicio)
);

-- ------------------------------------------------------------------ Beneficiarios

create table beneficiarios (
  id uuid primary key default gen_random_uuid(),
  tipo tipo_beneficiario not null,
  nombre text not null,                              -- nombre completo o razón social
  tipo_documento tipo_documento_identidad not null,
  numero_documento text not null,                    -- solo dígitos; el NIT va sin dígito de verificación
  digito_verificacion smallint check (digito_verificacion between 0 and 9),
  -- Representante legal (personas jurídicas)
  representante_nombre text,
  representante_documento text,
  representante_cargo text,
  -- Personería jurídica
  personeria_resolucion text,
  personeria_fecha date,
  personeria_entidad text,
  -- Contacto
  telefono text,
  correo text,
  direccion text,
  municipio text,
  departamento text,
  observaciones text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  constraint beneficiario_documento_unico unique (tipo_documento, numero_documento),
  constraint beneficiario_documento_digitos check (numero_documento ~ '^[0-9A-Za-z]{4,15}$')
);
create index beneficiarios_nombre_trgm on beneficiarios using gin (nombre gin_trgm_ops);

-- La cuenta bancaria va aparte porque solo la ven administrador, coordinador y financiero.
create table beneficiario_cuentas (
  id uuid primary key default gen_random_uuid(),
  beneficiario_id uuid not null references beneficiarios (id) on delete cascade,
  banco text not null,
  tipo_cuenta text not null check (tipo_cuenta in ('ahorros', 'corriente')),
  numero text not null,
  titular text not null,
  titular_documento text,
  principal boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz
);
create index on beneficiario_cuentas (beneficiario_id);

-- Autorización de tratamiento de datos personales (Ley 1581 de 2012).
create table consentimientos (
  id uuid primary key default gen_random_uuid(),
  beneficiario_id uuid not null references beneficiarios (id) on delete cascade,
  version_politica text not null,
  fecha date not null,
  medio text not null,                               -- firma física, firma en la app, correo…
  documento_ruta text,                               -- soporte en Storage
  revocado_en date,
  registrado_por uuid references perfiles (id),
  creado_en timestamptz not null default now()
);
create index on consentimientos (beneficiario_id);

-- ------------------------------------------------------------------ Zonas de conservación

create table zonas_conservacion (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null,                                -- microcuenca abastecedora, área de recarga, corredor…
  cuenca text,
  acueducto text,
  ecosistema text,
  prioridad smallint check (prioridad between 1 and 5),
  geom geometry (MultiPolygon, 4326),
  area_ha numeric(14, 4) generated always as (round((st_area(geom::geography) / 10000)::numeric, 4)) stored,
  observaciones text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz
);
create index zonas_geom_idx on zonas_conservacion using gist (geom);

-- Capas de referencia contra las que se revisan traslapes (áreas protegidas, otros incentivos…).
create table capas_referencia (
  id uuid primary key default gen_random_uuid(),
  categoria text not null,                           -- area_protegida, otro_incentivo, paramo, reserva_forestal…
  nombre text not null,
  fuente text,
  geom geometry (MultiPolygon, 4326) not null,
  creado_en timestamptz not null default now()
);
create index capas_geom_idx on capas_referencia using gist (geom);

-- ------------------------------------------------------------------ Predios

create table predios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  fmi text,                                          -- folio de matrícula inmobiliaria, ej. 000-12345
  codigo_catastral text,                             -- número predial nacional de 30 dígitos
  vereda text,
  municipio text not null,
  departamento text not null default 'Boyacá',
  altitud_min numeric(7, 1),
  altitud_max numeric(7, 1),
  area_total_ha numeric(14, 4) check (area_total_ha > 0),
  area_conservacion_ha numeric(14, 4) check (area_conservacion_ha >= 0),
  geom geometry (MultiPolygon, 4326),
  area_poligono_ha numeric(14, 4) generated always as (round((st_area(geom::geography) / 10000)::numeric, 4)) stored,
  -- Escritura pública
  escritura_numero text,
  escritura_fecha date,
  escritura_notaria text,
  -- Ordenamiento y ecosistema
  clasificacion_pot text,
  ecosistema_estrategico text,
  uso_permitido text,
  uso_prohibido text,
  infraestructura text,
  -- Situación jurídica
  regimen_tenencia regimen_tenencia,
  situacion_juridica text,
  alertas_juridicas text,
  zona_id uuid references zonas_conservacion (id),
  observaciones text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  constraint predio_fmi_formato check (fmi is null or fmi ~ '^[0-9]{3}-[0-9]{1,8}$'),
  constraint predio_catastral_formato check (codigo_catastral is null or codigo_catastral ~ '^[0-9]{30}$'),
  constraint predio_altitudes check (altitud_min is null or altitud_max is null or altitud_max >= altitud_min)
);
create unique index predios_fmi_unico on predios (fmi) where fmi is not null and eliminado_en is null;
create unique index predios_catastral_unico on predios (codigo_catastral) where codigo_catastral is not null and eliminado_en is null;
create index predios_geom_idx on predios using gist (geom);
create index predios_lugar_idx on predios (municipio, vereda);
create index predios_nombre_trgm on predios using gin (nombre gin_trgm_ops);

-- Titulares del predio (N:M con beneficiarios).
create table predio_titulares (
  predio_id uuid not null references predios (id) on delete cascade,
  beneficiario_id uuid not null references beneficiarios (id) on delete restrict,
  tenencia regimen_tenencia not null default 'propietario',
  porcentaje numeric(5, 2) check (porcentaje > 0 and porcentaje <= 100),
  principal boolean not null default false,
  creado_en timestamptz not null default now(),
  primary key (predio_id, beneficiario_id)
);
create index on predio_titulares (beneficiario_id);

-- Cada área que aparece en una fuente (escritura, certificado, levantamiento, diagnóstico), tal como viene.
-- Permite conservar cifras que se contradicen y compararlas en una misma unidad.
create table predio_areas_fuente (
  id uuid primary key default gen_random_uuid(),
  predio_id uuid not null references predios (id) on delete cascade,
  concepto text not null check (concepto in ('total', 'conservacion')),
  fuente text not null,
  valor numeric(16, 4) not null check (valor > 0),
  unidad text not null check (unidad in ('ha', 'm2')),
  valor_ha numeric(16, 4) generated always as (case unidad when 'm2' then valor / 10000 else valor end) stored,
  creado_en timestamptz not null default now()
);
create index on predio_areas_fuente (predio_id);

-- Predios que cada funcionario de campo tiene asignados (lo que descarga la app).
create table predio_asignaciones (
  predio_id uuid not null references predios (id) on delete cascade,
  funcionario_id uuid not null references perfiles (id) on delete cascade,
  asignado_en timestamptz not null default now(),
  primary key (predio_id, funcionario_id)
);

-- ------------------------------------------------------------------ Acuerdos y pagos

create table acuerdos (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  convenio_id uuid not null references convenios (id) on delete restrict,
  beneficiario_id uuid not null references beneficiarios (id) on delete restrict,
  predio_id uuid not null references predios (id) on delete restrict,
  modalidad modalidad_psa not null,
  fecha_firma date,
  fecha_inicio date,
  fecha_fin date,                                    -- fin de la vigencia inicial
  area_ha numeric(14, 4) check (area_ha > 0),
  valor_total numeric(16, 2) check (valor_total >= 0),
  valor_ha_anio numeric(16, 2) check (valor_ha_anio >= 0),
  periodicidad periodicidad_pago not null default 'anual',
  estado estado_acuerdo not null default 'borrador',
  compromisos text,
  observaciones text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  constraint acuerdo_fechas check (fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio)
);
create index on acuerdos (convenio_id);
create index on acuerdos (beneficiario_id);
create index on acuerdos (predio_id);
create index on acuerdos (estado, fecha_fin);

create table acuerdo_prorrogas (
  id uuid primary key default gen_random_uuid(),
  acuerdo_id uuid not null references acuerdos (id) on delete cascade,
  numero smallint not null,
  fecha_firma date not null,
  nueva_fecha_fin date not null,
  valor_adicional numeric(16, 2) default 0,
  soporte_ruta text,
  observaciones text,
  creado_en timestamptz not null default now(),
  unique (acuerdo_id, numero)
);

create table pagos (
  id uuid primary key default gen_random_uuid(),
  acuerdo_id uuid not null references acuerdos (id) on delete restrict,
  vigencia smallint not null check (vigencia between 2000 and 2100),
  numero_cuota smallint not null default 1,
  valor_programado numeric(16, 2) not null check (valor_programado >= 0),
  fecha_programada date not null,
  valor_pagado numeric(16, 2) check (valor_pagado >= 0),
  fecha_pago date,
  retenciones numeric(16, 2) not null default 0 check (retenciones >= 0),
  fuente_recursos text,
  comprobante_ruta text,
  estado estado_pago not null default 'pendiente',
  observaciones text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  unique (acuerdo_id, vigencia, numero_cuota),
  constraint pago_pagado_completo check (estado <> 'pagado' or (valor_pagado is not null and fecha_pago is not null))
);
create index on pagos (estado, fecha_programada);

-- ------------------------------------------------------------------ Costo de oportunidad e IPC

-- Una fila por versión. La versión vigente de una zona y uso es la que tiene estado 'vigente';
-- al publicar una nueva, la anterior pasa a 'reemplazado' y queda como historial.
create table costo_oportunidad (
  id uuid primary key default gen_random_uuid(),
  zona_id uuid not null references zonas_conservacion (id) on delete restrict,
  uso_suelo text not null,                           -- ganadería de leche, papa, sin uso productivo…
  aplicacion aplicacion_costo not null default 'aplica',
  valor_ha_anio numeric(16, 2) check (valor_ha_anio >= 0),
  justificacion text,                                -- obligatoria si no aplica o es valor especial
  fuente text,
  fecha_calculo date not null,
  anio_base smallint not null,                       -- año de los precios del valor
  version smallint not null default 1,
  vigente_desde date not null,
  vigente_hasta date,
  reajuste_ipc boolean not null default true,
  estado estado_costo not null default 'borrador',
  reemplaza_a uuid references costo_oportunidad (id),
  creado_por uuid references perfiles (id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  unique (zona_id, uso_suelo, version),
  constraint costo_valor_coherente check (
    (aplicacion = 'no_aplica' and valor_ha_anio is null) or (aplicacion <> 'no_aplica' and valor_ha_anio is not null)
  ),
  constraint costo_justificado check (aplicacion = 'aplica' or length(trim(coalesce(justificacion, ''))) >= 10)
);
create unique index costo_una_vigente on costo_oportunidad (zona_id, uso_suelo) where estado = 'vigente' and eliminado_en is null;

-- Variación anual del IPC (DANE), para los reajustes.
create table ipc_anual (
  anio smallint primary key,
  variacion_pct numeric(6, 3) not null,
  es_proyectado boolean not null default false,
  fuente text,
  actualizado_en timestamptz not null default now()
);

-- Parámetros de la calculadora de incentivo. La metodología NO está fijada: queda aquí como
-- configuración con versión, para replicar las proyecciones históricas cuando se definan.
create table metodologias_calculo (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  version smallint not null default 1,
  descripcion text,
  parametros jsonb not null default '{}'::jsonb,
  vigente boolean not null default false,
  aprobada_por uuid references perfiles (id),
  creado_en timestamptz not null default now(),
  unique (nombre, version)
);

-- ------------------------------------------------------------------ Proyecciones

create table proyecciones (
  id uuid primary key default gen_random_uuid(),
  consecutivo text unique,
  origen origen_proyeccion not null default 'manual',
  -- Solicitud
  solicitante text not null,
  solicitante_documento text,
  radicado text,
  fecha_solicitud date,
  solicitud_pdf_ruta text,                           -- PDF original (Storage)
  -- Datos del cálculo
  zona_id uuid references zonas_conservacion (id),
  costo_oportunidad_id uuid references costo_oportunidad (id),
  metodologia_id uuid references metodologias_calculo (id),
  area_ha numeric(14, 4) check (area_ha > 0),
  anios smallint check (anios between 1 and 50),
  reajuste jsonb,                                    -- parámetros del reajuste aplicados (IPC por año, etc.)
  escenario text,
  resultado jsonb,                                   -- detalle año por año
  valor_total numeric(18, 2),
  -- Análisis con IA y trazabilidad
  datos_extraidos jsonb,                             -- lo que leyó la IA, sin corregir
  datos_revisados jsonb,                             -- lo que aprobó la persona
  modelo_ia text,
  extraccion_revisada_por uuid references perfiles (id),
  extraccion_revisada_en timestamptz,
  -- Respuesta
  estado estado_proyeccion not null default 'borrador',
  version smallint not null default 1,
  documento_ruta text,                               -- Word de respuesta vigente
  aprobada_por uuid references perfiles (id),
  aprobada_en timestamptz,
  enviada_en timestamptz,
  texto_busqueda tsvector,                           -- índice para encontrar proyecciones parecidas
  observaciones text,
  creado_por uuid references perfiles (id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz
);
create index on proyecciones (estado);
create index proyecciones_busqueda_idx on proyecciones using gin (texto_busqueda);

create table proyeccion_predios (
  id uuid primary key default gen_random_uuid(),
  proyeccion_id uuid not null references proyecciones (id) on delete cascade,
  predio_id uuid references predios (id),            -- null si el predio de la solicitud aún no está registrado
  nombre text,
  fmi text,
  codigo_catastral text,
  vereda text,
  municipio text,
  area_ha numeric(14, 4)
);
create index on proyeccion_predios (proyeccion_id);

-- Proyecciones pasadas que se consultaron para armar una respuesta.
create table proyeccion_referencias (
  proyeccion_id uuid not null references proyecciones (id) on delete cascade,
  referencia_id uuid not null references proyecciones (id) on delete restrict,
  puntaje numeric(5, 2),
  motivo text,
  incluida boolean not null default true,
  primary key (proyeccion_id, referencia_id)
);

-- Cada versión del documento de respuesta, con quién la generó y en qué estado quedó.
create table proyeccion_versiones (
  id uuid primary key default gen_random_uuid(),
  proyeccion_id uuid not null references proyecciones (id) on delete cascade,
  version smallint not null,
  estado estado_proyeccion not null,
  documento_ruta text,
  contenido jsonb,
  comentario text,
  creado_por uuid references perfiles (id),
  creado_en timestamptz not null default now(),
  unique (proyeccion_id, version)
);

-- ------------------------------------------------------------------ Documentos y listas de chequeo

create table tipos_documento (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,                       -- CEDULA, RUT, CTL, ESCRITURA…
  nombre text not null,
  ambito ambito_expediente not null,
  vigencia_dias integer check (vigencia_dias > 0),   -- ej. 30 días para el certificado de tradición
  activo boolean not null default true
);

create table documentos (
  id uuid primary key default gen_random_uuid(),
  tipo_id uuid not null references tipos_documento (id),
  -- Expediente: exactamente uno de los tres
  beneficiario_id uuid references beneficiarios (id) on delete cascade,
  predio_id uuid references predios (id) on delete cascade,
  acuerdo_id uuid references acuerdos (id) on delete cascade,
  archivo_ruta text,
  archivo_nombre text,
  version smallint not null default 1,
  estado estado_documento not null default 'pendiente',
  fecha_emision date,
  fecha_vencimiento date,
  verificado_por uuid references perfiles (id),
  verificado_en timestamptz,
  observaciones text,
  creado_por uuid references perfiles (id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  constraint documento_un_expediente check (num_nonnulls(beneficiario_id, predio_id, acuerdo_id) = 1),
  constraint documento_fechas check (fecha_vencimiento is null or fecha_emision is null or fecha_vencimiento >= fecha_emision)
);
create index on documentos (beneficiario_id);
create index on documentos (predio_id);
create index on documentos (acuerdo_id);
create index on documentos (estado, fecha_vencimiento);

-- Plantillas de lista de chequeo: qué documentos exige cada expediente según modalidad y tipo de beneficiario.
create table listas_chequeo (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  ambito ambito_expediente not null,
  modalidad modalidad_psa,                           -- null = todas
  tipo_beneficiario tipo_beneficiario,               -- null = todos
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

create table lista_chequeo_items (
  id uuid primary key default gen_random_uuid(),
  lista_id uuid not null references listas_chequeo (id) on delete cascade,
  tipo_documento_id uuid not null references tipos_documento (id),
  obligatorio boolean not null default true,
  orden smallint not null default 0,
  ayuda text,
  unique (lista_id, tipo_documento_id)
);

-- ------------------------------------------------------------------ Diagnósticos (formato F-RE-08)

create table diagnosticos (
  id uuid primary key default gen_random_uuid(),
  predio_id uuid not null references predios (id) on delete restrict,
  acuerdo_id uuid references acuerdos (id),
  formato_codigo text not null default 'F-RE-08',
  formato_version text,
  formato_fecha date,
  elaboro text,
  elaboro_fecha date,
  reviso text,
  reviso_fecha date,
  aprobo text,
  aprobo_fecha date,
  antecedentes_legales text,
  identificacion_juridica text,
  area_estudio text,
  contexto_ecosistemico text,
  uso_suelo text,
  importancia_ambiental text,
  potencial_conservacion text,
  estado estado_diagnostico not null default 'borrador',
  documento_ruta text,
  creado_por uuid references perfiles (id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz
);
create index on diagnosticos (predio_id);

create table diagnostico_especies (
  id uuid primary key default gen_random_uuid(),
  diagnostico_id uuid not null references diagnosticos (id) on delete cascade,
  grupo grupo_especie not null,
  nombre_comun text not null,
  nombre_cientifico text,
  familia text,
  categoria_amenaza text,
  -- Resultado de contrastar con la fuente taxonómica: null = sin revisar
  taxonomia_valida boolean,
  taxonomia_fuente text,
  taxonomia_nombre_aceptado text,
  orden smallint not null default 0
);
create index on diagnostico_especies (diagnostico_id);

-- ------------------------------------------------------------------ Visitas de campo

create table visitas_campo (
  id uuid primary key default gen_random_uuid(),     -- lo genera el teléfono
  predio_id uuid not null references predios (id) on delete restrict,
  acuerdo_id uuid references acuerdos (id),
  funcionario_id uuid not null references perfiles (id),
  fecha_hora timestamptz not null,
  ubicacion geometry (Point, 4326),
  precision_m numeric(7, 2),
  altitud numeric(7, 1),
  cobertura text,
  estado_conservacion text,
  presiones text[],
  cumple_compromisos boolean,
  cumplimiento_detalle text,
  hallazgos text,
  recomendaciones text,
  formulario jsonb not null default '{}'::jsonb,     -- respuestas completas (formulario propio u ODK)
  firmante_nombre text,
  firmante_documento text,
  firma_ruta text,
  -- Sincronización
  dispositivo_id text,
  revision integer not null default 1,               -- sube con cada edición; sirve para detectar conflictos
  estado_sincronizacion estado_sincronizacion not null default 'sincronizada',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz
);
create index on visitas_campo (predio_id, fecha_hora desc);
create index on visitas_campo (funcionario_id);
create index visitas_ubicacion_idx on visitas_campo using gist (ubicacion);

create table visita_fotos (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid not null references visitas_campo (id) on delete cascade,
  archivo_ruta text not null,
  ubicacion geometry (Point, 4326),
  tomada_en timestamptz not null,
  rumbo numeric(5, 1),
  descripcion text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz
);
create index on visita_fotos (visita_id);

-- ------------------------------------------------------------------ Calidad de datos, auditoría, respaldos

create table alertas_calidad (
  id uuid primary key default gen_random_uuid(),
  tabla text not null,
  registro_id uuid not null,
  regla text not null,                               -- area_conservacion_mayor, unidades_sospechosas…
  severidad severidad_alerta not null default 'advertencia',
  mensaje text not null,
  resuelta boolean not null default false,
  resuelta_por uuid references perfiles (id),
  resuelta_en timestamptz,
  nota_resolucion text,
  creado_en timestamptz not null default now(),
  unique (tabla, registro_id, regla)
);
create index on alertas_calidad (resuelta, severidad);

create table auditoria (
  id bigint generated always as identity primary key,
  tabla text not null,
  registro_id text,
  accion text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  usuario_id uuid,
  antes jsonb,
  despues jsonb,
  fecha timestamptz not null default now()
);
create index on auditoria (tabla, registro_id);
create index on auditoria (fecha desc);

create table respaldos (
  id uuid primary key default gen_random_uuid(),
  iniciado_en timestamptz not null default now(),
  terminado_en timestamptz,
  resultado resultado_respaldo not null default 'en_curso',
  tamano_bytes bigint,
  archivos integer,
  destino text,                                      -- carpeta de Google Drive
  detalle text,
  alerta_enviada boolean not null default false
);

create table configuracion (
  clave text primary key,
  valor jsonb not null,
  descripcion text,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references perfiles (id)
);

-- ------------------------------------------------------------------ Disparadores comunes

create or replace function tocar_actualizado() returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

-- Guarda en la bitácora el antes y el después de cada cambio, con el usuario que lo hizo.
create or replace function registrar_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fila jsonb := to_jsonb(coalesce(new, old));
begin
  insert into auditoria (tabla, registro_id, accion, usuario_id, antes, despues)
  values (
    tg_table_name, coalesce(fila ->> 'id', fila ->> 'anio', fila ->> 'clave'), tg_op, auth.uid(),
    case when tg_op <> 'INSERT' then to_jsonb(old) - 'geom' end,
    case when tg_op <> 'DELETE' then to_jsonb(new) - 'geom' end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  -- actualizado_en automático
  foreach t in array array[
    'perfiles', 'convenios', 'beneficiarios', 'beneficiario_cuentas', 'zonas_conservacion', 'predios', 'acuerdos', 'pagos',
    'costo_oportunidad', 'proyecciones', 'documentos', 'diagnosticos', 'visitas_campo', 'visita_fotos'
  ] loop
    execute format('create trigger %I before update on %I for each row execute function tocar_actualizado()', t || '_tocar', t);
  end loop;
  -- bitácora de auditoría
  foreach t in array array[
    'perfiles', 'convenios', 'beneficiarios', 'beneficiario_cuentas', 'consentimientos', 'zonas_conservacion', 'predios',
    'predio_titulares', 'predio_areas_fuente', 'predio_asignaciones', 'acuerdos', 'acuerdo_prorrogas', 'pagos',
    'costo_oportunidad', 'ipc_anual', 'metodologias_calculo', 'proyecciones', 'proyeccion_versiones', 'documentos',
    'listas_chequeo', 'lista_chequeo_items', 'tipos_documento', 'diagnosticos', 'diagnostico_especies', 'visitas_campo',
    'visita_fotos', 'configuracion'
  ] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function registrar_auditoria()', t || '_auditoria', t);
  end loop;
end $$;

-- Al registrarse una cuenta en Supabase Auth se crea su perfil con el rol mínimo (consulta).
create or replace function crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre) values (new.id, coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger auth_crear_perfil after insert on auth.users for each row execute function crear_perfil();

-- ------------------------------------------------------------------ Validaciones de calidad de datos

create or replace function poner_alerta(p_tabla text, p_id uuid, p_regla text, p_severidad severidad_alerta, p_mensaje text, p_activa boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_activa then
    insert into alertas_calidad (tabla, registro_id, regla, severidad, mensaje)
    values (p_tabla, p_id, p_regla, p_severidad, p_mensaje)
    on conflict (tabla, registro_id, regla) do update
      set mensaje = excluded.mensaje, severidad = excluded.severidad,
          resuelta = alertas_calidad.resuelta and alertas_calidad.mensaje = excluded.mensaje;
  else
    -- La condición ya no se cumple: la alerta sin resolver desaparece.
    delete from alertas_calidad where tabla = p_tabla and registro_id = p_id and regla = p_regla and not resuelta;
  end if;
end $$;

-- Revisa un predio completo. Se llama sola al cambiar el predio o sus áreas de fuente.
create or replace function validar_predio(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p predios%rowtype;
  minimo numeric;
  maximo numeric;
  fuentes text;
begin
  select * into p from predios where id = p_id;
  if not found then return; end if;

  perform poner_alerta('predios', p_id, 'area_conservacion_mayor', 'error',
    format('El área en conservación (%s ha) es mayor que el área total (%s ha).', p.area_conservacion_ha, p.area_total_ha),
    p.area_conservacion_ha > p.area_total_ha);

  -- Un área 10.000 veces mayor o menor que la del polígono suele ser m² escritos como ha (o al revés).
  perform poner_alerta('predios', p_id, 'unidades_sospechosas', 'advertencia',
    format('El área total registrada (%s ha) y la del polígono (%s ha) difieren miles de veces: revise si se escribieron m² en lugar de ha.', p.area_total_ha, p.area_poligono_ha),
    p.area_poligono_ha > 0 and p.area_total_ha > 0 and (p.area_total_ha / p.area_poligono_ha > 1000 or p.area_poligono_ha / p.area_total_ha > 1000));

  perform poner_alerta('predios', p_id, 'area_difiere_poligono', 'advertencia',
    format('El área total registrada (%s ha) difiere más de 10 %% de la del polígono (%s ha).', p.area_total_ha, p.area_poligono_ha),
    p.area_poligono_ha > 0 and p.area_total_ha > 0
      and abs(p.area_total_ha - p.area_poligono_ha) / p.area_poligono_ha between 0.10 and 1000);

  -- Fuentes que no coinciden entre sí para el mismo concepto.
  select min(valor_ha), max(valor_ha), string_agg(format('%s: %s ha', fuente, round(valor_ha, 4)), '; ' order by valor_ha)
    into minimo, maximo, fuentes
  from predio_areas_fuente where predio_id = p_id and concepto = 'total';
  perform poner_alerta('predios', p_id, 'area_total_fuentes_inconsistentes', 'advertencia',
    'Las fuentes dan áreas totales distintas: ' || coalesce(fuentes, ''),
    maximo > 0 and (maximo - minimo) / maximo > 0.02);

  perform poner_alerta('predios', p_id, 'sin_titular', 'advertencia', 'El predio no tiene titulares registrados.',
    not exists (select 1 from predio_titulares where predio_id = p_id));

  perform poner_alerta('predios', p_id, 'escritura_futura', 'error', 'La fecha de la escritura es posterior a hoy.',
    p.escritura_fecha > current_date);
end $$;

create or replace function predio_validar_trg() returns trigger language plpgsql as $$
begin
  -- Se lee del JSON de la fila porque el nombre de la columna cambia según la tabla que dispara.
  perform validar_predio((to_jsonb(coalesce(new, old)) ->> case tg_table_name when 'predios' then 'id' else 'predio_id' end)::uuid);
  return null;
end $$;
create trigger predios_validar after insert or update on predios for each row execute function predio_validar_trg();
create trigger predio_areas_validar after insert or update or delete on predio_areas_fuente for each row execute function predio_validar_trg();
create trigger predio_titulares_validar after insert or delete on predio_titulares for each row execute function predio_validar_trg();

create or replace function validar_acuerdo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  a acuerdos%rowtype;
  p predios%rowtype;
  c convenios%rowtype;
begin
  select * into a from acuerdos where id = p_id;
  if not found then return; end if;
  select * into p from predios where id = a.predio_id;
  select * into c from convenios where id = a.convenio_id;

  perform poner_alerta('acuerdos', p_id, 'area_mayor_que_predio', 'error',
    format('El área del acuerdo (%s ha) supera el área total del predio (%s ha).', a.area_ha, p.area_total_ha),
    a.area_ha > p.area_total_ha);
  perform poner_alerta('acuerdos', p_id, 'firma_posterior_inicio', 'advertencia', 'La fecha de firma es posterior a la fecha de inicio.',
    a.fecha_firma > a.fecha_inicio);
  perform poner_alerta('acuerdos', p_id, 'fuera_del_convenio', 'advertencia',
    format('El acuerdo empieza antes del inicio del convenio %s (%s).', c.numero, c.fecha_inicio),
    a.fecha_inicio < c.fecha_inicio);
  perform poner_alerta('acuerdos', p_id, 'beneficiario_no_titular', 'advertencia', 'El beneficiario del acuerdo no figura como titular del predio.',
    not exists (select 1 from predio_titulares where predio_id = a.predio_id and beneficiario_id = a.beneficiario_id));
end $$;

create or replace function acuerdo_validar_trg() returns trigger language plpgsql as $$
begin
  perform validar_acuerdo(new.id);
  return null;
end $$;
create trigger acuerdos_validar after insert or update on acuerdos for each row execute function acuerdo_validar_trg();

-- ------------------------------------------------------------------ Vistas y funciones de consulta

-- Fin real de un acuerdo: la última prórroga o, si no hay, la vigencia inicial.
create or replace view acuerdos_vigencia with (security_invoker = true) as
select a.*,
       coalesce((select max(nueva_fecha_fin) from acuerdo_prorrogas pr where pr.acuerdo_id = a.id), a.fecha_fin) as fecha_fin_efectiva,
       (select count(*) from acuerdo_prorrogas pr where pr.acuerdo_id = a.id) as prorrogas
from acuerdos a
where a.eliminado_en is null;

-- Acuerdos activos que vencen en los próximos 90 días o ya vencieron.
create or replace view acuerdos_por_vencer with (security_invoker = true) as
select v.*, v.fecha_fin_efectiva - current_date as dias_restantes
from acuerdos_vigencia v
where v.estado = 'activo' and v.fecha_fin_efectiva <= current_date + 90;

-- Indicadores del tablero.
create or replace view tablero_indicadores with (security_invoker = true) as
select
  (select coalesce(sum(area_ha), 0) from acuerdos where estado = 'activo' and eliminado_en is null) as hectareas_psa,
  (select count(distinct beneficiario_id) from acuerdos where estado = 'activo' and eliminado_en is null) as beneficiarios_activos,
  (select count(*) from predios where eliminado_en is null) as predios,
  (select coalesce(sum(valor_pagado), 0) from pagos where estado = 'pagado' and eliminado_en is null) as inversion_acumulada,
  (select coalesce(sum(valor_programado), 0) from pagos where estado = 'pendiente' and eliminado_en is null) as pagos_pendientes_valor,
  (select count(*) from pagos where estado = 'pendiente' and eliminado_en is null) as pagos_pendientes,
  (select count(*) from acuerdos_por_vencer) as acuerdos_por_vencer,
  (select count(*) from alertas_calidad where not resuelta) as alertas_calidad;

create or replace view indicadores_territorio with (security_invoker = true) as
select p.departamento, p.municipio, p.vereda,
       count(distinct p.id) as predios,
       count(distinct a.id) filter (where a.estado = 'activo') as acuerdos_activos,
       coalesce(sum(a.area_ha) filter (where a.estado = 'activo'), 0) as hectareas_psa
from predios p
left join acuerdos a on a.predio_id = p.id and a.eliminado_en is null
where p.eliminado_en is null
group by p.departamento, p.municipio, p.vereda;

create or replace view indicadores_vigencia with (security_invoker = true) as
select vigencia,
       sum(valor_programado) as programado,
       coalesce(sum(valor_pagado) filter (where estado = 'pagado'), 0) as pagado,
       count(*) filter (where estado = 'pendiente') as cuotas_pendientes
from pagos where eliminado_en is null
group by vigencia;

-- Traslapes de un predio con las capas de referencia y con otros predios (hectáreas compartidas).
create or replace function traslapes_predio(p_id uuid)
returns table (categoria text, nombre text, area_ha numeric)
language sql stable as $$
  select c.categoria, c.nombre, round((st_area(st_intersection(p.geom, c.geom)::geography) / 10000)::numeric, 4)
  from predios p join capas_referencia c on st_intersects(p.geom, c.geom)
  where p.id = p_id
  union all
  select 'otro_predio', o.nombre, round((st_area(st_intersection(p.geom, o.geom)::geography) / 10000)::numeric, 4)
  from predios p join predios o on o.id <> p.id and o.eliminado_en is null and st_intersects(p.geom, o.geom)
  where p.id = p_id and st_area(st_intersection(p.geom, o.geom)::geography) > 1
$$;

-- Porcentaje de completitud del expediente de un acuerdo: documentos obligatorios recibidos y vigentes
-- (del acuerdo, de su predio y de su beneficiario) sobre los que exigen las listas de chequeo que le aplican.
create or replace function completitud_acuerdo(p_acuerdo uuid)
returns table (exigidos integer, cumplidos integer, porcentaje numeric)
language sql stable as $$
  with a as (
    select ac.id, ac.predio_id, ac.beneficiario_id, ac.modalidad, b.tipo
    from acuerdos ac join beneficiarios b on b.id = ac.beneficiario_id where ac.id = p_acuerdo
  ), exigidos as (
    select distinct i.tipo_documento_id, l.ambito
    from a
    join listas_chequeo l on l.activa and (l.modalidad is null or l.modalidad = a.modalidad)
      and (l.tipo_beneficiario is null or l.tipo_beneficiario = a.tipo)
    join lista_chequeo_items i on i.lista_id = l.id and i.obligatorio
  ), cumplidos as (
    select e.tipo_documento_id
    from exigidos e, a
    where exists (
      select 1 from documentos d
      where d.tipo_id = e.tipo_documento_id and d.estado = 'recibido' and d.eliminado_en is null
        and (d.fecha_vencimiento is null or d.fecha_vencimiento >= current_date)
        and ((e.ambito = 'acuerdo' and d.acuerdo_id = a.id) or (e.ambito = 'predio' and d.predio_id = a.predio_id)
          or (e.ambito = 'beneficiario' and d.beneficiario_id = a.beneficiario_id))
    )
  )
  select (select count(*) from exigidos)::integer, (select count(*) from cumplidos)::integer,
         case when (select count(*) from exigidos) = 0 then 0
              else round(100.0 * (select count(*) from cumplidos) / (select count(*) from exigidos), 1) end
$$;

-- ------------------------------------------------------------------ Seguridad por rol (RLS)
--
--   administrador      todo, incluidos usuarios y configuración
--   coordinador        todo lo de negocio; no administra usuarios
--   financiero         lee todo; escribe pagos y cuentas bancarias
--   funcionario_campo  lee solo sus predios asignados y lo relacionado; escribe sus visitas y fotos
--   consulta           solo lectura, sin cuentas bancarias ni solicitudes con datos personales

do $$
declare t text;
begin
  foreach t in array array[
    'perfiles', 'convenios', 'beneficiarios', 'beneficiario_cuentas', 'consentimientos', 'zonas_conservacion', 'capas_referencia',
    'predios', 'predio_titulares', 'predio_areas_fuente', 'predio_asignaciones', 'acuerdos', 'acuerdo_prorrogas', 'pagos',
    'costo_oportunidad', 'ipc_anual', 'metodologias_calculo', 'proyecciones', 'proyeccion_predios', 'proyeccion_referencias',
    'proyeccion_versiones', 'tipos_documento', 'documentos', 'listas_chequeo', 'lista_chequeo_items', 'diagnosticos',
    'diagnostico_especies', 'visitas_campo', 'visita_fotos', 'alertas_calidad', 'auditoria', 'respaldos', 'configuracion'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;

  -- Catálogos y datos generales: los lee cualquier usuario activo; los editan administrador y coordinador.
  foreach t in array array[
    'convenios', 'zonas_conservacion', 'capas_referencia', 'costo_oportunidad', 'ipc_anual', 'metodologias_calculo',
    'tipos_documento', 'listas_chequeo', 'lista_chequeo_items', 'acuerdo_prorrogas'
  ] loop
    execute format('create policy lectura on %I for select to authenticated using (rol_actual() is not null)', t);
    execute format($p$create policy edicion on %I for all to authenticated using (tiene_rol('administrador', 'coordinador')) with check (tiene_rol('administrador', 'coordinador'))$p$, t);
  end loop;

  -- Solo oficina (no campo): los editan administrador y coordinador.
  foreach t in array array['consentimientos', 'alertas_calidad'] loop
    execute format($p$create policy lectura on %I for select to authenticated using (tiene_rol('administrador', 'coordinador', 'financiero', 'consulta'))$p$, t);
    execute format($p$create policy edicion on %I for all to authenticated using (tiene_rol('administrador', 'coordinador')) with check (tiene_rol('administrador', 'coordinador'))$p$, t);
  end loop;

  -- Proyecciones y solicitudes: tienen datos personales de terceros; consulta y campo no las ven.
  foreach t in array array['proyecciones', 'proyeccion_predios', 'proyeccion_referencias', 'proyeccion_versiones'] loop
    execute format($p$create policy lectura on %I for select to authenticated using (tiene_rol('administrador', 'coordinador', 'financiero'))$p$, t);
    execute format($p$create policy edicion on %I for all to authenticated using (tiene_rol('administrador', 'coordinador')) with check (tiene_rol('administrador', 'coordinador'))$p$, t);
  end loop;
end $$;

-- ¿El predio está asignado a quien consulta? (para el funcionario de campo)
create or replace function predio_asignado(p_predio uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from predio_asignaciones where predio_id = p_predio and funcionario_id = auth.uid())
$$;

create or replace function es_oficina() returns boolean language sql stable as $$
  select tiene_rol('administrador', 'coordinador', 'financiero', 'consulta')
$$;

-- Perfiles
create policy lectura on perfiles for select to authenticated using (rol_actual() is not null);
create policy admin on perfiles for all to authenticated using (tiene_rol('administrador')) with check (tiene_rol('administrador'));

-- Predios y lo que cuelga de ellos
create policy lectura on predios for select to authenticated using (es_oficina() or predio_asignado(id));
create policy edicion on predios for all to authenticated using (tiene_rol('administrador', 'coordinador')) with check (tiene_rol('administrador', 'coordinador'));

create policy lectura on predio_titulares for select to authenticated using (es_oficina() or predio_asignado(predio_id));
create policy edicion on predio_titulares for all to authenticated using (tiene_rol('administrador', 'coordinador')) with check (tiene_rol('administrador', 'coordinador'));

create policy lectura on predio_areas_fuente for select to authenticated using (es_oficina() or predio_asignado(predio_id));
create policy edicion on predio_areas_fuente for all to authenticated using (tiene_rol('administrador', 'coordinador')) with check (tiene_rol('administrador', 'coordinador'));

create policy lectura on predio_asignaciones for select to authenticated using (es_oficina() or funcionario_id = auth.uid());
create policy edicion on predio_asignaciones for all to authenticated using (tiene_rol('administrador', 'coordinador')) with check (tiene_rol('administrador', 'coordinador'));

-- Beneficiarios: el funcionario de campo ve solo los titulares de sus predios asignados.
create policy lectura on beneficiarios for select to authenticated using (
  es_oficina() or exists (select 1 from predio_titulares pt where pt.beneficiario_id = beneficiarios.id and predio_asignado(pt.predio_id))
);
create policy edicion on beneficiarios for all to authenticated using (tiene_rol('administrador', 'coordinador')) with check (tiene_rol('administrador', 'coordinador'));

-- Cuentas bancarias: dato sensible.
create policy lectura on beneficiario_cuentas for select to authenticated using (tiene_rol('administrador', 'coordinador', 'financiero'));
create policy edicion on beneficiario_cuentas for all to authenticated using (tiene_rol('administrador', 'coordinador', 'financiero')) with check (tiene_rol('administrador', 'coordinador', 'financiero'));

-- Acuerdos
create policy lectura on acuerdos for select to authenticated using (es_oficina() or predio_asignado(predio_id));
create policy edicion on acuerdos for all to authenticated using (tiene_rol('administrador', 'coordinador')) with check (tiene_rol('administrador', 'coordinador'));

-- Pagos: los registra el área financiera.
create policy lectura on pagos for select to authenticated using (es_oficina());
create policy edicion on pagos for all to authenticated using (tiene_rol('administrador', 'coordinador', 'financiero')) with check (tiene_rol('administrador', 'coordinador', 'financiero'));

-- Documentos
create policy lectura on documentos for select to authenticated using (es_oficina() or (predio_id is not null and predio_asignado(predio_id)));
create policy edicion on documentos for all to authenticated using (tiene_rol('administrador', 'coordinador')) with check (tiene_rol('administrador', 'coordinador'));

-- Diagnósticos
create policy lectura on diagnosticos for select to authenticated using (es_oficina() or predio_asignado(predio_id));
create policy edicion on diagnosticos for all to authenticated using (tiene_rol('administrador', 'coordinador')) with check (tiene_rol('administrador', 'coordinador'));
create policy lectura on diagnostico_especies for select to authenticated using (
  exists (select 1 from diagnosticos d where d.id = diagnostico_id and (es_oficina() or predio_asignado(d.predio_id)))
);
create policy edicion on diagnostico_especies for all to authenticated using (tiene_rol('administrador', 'coordinador')) with check (tiene_rol('administrador', 'coordinador'));

-- Visitas de campo: el funcionario crea y edita las suyas, sobre predios que tiene asignados.
create policy lectura on visitas_campo for select to authenticated using (es_oficina() or funcionario_id = auth.uid());
create policy campo_crea on visitas_campo for insert to authenticated with check (
  tiene_rol('administrador', 'coordinador') or (tiene_rol('funcionario_campo') and funcionario_id = auth.uid() and predio_asignado(predio_id))
);
create policy campo_edita on visitas_campo for update to authenticated
  using (tiene_rol('administrador', 'coordinador') or (tiene_rol('funcionario_campo') and funcionario_id = auth.uid()))
  with check (tiene_rol('administrador', 'coordinador') or (tiene_rol('funcionario_campo') and funcionario_id = auth.uid()));
create policy oficina_borra on visitas_campo for delete to authenticated using (tiene_rol('administrador', 'coordinador'));

create policy lectura on visita_fotos for select to authenticated using (
  exists (select 1 from visitas_campo v where v.id = visita_id and (es_oficina() or v.funcionario_id = auth.uid()))
);
create policy edicion on visita_fotos for all to authenticated
  using (tiene_rol('administrador', 'coordinador') or exists (select 1 from visitas_campo v where v.id = visita_id and v.funcionario_id = auth.uid()))
  with check (tiene_rol('administrador', 'coordinador') or exists (select 1 from visitas_campo v where v.id = visita_id and v.funcionario_id = auth.uid()));

-- Bitácora, respaldos y configuración: solo lectura para quien coordina; nadie edita la bitácora desde la app.
create policy lectura on auditoria for select to authenticated using (tiene_rol('administrador', 'coordinador'));
create policy lectura on respaldos for select to authenticated using (tiene_rol('administrador', 'coordinador'));
create policy lectura on configuracion for select to authenticated using (rol_actual() is not null);
create policy admin on configuracion for all to authenticated using (tiene_rol('administrador')) with check (tiene_rol('administrador'));
