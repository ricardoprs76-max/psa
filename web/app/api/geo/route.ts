import { q, type Fila } from "@/lib/db";
import { usuarioActual } from "@/lib/sesion";

/** Polígonos de predios, zonas y capas de referencia en GeoJSON, más los traslapes detectados entre ellos. */
export async function GET() {
  const usuario = await usuarioActual();
  if (!usuario) return new Response("Sin sesión", { status: 401 });
  if (usuario.rol === "funcionario_campo") return new Response("No encontrado", { status: 404 });
  const coleccion = async (sql: string) => ({
    type: "FeatureCollection",
    features: (await q<Fila>(sql)).map((f) => ({ type: "Feature", id: f.id, geometry: f.geometria, properties: f.propiedades })),
  });
  const predios = await coleccion(
    `select id, st_asgeojson(geom, 6)::jsonb as geometria,
            jsonb_build_object('id', id, 'nombre', nombre, 'municipio', municipio, 'vereda', vereda, 'area_ha', area_poligono_ha, 'area_registrada', area_total_ha, 'capa', 'predios') as propiedades
     from predios where geom is not null and eliminado_en is null`);
  const zonas = await coleccion(
    `select id, st_asgeojson(geom, 6)::jsonb as geometria, jsonb_build_object('id', id, 'nombre', nombre, 'tipo', tipo, 'area_ha', area_ha, 'capa', 'zonas_conservacion') as propiedades
     from zonas_conservacion where geom is not null and eliminado_en is null`);
  const capas = await coleccion(
    `select id, st_asgeojson(geom, 6)::jsonb as geometria, jsonb_build_object('id', id, 'nombre', nombre, 'categoria', categoria, 'capa', 'capas_referencia') as propiedades from capas_referencia`);
  // Visitas de campo: el punto GPS de cada visita (o, si no lo tiene, el de su primera foto).
  const visitas = await coleccion(
    `select v.id, st_asgeojson(coalesce(v.ubicacion, (select f.ubicacion from visita_fotos f where f.visita_id = v.id and f.ubicacion is not null and f.eliminado_en is null order by f.tomada_en limit 1)), 6)::jsonb as geometria,
            jsonb_build_object('id', v.id, 'capa', 'visitas', 'predio', p.nombre, 'fecha', to_char(v.fecha_hora at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI'),
              'funcionario', coalesce(pf.nombre, ''), 'estado', coalesce(v.estado_conservacion, ''), 'cobertura', coalesce(v.cobertura, ''),
              'cumple', case v.cumple_compromisos when true then 'Cumple' when false then 'No cumple' else 'Sin dato' end,
              'fotos', (select count(*) from visita_fotos f where f.visita_id = v.id and f.eliminado_en is null)) as propiedades
     from visitas_campo v join predios p on p.id = v.predio_id left join perfiles pf on pf.id = v.funcionario_id
     where v.eliminado_en is null and (v.ubicacion is not null or exists (select 1 from visita_fotos f where f.visita_id = v.id and f.ubicacion is not null and f.eliminado_en is null))`);
  const traslapes = await q<Fila>(
    `select p.id as predio_id, p.nombre as predio, t.categoria, t.nombre, t.area_ha
     from predios p cross join lateral traslapes_predio(p.id) t where p.geom is not null and p.eliminado_en is null and t.area_ha > 0 order by t.area_ha desc limit 200`);
  const destinos = {
    predios: await q<Fila>("select id, nombre, geom is not null as con from predios where eliminado_en is null order by nombre limit 2000"),
    zonas_conservacion: await q<Fila>("select id, nombre, geom is not null as con from zonas_conservacion where eliminado_en is null order by nombre limit 2000"),
  };
  return Response.json({ predios, zonas, capas, visitas, traslapes, destinos });
}
