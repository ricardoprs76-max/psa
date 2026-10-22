import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { leerArchivo } from "./archivos";
import { numero, pesos } from "./calculo";
import { q1 } from "./db";

/**
 * Genera el borrador de respuesta en Word.
 *  - Si hay una plantilla institucional activa (Ajustes → Plantillas), se llena esa.
 *  - Si no, se arma una carta genérica.
 * En ambos casos los datos que faltan quedan como [PENDIENTE] resaltado y el archivo abre con control de cambios activo.
 */

export const PENDIENTE = "[PENDIENTE]";

export type DatosRespuesta = {
  consecutivo: string | null; fecha_hoy: string; solicitante: string | null; solicitante_documento: string | null; radicado: string | null;
  fecha_solicitud: string | null; asunto: string | null; municipio: string | null; vereda: string | null;
  area_ha: number | null; anios: number | null; zona: string | null; uso_suelo: string | null; costo_ha_anio: number | null; anio_base: number | null;
  costo_aplicacion: string | null; costo_justificacion: string | null; metodologia: string | null; metodologia_aprobada: boolean;
  valor_total: number | null; avisos: string[];
  filas: { anio: number; variacion: string; valor_ha: number; valor: number }[];
  predios: { nombre: string | null; fmi: string | null; codigo_catastral: string | null; vereda: string | null; municipio: string | null; area_ha: number | null }[];
  referencias: { consecutivo: string | null; solicitante: string | null; fecha: string | null; valor_total: number | null; motivo: string | null }[];
  entidad: string;
};

const t = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? PENDIENTE : String(v));

/** Etiquetas disponibles para una plantilla propia, con el valor que tomarían. */
export function etiquetas(d: DatosRespuesta): Record<string, unknown> {
  return {
    consecutivo: t(d.consecutivo), fecha_hoy: d.fecha_hoy, entidad: d.entidad,
    solicitante: t(d.solicitante), solicitante_documento: t(d.solicitante_documento), radicado: t(d.radicado), fecha_solicitud: t(d.fecha_solicitud),
    asunto: t(d.asunto), municipio: t(d.municipio), vereda: t(d.vereda),
    area_ha: d.area_ha === null ? PENDIENTE : numero(d.area_ha), anios: t(d.anios), zona: t(d.zona), uso_suelo: t(d.uso_suelo),
    costo_ha_anio: d.costo_ha_anio === null ? PENDIENTE : pesos(d.costo_ha_anio), anio_base: t(d.anio_base),
    metodologia: t(d.metodologia), valor_total: d.valor_total === null ? PENDIENTE : pesos(d.valor_total),
    filas: d.filas.map((f) => ({ anio: f.anio, variacion: f.variacion, valor_ha: pesos(f.valor_ha), valor: pesos(f.valor) })),
    predios: d.predios.map((p) => ({ nombre: t(p.nombre), fmi: t(p.fmi), codigo_catastral: t(p.codigo_catastral), vereda: t(p.vereda), municipio: t(p.municipio), area_ha: p.area_ha === null ? PENDIENTE : numero(p.area_ha) })),
    referencias: d.referencias.map((r) => ({ consecutivo: t(r.consecutivo), solicitante: t(r.solicitante), fecha: t(r.fecha), valor_total: r.valor_total === null ? PENDIENTE : pesos(r.valor_total), motivo: r.motivo ?? "" })),
    avisos: d.avisos.map((a) => ({ texto: a })),
  };
}

export const ETIQUETAS_AYUDA: [string, string][] = [
  ["{solicitante}", "Nombre de quien solicita"], ["{solicitante_documento}", "Cédula o NIT"], ["{radicado}", "Radicado de la solicitud"],
  ["{fecha_solicitud}", "Fecha de la solicitud"], ["{fecha_hoy}", "Fecha de generación"], ["{consecutivo}", "Consecutivo de la proyección"],
  ["{asunto}", "Asunto"], ["{municipio} {vereda}", "Ubicación"], ["{area_ha}", "Área en hectáreas"], ["{anios}", "Años proyectados"],
  ["{zona} {uso_suelo}", "Zona y uso del costo de oportunidad"], ["{costo_ha_anio} {anio_base}", "Costo por ha/año y su año base"],
  ["{metodologia}", "Nombre de la metodología"], ["{valor_total}", "Valor total proyectado"],
  ["{#filas}{anio} {variacion} {valor_ha} {valor}{/filas}", "Una fila por año (dentro de una fila de tabla)"],
  ["{#predios}{nombre} {fmi} {codigo_catastral} {vereda} {municipio} {area_ha}{/predios}", "Predios de la solicitud"],
  ["{#referencias}{consecutivo} {solicitante} {fecha} {valor_total}{/referencias}", "Proyecciones anteriores consultadas"],
  ["{#avisos}{texto}{/avisos}", "Advertencias del cálculo"],
];

/** Resalta en amarillo los tramos que contienen [PENDIENTE] y activa el control de cambios. */
function rematar(zip: PizZip): Buffer {
  const doc = zip.file("word/document.xml");
  if (doc) {
    const xml = doc.asText().replace(/<w:r>(?:(?!<\/w:r>)[\s\S])*?\[PENDIENTE\](?:(?!<\/w:r>)[\s\S])*?<\/w:r>|<w:r [^>]*>(?:(?!<\/w:r>)[\s\S])*?\[PENDIENTE\](?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, (tramo) => {
      if (tramo.includes("<w:highlight")) return tramo;
      return tramo.includes("<w:rPr>")
        ? tramo.replace("<w:rPr>", '<w:rPr><w:highlight w:val="yellow"/>')
        : tramo.replace(/^(<w:r(?: [^>]*)?>)/, '$1<w:rPr><w:highlight w:val="yellow"/></w:rPr>');
    });
    zip.file("word/document.xml", xml);
  }
  const ajustes = zip.file("word/settings.xml");
  if (ajustes) {
    let xml = ajustes.asText();
    if (!xml.includes("<w:trackRevisions")) xml = xml.replace(/(<w:settings[^>]*>)/, "$1<w:trackRevisions/>");
    zip.file("word/settings.xml", xml);
  }
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

async function conPlantilla(plantilla: Buffer, d: DatosRespuesta): Promise<Buffer> {
  const zip = new PizZip(plantilla);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => PENDIENTE });
  doc.render(etiquetas(d));
  return rematar(doc.getZip() as PizZip);
}

const p = (texto: string, opciones: { negrita?: boolean; alinear?: (typeof AlignmentType)[keyof typeof AlignmentType]; espacio?: number } = {}) =>
  new Paragraph({
    alignment: opciones.alinear, spacing: { after: opciones.espacio ?? 160 },
    // Cada [PENDIENTE] va en su propio tramo para poder resaltarlo.
    children: texto.split(/(\[PENDIENTE[^\]]*\])/).filter(Boolean).map((parte) => new TextRun({ text: parte, bold: opciones.negrita, highlight: parte.startsWith("[PENDIENTE") ? "yellow" : undefined })),
  });

const celda = (texto: string, negrita = false) => new TableCell({ children: [p(texto, { negrita, espacio: 40 })] });
const tabla = (encabezados: string[], filas: string[][]) =>
  new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: encabezados.map((e) => celda(e, true)) }), ...filas.map((f) => new TableRow({ children: f.map((c) => celda(c)) }))] });

async function generica(d: DatosRespuesta, logo: Buffer | null, tipoLogo: "png" | "jpg" | null): Promise<Buffer> {
  const e = etiquetas(d) as Record<string, any>;
  const contenido: (Paragraph | Table)[] = [];
  if (logo && tipoLogo) contenido.push(new Paragraph({ children: [new ImageRun({ type: tipoLogo, data: logo, transformation: { width: 70, height: 70 } })], spacing: { after: 200 } }));
  contenido.push(
    p(d.entidad, { negrita: true }),
    p(`${PENDIENTE.replace("]", ": ciudad]")}, ${d.fecha_hoy}`),
    p(`Señor(a)\n`, { espacio: 0 }), p(e.solicitante, { negrita: true, espacio: 0 }), p(`${e.vereda}, ${e.municipio}`),
    p(`Asunto: respuesta a la solicitud ${e.radicado} del ${e.fecha_solicitud}. ${d.asunto ?? ""}`.trim(), { negrita: true }),
    p("Cordial saludo."),
    p(`En atención a su solicitud, se presenta la proyección del incentivo de Pago por Servicios Ambientales para un área de ${e.area_ha} hectáreas durante ${e.anios} año(s).`),
  );
  if (d.predios.length) {
    contenido.push(new Paragraph({ text: "Predios", heading: HeadingLevel.HEADING_2 }),
      tabla(["Predio", "Matrícula", "Código catastral", "Vereda", "Municipio", "Área (ha)"], e.predios.map((x: any) => [x.nombre, x.fmi, x.codigo_catastral, x.vereda, x.municipio, x.area_ha])), p(""));
  }
  contenido.push(new Paragraph({ text: "Base del cálculo", heading: HeadingLevel.HEADING_2 }));
  if (d.costo_aplicacion === "no_aplica") {
    contenido.push(p(`Para la zona ${e.zona} y el uso "${e.uso_suelo}" el costo de oportunidad no aplica. Justificación: ${t(d.costo_justificacion)}`));
  } else {
    contenido.push(p(`Zona: ${e.zona}. Uso del suelo: ${e.uso_suelo}. Costo de oportunidad: ${e.costo_ha_anio} por hectárea al año, a precios de ${e.anio_base}.`),
      p(`Metodología: ${e.metodologia}${d.metodologia_aprobada ? "" : " " + PENDIENTE.replace("]", ": metodología provisional, sin aprobar]")}.`));
  }
  if (d.filas.length) {
    contenido.push(new Paragraph({ text: "Proyección", heading: HeadingLevel.HEADING_2 }),
      tabla(["Año", "Reajuste", "Valor por ha", "Valor del año"], e.filas.map((f: any) => [String(f.anio), f.variacion, f.valor_ha, f.valor])),
      p(""), p(`Valor total proyectado: ${e.valor_total}`, { negrita: true }));
  } else {
    contenido.push(p(`${PENDIENTE.replace("]", ": proyección sin calcular]")}`));
  }
  d.avisos.forEach((a) => contenido.push(p(`Nota: ${a}`)));
  if (d.referencias.length) {
    contenido.push(new Paragraph({ text: "Proyecciones anteriores consultadas", heading: HeadingLevel.HEADING_2 }),
      tabla(["Consecutivo", "Solicitante", "Fecha", "Valor total"], e.referencias.map((r: any) => [r.consecutivo, r.solicitante, r.fecha, r.valor_total])), p(""));
  }
  contenido.push(p("Esta proyección es informativa y no constituye compromiso de pago; la vinculación al esquema está sujeta a la verificación de requisitos y a la disponibilidad de recursos."),
    p("Atentamente,"), p(""), p(PENDIENTE.replace("]", ": nombre y cargo de quien firma]"), { negrita: true }), p(d.entidad));
  const doc = new Document({ features: { trackRevisions: true }, sections: [{ children: contenido }] });
  return Packer.toBuffer(doc);
}

export async function generarRespuesta(d: DatosRespuesta): Promise<{ archivo: Buffer; plantilla: string }> {
  const plantilla = await q1<{ archivo_ruta: string; nombre: string; version: number }>("select archivo_ruta, nombre, version from plantillas where tipo = 'respuesta_proyeccion' and activa");
  if (plantilla) {
    return { archivo: await conPlantilla(await leerArchivo(plantilla.archivo_ruta), d), plantilla: `${plantilla.nombre} (versión ${plantilla.version})` };
  }
  const logo = await q1<{ archivo_ruta: string; archivo_nombre: string }>("select archivo_ruta, archivo_nombre from plantillas where tipo = 'logo' and activa");
  const ext = logo?.archivo_nombre.toLowerCase().match(/\.(png|jpe?g)$/)?.[1];
  let datosLogo = logo && ext ? await leerArchivo(logo.archivo_ruta).catch(() => null) : null;
  let tipoLogo: "png" | "jpg" | null = ext ? (ext === "png" ? "png" : "jpg") : null;
  if (!datosLogo) {
    // Sin logo subido se usa el emblema oficial que viene con la aplicación.
    datosLogo = await fs.readFile(path.join(process.cwd(), "public", "marca", "matica.png")).catch(() => null);
    tipoLogo = datosLogo ? "png" : null;
  }
  return { archivo: await generica(d, datosLogo, tipoLogo), plantilla: "Carta genérica del sistema" };
}

/** Valida que un .docx subido sea una plantilla utilizable; devuelve el mensaje de error o null. */
export function revisarPlantilla(archivo: Buffer): string | null {
  try {
    const doc = new Docxtemplater(new PizZip(archivo), { paragraphLoop: true, linebreaks: true, nullGetter: () => PENDIENTE });
    doc.render({});
    return null;
  } catch (e) {
    const err = e as { properties?: { errors?: { properties?: { explanation?: string } }[] }; message?: string };
    return err.properties?.errors?.map((x) => x.properties?.explanation).filter(Boolean).join(" ") || err.message || "El archivo no es un documento de Word válido.";
  }
}
