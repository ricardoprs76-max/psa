import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cambios, DIR_DATOS, modoLocal, volcarBase } from "./db";

/**
 * Almacén en la nube: la carpeta "Proyecto PSA" de Google Drive. Ahí vive la copia que manda:
 *
 *   archivos/    documentos, plantillas, solicitudes, respuestas y fotos (se suben al guardarlos)
 *   base/        copia exacta de la base de datos (se renueva a los pocos segundos de cada cambio) y la anterior
 *   respaldos/   los .zip diarios
 *
 * El sistema trabaja sobre una base embebida en el disco del servidor (web/.datos), que es rápida, y la sube a Drive.
 * Al arrancar sin base local (servidor en la nube recién encendido, computador nuevo) la baja de Drive y sigue desde ahí.
 * La base no se abre directamente dentro de Drive: los archivos de PostgreSQL se dañan si se sincronizan mientras se escriben.
 *
 * Hay dos maneras de llegar a la carpeta:
 *  - "remoto": un servidor publicado en internet habla con Drive por la aplicación web de Apps Script (nube/Codigo.gs)
 *    instalada en la cuenta dueña de la carpeta. Se activa con las variables PSA_NUBE_URL y PSA_NUBE_TOKEN.
 *  - "carpeta": en un computador con Google Drive para escritorio, escribe en G:\Mi unidad\Proyecto PSA y Drive la sube.
 *
 * El archivo "llave" no se copia a la nube; en un servidor se usa la variable PSA_SECRETO.
 */

const NOMBRE = "Proyecto PSA";
const COPIA = "base/base_local.tar.gz";
const COPIA_ANTERIOR = "base/base_local_anterior.tar.gz";
const ESTADO = "base/estado.json";
const RESPALDOS_EN_NUBE = 30;

/** `visto` es la fecha de la última copia de la nube que este equipo cargó o escribió: si la nube trae otra, alguien más escribió. */
type Conf = { carpeta?: string; linaje?: string; visto?: string; restaurar?: boolean };
type Entrada = { ruta: string; tamano: number };
export type EstadoCopia = { linaje: string; fecha: string; equipo: string };
export type EstadoNube = { ultima: string | null; ok: boolean; mensaje: string; conflicto: boolean };
export type Almacen = {
  tipo: "remoto" | "carpeta";
  /** Texto para mostrar: la ruta de la carpeta o "Google Drive". */
  ruta: string;
  origen: "variable" | "ajuste" | "detectada";
  disponible: boolean;
  leer(ruta: string): Promise<Buffer | null>;
  /** Escribe el archivo; con `anterior`, el que había pasa a llamarse así en vez de borrarse. */
  escribir(ruta: string, datos: Buffer, anterior?: string): Promise<void>;
  listar(carpeta: string): Promise<Entrada[]>;
  borrar(ruta: string): Promise<void>;
};

const g = globalThis as unknown as {
  __psaNube?: { estado: EstadoNube; cola: Promise<unknown>; volcado: number; programada: boolean; temporizador: NodeJS.Timeout | null; deteccion?: { ruta: string | null; en: number }; copia?: { valor: EstadoCopia | null; en: number } };
};
const mem = () => (g.__psaNube ??= { estado: { ultima: null, ok: false, mensaje: "Todavía no se ha sincronizado.", conflicto: false }, cola: Promise.resolve(), volcado: -1, programada: false, temporizador: null });

const archivoConf = () => path.join(DIR_DATOS, "nube.json");
function leerConf(): Conf {
  try { return JSON.parse(fs.readFileSync(archivoConf(), "utf8")); } catch { return {}; }
}
function guardarConf(c: Conf) {
  fs.mkdirSync(DIR_DATOS, { recursive: true });
  fs.writeFileSync(archivoConf(), JSON.stringify(c, null, 2));
}

const esCarpeta = (ruta: string) => { try { return fs.statSync(ruta).isDirectory(); } catch { return false; } };

function listarDisco(dir: string, base = dir): Entrada[] {
  let entradas: fs.Dirent[];
  try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entradas.flatMap((e) => {
    const completa = path.join(dir, e.name);
    if (e.isDirectory()) return listarDisco(completa, base);
    try { return [{ ruta: path.relative(base, completa).split(path.sep).join("/"), tamano: fs.statSync(completa).size }]; } catch { return []; }
  });
}

// ---------- Drive por Apps Script ----------

export const modoRemoto = () => !!process.env.PSA_NUBE_URL;

async function llamar<T>(accion: string, extra: Record<string, unknown> = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(process.env.PSA_NUBE_URL!, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow", signal: AbortSignal.timeout(240_000),
      body: JSON.stringify({ token: process.env.PSA_NUBE_TOKEN ?? "", accion, ...extra }),
    });
  } catch (e) { throw new Error(`No hubo conexión con Google Drive (${(e as Error).message}).`); }
  let j: { ok: boolean; datos?: T; error?: string };
  try { j = JSON.parse(await r.text()); } catch { throw new Error(`Google Drive respondió algo inesperado (${r.status}). Revisa que la aplicación web de Apps Script esté publicada para "Cualquier persona".`); }
  if (!j.ok) throw new Error(`Google Drive: ${j.error}`);
  return j.datos as T;
}

function almacenRemoto(): Almacen {
  return {
    tipo: "remoto", ruta: `Google Drive, carpeta ${NOMBRE}`, origen: "variable", disponible: true,
    leer: async (ruta) => { const d = await llamar<{ base64: string } | null>("leer", { ruta }); return d ? Buffer.from(d.base64, "base64") : null; },
    escribir: async (ruta, datos, anterior) => { await llamar("escribir", { ruta, anterior, base64: datos.toString("base64") }); },
    listar: (carpeta) => llamar<Entrada[]>("listar", { ruta: carpeta }),
    borrar: async (ruta) => { await llamar("borrar", { ruta }); },
  };
}

// ---------- Carpeta de Google Drive para escritorio ----------

/** Busca "Mi unidad" de Google Drive en las unidades del equipo y, dentro, la carpeta del proyecto (la crea si falta). */
function detectar(): string | null {
  const m = mem();
  if (m.deteccion && Date.now() - m.deteccion.en < 60_000) return m.deteccion.ruta;
  const casa = os.homedir();
  const raices = [
    ..."DEFGHIJKLMNOPQRSTUVWXYZ".split("").flatMap((l) => [`${l}:\\Mi unidad`, `${l}:\\My Drive`]),
    path.join(casa, "Mi unidad"), path.join(casa, "My Drive"), path.join(casa, "Google Drive"),
  ];
  let ruta: string | null = null;
  const raiz = process.platform === "win32" ? raices.find(esCarpeta) : undefined;
  if (raiz) {
    try {
      const existente = fs.readdirSync(raiz).find((n) => n.trim().toLowerCase() === NOMBRE.toLowerCase() && esCarpeta(path.join(raiz, n)));
      ruta = path.join(/*turbopackIgnore: true*/ raiz, existente ?? NOMBRE);
      if (!existente) fs.mkdirSync(ruta, { recursive: true });
    } catch { ruta = null; }
  }
  m.deteccion = { ruta, en: Date.now() };
  return ruta;
}

function almacenCarpeta(raiz: string, origen: Almacen["origen"]): Almacen {
  const en = (ruta: string) => path.join(raiz, ...ruta.split("/"));
  return {
    tipo: "carpeta", ruta: raiz, origen, disponible: esCarpeta(raiz),
    leer: async (ruta) => { try { return fs.readFileSync(en(ruta)); } catch { return null; } },
    escribir: async (ruta, datos, anterior) => {
      const destino = en(ruta), tmp = `${destino}.subiendo`;
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(tmp, datos);
      if (anterior && fs.existsSync(destino)) { fs.rmSync(en(anterior), { force: true }); fs.renameSync(destino, en(anterior)); }
      fs.renameSync(tmp, destino);
    },
    listar: async (carpeta) => listarDisco(en(carpeta)),
    borrar: async (ruta) => fs.rmSync(en(ruta), { force: true }),
  };
}

/** Almacén en uso: Drive por Apps Script si hay PSA_NUBE_URL; si no, la carpeta fijada o la que se detecte en el equipo. */
export function almacenNube(): Almacen | null {
  if (modoRemoto()) return almacenRemoto();
  if (process.env.PSA_CARPETA_NUBE) return almacenCarpeta(process.env.PSA_CARPETA_NUBE, "variable");
  const fijada = leerConf().carpeta;
  if (fijada) return almacenCarpeta(fijada, "ajuste");
  const ruta = detectar();
  return ruta ? almacenCarpeta(ruta, "detectada") : null;
}

/** Fija la carpeta a mano (vacío = volver a detectarla sola). */
export function fijarCarpetaNube(ruta: string) {
  if (ruta && !esCarpeta(ruta)) throw new Error("Esa carpeta no existe en este computador.");
  const c = leerConf();
  if (ruta) c.carpeta = ruta; else delete c.carpeta;
  guardarConf(c);
  mem().deteccion = undefined;
}

// ---------- Copia de la base ----------

/** Datos de la copia de la base que hay en la nube (quién la escribió y cuándo), o null si no hay. Lanza error si Drive no responde. */
async function leerCopia(a: Almacen): Promise<EstadoCopia | null> {
  const crudo = await a.leer(ESTADO);
  let valor: EstadoCopia | null = null;
  if (crudo) { try { valor = JSON.parse(crudo.toString("utf8")); } catch { valor = { linaje: "", fecha: "", equipo: "desconocido" }; } }
  mem().copia = { valor, en: Date.now() };
  return valor;
}

/** Lo mismo, para mostrar en pantalla: usa lo último que se supo (hasta un minuto) y no falla si Drive no responde. */
export async function copiaEnNube(): Promise<EstadoCopia | null> {
  const m = mem();
  if (m.copia && Date.now() - m.copia.en < 60_000) return m.copia.valor;
  const a = almacenNube();
  if (!a?.disponible) return null;
  try { return await leerCopia(a); } catch { return m.copia?.valor ?? null; }
}

export const estadoNube = () => mem().estado;
export const restauracionSolicitada = () => !!leerConf().restaurar;

/**
 * La usa lib/db.ts al abrir la base: devuelve la copia de la nube cuando hay que arrancar con ella (no hay base local,
 * o el administrador pidió traer los datos de la nube). `confirmar` se llama cuando la base ya abrió con esa copia.
 * En modo remoto, si Drive no responde lanza error: es preferible no arrancar a arrancar con una base vacía.
 */
export async function restauracionPendiente(hayBaseLocal: boolean): Promise<{ datos: Buffer; confirmar: () => void } | null> {
  const conf = leerConf();
  if (hayBaseLocal && !conf.restaurar) return null;
  const a = almacenNube();
  if (!a?.disponible) return null;
  let copia: EstadoCopia | null, datos: Buffer | null;
  try {
    copia = await leerCopia(a);
    datos = copia ? await a.leer(COPIA) : null;
  } catch (e) {
    if (a.tipo === "remoto") throw e;
    return null;
  }
  if (!copia || !datos) return null;
  const linaje = copia.linaje || crypto.randomUUID();
  return { datos, confirmar: () => { guardarConf({ ...leerConf(), linaje, visto: copia.fecha, restaurar: false }); mem().volcado = cambios.n; mem().estado = { ultima: new Date().toISOString(), ok: true, mensaje: "Base cargada desde la nube al encender.", conflicto: false }; } };
}

/** El administrador decide qué datos mandan cuando la nube trae una copia que no salió de este equipo. */
export async function resolverConflicto(decision: "subir" | "traer") {
  const a = almacenNube();
  const copia = a?.disponible ? await leerCopia(a) : null;
  if (!copia) throw new Error("No hay copia de la base en la carpeta de la nube.");
  if (decision === "subir") guardarConf({ ...leerConf(), linaje: copia.linaje || crypto.randomUUID(), visto: copia.fecha, restaurar: false });
  else guardarConf({ ...leerConf(), restaurar: true });
}

// ---------- Archivos ----------

/**
 * Sube a la nube un archivo recién guardado. En modo remoto el disco del servidor es pasajero, así que si Drive no lo
 * recibe el guardado falla; con la carpeta de escritorio, lo que no alcance a copiarse lo recoge la sincronización.
 */
export async function subirArchivo(relativa: string, datos: Buffer) {
  const a = almacenNube();
  if (!a?.disponible) return;
  if (a.tipo === "remoto") await a.escribir(`archivos/${relativa}`, datos);
  else await a.escribir(`archivos/${relativa}`, datos).catch(() => {});
}

/** Trae de la nube un archivo que no está en el disco del servidor. */
export async function bajarArchivo(relativa: string): Promise<Buffer | null> {
  const a = almacenNube();
  return a?.disponible ? a.leer(`archivos/${relativa}`).catch(() => null) : null;
}

/** Trae de la nube un respaldo .zip que ya no está en el disco del servidor. */
export async function bajarRespaldo(nombre: string): Promise<Buffer | null> {
  const a = almacenNube();
  return a?.disponible ? a.leer(`respaldos/${nombre}`).catch(() => null) : null;
}

// ---------- Sincronización ----------

type Opciones = { base?: boolean; respaldos?: boolean };

async function sincronizar(op: Opciones): Promise<EstadoNube> {
  const m = mem();
  const fin = (ok: boolean, mensaje: string, conflicto = false): EstadoNube => (m.estado = { ultima: ok ? new Date().toISOString() : m.estado.ultima, ok, mensaje, conflicto });
  const a = almacenNube();
  if (!a) return fin(false, "No se encontró Google Drive en este computador. Instala Google Drive para escritorio e inicia sesión, o escribe la ruta de la carpeta.");
  if (!a.disponible) return fin(false, `La carpeta ${a.ruta} no está disponible (¿Google Drive está abierto?).`);
  const remoto = a.tipo === "remoto";
  // Cada llamada a Drive por Apps Script gasta cuota: sin cambios en la base no hay nada que hacer.
  // Con la base en un servidor PostgreSQL externo, a Drive solo van los archivos (al guardarlos) y los respaldos.
  const conBase = modoLocal();
  if (remoto && !op.respaldos && !conBase) return m.estado.ok ? m.estado : fin(true, "Los archivos se guardan en Drive al subirlos; la base está en el servidor de base de datos y se respalda a diario en Drive.");
  if (remoto && !op.base && !op.respaldos && m.volcado === cambios.n && m.estado.ok) return m.estado;
  try {
    let detalle = "";
    if (!remoto) {
      if (!(await a.leer("LEEME.txt"))) await a.escribir("LEEME.txt", Buffer.from("Sistema PSA - datos en la nube\r\n\r\narchivos/    documentos, plantillas, solicitudes, respuestas y fotos\r\nbase/        copia exacta de la base de datos (con ella arranca el sistema en otro computador o en el servidor)\r\nrespaldos/   respaldos diarios en .zip (tablas en CSV y Excel, archivos y base)\r\n\r\nEsta carpeta la escribe el sistema. No muevas ni cambies el nombre de lo que hay dentro.\r\n"));
      // Archivos en los dos sentidos, para que un computador nuevo reciba los que ya estaban en la nube.
      const local = path.join(DIR_DATOS, "archivos"), enLocal = listarDisco(local), enNube = await a.listar("archivos");
      const tamano = (lista: Entrada[]) => new Map(lista.map((e) => [e.ruta, e.tamano]));
      const tl = tamano(enLocal), tn = tamano(enNube);
      let subidos = 0, bajados = 0;
      for (const e of enLocal) if (tn.get(e.ruta) !== e.tamano) { try { await a.escribir(`archivos/${e.ruta}`, fs.readFileSync(path.join(local, e.ruta))); subidos++; } catch { /* se reintenta en la siguiente pasada */ } }
      for (const e of enNube) {
        if (tl.has(e.ruta) || /(^|\/)(desktop\.ini|~\$.*|.*\.(tmp|subiendo))$/i.test(e.ruta)) continue;
        const datos = await a.leer(`archivos/${e.ruta}`);
        if (!datos) continue;
        fs.mkdirSync(path.dirname(path.join(local, e.ruta)), { recursive: true });
        fs.writeFileSync(path.join(local, e.ruta), datos);
        bajados++;
      }
      detalle = `; ${subidos} archivo(s) subido(s)${bajados ? `, ${bajados} traído(s) de la nube` : ""}`;
    }

    // Respaldos .zip: suben los que falten y en la nube se conservan los más recientes.
    if (!remoto || op.respaldos) {
      const dir = path.join(DIR_DATOS, "respaldos");
      const enNube = (await a.listar("respaldos")).filter((e) => /^respaldo-psa_[\d-]+\.zip$/.test(e.ruta));
      const ya = new Set(enNube.map((e) => e.ruta));
      for (const e of listarDisco(dir)) if (/^respaldo-psa_[\d-]+\.zip$/.test(e.ruta) && !ya.has(e.ruta)) { await a.escribir(`respaldos/${e.ruta}`, fs.readFileSync(path.join(dir, e.ruta))); ya.add(e.ruta); }
      for (const viejo of [...ya].sort().reverse().slice(RESPALDOS_EN_NUBE)) await a.borrar(`respaldos/${viejo}`);
    }

    // Base de datos: solo si cambió desde la última copia, y nunca encima de una copia que no salió de este servidor.
    if (!conBase) return fin(true, `Respaldos al día en Drive${detalle}. La base está en el servidor de base de datos.`);
    const conf = leerConf();
    if (conf.restaurar) return fin(true, "Pendiente traer los datos de la nube: cierra el sistema y vuelve a abrirlo.", true);
    let base = "sin cambios en la base";
    const marca = cambios.n;
    if (op.base || m.volcado !== marca || !m.copia?.valor) {
      const copia = await leerCopia(a);
      if (copia && (copia.linaje !== conf.linaje || (conf.visto !== undefined && copia.fecha !== conf.visto))) return fin(true, `La carpeta ya tiene una copia de la base hecha en otro equipo (${copia.equipo}${copia.fecha ? `, ${copia.fecha.slice(0, 16).replace("T", " ")}` : ""}). Elige cuáles datos conservar.`, true);
      if (op.base || m.volcado !== marca || !copia) {
        const datos = await volcarBase();
        if (datos) {
          await a.escribir(COPIA, datos, COPIA_ANTERIOR);
          const estado: EstadoCopia = { linaje: conf.linaje ?? crypto.randomUUID(), fecha: new Date().toISOString(), equipo: process.env.PSA_NOMBRE_SERVIDOR ?? os.hostname() };
          await a.escribir(ESTADO, Buffer.from(JSON.stringify(estado, null, 2)));
          guardarConf({ ...leerConf(), linaje: estado.linaje, visto: estado.fecha });
          m.copia = { valor: estado, en: Date.now() };
          base = `base copiada (${(datos.length / 1048576).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB)`;
        } else base = "base externa: no se copia";
      }
      m.volcado = marca;
    }
    return fin(true, `${base}${detalle}.`);
  } catch (e) {
    return fin(false, `No se pudo guardar en ${a.ruta}: ${(e as Error).message}`);
  }
}

/** Sincroniza con el almacén en la nube. Las sincronizaciones van una detrás de otra, nunca dos a la vez. */
export function sincronizarNube(op: Opciones = {}): Promise<EstadoNube> {
  const m = mem();
  const turno = m.cola.then(() => sincronizar(op));
  m.cola = turno.catch(() => {});
  return turno;
}

/**
 * Arranca la sincronización automática: poco después de cada escritura en la base (lib/db.ts avisa por `cambios.alCambiar`)
 * y, de respaldo, cada pocos minutos. Antes de apagarse el servidor intenta una última copia.
 */
export function programarNube() {
  const m = mem();
  if (m.programada) return;
  m.programada = true;
  const espera = modoRemoto() ? 30_000 : 20_000;
  cambios.alCambiar = () => {
    if (m.temporizador) return;
    m.temporizador = setTimeout(() => { m.temporizador = null; void sincronizarNube(); }, espera);
  };
  setTimeout(() => void sincronizarNube(), 20_000);
  setInterval(() => void sincronizarNube(), 3 * 60_000);
  if (modoRemoto()) process.once("SIGTERM", () => { void Promise.race([sincronizarNube(), new Promise((r) => setTimeout(r, 25_000))]).finally(() => process.exit(0)); });
}
