import "server-only";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { guardarArchivo, leerArchivo } from "./archivos";
import { numero } from "./calculo";
import { comoUsuario, q, q1, type Fila } from "./db";
import type { Usuario } from "./sesion";

/**
 * Diagnóstico del predio según el formato F-RE-08: genera el Word desde los datos registrados.
 * Con una plantilla "diagnostico" activa (Ajustes) se llena esa; si no, se arma un documento con las mismas secciones.
 */
const P = "[PENDIENTE]";
const t = (v: unknown) => (v === null || v === undefined || v === "" ? P : String(v));

async function datosDe(id: string) {
  const d = await q1<Fila>(
    `select d.*, d.formato_fecha::text as formato_fecha_t, d.elaboro_fecha::text as elaboro_fecha_t, d.reviso_fecha::text as reviso_fecha_t, d.aprobo_fecha::text as aprobo_fecha_t,
            to_jsonb(p) - 'geom' as predio from diagnosticos d join predios p on p.id = d.predio_id where d.id = $1`, [id]);
  if (!d) throw new Error("El diagnóstico no existe.");
  const titulares = await q<Fila>(
    `select b.nombre, b.tipo_documento::text as tipo_documento, b.numero_documento, b.digito_verificacion, b.representante_nombre, b.representante_documento, b.representante_cargo,
            b.personeria_resolucion, b.personeria_fecha::text as personeria_fecha, b.personeria_entidad, pt.tenencia::text as tenencia
     from predio_titulares pt join beneficiarios b on b.id = pt.beneficiario_id where pt.predio_id = $1 order by pt.principal desc`, [d.predio_id]);
  const especies = await q<Fila>("select grupo::text as grupo, nombre_comun, nombre_cientifico, familia, categoria_amenaza, taxonomia_valida from diagnostico_especies where diagnostico_id = $1 order by grupo, orden, nombre_comun", [id]);
  const alertas = await q<Fila>("select mensaje from alertas_calidad where tabla = 'predios' and registro_id = $1 and not resuelta", [d.predio_id]);
  return { d, p: d.predio as Fila, titulares, especies, alertas };
}

/** Texto de la identificación jurídica armado con lo registrado, cuando la sección se dejó vacía. */
function juridica(p: Fila, titulares: Fila[]): string {
  const quien = titulares.map((x) => {
    const doc = `${x.tipo_documento} ${x.numero_documento}${x.digito_verificacion !== null ? "-" + x.digito_verificacion : ""}`;
    const rep = x.representante_nombre ? `, representada legalmente por ${x.representante_nombre} (CC ${t(x.representante_documento)})${x.representante_cargo ? ", " + x.representante_cargo : ""}` : "";
    const per = x.personeria_resolucion ? `, con personería jurídica otorgada mediante ${x.personeria_resolucion} del ${t(x.personeria_fecha)} de ${t(x.personeria_entidad)}` : "";
    return `${x.nombre} (${doc})${rep}${per}, en calidad de ${x.tenencia}`;
  }).join("; ");
  return `El predio "${p.nombre}" se identifica con el folio de matrícula inmobiliaria ${t(p.fmi)} y el código catastral ${t(p.codigo_catastral)}, ubicado en la vereda ${t(p.vereda)} del municipio de ${t(p.municipio)}, ${t(p.departamento)}. ` +
    `Fue adquirido mediante Escritura Pública ${t(p.escritura_numero)} del ${t(p.escritura_fecha)} de la ${t(p.escritura_notaria)}. Titular(es): ${quien || P}.`;
}

function etiquetas(x: Awaited<ReturnType<typeof datosDe>>) {
  const { d, p, titulares, especies } = x;
  const fila = (e: Fila) => ({ nombre_comun: e.nombre_comun, nombre_cientifico: t(e.nombre_cientifico), familia: e.familia ?? "", categoria_amenaza: e.categoria_amenaza ?? "" });
  return {
    codigo: d.formato_codigo, version: t(d.formato_version), fecha_formato: t(d.formato_fecha_t),
    elaboro: t(d.elaboro), elaboro_fecha: t(d.elaboro_fecha_t), reviso: t(d.reviso), reviso_fecha: t(d.reviso_fecha_t), aprobo: t(d.aprobo), aprobo_fecha: t(d.aprobo_fecha_t),
    predio: p.nombre, fmi: t(p.fmi), codigo_catastral: t(p.codigo_catastral), vereda: t(p.vereda), municipio: t(p.municipio), departamento: t(p.departamento),
    altitud_min: t(p.altitud_min), altitud_max: t(p.altitud_max), area_total_ha: p.area_total_ha ? numero(p.area_total_ha) : P, area_conservacion_ha: p.area_conservacion_ha ? numero(p.area_conservacion_ha) : P,
    clasificacion_pot: t(p.clasificacion_pot), ecosistema: t(p.ecosistema_estrategico), uso_permitido: t(p.uso_permitido), uso_prohibido: t(p.uso_prohibido), infraestructura: t(p.infraestructura),
    titular: t(titulares[0]?.nombre),
    antecedentes_legales: t(d.antecedentes_legales), identificacion_juridica: d.identificacion_juridica || juridica(p, titulares), area_estudio: t(d.area_estudio),
    contexto_ecosistemico: t(d.contexto_ecosistemico), uso_suelo: t(d.uso_suelo), importancia_ambiental: t(d.importancia_ambiental), potencial_conservacion: t(d.potencial_conservacion),
    flora: especies.filter((e) => e.grupo === "flora").map(fila), fauna: especies.filter((e) => e.grupo === "fauna").map(fila),
  };
}

export const ETIQUETAS_DIAGNOSTICO = "{codigo} {version} {fecha_formato} {elaboro} {elaboro_fecha} {reviso} {reviso_fecha} {aprobo} {aprobo_fecha} {predio} {fmi} {codigo_catastral} {vereda} {municipio} {departamento} {altitud_min} {altitud_max} {area_total_ha} {area_conservacion_ha} {clasificacion_pot} {ecosistema} {uso_permitido} {uso_prohibido} {infraestructura} {titular} {antecedentes_legales} {identificacion_juridica} {area_estudio} {contexto_ecosistemico} {uso_suelo} {importancia_ambiental} {potencial_conservacion} {#flora}{nombre_comun} {nombre_cientifico} {familia} {categoria_amenaza}{/flora} {#fauna}…{/fauna}";

const parrafo = (texto: string, negrita = false) => new Paragraph({
  spacing: { after: 140 }, alignment: AlignmentType.JUSTIFIED,
  children: texto.split(/(\[PENDIENTE[^\]]*\])/).filter(Boolean).map((x) => new TextRun({ text: x, bold: negrita, highlight: x.startsWith("[PENDIENTE") ? "yellow" : undefined })),
});
const celda = (texto: string, negrita = false, cursiva = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: texto, bold: negrita, italics: cursiva, highlight: texto.startsWith("[PENDIENTE") ? "yellow" : undefined })] })] });
const tabla = (filas: TableRow[]) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: filas });
const titulo = (texto: string) => new Paragraph({ text: texto, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } });

async function generico(e: ReturnType<typeof etiquetas>, alertas: Fila[]): Promise<Buffer> {
  const especies = (lista: typeof e.flora) => lista.length
    ? tabla([new TableRow({ tableHeader: true, children: ["Nombre común", "Nombre científico", "Familia", "Categoría de amenaza"].map((x) => celda(x, true)) }),
      ...lista.map((x) => new TableRow({ children: [celda(x.nombre_comun), celda(x.nombre_cientifico, false, true), celda(x.familia), celda(x.categoria_amenaza)] }))])
    : parrafo(P);
  const hijos: (Paragraph | Table)[] = [
    tabla([
      new TableRow({ children: [celda("DIAGNÓSTICO DE PREDIO PARA PAGO POR SERVICIOS AMBIENTALES", true), celda(`Código: ${e.codigo}`), celda(`Versión: ${e.version}`), celda(`Fecha: ${e.fecha_formato}`)] }),
      new TableRow({ children: [celda(`Predio: ${e.predio}`, true), celda(`Elaboró: ${e.elaboro} (${e.elaboro_fecha})`), celda(`Revisó: ${e.reviso} (${e.reviso_fecha})`), celda(`Aprobó: ${e.aprobo} (${e.aprobo_fecha})`)] }),
    ]),
    titulo("1. Antecedentes legales"), parrafo(e.antecedentes_legales),
    titulo("2. Identificación jurídica"), parrafo(e.identificacion_juridica),
    titulo("3. Área de estudio"), parrafo(e.area_estudio),
    tabla([
      new TableRow({ children: [celda("Vereda / municipio", true), celda(`${e.vereda}, ${e.municipio}, ${e.departamento}`), celda("Altitud (msnm)", true), celda(`${e.altitud_min} – ${e.altitud_max}`)] }),
      new TableRow({ children: [celda("Área total (ha)", true), celda(e.area_total_ha), celda("Área en conservación (ha)", true), celda(e.area_conservacion_ha)] }),
      new TableRow({ children: [celda("Matrícula inmobiliaria", true), celda(e.fmi), celda("Código catastral", true), celda(e.codigo_catastral)] }),
    ]),
    ...alertas.map((a) => parrafo(`[PENDIENTE: resolver antes de aprobar — ${a.mensaje}]`)),
    titulo("4. Contexto ecosistémico"), parrafo(`Ecosistema estratégico: ${e.ecosistema}. Clasificación en el ordenamiento territorial: ${e.clasificacion_pot}.`), parrafo(e.contexto_ecosistemico),
    titulo("5. Uso del suelo"), parrafo(`Uso permitido: ${e.uso_permitido}. Uso prohibido: ${e.uso_prohibido}. Infraestructura existente: ${e.infraestructura}.`), parrafo(e.uso_suelo),
    titulo("6. Flora y fauna"), parrafo("Flora", true), especies(e.flora), parrafo(""), parrafo("Fauna", true), especies(e.fauna),
    titulo("7. Importancia ambiental"), parrafo(e.importancia_ambiental),
    titulo("8. Potencial de conservación"), parrafo(e.potencial_conservacion),
  ];
  return Packer.toBuffer(new Document({ features: { trackRevisions: true }, sections: [{ children: hijos }] }));
}

export async function generarDiagnostico(id: string, usuario: Usuario): Promise<{ plantilla: string; pendientes: number }> {
  const x = await datosDe(id);
  const e = etiquetas(x);
  const plantilla = await q1<Fila>("select archivo_ruta, nombre, version from plantillas where tipo = 'diagnostico' and activa");
  let archivo: Buffer;
  if (plantilla) {
    const doc = new Docxtemplater(new PizZip(await leerArchivo(plantilla.archivo_ruta)), { paragraphLoop: true, linebreaks: true, nullGetter: () => P });
    doc.render(e);
    archivo = (doc.getZip() as PizZip).generate({ type: "nodebuffer", compression: "DEFLATE" });
  } else {
    archivo = await generico(e, x.alertas);
  }
  const ruta = await guardarArchivo("diagnosticos", `${x.d.formato_codigo}_${x.p.nombre}.docx`, archivo);
  await comoUsuario(usuario.id, () => q("update diagnosticos set documento_ruta = $2 where id = $1", [id, ruta]));
  const pendientes = Object.values(e).filter((v) => typeof v === "string" && v.includes(P)).length;
  return { plantilla: plantilla ? `${plantilla.nombre} (versión ${plantilla.version})` : "formato genérico del sistema", pendientes };
}

// ---------- Verificación de nombres científicos ----------

/**
 * Contrasta cada nombre científico con el árbol taxonómico de GBIF (api.gbif.org). Marca si existe, cuál es el nombre
 * aceptado si se registró un sinónimo, y completa la familia cuando falta. No cambia lo que la persona escribió.
 */
export async function verificarEspecies(diagnosticoId: string, usuario: Usuario): Promise<{ revisadas: number; dudosas: number; sinRed: boolean }> {
  const especies = await q<Fila>("select id, nombre_comun, nombre_cientifico, familia, grupo::text as grupo from diagnostico_especies where diagnostico_id = $1", [diagnosticoId]);
  let revisadas = 0, dudosas = 0, sinRed = false;
  for (const e of especies) {
    if (!e.nombre_cientifico?.trim()) {
      await q("update diagnostico_especies set taxonomia_valida = false, taxonomia_nombre_aceptado = 'Falta el nombre científico', taxonomia_fuente = null where id = $1", [e.id]);
      dudosas++; continue;
    }
    let r: Fila;
    try {
      const resp = await fetch(`https://api.gbif.org/v1/species/match?verbose=false&name=${encodeURIComponent(e.nombre_cientifico.trim())}`, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) throw new Error(String(resp.status));
      r = await resp.json();
    } catch { sinRed = true; break; }
    const reino = e.grupo === "flora" ? "Plantae" : "Animalia";
    let nota: string, valida: boolean;
    if (r.matchType === "NONE" || !r.usageKey) { valida = false; nota = "No aparece en el catálogo taxonómico: revisa la escritura"; }
    else if (r.kingdom && r.kingdom !== reino) { valida = false; nota = `Es del reino ${r.kingdom}, no corresponde a ${e.grupo}`; }
    else if (r.matchType !== "EXACT") { valida = false; nota = `Escritura dudosa. ¿Quisiste decir ${r.canonicalName}?`; }
    else if (r.status === "SYNONYM" && r.species) { valida = true; nota = `Sinónimo; nombre aceptado: ${r.species}`; }
    else if (r.rank && !["SPECIES", "SUBSPECIES", "VARIETY"].includes(r.rank)) { valida = true; nota = `Identificado solo hasta ${String(r.rank).toLowerCase()}`; }
    else { valida = true; nota = "Nombre aceptado"; }
    if (!valida) dudosas++;
    await comoUsuario(usuario.id, () => q(
      "update diagnostico_especies set taxonomia_valida = $2, taxonomia_nombre_aceptado = $3, taxonomia_fuente = 'GBIF Backbone Taxonomy', familia = coalesce(nullif(familia, ''), $4) where id = $1",
      [e.id, valida, nota, r.family ?? null]));
    revisadas++;
  }
  return { revisadas, dudosas, sinRed };
}
