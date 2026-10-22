import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Acceso a la base de datos desde el servidor.
 *
 * - Con DATABASE_URL (cadena de conexión de PostgreSQL con PostGIS: Neon, Supabase…) se usa esa base y se le aplican
 *   solas las migraciones.
 * - Sin ella, "modo local": un PostgreSQL embebido con PostGIS (PGlite) guardado en web/.datos/pg, al que se le
 *   cargan solos el esquema y los datos de ejemplo. Sirve para trabajar sin cuenta de Supabase.
 *
 * El servidor entra con un usuario que salta RLS, así que los permisos por rol se exigen en lib/sesion.ts;
 * las políticas RLS del esquema protegen además el acceso directo (app móvil, API de Supabase).
 */

export type Fila = Record<string, any>;
type Cliente = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Fila[] }>; exec?: (sql: string) => Promise<unknown>; volcar?: () => Promise<Buffer>; cerrar?: () => Promise<void> };

export const DIR_DATOS = process.env.PSA_DIR_DATOS || path.join(process.cwd(), ".datos");
const DIR_SQL = path.join(process.cwd(), "..", "supabase");
const global = globalThis as unknown as { __psaDb?: Promise<Cliente>; __psaCambios?: { n: number; alCambiar?: () => void } };

/** Cuenta las escrituras hechas a la base; lib/nube.ts la mira para saber si hay algo nuevo que copiar a la nube. */
export const cambios = (global.__psaCambios ??= { n: 0 });
const ESCRIBE = /\b(insert|update|delete|truncate|create|alter|drop)\b/i;

async function abrir(): Promise<Cliente> {
  if (process.env.DATABASE_URL) {
    const { Pool, types } = await import("pg");
    // Mismos tipos que entrega la base embebida: los enteros largos llegan como BigInt.
    types.setTypeParser(20, BigInt);
    // Una sola conexión: comoUsuario deja el usuario en la sesión y las consultas siguientes deben ir por la misma.
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, idleTimeoutMillis: 60_000, connectionTimeoutMillis: 30_000 });
    pool.on("error", () => { /* conexión inactiva cerrada por el servidor: la siguiente consulta abre otra */ });
    // Hora de Colombia para toda la base (queda guardado en ella) y para esta primera conexión.
    await pool.query("do $$ begin execute format('alter database %I set timezone to %L', current_database(), 'America/Bogota'); end $$").catch(() => {});
    await pool.query("set timezone = 'America/Bogota'");
    await migrar((sql) => pool.query(sql), (sql, params) => pool.query(sql, params as any[]));
    return { query: (sql, params) => pool.query(sql, params as any[]) };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { postgis } = await import("@electric-sql/pglite-postgis");
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
  const { unaccent } = await import("@electric-sql/pglite/contrib/unaccent");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  fs.mkdirSync(DIR_DATOS, { recursive: true });
  // Computador nuevo (o el administrador pidió traer los datos): la base arranca con la copia de la carpeta en la nube.
  const dirPg = path.join(DIR_DATOS, "pg");
  const { restauracionPendiente, programarNube } = await import("./nube");
  let copia = await restauracionPendiente(fs.existsSync(dirPg));
  if (copia && fs.existsSync(dirPg)) {
    // La base de este equipo no se borra: queda a un lado. Si Windows aún la tiene ocupada, se intenta en el próximo arranque.
    try { fs.renameSync(dirPg, path.join(DIR_DATOS, `pg_anterior_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`)); } catch { copia = null; }
  }
  const db = new PGlite(dirPg, { extensions: { postgis, pg_trgm, unaccent, pgcrypto }, ...(copia ? { loadDataDir: new Blob([new Uint8Array(copia.datos)], { type: "application/gzip" }) } : {}) });
  await db.waitReady;
  copia?.confirmar();
  programarNube();
  await db.exec("set timezone = 'America/Bogota'");

  await migrar((sql) => db.exec(sql), (sql, params) => db.query(sql, params as any[]) as Promise<{ rows: Fila[] }>);
  return {
    query: (sql, params) => db.query(sql, params as any[]) as Promise<{ rows: Fila[] }>, exec: (sql) => db.exec(sql),
    volcar: async () => Buffer.from(await (await db.dumpDataDir("gzip")).arrayBuffer()),
    cerrar: () => db.close(),
  };
}

/**
 * Migraciones: se aplican en orden y una sola vez cada una. En Supabase el esquema "auth" ya viene con el servicio,
 * así que el archivo que lo imita (auth_local.sql) se da por hecho; en cualquier otro PostgreSQL sí se ejecuta.
 */
async function migrar(exec: (sql: string) => Promise<unknown>, query: Cliente["query"]) {
  const authPropio = (await query("select to_regclass('auth.users') is not null and to_regclass('_migraciones') is null as si")).rows[0].si;
  await exec("create table if not exists _migraciones (nombre text primary key, aplicada_en timestamptz default now())");
  if (authPropio) await query("insert into _migraciones (nombre) values ('auth_local.sql') on conflict do nothing");
  const hechas = new Set((await query("select nombre from _migraciones")).rows.map((r) => r.nombre as string));
  const pendientes = [
    path.join(DIR_SQL, "local", "auth_local.sql"),
    ...fs.readdirSync(path.join(DIR_SQL, "migrations")).sort().map((f) => path.join(DIR_SQL, "migrations", f)),
    path.join(DIR_SQL, "seed.sql"),
  ];
  for (const archivo of pendientes) {
    const nombre = path.basename(archivo);
    if (hechas.has(nombre)) continue;
    await exec(fs.readFileSync(archivo, "utf8"));
    await query("insert into _migraciones (nombre) values ($1)", [nombre]);
  }
}

/** Cierra la base embebida y la vuelve a abrir (así entra la copia de la nube sin reiniciar el sistema). */
export async function reabrirBase() {
  const c = await cliente();
  if (!c.cerrar) return;
  await c.cerrar();
  global.__psaDb = undefined;
  await cliente();
}

function cliente() {
  // Si no abre (por ejemplo, Drive no respondió al traer la copia), el siguiente intento empieza de cero.
  return (global.__psaDb ??= abrir().catch((e) => { global.__psaDb = undefined; throw e; }));
}

/** Ejecuta una consulta y devuelve sus filas. */
export async function q<T = Fila>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await cliente();
  const filas = (await c.query(sql, params)).rows as T[];
  if (ESCRIBE.test(sql)) { cambios.n++; cambios.alCambiar?.(); }
  return filas;
}

/** Primera fila o null. */
export async function q1<T = Fila>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await q<T>(sql, params))[0] ?? null;
}

/**
 * Ejecuta escrituras a nombre de un usuario: deja su id donde auth.uid() lo lee, para que la bitácora de
 * auditoría registre quién hizo el cambio.
 */
export async function comoUsuario<T>(usuarioId: string | null, tarea: () => Promise<T>): Promise<T> {
  await q("select set_config('request.jwt.claim.sub', $1, false)", [usuarioId ?? ""]);
  try {
    return await tarea();
  } finally {
    await q("select set_config('request.jwt.claim.sub', '', false)");
  }
}

/** Copia completa de la base embebida (solo en modo local); con una base externa devuelve null. */
export async function volcarBase(): Promise<Buffer | null> {
  const c = await cliente();
  return c.volcar ? c.volcar() : null;
}

export const modoLocal = () => !process.env.DATABASE_URL;
