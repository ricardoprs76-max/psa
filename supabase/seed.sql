-- Datos de ejemplo (ficticios): "Predio Ejemplo" (Paipa, Boyacá), convenio CNV 2025-012.
-- Las áreas de la fuente se contradicen a propósito: sirven para probar las validaciones de calidad.

insert into convenios (id, numero, entidad_contratante, operador, objeto, estado, observaciones) values
  ('00000000-0000-4000-8000-000000000001', 'CNV 2025-012', 'Corporación Autónoma Regional de Boyacá – Corpoboyacá',
   'Corporación Masbosques', '[PENDIENTE: objeto del convenio]', 'vigente', 'Fechas y valor por confirmar con el texto del convenio.');

insert into beneficiarios (id, tipo, nombre, tipo_documento, numero_documento, digito_verificacion,
  representante_nombre, representante_documento, representante_cargo,
  personeria_resolucion, personeria_fecha, personeria_entidad, municipio, departamento) values
  ('00000000-0000-4000-8000-000000000002', 'jac', 'Junta de Acción Comunal Vereda Ejemplo', 'NIT', '900000000', 0,
   'Nombre Apellido Ejemplo', '1000000000', 'Presidente',
   'Resolución 000', '2000-01-01', 'Gobernación de Boyacá', 'Paipa', 'Boyacá');

insert into predios (id, nombre, fmi, codigo_catastral, vereda, municipio, departamento, altitud_min, altitud_max,
  area_total_ha, area_conservacion_ha, escritura_numero, escritura_fecha, escritura_notaria,
  clasificacion_pot, ecosistema_estrategico, uso_permitido, uso_prohibido, infraestructura, regimen_tenencia) values
  ('00000000-0000-4000-8000-000000000003', 'Predio Ejemplo', '000-12345', '000000000000000000000000000000', 'Vereda Ejemplo', 'Paipa', 'Boyacá',
   3089, 3174, 1.114, 1.09, '000', '2000-01-01', 'Notaría Única de Paipa',
   'Área de Conservación y Protección Ambiental del Páramo Guantiva–La Rusia', 'Páramo',
   'Obras de captación y fomento forestal protector', 'Actividad agropecuaria',
   'Bocatoma y tanques del Acueducto Ejemplo', 'propietario');

insert into predio_titulares (predio_id, beneficiario_id, tenencia, porcentaje, principal) values
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'propietario', 100, true);

insert into predio_areas_fuente (predio_id, concepto, fuente, valor, unidad) values
  ('00000000-0000-4000-8000-000000000003', 'total', 'Documento fuente (m²)', 10285.77, 'm2'),
  ('00000000-0000-4000-8000-000000000003', 'total', 'Documento fuente (ha)', 1.114, 'ha'),
  ('00000000-0000-4000-8000-000000000003', 'conservacion', 'Documento fuente', 1.09, 'ha');

-- Tipos de documento y lista de chequeo base
insert into tipos_documento (codigo, nombre, ambito, vigencia_dias) values
  ('CEDULA', 'Cédula de ciudadanía', 'beneficiario', null),
  ('CERL', 'Certificado de existencia y representación legal', 'beneficiario', 30),
  ('RUT', 'Registro Único Tributario (RUT)', 'beneficiario', null),
  ('CERT_BANCARIA', 'Certificación bancaria', 'beneficiario', 90),
  ('CTL', 'Certificado de tradición y libertad', 'predio', 30),
  ('ESCRITURA', 'Escritura pública', 'predio', null),
  ('USO_SUELO', 'Concepto de uso del suelo', 'predio', null),
  ('DIAGNOSTICO', 'Diagnóstico del predio (F-RE-08)', 'predio', null),
  ('ACUERDO', 'Acuerdo firmado', 'acuerdo', null),
  ('PLAN_MANEJO', 'Plan de manejo', 'acuerdo', null),
  ('ACTA_VISITA', 'Acta de visita', 'acuerdo', null),
  ('SOPORTE_PAGO', 'Soporte de pago', 'acuerdo', null);

insert into listas_chequeo (id, nombre, ambito, tipo_beneficiario) values
  ('00000000-0000-4000-8000-000000000010', 'Beneficiario · persona natural', 'beneficiario', 'persona_natural'),
  ('00000000-0000-4000-8000-000000000011', 'Beneficiario · persona jurídica (JAC)', 'beneficiario', 'jac'),
  ('00000000-0000-4000-8000-000000000012', 'Predio', 'predio', null),
  ('00000000-0000-4000-8000-000000000013', 'Acuerdo', 'acuerdo', null);

insert into lista_chequeo_items (lista_id, tipo_documento_id, orden)
select l.id, t.id, x.orden
from (values
  ('00000000-0000-4000-8000-000000000010'::uuid, 'CEDULA', 1), ('00000000-0000-4000-8000-000000000010', 'RUT', 2),
  ('00000000-0000-4000-8000-000000000010', 'CERT_BANCARIA', 3),
  ('00000000-0000-4000-8000-000000000011', 'CERL', 1), ('00000000-0000-4000-8000-000000000011', 'CEDULA', 2),
  ('00000000-0000-4000-8000-000000000011', 'RUT', 3), ('00000000-0000-4000-8000-000000000011', 'CERT_BANCARIA', 4),
  ('00000000-0000-4000-8000-000000000012', 'CTL', 1), ('00000000-0000-4000-8000-000000000012', 'ESCRITURA', 2),
  ('00000000-0000-4000-8000-000000000012', 'USO_SUELO', 3), ('00000000-0000-4000-8000-000000000012', 'DIAGNOSTICO', 4),
  ('00000000-0000-4000-8000-000000000013', 'ACUERDO', 1), ('00000000-0000-4000-8000-000000000013', 'PLAN_MANEJO', 2),
  ('00000000-0000-4000-8000-000000000013', 'ACTA_VISITA', 3), ('00000000-0000-4000-8000-000000000013', 'SOPORTE_PAGO', 4)
) as x (lista, codigo, orden)
join listas_chequeo l on l.id = x.lista
join tipos_documento t on t.codigo = x.codigo;
