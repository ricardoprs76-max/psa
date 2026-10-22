import "server-only";
import * as XLSX from "xlsx";
import { guardar, mensajeError, moduloDe } from "./crud";
import { q } from "./db";
import type { Campo } from "./modulos";
import type { Usuario } from "./sesion";

/** Importación de datos desde Excel o CSV (incluidas las exportaciones de ODK) hacia cualquier módulo. */

export const IMPORTABLES = ["convenios", "beneficiarios", "predios", "acuerdos", "pagos", "zonas", "ipc"];

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function leerTabla(archivo: Buffer): { encabezados: string[]; filas: Record<string, unknown>[]; hoja: string } {
  const libro = XLSX.read(archivo, { type: "buffer", cellDates: true });
  // Se toma la primera hoja que tenga datos.
  for (const hoja of libro.SheetNames) {
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets[hoja], { defval: null, raw: true });
    if (filas.length) return { encabezados: Object.keys(filas[0]), filas, hoja };
  }
  throw new Error("El archivo no tiene filas con datos.");
}

/** Propone qué columna del archivo corresponde a cada campo, comparando nombres sin tildes ni mayúsculas. */
export function sugerirMapa(clave: string, encabezados: string[]): Record<string, string> {
  const m = moduloDe(clave);
  const mapa: Record<string, string> = {};
  for (const c of m.campos.filter((x) => !x.soloLectura)) {
    const candidatos = [norm(c.n), norm(c.e), norm(c.n.replace(/_id$/, "")), norm(c.e.replace(/\(.*\)/, ""))];
    // En ODK las columnas vienen como "grupo-campo" o "grupo/campo": cuenta el último tramo.
    const hallada = encabezados.find((h) => candidatos.includes(norm(h)) || candidatos.includes(norm(h.split(/[-/:.]/).pop())));
    if (hallada) mapa[c.n] = hallada;
  }
  return mapa;
}

function numeroDe(v: unknown): string {
  if (typeof v === "number") return String(v);
  let s = String(v).replace(/[^\d.,-]/g, "");
  // "10.285,77" → 10285.77 · "1,114" → 1.114 · "2.500.000" → 2500000
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  return s;
}

function fechaDe(v: unknown): string {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const s = String(v).trim();
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return s.slice(0, 10);
}

/** Columnas por las que se puede reconocer el registro al que apunta una referencia. */
const BUSCAR_REF: Record<string, string[]> = {
  convenios: ["numero"], beneficiarios: ["nombre", "numero_documento"], predios: ["nombre", "fmi", "codigo_catastral"],
  acuerdos: ["codigo"], zonas_conservacion: ["nombre"],
};

async function valorDe(c: Campo, crudo: unknown): Promise<string> {
  if (crudo === null || crudo === undefined || String(crudo).trim() === "") return "";
  if (c.t === "numero" || c.t === "moneda" || c.t === "entero") return numeroDe(crudo);
  if (c.t === "fecha") return fechaDe(crudo);
  if (c.t === "si_no") return ["si", "sí", "true", "1", "x", "yes"].includes(norm(crudo)) ? "on" : "";
  if (c.t === "opcion") {
    const op = c.ops!.find(([v, e]) => norm(v) === norm(crudo) || norm(e) === norm(crudo));
    if (!op) throw new Error(`"${crudo}" no es una opción válida para ${c.e} (${c.ops!.map(([, e]) => e).join(", ")}).`);
    return op[0];
  }
  if (c.t === "ref") {
    const columnas = BUSCAR_REF[c.ref!.tabla] ?? ["id"];
    const filas = await q<{ id: string }>(
      `select id from ${c.ref!.tabla} where ${columnas.map((col) => `unaccent(lower(${col}::text)) = unaccent(lower($1))`).join(" or ")} limit 2`, [String(crudo).trim()]);
    if (filas.length === 0) throw new Error(`No existe ${c.e.toLowerCase()} "${crudo}". Créalo o impórtalo primero.`);
    if (filas.length > 1) throw new Error(`Hay más de un registro que coincide con "${crudo}" en ${c.e.toLowerCase()}.`);
    return filas[0].id;
  }
  return String(crudo).trim();
}

export type ResultadoImportacion = { creados: number; errores: { fila: number; mensaje: string }[] };

export async function importarFilas(clave: string, filas: Record<string, unknown>[], mapa: Record<string, string>, usuario: Usuario): Promise<ResultadoImportacion> {
  if (!IMPORTABLES.includes(clave)) throw new Error("Este módulo no admite importación.");
  const m = moduloDe(clave);
  const r: ResultadoImportacion = { creados: 0, errores: [] };
  for (const [i, fila] of filas.entries()) {
    try {
      const datos = new FormData();
      for (const c of m.campos) {
        if (c.soloLectura || !mapa[c.n]) continue;
        datos.set(c.n, await valorDe(c, fila[mapa[c.n]]));
      }
      if ([...datos.values()].every((v) => v === "")) continue;      // fila vacía
      await guardar(clave, null, datos, usuario);
      r.creados++;
    } catch (e) {
      r.errores.push({ fila: i + 2, mensaje: mensajeError(e) });     // +2: encabezado y base 1, como se ve en Excel
    }
  }
  return r;
}
