// Pasa los datos de la base local (web/.datos/pg) a un PostgreSQL en la nube (Neon, Supabase…).
// Uso, con el sistema cerrado:   set DATABASE_URL=postgresql://…   y luego   node migrar-a-postgres.mjs
// Crea el esquema en el destino si falta, BORRA lo que haya en sus tablas y copia todas las filas tal cual.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

if (!process.env.DATABASE_URL) { console.error("Falta DATABASE_URL."); process.exit(1); }
const dirPg = path.join(process.env.PSA_DIR_DATOS || ".datos", "pg");
if (!fs.existsSync(dirPg)) { console.error(`No hay base local en ${dirPg}.`); process.exit(1); }

const origen = new PGlite(dirPg, { extensions: { postgis, pg_trgm, unaccent, pgcrypto } });
await origen.waitReady;
const destino = new pg.Client({ connectionString: process.env.DATABASE_URL });
await destino.connect();
if (process.env.PSA_DEPURAR) { const q = destino.query.bind(destino); destino.query = (t, p) => { console.log("SQL>", String(t).slice(0, 300), p ? JSON.stringify(p).slice(0, 200) : ""); return q(t, p); }; }
const id = (s) => `"${s.replace(/"/g, '""')}"`;

// 1. Esquema en el destino (lo mismo que hace el sistema al arrancar).
const authPropio = (await destino.query("select to_regclass('auth.users') is not null and to_regclass('_migraciones') is null as si")).rows[0].si;
await destino.query("create table if not exists _migraciones (nombre text primary key, aplicada_en timestamptz default now())");
if (authPropio) await destino.query("insert into _migraciones (nombre) values ('auth_local.sql') on conflict do nothing");
const hechas = new Set((await destino.query("select nombre from _migraciones")).rows.map((r) => r.nombre));
const sql = path.join("..", "supabase");
for (const archivo of [path.join(sql, "local", "auth_local.sql"), ...fs.readdirSync(path.join(sql, "migrations")).sort().map((f) => path.join(sql, "migrations", f)), path.join(sql, "seed.sql")]) {
  const nombre = path.basename(archivo);
  if (hechas.has(nombre)) continue;
  await destino.query(fs.readFileSync(archivo, "utf8"));
  await destino.query("insert into _migraciones (nombre) values ($1)", [nombre]);
  console.log("esquema:", nombre);
}

// 2. Tablas del origen, ordenadas para que cada una vaya después de las que referencia.
const TABLAS = `select n.nspname as esquema, c.relname as tabla, c.oid::int as oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and ((n.nspname = 'public' and c.relname <> 'spatial_ref_sys') or (n.nspname = 'auth' and c.relname = 'users'))`;
const COLUMNAS = `select a.attname as col, format_type(a.atttypid, a.atttypmod) as tipo from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' order by a.attnum`;
const tablas = (await origen.query(TABLAS)).rows;
const refs = (await origen.query("select conrelid::int as de, confrelid::int as a from pg_constraint where contype = 'f' and conrelid <> confrelid")).rows;
const orden = [], puestas = new Set();
while (orden.length < tablas.length) {
  const lista = tablas.filter((t) => !puestas.has(t.oid) && refs.filter((r) => r.de === t.oid).every((r) => puestas.has(r.a) || !tablas.some((x) => x.oid === r.a)));
  if (!lista.length) throw new Error("Las tablas se referencian en círculo; no se pudo ordenar.");
  for (const t of lista.sort((x, y) => (x.esquema === "auth" ? -1 : y.esquema === "auth" ? 1 : x.tabla.localeCompare(y.tabla)))) { orden.push(t); puestas.add(t.oid); }
}

// 3. Vaciar el destino y copiar. Los disparadores propios (auditoría, perfiles…) se apagan para que las filas queden idénticas.
const nombre = (t) => `${id(t.esquema)}.${id(t.tabla)}`;
await destino.query(`truncate table ${orden.map(nombre).join(", ")} cascade`);
let total = 0;
for (const t of orden) {
  const enDestino = new Map((await destino.query(COLUMNAS, [t.esquema, t.tabla])).rows.map((c) => [c.col, c.tipo]));
  if (!enDestino.size) { console.log(`- ${t.tabla}: no existe en el destino, se omite`); continue; }
  const cols = (await origen.query(COLUMNAS, [t.esquema, t.tabla])).rows.map((c) => c.col).filter((c) => enDestino.has(c));
  const filas = (await origen.query(`select ${cols.map((c) => `${id(c)}::text as ${id(c)}`).join(", ")} from ${nombre(t)}`)).rows;
  const sinDisparadores = await destino.query(`alter table ${nombre(t)} disable trigger user`).then(() => true, () => false);
  const insertar = `insert into ${nombre(t)} (${cols.map(id).join(", ")}) overriding system value values (${cols.map((c, i) => `($${i + 1}::text)::${enDestino.get(c)}`).join(", ")})`;
  for (const f of filas) await destino.query(insertar, cols.map((c) => f[c]));
  if (sinDisparadores) await destino.query(`alter table ${nombre(t)} enable trigger user`);
  // Si no se pudieron apagar (tabla de usuarios de Supabase), lo que hayan creado los disparadores se borra antes de seguir.
  else if (t.esquema === "auth") await destino.query(`truncate table ${orden.filter((x) => x.esquema === "public").map(nombre).join(", ")} cascade`);
  // Contadores automáticos al día.
  for (const c of cols) {
    const sec = (await destino.query("select pg_get_serial_sequence($1, $2) as s", [`${t.esquema}.${t.tabla}`, c])).rows[0].s;
    if (sec) await destino.query(`select setval($1::regclass, coalesce((select max(${id(c)}) from ${nombre(t)}), 1))`, [sec]);
  }
  const n = Number((await destino.query(`select count(*) as n from ${nombre(t)}`)).rows[0].n);
  console.log(`${n === filas.length ? "ok" : "DIFERENTE"}  ${t.esquema}.${t.tabla}: ${filas.length} fila(s)${n === filas.length ? "" : ` en el origen, ${n} en el destino`}`);
  total += filas.length;
}
console.log(`Listo: ${total} filas en ${orden.length} tablas.`);
await destino.end();
await origen.close();
