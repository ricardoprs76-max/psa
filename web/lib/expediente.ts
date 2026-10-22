import "server-only";
import { q, q1, type Fila } from "./db";

/**
 * Expediente documental de un beneficiario, un predio o un acuerdo: qué documentos exige su lista de chequeo,
 * cuáles hay y en qué estado, y el porcentaje de completitud.
 */
export type Ambito = "beneficiario" | "predio" | "acuerdo";
export type Situacion = "falta" | "pendiente" | "recibido" | "vencido" | "rechazado";

export type Item = {
  tipo_id: string; codigo: string; nombre: string; obligatorio: boolean; vigencia_dias: number | null; ayuda: string | null;
  situacion: Situacion; documento: Fila | null;
};
export type Expediente = { ambito: Ambito; id: string; items: Item[]; otros: Fila[]; exigidos: number; cumplidos: number; porcentaje: number };

const COLUMNA: Record<Ambito, string> = { beneficiario: "beneficiario_id", predio: "predio_id", acuerdo: "acuerdo_id" };

/** Situación real de un documento: uno recibido cuya fecha de vencimiento ya pasó cuenta como vencido. */
export function situacionDe(d: Fila | null): Situacion {
  if (!d) return "falta";
  if (d.estado === "recibido" && d.vencimiento && d.vencimiento < new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" })) return "vencido";
  return d.estado as Situacion;
}

export async function expedienteDe(ambito: Ambito, id: string): Promise<Expediente> {
  // Las listas dependen de la modalidad (acuerdo) y del tipo de beneficiario.
  const contexto = ambito === "acuerdo"
    ? await q1<Fila>("select a.modalidad::text as modalidad, b.tipo::text as tipo from acuerdos a join beneficiarios b on b.id = a.beneficiario_id where a.id = $1", [id])
    : ambito === "beneficiario" ? await q1<Fila>("select null as modalidad, tipo::text as tipo from beneficiarios where id = $1", [id]) : { modalidad: null, tipo: null };
  const exigidos = await q<Fila>(
    `select distinct on (t.id) t.id as tipo_id, t.codigo, t.nombre, t.vigencia_dias, i.obligatorio, i.orden, i.ayuda
     from listas_chequeo l join lista_chequeo_items i on i.lista_id = l.id join tipos_documento t on t.id = i.tipo_documento_id and t.activo
     where l.activa and l.ambito = $1::ambito_expediente
       and (l.modalidad is null or l.modalidad::text = $2) and (l.tipo_beneficiario is null or l.tipo_beneficiario::text = $3)
     order by t.id, i.obligatorio desc`, [ambito, contexto?.modalidad ?? null, contexto?.tipo ?? null]);
  const documentos = await q<Fila>(
    `select d.id, d.tipo_id, d.archivo_nombre, d.archivo_ruta is not null as con_archivo, d.version, d.estado::text as estado, d.fecha_emision::text as emision,
            d.fecha_vencimiento::text as vencimiento, d.observaciones, t.nombre as tipo, (select nombre from perfiles where id = d.verificado_por) as verificador
     from documentos d join tipos_documento t on t.id = d.tipo_id where d.${COLUMNA[ambito]} = $1 and d.eliminado_en is null order by d.creado_en desc`, [id]);
  const usados = new Set<string>();
  const items: Item[] = exigidos.sort((a, b) => a.orden - b.orden).map((e) => {
    // El más reciente de ese tipo es el que cuenta.
    const documento = documentos.find((d) => d.tipo_id === e.tipo_id) ?? null;
    if (documento) usados.add(documento.id);
    return { tipo_id: e.tipo_id, codigo: e.codigo, nombre: e.nombre, obligatorio: e.obligatorio, vigencia_dias: e.vigencia_dias, ayuda: e.ayuda, situacion: situacionDe(documento), documento };
  });
  const obligatorios = items.filter((i) => i.obligatorio);
  const cumplidos = obligatorios.filter((i) => i.situacion === "recibido").length;
  return {
    ambito, id, items, otros: documentos.filter((d) => !usados.has(d.id)), exigidos: obligatorios.length, cumplidos,
    porcentaje: obligatorios.length ? Math.round((cumplidos / obligatorios.length) * 100) : 0,
  };
}

/** Completitud del expediente completo de un acuerdo: sus documentos, los de su predio y los de su beneficiario. */
export async function completitudAcuerdos(): Promise<Fila[]> {
  const acuerdos = await q<Fila>(
    `select a.id, a.codigo, a.estado::text as estado, a.predio_id, a.beneficiario_id, p.nombre as predio, b.nombre as beneficiario, c.numero as convenio
     from acuerdos a join predios p on p.id = a.predio_id join beneficiarios b on b.id = a.beneficiario_id join convenios c on c.id = a.convenio_id
     where a.eliminado_en is null order by a.creado_en desc limit 300`);
  return Promise.all(acuerdos.map(async (a) => {
    const partes = await Promise.all([expedienteDe("acuerdo", a.id), expedienteDe("predio", a.predio_id), expedienteDe("beneficiario", a.beneficiario_id)]);
    const exigidos = partes.reduce((s, p) => s + p.exigidos, 0);
    const cumplidos = partes.reduce((s, p) => s + p.cumplidos, 0);
    const faltan = partes.flatMap((p) => p.items.filter((i) => i.obligatorio && i.situacion !== "recibido").map((i) => `${i.nombre}${i.situacion === "vencido" ? " (vencido)" : ""}`));
    return { ...a, exigidos, cumplidos, porcentaje: exigidos ? Math.round((cumplidos / exigidos) * 100) : 0, faltan };
  }));
}
