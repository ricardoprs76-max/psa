import "server-only";
import crypto from "node:crypto";
import { guardarArchivo } from "./archivos";
import { comoUsuario, q, q1, type Fila } from "./db";
import { llaveServidor, validoDesde, type Usuario } from "./sesion";

/**
 * Servicio para la app de campo: acceso con token, descarga de los predios asignados y sincronización de visitas
 * con detección de conflictos. La app trabaja sin conexión y llama a esto cuando recupera señal.
 */

const DIAS_TOKEN = 30;
const firmar = (texto: string) => crypto.createHmac("sha256", llaveServidor()).update("movil:" + texto).digest("base64url");

export function crearToken(usuarioId: string): string {
  const cuerpo = `${usuarioId}.${Date.now() + DIAS_TOKEN * 86_400_000}`;
  return `${cuerpo}.${firmar(cuerpo)}`;
}

/** Usuario del encabezado "Authorization: Bearer …", o null si el token no vale o el perfil está inactivo. */
export async function usuarioDeToken(peticion: Request): Promise<Usuario | null> {
  const token = /^Bearer (.+)$/.exec(peticion.headers.get("authorization") ?? "")?.[1];
  if (!token) return null;
  const [id, vence, firma] = token.split(".");
  if (!id || !vence || !firma) return null;
  const esperada = firmar(`${id}.${vence}`);
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  if (Number(vence) < Date.now()) return null;
  if (Number(vence) - DIAS_TOKEN * 86_400_000 < (await validoDesde())) return null; // emitido antes del último cambio de contraseña
  return q1<Usuario>("select p.id, p.nombre, p.rol, u.email as correo from perfiles p join auth.users u on u.id = p.id where p.id = $1 and p.activo", [id]);
}

/** Todo lo que el teléfono guarda para trabajar sin conexión: predios asignados (con polígono, titulares y acuerdos) y sus propias visitas. */
export async function paquete(usuario: Usuario): Promise<Fila> {
  const predios = await q<Fila>(
    `select p.id, p.nombre, p.fmi, p.codigo_catastral, p.vereda, p.municipio, p.departamento, p.altitud_min, p.altitud_max, p.area_total_ha, p.area_conservacion_ha,
            p.ecosistema_estrategico, p.uso_permitido, p.uso_prohibido, p.infraestructura, p.clasificacion_pot,
            st_asgeojson(p.geom, 6)::jsonb as poligono, st_y(st_centroid(p.geom)) as lat, st_x(st_centroid(p.geom)) as lon,
            (select coalesce(jsonb_agg(jsonb_build_object('nombre', b.nombre, 'telefono', b.telefono, 'representante', b.representante_nombre)), '[]'::jsonb)
               from predio_titulares pt join beneficiarios b on b.id = pt.beneficiario_id where pt.predio_id = p.id) as titulares,
            (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'codigo', a.codigo, 'modalidad', a.modalidad, 'estado', a.estado, 'compromisos', a.compromisos, 'area_ha', a.area_ha)), '[]'::jsonb)
               from acuerdos a where a.predio_id = p.id and a.eliminado_en is null) as acuerdos
     from predios p join predio_asignaciones pa on pa.predio_id = p.id and pa.funcionario_id = $1 where p.eliminado_en is null order by p.nombre`, [usuario.id]);
  const visitas = await q<Fila>(
    `select id, predio_id, acuerdo_id, fecha_hora, st_y(ubicacion) as lat, st_x(ubicacion) as lon, precision_m, altitud, cobertura, estado_conservacion, presiones,
            cumple_compromisos, cumplimiento_detalle, hallazgos, recomendaciones, firmante_nombre, firmante_documento, revision, firma_ruta is not null as con_firma,
            (select coalesce(jsonb_agg(f.id), '[]'::jsonb) from visita_fotos f where f.visita_id = v.id and f.eliminado_en is null) as fotos
     from visitas_campo v where funcionario_id = $1 and eliminado_en is null and fecha_hora > now() - interval '18 months' order by fecha_hora desc`, [usuario.id]);
  return { servidor_ahora: new Date().toISOString(), usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, correo: usuario.correo }, predios, visitas };
}

const CAMPOS = ["predio_id", "acuerdo_id", "fecha_hora", "precision_m", "altitud", "cobertura", "estado_conservacion", "presiones", "cumple_compromisos", "cumplimiento_detalle",
  "hallazgos", "recomendaciones", "firmante_nombre", "firmante_documento"] as const;

export type ResultadoVisita = { estado: "guardada"; revision: number } | { estado: "conflicto"; servidor: Fila } | { estado: "rechazada"; motivo: string };

/**
 * Guarda la visita que llega del teléfono.
 *  - Nueva: se inserta con revisión 1.
 *  - Existente y el teléfono partió de la revisión actual: se actualiza y la revisión sube.
 *  - Existente pero alguien la cambió en el servidor después (revisión distinta): es un conflicto. No se pisa nada; se devuelve la
 *    versión del servidor para que la persona elija. Si reenvía con "forzar", gana la del teléfono y la del servidor queda guardada
 *    en conflicto_resuelto (además de la bitácora de auditoría).
 */
export async function guardarVisita(usuario: Usuario, v: Fila): Promise<ResultadoVisita> {
  if (!/^[0-9a-f-]{36}$/i.test(String(v.id ?? ""))) return { estado: "rechazada", motivo: "La visita no trae un identificador válido." };
  if (!v.fecha_hora || Number.isNaN(new Date(v.fecha_hora).getTime())) return { estado: "rechazada", motivo: "La fecha de la visita no es válida." };
  const asignado = await q1("select 1 from predio_asignaciones where predio_id = $1 and funcionario_id = $2", [v.predio_id, usuario.id]);
  if (!asignado && !["administrador", "coordinador"].includes(usuario.rol)) return { estado: "rechazada", motivo: "Ese predio ya no está asignado a tu usuario." };
  const actual = await q1<Fila>("select *, st_y(ubicacion) as lat, st_x(ubicacion) as lon from visitas_campo where id = $1", [v.id]);
  if (actual && actual.funcionario_id !== usuario.id) return { estado: "rechazada", motivo: "Esa visita pertenece a otro funcionario." };

  const valores = CAMPOS.map((c) => (c === "presiones" ? (Array.isArray(v.presiones) ? v.presiones.map(String) : null) : v[c] ?? null));
  const punto = typeof v.lat === "number" && typeof v.lon === "number" ? [v.lon, v.lat] : [null, null];
  let firmaRuta: string | null = null;
  if (typeof v.firma_png_base64 === "string" && v.firma_png_base64.length > 100) {
    const datos = Buffer.from(v.firma_png_base64, "base64");
    if (datos.length > 2 * 1024 * 1024 || datos.subarray(1, 4).toString() !== "PNG") return { estado: "rechazada", motivo: "La firma no es una imagen PNG válida." };
    firmaRuta = await guardarArchivo(`visitas/${v.id}`, "firma.png", datos);
  }

  return comoUsuario(usuario.id, async () => {
    if (!actual) {
      await q(
        `insert into visitas_campo (id, funcionario_id, ${CAMPOS.join(", ")}, ubicacion, firma_ruta, dispositivo_id, formulario, revision, estado_sincronizacion)
         values ($1, $2, ${CAMPOS.map((_, i) => `$${i + 3}`).join(", ")}, case when $17::float8 is null then null else st_setsrid(st_makepoint($17, $18), 4326) end, $19, $20, $21, 1, 'sincronizada')`,
        [v.id, usuario.id, ...valores, punto[0], punto[1], firmaRuta, v.dispositivo_id ?? null, JSON.stringify(v.formulario ?? {})]);
      return { estado: "guardada", revision: 1 } as const;
    }
    if (Number(v.revision_base ?? 0) !== actual.revision && !v.forzar) {
      const { ubicacion: _u, formulario: _f, ...servidor } = actual;
      return { estado: "conflicto", servidor } as const;
    }
    const perdida = Number(v.revision_base ?? 0) !== actual.revision ? JSON.stringify(Object.fromEntries(Object.entries(actual).filter(([k]) => k !== "ubicacion"))) : null;
    const fila = await q1<{ revision: number }>(
      `update visitas_campo set ${CAMPOS.map((c, i) => `${c} = $${i + 2}`).join(", ")},
         ubicacion = case when $16::float8 is null then ubicacion else st_setsrid(st_makepoint($16, $17), 4326) end, firma_ruta = coalesce($18, firma_ruta),
         dispositivo_id = $19, formulario = $20, revision = revision + 1, estado_sincronizacion = 'sincronizada', conflicto_resuelto = coalesce($21::jsonb, conflicto_resuelto)
       where id = $1 returning revision`,
      [v.id, ...valores, punto[0], punto[1], firmaRuta, v.dispositivo_id ?? null, JSON.stringify(v.formulario ?? {}), perdida]);
    return { estado: "guardada", revision: fila!.revision } as const;
  });
}

/** Guarda una foto de la visita. Repetir el envío de la misma foto (mismo id) no la duplica. */
export async function guardarFoto(usuario: Usuario, datos: { id: string; visita_id: string; lat: number | null; lon: number | null; tomada_en: string; descripcion: string | null; archivo: File }): Promise<{ ok: true } | { error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(datos.id)) return { error: "La foto no trae un identificador válido." };
  const visita = await q1<Fila>("select funcionario_id from visitas_campo where id = $1", [datos.visita_id]);
  if (!visita) return { error: "Primero debe sincronizarse la visita." };
  if (visita.funcionario_id !== usuario.id) return { error: "La visita pertenece a otro funcionario." };
  if (await q1("select 1 from visita_fotos where id = $1", [datos.id])) return { ok: true };
  if (datos.archivo.size > 15 * 1024 * 1024) return { error: "La foto supera los 15 MB." };
  const bytes = Buffer.from(await datos.archivo.arrayBuffer());
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8) && bytes.subarray(1, 4).toString() !== "PNG") return { error: "La foto debe ser JPG o PNG." };
  const ruta = await guardarArchivo(`visitas/${datos.visita_id}`, bytes[0] === 0xff ? "foto.jpg" : "foto.png", bytes);
  await comoUsuario(usuario.id, () => q(
    "insert into visita_fotos (id, visita_id, archivo_ruta, ubicacion, tomada_en, descripcion) values ($1, $2, $3, case when $4::float8 is null then null else st_setsrid(st_makepoint($4, $5), 4326) end, $6, $7)",
    [datos.id, datos.visita_id, ruta, datos.lon, datos.lat, datos.tomada_en, datos.descripcion]));
  return { ok: true };
}

// ---------- Predios creados desde el teléfono ----------

const GEOM = "st_multi(st_collectionextract(st_makevalid(st_force2d(st_setsrid(st_geomfromgeojson($1), 4326))), 3))";

/** Polígono válido en GeoJSON (Polygon o MultiPolygon) con al menos 3 vértices, o null. */
function poligonoValido(g: unknown): string | null {
  if (!g || typeof g !== "object") return null;
  const tipo = (g as { type?: string }).type;
  const coords = (g as { coordinates?: unknown }).coordinates;
  if ((tipo !== "Polygon" && tipo !== "MultiPolygon") || !Array.isArray(coords)) return null;
  const anillo = (tipo === "Polygon" ? coords[0] : (coords[0] as unknown[])?.[0]) as unknown[] | undefined;
  if (!Array.isArray(anillo) || anillo.length < 4) return null;
  return JSON.stringify(g);
}

/**
 * Crea un predio levantado en campo y lo asigna a quien lo creó (para que lo vea en su teléfono). Repetir el envío
 * con el mismo id no lo duplica. La oficina completa luego titulares, acuerdos y demás desde la plataforma.
 */
export async function crearPredio(usuario: Usuario, d: Fila): Promise<{ ok: true } | { error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(String(d.id ?? ""))) return { error: "El predio no trae un identificador válido." };
  const nombre = String(d.nombre ?? "").trim();
  const municipio = String(d.municipio ?? "").trim();
  if (!nombre || !municipio) return { error: "El predio necesita nombre y municipio." };
  const fmi = String(d.fmi ?? "").trim() || null;
  if (fmi && !/^[0-9]{3}-[0-9]{1,8}$/.test(fmi)) return { error: "La matrícula debe tener la forma 074-12345." };
  const area = d.area_total_ha == null || d.area_total_ha === "" ? null : Number(d.area_total_ha);
  if (area != null && !(area > 0)) return { error: "El área total debe ser mayor que cero." };
  const geo = d.poligono ? poligonoValido(d.poligono) : null;
  if (await q1("select 1 from predios where id = $1", [d.id])) {
    await q("insert into predio_asignaciones (predio_id, funcionario_id) values ($1, $2) on conflict do nothing", [d.id, usuario.id]);
    return { ok: true };
  }
  if (fmi && await q1("select 1 from predios where fmi = $1 and eliminado_en is null", [fmi])) return { error: `Ya existe un predio con la matrícula ${fmi}. Pide a la oficina que te lo asigne.` };
  await comoUsuario(usuario.id, async () => {
    await q(
      `insert into predios (id, nombre, fmi, vereda, municipio, departamento, area_total_ha, ecosistema_estrategico, observaciones, geom)
       values ($2, $3, $4, $5, $6, $7, $8, $9, $10, case when $1::text is null then null else ${GEOM} end)`,
      [geo, d.id, nombre, fmi, String(d.vereda ?? "").trim() || null, municipio, String(d.departamento ?? "").trim() || "Boyacá", area,
        String(d.ecosistema_estrategico ?? "").trim() || null, (String(d.observaciones ?? "").trim() ? String(d.observaciones).trim() + "\n" : "") + `Creado en campo por ${usuario.correo ?? usuario.nombre}.`]);
    await q("insert into predio_asignaciones (predio_id, funcionario_id) values ($1, $2) on conflict do nothing", [d.id, usuario.id]);
  });
  return { ok: true };
}

/** Guarda el polígono delimitado en el teléfono para un predio asignado. */
export async function guardarPoligono(usuario: Usuario, predioId: string, poligono: unknown): Promise<{ ok: true } | { error: string }> {
  const geo = poligonoValido(poligono);
  if (!geo) return { error: "El polígono necesita al menos 3 puntos." };
  const asignado = await q1("select 1 from predio_asignaciones where predio_id = $1 and funcionario_id = $2", [predioId, usuario.id]);
  if (!asignado && !["administrador", "coordinador"].includes(usuario.rol)) return { error: "Ese predio no está asignado a tu usuario." };
  await comoUsuario(usuario.id, () => q(`update predios set geom = ${GEOM}, actualizado_en = now() where id = $2`, [geo, predioId]));
  return { ok: true };
}
