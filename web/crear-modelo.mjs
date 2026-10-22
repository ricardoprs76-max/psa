// Crea un expediente MODELO (datos simulados) con todas las secciones diligenciadas: convenio, beneficiario con cuenta y
// consentimiento, predio con polígono, titulares, áreas y asignación, acuerdo con prórroga y pagos, documentos del
// expediente (PDF de muestra en Drive), diagnóstico con especies y una visita de campo.
// Uso: set DATABASE_URL, PSA_NUBE_URL, PSA_NUBE_TOKEN  y  node crear-modelo.mjs
import crypto from "node:crypto";
import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = async (s, p) => (await c.query(s, p)).rows;
const M = "(MODELO)";
const NOTA = "Registro MODELO con datos simulados, creado como ejemplo de diligenciamiento. No corresponde a un beneficiario real.";
const id = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`;

if ((await q("select 1 from beneficiarios where id = $1", [id(2)])).length) { console.log("El modelo ya existe; no se crea de nuevo."); await c.end(); process.exit(0); }
const admin = (await q("select p.id, p.nombre from perfiles p where p.rol = 'administrador' and p.activo order by p.creado_en limit 1"))[0];
await q("select set_config('request.jwt.claim.sub', $1, false)", [admin.id]);
const tipoGeom = Object.fromEntries((await q("select f_table_name t, f_geometry_column c, type from geometry_columns where f_table_schema = 'public'")).map((r) => [`${r.t}.${r.c}`, r.type]));
const geom = (tabla, wkt) => (String(tipoGeom[tabla]).toUpperCase().startsWith("MULTI") ? `st_multi(st_geomfromtext('${wkt}', 4326))` : `st_geomfromtext('${wkt}', 4326)`);

// PDF de una página con unas líneas de texto (sin acentos, para no depender de fuentes).
function pdf(lineas) {
  const txt = lineas.map((l, i) => `BT /F1 ${i ? 11 : 15} Tf 60 ${760 - i * 22} Td (${l.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/[()\\]/g, "")}) Tj ET`).join("\n");
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${txt.length} >>\nstream\n${txt}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let s = "%PDF-1.4\n"; const pos = [];
  objs.forEach((o, i) => { pos.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, "latin1");
}
async function aDrive(ruta, datos) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(process.env.PSA_NUBE_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ token: process.env.PSA_NUBE_TOKEN, accion: "escribir", ruta: `archivos/${ruta}`, base64: datos.toString("base64") }) });
      const j = await r.json();
      if (j.ok) return;
      throw new Error(j.error);
    } catch (e) { if (i === 3) throw e; await new Promise((r) => setTimeout(r, 3000)); }
  }
}

const hoy = new Date().toISOString().slice(0, 10);
const POL_PREDIO = "POLYGON((-73.1512 5.8302, -73.1474 5.8306, -73.1466 5.8279, -73.1489 5.8262, -73.1516 5.8274, -73.1512 5.8302))";
const POL_ZONA = "POLYGON((-73.160 5.836, -73.139 5.838, -73.134 5.822, -73.148 5.814, -73.163 5.821, -73.160 5.836))";
const subidos = [];

await c.query("begin");
try {
  await q(`insert into zonas_conservacion (id, nombre, tipo, cuenca, acueducto, ecosistema, prioridad, observaciones, geom)
           values ($1, $2, 'Microcuenca abastecedora', 'Río Chicamocha – quebrada La Esperanza', 'Acueducto La Esperanza', 'Bosque altoandino y subpáramo', 5, $3, ${geom("zonas_conservacion.geom", POL_ZONA)})`,
    [id(20), `Microcuenca La Esperanza ${M}`, NOTA]);
  await q(`insert into ipc_anual (anio, variacion_pct, es_proyectado, fuente) values (2024, 5.20, false, 'DANE (valor de ejemplo ${M})'), (2025, 5.10, false, 'DANE (valor de ejemplo ${M})'), (2026, 4.00, true, 'Proyección de ejemplo ${M}') on conflict (anio) do nothing`);
  await q(`insert into costo_oportunidad (id, zona_id, uso_suelo, aplicacion, valor_ha_anio, justificacion, fuente, fecha_calculo, anio_base, version, vigente_desde, reajuste_ipc, estado)
           values ($1, $2, 'Ganadería extensiva de doble propósito', 'aplica', 850000, $3, 'Estudio de costos de ejemplo ${M}', '2026-01-15', 2026, 1, '2026-01-15', true, 'vigente')`,
    [id(21), id(20), `Valor simulado para el ejemplo. ${NOTA}`]);

  await q(`insert into convenios (id, numero, estado, entidad_contratante, operador, objeto, proyecto_marco, fecha_inicio, fecha_fin, valor, observaciones)
           values ($1, $2, 'vigente', 'Corporación Autónoma Regional de Boyacá – Corpoboyacá', 'Corporación Masbosques', $3, 'Esquema de Pago por Servicios Ambientales para la protección de fuentes abastecedoras', '2026-01-15', '2027-12-31', 480000000, $4)`,
    [id(1), `CNV MODELO-001`, "Aunar esfuerzos técnicos, administrativos y financieros para implementar el esquema de Pago por Servicios Ambientales en áreas de importancia estratégica para la conservación del recurso hídrico.", NOTA]);

  await q(`insert into beneficiarios (id, tipo, nombre, tipo_documento, numero_documento, digito_verificacion, representante_nombre, representante_documento, representante_cargo,
             personeria_resolucion, personeria_fecha, personeria_entidad, telefono, correo, direccion, municipio, departamento, observaciones)
           values ($1, 'asociacion_acueducto', $2, 'NIT', '900000001', 2, 'María Fernanda Rojas Cárdenas', '1000000001', 'Representante legal',
             'Resolución 0123 de 2008', '2008-03-14', 'Gobernación de Boyacá', '3100000000', 'acueducto.modelo@ejemplo.co', 'Salón comunal, vereda La Esperanza', 'Paipa', 'Boyacá', $3)`,
    [id(2), `Asociación de Suscriptores del Acueducto La Esperanza ${M}`, NOTA]);
  await q(`insert into beneficiario_cuentas (id, beneficiario_id, banco, tipo_cuenta, numero, titular, titular_documento, principal)
           values ($1, $2, 'Banco Agrario de Colombia', 'ahorros', '4-150-00-00000-1', $3, '900000001-2', true)`, [id(3), id(2), `Asociación de Suscriptores del Acueducto La Esperanza ${M}`]);
  await q(`insert into consentimientos (id, beneficiario_id, version_politica, fecha, medio, registrado_por) values ($1, $2, 'Política de tratamiento de datos v1 (Ley 1581 de 2012)', $3, 'Formato físico firmado', $4)`, [id(4), id(2), hoy, admin.id]);

  await q(`insert into predios (id, nombre, fmi, codigo_catastral, vereda, municipio, departamento, altitud_min, altitud_max, area_total_ha, area_conservacion_ha, zona_id,
             escritura_numero, escritura_fecha, escritura_notaria, regimen_tenencia, clasificacion_pot, ecosistema_estrategico, infraestructura, uso_permitido, uso_prohibido,
             situacion_juridica, alertas_juridicas, observaciones, geom)
           values ($1, $2, '074-00001', '155160001000000010001000000000', 'La Esperanza', 'Paipa', 'Boyacá', 2950, 3120, 14.5, 11.8, $3,
             '250', '2004-08-19', 'Notaría Única de Paipa', 'propietario', 'Suelo rural de protección – área de recarga hídrica según el PBOT', 'Bosque altoandino', 'Bocatoma, tanque desarenador y cerca de aislamiento',
             'Conservación, restauración ecológica e investigación', 'Ganadería, cultivos y tala',
             'Predio saneado, sin gravámenes ni limitaciones al dominio según el certificado de tradición.', 'Ninguna a la fecha.', $4, ${geom("predios.geom", POL_PREDIO)})`,
    [id(5), `Finca La Esperanza ${M}`, id(20), NOTA]);
  await q(`insert into predio_titulares (id, predio_id, beneficiario_id, tenencia, porcentaje, principal) values ($1, $2, $3, 'propietario', 100, true)`, [id(6), id(5), id(2)]);
  await q(`insert into predio_areas_fuente (predio_id, concepto, fuente, valor, unidad) values
             ($1, 'total', 'Escritura pública 250 de 2004', 14.5, 'ha'), ($1, 'total', 'Certificado de tradición y libertad', 145000, 'm2'), ($1, 'conservacion', 'Levantamiento topográfico 2026', 11.8, 'ha')`, [id(5)]);
  await q(`insert into predio_asignaciones (id, predio_id, funcionario_id) values ($1, $2, $3)`, [id(7), id(5), admin.id]);

  await q(`insert into acuerdos (id, codigo, convenio_id, beneficiario_id, predio_id, modalidad, fecha_firma, fecha_inicio, fecha_fin, area_ha, valor_ha_anio, valor_total, periodicidad, estado, compromisos, observaciones)
           values ($1, 'ACU-MODELO-001', $2, $3, $4, 'hidrico', '2026-02-10', '2026-03-01', '2027-02-28', 11.8, 850000, 10030000, 'semestral', 'activo',
             'Mantener el aislamiento de las 11,8 ha en conservación; no realizar tala, quema ni ingreso de ganado; permitir las visitas de seguimiento; reportar cualquier afectación a la cobertura.', $5)`,
    [id(8), id(1), id(2), id(5), NOTA]);
  await q(`insert into acuerdo_prorrogas (id, acuerdo_id, numero, fecha_firma, nueva_fecha_fin, valor_adicional, observaciones) values ($1, $2, 1, '2026-09-15', '2027-08-31', 5015000, $3)`, [id(9), id(8), `Prórroga de seis meses. ${NOTA}`]);
  await q(`insert into pagos (id, acuerdo_id, vigencia, numero_cuota, estado, valor_programado, fecha_programada, valor_pagado, fecha_pago, retenciones, fuente_recursos, observaciones) values
             ($1, $4, 2026, 1, 'pagado', 5015000, '2026-06-30', 5015000, '2026-07-03', 0, 'Recursos del convenio CNV MODELO-001', $5),
             ($2, $4, 2026, 2, 'pendiente', 5015000, '2026-12-31', null, null, 0, 'Recursos del convenio CNV MODELO-001', $5),
             ($3, $4, 2027, 3, 'pendiente', 5015000, '2027-06-30', null, null, 0, 'Recursos de la prórroga 1', $5)`, [id(10), id(11), id(12), id(8), NOTA]);

  // Documentos de los tres expedientes: un PDF de muestra por cada tipo de documento.
  const tipos = await q("select id, codigo, nombre, ambito::text as ambito, vigencia_dias from tipos_documento where activo");
  for (const t of tipos) {
    const destino = t.ambito === "beneficiario" ? id(2) : t.ambito === "predio" ? id(5) : id(8);
    const nombre = `${t.codigo}_MODELO.pdf`;
    const ruta = `documentos/${t.ambito}/${destino}/${crypto.randomUUID().slice(0, 8)}_${nombre}`;
    await aDrive(ruta, pdf([`${t.nombre} - DOCUMENTO DE MUESTRA`, "Sistema PSA - expediente MODELO con datos simulados.", "Este archivo solo ilustra como queda un documento cargado en el expediente.", `Expediente: ${t.ambito}`, `Fecha: ${hoy}`]));
    subidos.push(ruta);
    await q(`insert into documentos (tipo_id, ${t.ambito}_id, archivo_ruta, archivo_nombre, version, estado, fecha_emision, fecha_vencimiento, verificado_por, verificado_en, observaciones, creado_por)
             values ($1, $2, $3, $4, 1, 'recibido', $5::date, case when $6::int is null then null else $5::date + $6::int end, $7, now(), 'Documento de muestra (MODELO).', $7)`,
      [t.id, destino, ruta, nombre, hoy, t.vigencia_dias, admin.id]);
  }

  await q(`insert into diagnosticos (id, predio_id, acuerdo_id, formato_codigo, formato_version, formato_fecha, elaboro, elaboro_fecha, reviso, reviso_fecha, aprobo, aprobo_fecha,
             antecedentes_legales, identificacion_juridica, area_estudio, contexto_ecosistemico, uso_suelo, importancia_ambiental, potencial_conservacion, estado, creado_por)
           values ($1, $2, $3, 'F-RE-08', '1', '2026-01-10', 'Profesional de campo (MODELO)', '2026-02-20', 'Coordinación técnica (MODELO)', '2026-02-25', 'Supervisión del convenio (MODELO)', '2026-02-28',
             'Decreto Ley 870 de 2017 y Decreto 1007 de 2018, que reglamentan el Pago por Servicios Ambientales; artículo 111 de la Ley 99 de 1993 sobre áreas de importancia estratégica para acueductos.',
             'Predio Finca La Esperanza (MODELO), matrícula 074-00001, de propiedad de la asociación de suscriptores del acueducto, adquirido por escritura pública 250 de 2004 de la Notaría Única de Paipa.',
             'El predio se localiza en la vereda La Esperanza del municipio de Paipa, entre los 2.950 y 3.120 msnm, en la parte alta de la microcuenca de la quebrada La Esperanza.',
             'Bosque altoandino en transición a subpáramo, con nacimientos y zonas de recarga que alimentan la bocatoma del acueducto veredal.',
             'Del total de 14,5 ha, 11,8 ha están en cobertura natural en conservación y 2,7 ha en pastos en proceso de restauración pasiva.',
             'Abastece de agua a cerca de 180 familias suscriptoras; regula el caudal en época seca y sirve de hábitat y corredor para fauna altoandina.',
             'Alto: cobertura continua, aislamiento instalado y compromiso de la asociación con la protección de la fuente.', 'aprobado', $4)`,
    [id(13), id(5), id(8), admin.id]);
  await q(`insert into diagnostico_especies (diagnostico_id, grupo, nombre_comun, nombre_cientifico, familia, categoria_amenaza, orden) values
             ($1, 'flora', 'Encenillo', 'Weinmannia tomentosa', 'Cunoniaceae', 'Preocupación menor (LC)', 1),
             ($1, 'flora', 'Roble', 'Quercus humboldtii', 'Fagaceae', 'Vulnerable (VU)', 2),
             ($1, 'flora', 'Frailejón', 'Espeletia boyacensis', 'Asteraceae', 'Sin evaluar', 3),
             ($1, 'flora', 'Siete cueros', 'Andesanthus lepidotus', 'Melastomataceae', 'Preocupación menor (LC)', 4),
             ($1, 'fauna', 'Tigrillo lanudo', 'Leopardus tigrinus', 'Felidae', 'Vulnerable (VU)', 1),
             ($1, 'fauna', 'Colibrí chillón', 'Colibri coruscans', 'Trochilidae', 'Preocupación menor (LC)', 2),
             ($1, 'fauna', 'Zorro perruno', 'Cerdocyon thous', 'Canidae', 'Preocupación menor (LC)', 3)`, [id(13)]);

  await q(`insert into visitas_campo (id, predio_id, acuerdo_id, funcionario_id, fecha_hora, ubicacion, precision_m, altitud, cobertura, estado_conservacion, presiones, cumple_compromisos,
             cumplimiento_detalle, hallazgos, recomendaciones, firmante_nombre, firmante_documento, dispositivo_id, revision, estado_sincronizacion)
           values ($1, $2, $3, $4, '2026-09-18 09:30:00-05', st_setsrid(st_makepoint(-73.1491, 5.8284), 4326), 4.5, 3040, 'Bosque altoandino denso', 'Bueno', array['Ganado en predios vecinos'], true,
             'El aislamiento se encuentra completo y sin daños; no se observan tala, quema ni ingreso de ganado.',
             'Regeneración natural abundante en las 2,7 ha de pastos; la bocatoma opera con normalidad. Visita MODELO con datos simulados.',
             'Reforzar dos postes de la cerca en el lindero norte y mantener limpio el desarenador.', 'María Fernanda Rojas Cárdenas', '1000000001', 'modelo', 1, 'sincronizada')`,
    [id(14), id(5), id(8), admin.id]);
  await c.query("commit");
  console.log(`Modelo creado. Documentos de muestra en Drive: ${subidos.length}.`);
} catch (e) {
  await c.query("rollback");
  console.error("No se creó nada en la base:", e.message, e.detail ?? "", e.where ? `\n${String(e.where).slice(0, 300)}` : "");
  if (subidos.length) console.error(`Quedaron ${subidos.length} PDF de muestra en Drive (archivos/documentos); se pueden borrar.`);
  process.exitCode = 1;
}
for (const [t, w] of [["beneficiarios", id(2)], ["predios", id(5)], ["acuerdos", id(8)]]) console.log(t, (await q(`select count(*)::int n from ${t} where id = $1`, [w]))[0].n);
console.log("área del polígono del predio (ha):", (await q("select area_poligono_ha from predios where id = $1", [id(5)]))[0]?.area_poligono_ha, "| alertas de calidad nuevas:", (await q("select regla, mensaje from alertas_calidad where registro_id = any($1) and not resuelta", [[id(2), id(5), id(8)]])).map((a) => a.mensaje).join(" / ") || "ninguna");
await c.end();
