import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import PizZip from "pizzip";
import * as XLSX from "xlsx";
import { DIR_DATOS, q, q1, volcarBase, type Fila } from "./db";
import { almacenNube, bajarRespaldo, sincronizarNube } from "./nube";
import { descifrar } from "./sesion";

/**
 * Respaldo: un .zip con cada tabla en CSV, un Excel con todas, los archivos subidos (ordenados por carpeta) y, en modo
 * local, la copia exacta de la base para restaurar. Queda en web/.datos/respaldos y, si Google Drive está configurado
 * en la pantalla de Respaldos, se sube también allí. Cada ejecución se registra en la tabla "respaldos".
 */
const TABLAS = ["convenios", "beneficiarios", "beneficiario_cuentas", "consentimientos", "predios", "predio_titulares", "predio_areas_fuente", "acuerdos", "acuerdo_prorrogas", "pagos",
  "zonas_conservacion", "capas_referencia", "costo_oportunidad", "ipc_anual", "metodologias_calculo", "proyecciones", "proyeccion_predios", "proyeccion_referencias", "proyeccion_versiones",
  "tipos_documento", "documentos", "listas_chequeo", "lista_chequeo_items", "diagnosticos", "diagnostico_especies", "visitas_campo", "visita_fotos", "alertas_calidad", "plantillas", "perfiles", "configuracion", "auditoria"];
const DIR = path.join(DIR_DATOS, "respaldos");
const CONSERVAR = 14;

async function archivosDe(dir: string, base = dir): Promise<string[]> {
  const entradas = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const rutas = await Promise.all(entradas.map((e) => (e.isDirectory() ? archivosDe(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))])));
  return rutas.flat();
}

// ---------- Google Drive (cuenta de servicio) ----------

export async function configuracionDrive(): Promise<{ carpeta: string; credencial: { client_email: string; private_key: string } | null }> {
  const conf = await q1<{ valor: { carpeta?: string } }>("select valor from configuracion where clave = 'drive'");
  const secreto = await q1<{ valor_cifrado: string }>("select valor_cifrado from secretos where clave = 'drive_cuenta_servicio'");
  let credencial = null;
  try { credencial = secreto ? JSON.parse(descifrar(secreto.valor_cifrado) ?? "null") : null; } catch { /* credencial ilegible: se trata como no configurada */ }
  return { carpeta: conf?.valor?.carpeta ?? "", credencial };
}

async function tokenDrive(c: { client_email: string; private_key: string }): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const cuerpo = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: c.client_email, scope: "https://www.googleapis.com/auth/drive.file", aud: "https://oauth2.googleapis.com/token", iat: ahora, exp: ahora + 3600 })}`;
  const firma = crypto.createSign("RSA-SHA256").update(cuerpo).sign(c.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${cuerpo}.${firma}` }) });
  if (!r.ok) throw new Error(`Google rechazó la credencial (${r.status}).`);
  return (await r.json()).access_token;
}

async function subirADrive(nombre: string, datos: Buffer): Promise<string> {
  const { carpeta, credencial } = await configuracionDrive();
  if (!credencial || !carpeta) throw new Error("Drive no está configurado.");
  const token = await tokenDrive(credencial);
  const limite = "psa" + crypto.randomUUID();
  const cuerpo = Buffer.concat([
    Buffer.from(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nombre, parents: [carpeta] })}\r\n--${limite}\r\nContent-Type: application/zip\r\n\r\n`),
    datos, Buffer.from(`\r\n--${limite}--`),
  ]);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${limite}` }, body: new Uint8Array(cuerpo),
  });
  if (!r.ok) throw new Error(`Drive no aceptó el archivo (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).id;
}

// ---------- Respaldo ----------

export async function hacerRespaldo(): Promise<Fila> {
  const registro = (await q1<{ id: string }>("insert into respaldos default values returning id"))!;
  try {
    const zip = new PizZip();
    const libro = XLSX.utils.book_new();
    for (const tabla of TABLAS) {
      const filas = (await q<{ f: Fila }>(`select to_jsonb(t) - 'geom' - 'ubicacion' - 'texto_busqueda' ${tabla === "predios" || tabla === "zonas_conservacion" || tabla === "capas_referencia" ? "|| jsonb_build_object('geom_wkt', st_astext(geom))" : ""} as f from ${tabla} t`)).map((r) =>
        Object.fromEntries(Object.entries(r.f).map(([k, v]) => [k, v !== null && typeof v === "object" ? JSON.stringify(v) : typeof v === "string" && v.length > 32000 ? v.slice(0, 32000) : v])));
      const hoja = XLSX.utils.json_to_sheet(filas);
      zip.file(`tablas/${tabla}.csv`, "﻿" + XLSX.utils.sheet_to_csv(hoja, { FS: ";" }));
      XLSX.utils.book_append_sheet(libro, hoja, tabla.slice(0, 31));
    }
    zip.file("base_de_datos.xlsx", XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer);
    const raiz = path.join(DIR_DATOS, "archivos");
    const archivos = await archivosDe(raiz);
    for (const a of archivos) zip.file(`archivos/${a.split(path.sep).join("/")}`, await fs.readFile(path.join(raiz, a)));
    const copia = await volcarBase();
    if (copia) zip.file("restauracion/base_local.tar.gz", copia);
    zip.file("LEEME.txt", "Respaldo del Sistema PSA\r\n\r\ntablas/                 cada tabla en CSV (separador ;)\r\nbase_de_datos.xlsx      todas las tablas en un solo Excel\r\narchivos/               documentos, plantillas, solicitudes y respuestas\r\nrestauracion/           copia exacta de la base local (ver README.md, sección Restaurar un respaldo)\r\n");
    const datos = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
    const nombre = `respaldo-psa_${new Date().toLocaleString("sv-SE", { timeZone: "America/Bogota" }).replace(/[: ]/g, "-")}.zip`;
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(path.join(DIR, nombre), datos);
    // Solo se conservan los más recientes en el disco.
    const viejos = (await fs.readdir(DIR)).filter((f) => f.endsWith(".zip")).sort().reverse().slice(CONSERVAR);
    await Promise.all(viejos.map((f) => fs.unlink(path.join(DIR, f)).catch(() => {})));

    let destino = `Este equipo: .datos/respaldos/${nombre}`;
    let detalle = `${TABLAS.length} tablas, ${archivos.length} archivos`;
    const nube = almacenNube();
    if (nube?.tipo === "remoto") detalle += " (los demás archivos están en la carpeta archivos de Drive)";
    if (nube?.disponible) {
      const r = await sincronizarNube({ respaldos: true });
      if (r.ok) destino += ` · Carpeta en la nube: ${nube.ruta}`; else detalle += ` · ${r.mensaje}`;
    }
    const drive = await configuracionDrive();
    if (drive.credencial && drive.carpeta) {
      try { await subirADrive(nombre, datos); destino += ` · Google Drive (carpeta ${drive.carpeta})`; }
      catch (e) { throw new Error(`El respaldo quedó en este equipo, pero no subió a Drive: ${(e as Error).message}`); }
    } else if (!nube?.disponible) detalle += " · Drive sin configurar: solo copia local";
    await q("update respaldos set terminado_en = now(), resultado = 'exitoso', tamano_bytes = $2, archivos = $3, destino = $4, detalle = $5 where id = $1", [registro.id, datos.length, archivos.length, destino, detalle]);
  } catch (e) {
    await q("update respaldos set terminado_en = now(), resultado = 'fallido', detalle = $2 where id = $1", [registro.id, (e as Error).message.slice(0, 500)]);
  }
  return (await q1<Fila>("select *, resultado::text as resultado_t from respaldos where id = $1", [registro.id]))!;
}

export async function leerRespaldo(nombre: string): Promise<Buffer> {
  if (!/^respaldo-psa_[\d-]+\.zip$/.test(nombre)) throw new Error("Nombre de respaldo no válido.");
  try {
    return await fs.readFile(path.join(DIR, nombre));
  } catch (e) {
    const datos = await bajarRespaldo(nombre);
    if (!datos) throw e;
    return datos;
  }
}

/** Respaldo diario automático: mientras el servidor esté encendido, revisa cada media hora si ya pasó un día desde el último exitoso. */
export function programarRespaldos() {
  const g = globalThis as unknown as { __psaRespaldos?: boolean };
  if (g.__psaRespaldos) return;
  g.__psaRespaldos = true;
  const revisar = async () => {
    try {
      const ultimo = await q1<{ hace: number | null }>("select extract(epoch from now() - max(iniciado_en)) / 3600 as hace from respaldos where resultado = 'exitoso'");
      const hayDatos = await q1<{ n: number }>("select count(*)::int as n from auth.users");
      if (hayDatos!.n > 0 && (ultimo?.hace === null || ultimo?.hace === undefined || Number(ultimo.hace) >= 24)) await hacerRespaldo();
    } catch { /* se reintenta en la siguiente revisión */ }
  };
  setTimeout(revisar, 60_000);
  setInterval(revisar, 30 * 60_000);
}
