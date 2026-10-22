// Carga el esquema y los datos de ejemplo en un PostgreSQL embebido (PGlite + PostGIS) y hace unas comprobaciones.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const raiz = process.argv[2];
const ext = {};
for (const [nombre, modulo] of [
  ['postgis', '@electric-sql/pglite-postgis'], ['pg_trgm', '@electric-sql/pglite/contrib/pg_trgm'],
  ['unaccent', '@electric-sql/pglite/contrib/unaccent'], ['pgcrypto', '@electric-sql/pglite/contrib/pgcrypto'],
]) {
  try { const m = await import(modulo); ext[nombre] = m[nombre] ?? m.default; } catch (e) { console.log('sin extensión', nombre, e.message.split('\n')[0]); }
}
const db = new PGlite({ extensions: ext });

// Lo mínimo que Supabase trae de fábrica: esquema auth, usuarios y el rol "authenticated".
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
  create role authenticated;
  grant usage on schema public, auth to authenticated;
  alter default privileges in schema public grant all on tables to authenticated;
  alter default privileges in schema public grant execute on functions to authenticated;
`);
await db.exec(readFileSync(raiz + '/supabase/migrations/0001_esquema.sql', 'utf8'));
console.log('esquema: OK');
await db.exec(readFileSync(raiz + '/supabase/seed.sql', 'utf8'));
console.log('datos de ejemplo: OK');

const q = async (sql) => (await db.query(sql)).rows;
console.log('tablas:', (await q(`select count(*)::int n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`))[0].n);
console.log('alertas de Predio Ejemplo:', await q(`select regla, severidad, mensaje from alertas_calidad order by regla`));
console.log('tablero:', await q(`select * from tablero_indicadores`));

const falla = async (titulo, sql) => {
  try { await db.exec(sql); console.log('NO FALLÓ (mal):', titulo); } catch (e) { console.log('rechazado (bien):', titulo, '→', e.message.split('\n')[0]); }
};
await falla('FMI con formato inválido', `insert into predios (nombre, municipio, fmi) values ('X', 'Paipa', '74-ABC')`);
await falla('catastral de 20 dígitos', `insert into predios (nombre, municipio, codigo_catastral) values ('X', 'Paipa', '12345678901234567890')`);
await falla('costo "no aplica" sin justificación', `insert into zonas_conservacion (id, nombre, tipo) values ('00000000-0000-4000-8000-0000000000aa', 'Z', 't');
  insert into costo_oportunidad (zona_id, uso_suelo, aplicacion, fecha_calculo, anio_base, vigente_desde) values ('00000000-0000-4000-8000-0000000000aa', 'sin uso', 'no_aplica', current_date, 2025, current_date)`);

// Polígono de prueba (≈1 ha) para comprobar el área calculada y la alerta de unidades.
await db.exec(`update predios set geom = st_multi(st_geomfromtext('POLYGON((-73.10 5.80, -73.0991 5.80, -73.0991 5.8009, -73.10 5.8009, -73.10 5.80))', 4326)) where nombre = 'Predio Ejemplo'`);
console.log('área del polígono:', await q(`select area_total_ha, area_poligono_ha from predios where nombre = 'Predio Ejemplo'`));
await db.exec(`update predios set area_total_ha = 10285.77 where nombre = 'Predio Ejemplo'`);
console.log('alertas con m² escritos como ha:', (await q(`select regla from alertas_calidad where not resuelta order by regla`)).map((r) => r.regla));
await db.exec(`update predios set area_total_ha = 1.114 where nombre = 'Predio Ejemplo'`);

// Seguridad por rol
await db.exec(`
  insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c1', 'consulta@prueba.co'), ('00000000-0000-4000-8000-0000000000c2', 'campo@prueba.co'), ('00000000-0000-4000-8000-0000000000c3', 'financiero@prueba.co');
  update perfiles set rol = 'funcionario_campo' where id = '00000000-0000-4000-8000-0000000000c2';
  update perfiles set rol = 'financiero' where id = '00000000-0000-4000-8000-0000000000c3';
  insert into beneficiario_cuentas (beneficiario_id, banco, tipo_cuenta, numero, titular) values ('00000000-0000-4000-8000-000000000002', 'Banco Agrario', 'ahorros', '000', 'JAC');
`);
const como = async (uid, sql) => {
  await db.exec(`set role authenticated; select set_config('prueba.uid', '${uid}', false)`);
  try { return await q(sql); } catch (e) { return 'ERROR: ' + e.message.split('\n')[0]; } finally { await db.exec(`reset role`); }
};
const c1 = '00000000-0000-4000-8000-0000000000c1', c2 = '00000000-0000-4000-8000-0000000000c2', c3 = '00000000-0000-4000-8000-0000000000c3';
console.log('consulta ve predios:', (await como(c1, `select count(*)::int n from predios`))[0].n, '· cuentas:', (await como(c1, `select count(*)::int n from beneficiario_cuentas`))[0].n);
console.log('consulta intenta editar predio:', await como(c1, `update predios set nombre = 'hack' returning id`));
console.log('financiero ve cuentas:', (await como(c3, `select count(*)::int n from beneficiario_cuentas`))[0].n);
console.log('campo sin asignación ve predios:', (await como(c2, `select count(*)::int n from predios`))[0].n);
await db.exec(`insert into predio_asignaciones (predio_id, funcionario_id) values ('00000000-0000-4000-8000-000000000003', '${c2}')`);
console.log('campo con asignación ve predios:', (await como(c2, `select count(*)::int n from predios`))[0].n, '· beneficiarios:', (await como(c2, `select count(*)::int n from beneficiarios`))[0].n);
console.log('campo crea visita propia:', await como(c2, `insert into visitas_campo (predio_id, funcionario_id, fecha_hora) values ('00000000-0000-4000-8000-000000000003', '${c2}', now()) returning estado_sincronizacion`));
console.log('campo crea visita a nombre de otro:', await como(c2, `insert into visitas_campo (predio_id, funcionario_id, fecha_hora) values ('00000000-0000-4000-8000-000000000003', '${c1}', now()) returning id`));
console.log('sin perfil (anónimo autenticado) ve convenios:', (await como('', `select count(*)::int n from convenios`))[0].n);
console.log('filas en auditoría:', (await q(`select count(*)::int n from auditoria`))[0].n);
console.log('completitud de un acuerdo de prueba:');
await db.exec(`insert into acuerdos (id, convenio_id, beneficiario_id, predio_id, modalidad, area_ha, estado) values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'hidrico', 1.09, 'activo')`);
console.log(await q(`select * from completitud_acuerdo('00000000-0000-4000-8000-0000000000d1')`), await q(`select hectareas_psa, beneficiarios_activos from tablero_indicadores`));
