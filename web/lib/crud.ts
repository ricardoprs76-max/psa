import "server-only";
import { comoUsuario, q, q1, type Fila } from "./db";
import { MODULOS, type Campo, type Modulo } from "./modulos";
import type { Usuario } from "./sesion";

export function moduloDe(clave: string): Modulo {
  const m = MODULOS[clave];
  if (!m) throw new Error(`Módulo desconocido: ${clave}`);
  return m;
}

const pk = (m: Modulo) => m.pk ?? "id";

/** Columnas que se devuelven: la fila completa (sin geometrías) más la etiqueta de cada referencia. */
function seleccion(m: Modulo): string {
  const refs = m.campos.filter((c) => c.t === "ref" && c.ref).map(
    (c) => `'${c.n}__e', (select ${c.ref!.etiqueta} from ${c.ref!.tabla} r where r.id = t.${c.n})`,
  );
  return `to_jsonb(t) - 'geom' - 'texto_busqueda' - 'texto_fuente'${refs.length ? ` || jsonb_build_object(${refs.join(", ")})` : ""} as f`;
}

export type Consulta = { buscar?: string; filtros?: Record<string, string>; limite?: number; pagina?: number };

export async function listar(clave: string, c: Consulta = {}): Promise<{ filas: Fila[]; total: number }> {
  const m = moduloDe(clave);
  const donde: string[] = [];
  const params: unknown[] = [];
  if (m.borradoLogico) donde.push("t.eliminado_en is null");
  if (c.buscar?.trim() && m.buscar.length) {
    params.push(`%${c.buscar.trim()}%`);
    donde.push("(" + m.buscar.map((col) => `unaccent(coalesce(t.${col}::text, '')) ilike unaccent($${params.length})`).join(" or ") + ")");
  }
  for (const [col, valor] of Object.entries(c.filtros ?? {})) {
    const campo = m.campos.find((x) => x.n === col);
    if (!campo || valor === "") continue;        // solo columnas declaradas: nunca se arma SQL con nombres libres
    params.push(valor);
    donde.push(`t.${col}::text = $${params.length}`);
  }
  const where = donde.length ? `where ${donde.join(" and ")}` : "";
  const limite = Math.min(c.limite ?? 50, 5000);
  const total = Number((await q1<{ n: string }>(`select count(*) as n from ${m.tabla} t ${where}`, params))?.n ?? 0);
  const filas = await q<{ f: Fila }>(
    `select ${seleccion(m)} from ${m.tabla} t ${where} order by ${m.orden} limit ${limite} offset ${((c.pagina ?? 1) - 1) * limite}`, params,
  );
  return { filas: filas.map((r) => r.f), total };
}

export async function obtener(clave: string, id: string): Promise<Fila | null> {
  const m = moduloDe(clave);
  return (await q1<{ f: Fila }>(`select ${seleccion(m)} from ${m.tabla} t where t.${pk(m)}::text = $1`, [id]))?.f ?? null;
}

/** Opciones para un campo de referencia (id + etiqueta). */
export async function opcionesRef(campo: Campo): Promise<[string, string][]> {
  if (!campo.ref) return [];
  const borrado = ["convenios", "beneficiarios", "predios", "acuerdos", "zonas_conservacion"].includes(campo.ref.tabla) ? "where eliminado_en is null" : "";
  const filas = await q<{ id: string; e: string }>(`select id, ${campo.ref.etiqueta} as e from ${campo.ref.tabla} ${borrado} order by 2 limit 2000`);
  return filas.map((f) => [f.id, f.e]);
}

function convertir(campo: Campo, crudo: FormDataEntryValue | null): unknown {
  const texto = typeof crudo === "string" ? crudo.trim() : "";
  if (campo.t === "si_no") return texto === "on" || texto === "true";
  if (texto === "") return null;
  if (campo.t === "numero" || campo.t === "moneda" || campo.t === "entero") {
    const n = Number(texto);
    if (!Number.isFinite(n)) throw new Error(`"${campo.e}" debe ser un número.`);
    return n;
  }
  return texto;
}

const MENSAJES: Record<string, string> = {
  predio_fmi_formato: "La matrícula inmobiliaria debe tener el formato 000-12345 (tres dígitos, guion y el número).",
  predio_catastral_formato: "El código catastral debe tener exactamente 30 dígitos.",
  predio_altitudes: "La altitud máxima no puede ser menor que la mínima.",
  predios_fmi_unico: "Ya existe un predio con esa matrícula inmobiliaria.",
  predios_catastral_unico: "Ya existe un predio con ese código catastral.",
  beneficiario_documento_unico: "Ya existe un beneficiario con ese documento.",
  beneficiario_documento_digitos: "El número de documento solo admite letras y números, sin puntos ni guiones.",
  convenio_fechas: "La fecha de terminación no puede ser anterior a la de inicio.",
  acuerdo_fechas: "El fin de la vigencia no puede ser anterior al inicio.",
  costo_justificado: "Si el costo no aplica o es un valor especial, escribe la justificación (mínimo 10 caracteres).",
  costo_valor_coherente: "Si aplica o es valor especial debe tener valor; si no aplica, el valor va vacío.",
  costo_una_vigente: "Ya hay una versión vigente para esa zona y uso. Usa \"Nueva versión\" para reemplazarla.",
  pago_pagado_completo: "Un pago en estado Pagado necesita valor pagado y fecha real de pago.",
  convenios_numero_key: "Ya existe un convenio con ese número.",
};

/** Convierte un error de la base en un mensaje que la persona entienda. */
export function mensajeError(e: unknown): string {
  const err = e as { constraint?: string; message?: string; code?: string };
  const restriccion = err.constraint ?? /constraint "([^"]+)"/.exec(err.message ?? "")?.[1];
  if (restriccion && MENSAJES[restriccion]) return MENSAJES[restriccion];
  if (err.code === "23503") return "No se puede completar: hay otros registros que dependen de este.";
  if (err.code === "23505") return "Ya existe un registro con esos mismos datos.";
  if (err.code === "23514") return `Un valor no cumple una regla de la base (${restriccion ?? "revisa los campos"}).`;
  if (err.code === "23502") return "Falta un campo obligatorio.";
  return err.message ?? "Ocurrió un error.";
}

export async function guardar(clave: string, id: string | null, datos: FormData, usuario: Usuario): Promise<string> {
  const m = moduloDe(clave);
  if (!m.editan.includes(usuario.rol)) throw new Error("Tu rol no permite editar este módulo.");
  const campos = m.campos.filter((c) => !c.soloLectura && (datos.has(c.n) || c.t === "si_no"));
  const valores = campos.map((c) => {
    const v = convertir(c, datos.get(c.n));
    if (c.req && (v === null || v === "")) throw new Error(`Falta "${c.e}".`);
    return v;
  });
  return comoUsuario(usuario.id, async () => {
    if (id) {
      const sets = campos.map((c, i) => `${c.n} = $${i + 1}`).join(", ");
      await q(`update ${m.tabla} set ${sets} where ${pk(m)}::text = $${campos.length + 1}`, [...valores, id]);
      return id;
    }
    const fila = await q1<{ id: string }>(
      `insert into ${m.tabla} (${campos.map((c) => c.n).join(", ")}) values (${campos.map((_, i) => `$${i + 1}`).join(", ")}) returning ${pk(m)}::text as id`, valores,
    );
    return fila!.id;
  });
}

export async function eliminar(clave: string, id: string, usuario: Usuario): Promise<void> {
  const m = moduloDe(clave);
  if (!m.editan.includes(usuario.rol)) throw new Error("Tu rol no permite eliminar en este módulo.");
  await comoUsuario(usuario.id, () =>
    q(m.borradoLogico ? `update ${m.tabla} set eliminado_en = now() where ${pk(m)}::text = $1` : `delete from ${m.tabla} where ${pk(m)}::text = $1`, [id]),
  );
}
