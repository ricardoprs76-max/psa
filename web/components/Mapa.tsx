"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapaGL } from "maplibre-gl";

// MapLibre dibuja los polígonos en un proceso auxiliar. El empaquetador de Next no logra ubicarlo solo,
// así que se sirve desde public/ (lo copia "npm run mapa", que corre al instalar).
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
import { useCallback, useEffect, useRef, useState } from "react";
import { borrarGeometria, guardarGeometria } from "@/app/acciones";

type Destino = "predios" | "zonas_conservacion" | "capas_referencia";
type Datos = {
  predios: GeoJSON.FeatureCollection; zonas: GeoJSON.FeatureCollection; capas: GeoJSON.FeatureCollection; visitas?: GeoJSON.FeatureCollection;
  traslapes: { predio_id: string; predio: string; categoria: string; nombre: string; area_ha: string }[];
  destinos: Record<"predios" | "zonas_conservacion", { id: string; nombre: string; con: boolean }[]>;
};

const ESTILO: maplibregl.StyleSpecification = {
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap" } },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};
const CAPAS: [clave: keyof Pick<Datos, "predios" | "zonas" | "capas">, color: string, nombre: string][] = [
  ["capas", "#7c3aed", "Capas de referencia"], ["zonas", "#15803d", "Zonas de conservación"], ["predios", "#ea580c", "Predios"],
];
const CATEGORIAS = [["area_protegida", "Área protegida"], ["paramo", "Páramo delimitado"], ["reserva_forestal", "Reserva forestal"], ["otro_incentivo", "Otro incentivo"]];

/** Reúne todos los polígonos de lo que se cargó en un solo MultiPolygon. */
function aMultiPoligono(geo: GeoJSON.GeoJSON): GeoJSON.MultiPolygon | null {
  const poligonos: GeoJSON.Position[][][] = [];
  const recorrer = (g: GeoJSON.GeoJSON | null) => {
    if (!g) return;
    if (g.type === "FeatureCollection") g.features.forEach(recorrer);
    else if (g.type === "Feature") recorrer(g.geometry);
    else if (g.type === "GeometryCollection") g.geometries.forEach(recorrer);
    else if (g.type === "Polygon") poligonos.push(g.coordinates);
    else if (g.type === "MultiPolygon") poligonos.push(...g.coordinates);
  };
  recorrer(geo);
  return poligonos.length ? { type: "MultiPolygon", coordinates: poligonos } : null;
}

async function leerArchivoGeo(archivo: File): Promise<GeoJSON.GeoJSON> {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith(".kml")) {
    const { kml } = await import("@tmcw/togeojson");
    return kml(new DOMParser().parseFromString(await archivo.text(), "text/xml")) as GeoJSON.GeoJSON;
  }
  if (nombre.endsWith(".zip") || nombre.endsWith(".shp")) {
    const shp = (await import("shpjs")).default;
    const r = await shp(await archivo.arrayBuffer());
    return (Array.isArray(r) ? { type: "FeatureCollection", features: r.flatMap((c) => c.features) } : r) as GeoJSON.GeoJSON;
  }
  return JSON.parse(await archivo.text());
}

export function Mapa({ puedeEditar }: { puedeEditar: boolean }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaGL | null>(null);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [pendiente, setPendiente] = useState<GeoJSON.MultiPolygon | null>(null);   // polígono cargado o dibujado, sin guardar
  const [dibujando, setDibujando] = useState(false);
  const vertices = useRef<[number, number][]>([]);
  const [destino, setDestino] = useState<Destino>("predios");
  const [destinoId, setDestinoId] = useState("");
  const [capa, setCapa] = useState({ nombre: "", categoria: "area_protegida" });
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [seleccion, setSeleccion] = useState<{ capa: Destino; id: string; nombre: string } | null>(null);

  const cargar = useCallback(async () => {
    const r = await fetch("/api/geo", { cache: "no-store" });
    if (r.ok) setDatos(await r.json());
  }, []);

  // Crea el mapa una sola vez.
  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    const m = new maplibregl.Map({ container: contenedor.current, style: ESTILO, center: [-73.1, 5.78], zoom: 9 });
    m.addControl(new maplibregl.NavigationControl(), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }));
    m.on("load", () => {
      for (const [clave, color] of CAPAS) {
        m.addSource(clave, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: `${clave}-relleno`, type: "fill", source: clave, paint: { "fill-color": color, "fill-opacity": clave === "predios" ? 0.35 : 0.18 } });
        m.addLayer({ id: `${clave}-borde`, type: "line", source: clave, paint: { "line-color": color, "line-width": clave === "predios" ? 2.5 : 1.5 } });
        m.on("click", `${clave}-relleno`, (e: maplibregl.MapLayerMouseEvent) => {
          const p = e.features?.[0]?.properties as Record<string, string> | undefined;
          if (!p) return;
          setSeleccion({ capa: p.capa as Destino, id: p.id, nombre: p.nombre });
          const area = p.area_ha ? `<br>${Number(p.area_ha).toLocaleString("es-CO")} ha (polígono)` : "";
          new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<strong>${p.nombre.replace(/[<>&]/g, "")}</strong>${area}`).addTo(m);
        });
        m.on("mouseenter", `${clave}-relleno`, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", `${clave}-relleno`, () => { m.getCanvas().style.cursor = ""; });
      }
      // Visitas de campo: un punto por visita, con su información al tocarlo.
      m.addSource("visitas", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "visitas-puntos", type: "circle", source: "visitas", paint: { "circle-radius": 7, "circle-color": "#2563eb", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      m.on("click", "visitas-puntos", (e: maplibregl.MapLayerMouseEvent) => {
        const p = e.features?.[0]?.properties as Record<string, string> | undefined;
        if (!p) return;
        const t = (x: string) => String(x ?? "").replace(/[<>&]/g, "");
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(
          `<strong>Visita · ${t(p.predio)}</strong><br>${t(p.fecha)}${p.funcionario ? ` · ${t(p.funcionario)}` : ""}` +
          `${p.cobertura ? `<br>Cobertura: ${t(p.cobertura)}` : ""}${p.estado ? `<br>Estado: ${t(p.estado)}` : ""}<br>Compromisos: ${t(p.cumple)} · ${t(p.fotos)} foto(s)` +
          `<br><a href="/visitas/${t(p.id)}" style="color:#2563eb">Ver la visita</a>`).addTo(m);
      });
      m.on("mouseenter", "visitas-puntos", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "visitas-puntos", () => { m.getCanvas().style.cursor = ""; });
      m.addSource("pendiente", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "pendiente-relleno", type: "fill", source: "pendiente", paint: { "fill-color": "#0284c7", "fill-opacity": 0.3 } });
      m.addLayer({ id: "pendiente-borde", type: "line", source: "pendiente", paint: { "line-color": "#0284c7", "line-width": 3, "line-dasharray": [2, 1] } });
      m.addLayer({ id: "pendiente-puntos", type: "circle", source: "pendiente", paint: { "circle-radius": 5, "circle-color": "#0284c7", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      mapa.current = m;
      cargar();
    });
    return () => { m.remove(); mapa.current = null; };
  }, [cargar]);

  // Pinta los datos y encuadra todo lo que hay.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !datos) return;
    const limites = new maplibregl.LngLatBounds();
    for (const [clave] of CAPAS) {
      (m.getSource(clave) as GeoJSONSource).setData(datos[clave]);
      const visitar = (c: unknown): void => { if (Array.isArray(c)) { if (typeof c[0] === "number") limites.extend(c as [number, number]); else c.forEach(visitar); } };
      datos[clave].features.forEach((f) => visitar((f.geometry as GeoJSON.Polygon)?.coordinates));
    }
    if (datos.visitas) {
      (m.getSource("visitas") as GeoJSONSource | undefined)?.setData(datos.visitas);
      datos.visitas.features.forEach((f) => limites.extend((f.geometry as GeoJSON.Point).coordinates as [number, number]));
    }
    if (!limites.isEmpty()) m.fitBounds(limites, { padding: 60, maxZoom: 16, duration: 600 });
  }, [datos]);

  // Muestra el polígono pendiente (cargado o en dibujo).
  const pintarPendiente = useCallback((geo: GeoJSON.Geometry | null, puntos: [number, number][] = []) => {
    const fuente = mapa.current?.getSource("pendiente") as GeoJSONSource | undefined;
    fuente?.setData({ type: "FeatureCollection", features: [...(geo ? [{ type: "Feature" as const, geometry: geo, properties: {} }] : []), ...puntos.map((p) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: p }, properties: {} }))] });
  }, []);

  // Dibujo a mano: cada clic agrega un vértice; doble clic cierra el polígono.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !dibujando) return;
    vertices.current = [];
    m.doubleClickZoom.disable();
    m.getCanvas().style.cursor = "crosshair";
    const alClic = (e: maplibregl.MapMouseEvent) => {
      vertices.current.push([e.lngLat.lng, e.lngLat.lat]);
      const v = vertices.current;
      pintarPendiente(v.length >= 3 ? { type: "Polygon", coordinates: [[...v, v[0]]] } : v.length === 2 ? { type: "LineString", coordinates: v } : null, v);
    };
    const alDoble = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      const v = vertices.current.slice(0, -1);   // el doble clic ya agregó dos veces el último punto
      if (v.length < 3) { setMensaje({ tipo: "error", texto: "Un polígono necesita al menos 3 puntos." }); return; }
      const multi: GeoJSON.MultiPolygon = { type: "MultiPolygon", coordinates: [[[...v, v[0]]]] };
      setPendiente(multi);
      pintarPendiente(multi);
      setDibujando(false);
    };
    m.on("click", alClic);
    m.on("dblclick", alDoble);
    return () => { m.off("click", alClic); m.off("dblclick", alDoble); m.doubleClickZoom.enable(); m.getCanvas().style.cursor = ""; };
  }, [dibujando, pintarPendiente]);

  const alElegirArchivo = async (archivo: File | undefined) => {
    if (!archivo) return;
    setMensaje(null);
    try {
      const multi = aMultiPoligono(await leerArchivoGeo(archivo));
      if (!multi) throw new Error("El archivo no contiene polígonos.");
      setPendiente(multi);
      pintarPendiente(multi);
      const limites = new maplibregl.LngLatBounds();
      multi.coordinates.flat(2).forEach((c) => limites.extend(c as [number, number]));
      mapa.current?.fitBounds(limites, { padding: 80, maxZoom: 17 });
      const [x, y] = multi.coordinates[0][0][0];
      if (Math.abs(x) > 180 || Math.abs(y) > 90) setMensaje({ tipo: "error", texto: "Las coordenadas no parecen estar en grados (WGS84). Exporta el archivo en EPSG:4326." });
    } catch (e) {
      setMensaje({ tipo: "error", texto: `No pude leer el archivo: ${(e as Error).message}` });
    }
  };

  const guardar = async () => {
    if (!pendiente) return;
    if (destino !== "capas_referencia" && !destinoId) { setMensaje({ tipo: "error", texto: "Elige a qué registro pertenece el polígono." }); return; }
    if (destino === "capas_referencia" && !capa.nombre.trim()) { setMensaje({ tipo: "error", texto: "Escribe el nombre de la capa." }); return; }
    const r = await guardarGeometria(destino, destinoId || null, JSON.stringify(pendiente), capa);
    if ("error" in r) { setMensaje({ tipo: "error", texto: r.error ?? "No se pudo guardar." }); return; }
    setMensaje({ tipo: "ok", texto: "Polígono guardado. El área se calculó en la base de datos." });
    setPendiente(null); pintarPendiente(null); cargar();
  };

  const quitar = async () => {
    if (!seleccion || !confirm(`¿Quitar el polígono de "${seleccion.nombre}"? El registro se conserva.`)) return;
    await borrarGeometria(seleccion.capa, seleccion.id);
    setSeleccion(null); cargar();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="relative overflow-hidden rounded-2xl border border-borde">
        <div ref={contenedor} className="h-[72vh] min-h-[420px] w-full" />
        <div className="absolute left-3 top-3 space-y-1 rounded-xl bg-white/90 px-3 py-2 text-xs text-slate-800 shadow">
          {CAPAS.slice().reverse().map(([clave, color, nombre]) => <div key={clave} className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: color }} />{nombre}</div>)}
          <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: "#2563eb" }} />Visitas de campo ({datos?.visitas?.features.length ?? 0})</div>
        </div>
        {dibujando && <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-sky-700 px-4 py-2 text-sm text-white shadow">Clic para agregar puntos · doble clic para cerrar</div>}
      </div>
      <div className="space-y-4">
        {mensaje && <div className={`rounded-xl border px-3 py-2 text-sm ${mensaje.tipo === "error" ? "border-red-300 bg-red-50 text-red-800" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>{mensaje.texto}</div>}
        {puedeEditar && (
          <div className="rounded-2xl border border-borde bg-tarjeta p-4">
            <h2 className="mb-2 font-semibold">Cargar o dibujar un polígono</h2>
            <input type="file" accept=".geojson,.json,.kml,.zip,.shp" onChange={(e) => alElegirArchivo(e.target.files?.[0])} className="campo" />
            <p className="mt-1 text-xs text-tenue">GeoJSON, KML o Shapefile (en .zip), en coordenadas WGS84.</p>
            <button onClick={() => { setPendiente(null); pintarPendiente(null); setDibujando(!dibujando); }} className="mt-2 h-9 w-full cursor-pointer rounded-lg border border-borde text-sm font-medium hover:bg-marca-suave">
              {dibujando ? "Cancelar dibujo" : "Dibujar a mano en el mapa"}
            </button>
            {pendiente && (
              <div className="mt-3 space-y-2 border-t border-borde pt-3">
                <label className="block text-xs text-tenue">¿A qué corresponde?
                  <select value={destino} onChange={(e) => { setDestino(e.target.value as Destino); setDestinoId(""); }} className="campo mt-1">
                    <option value="predios">Un predio</option><option value="zonas_conservacion">Una zona de conservación</option><option value="capas_referencia">Capa de referencia (traslapes)</option>
                  </select>
                </label>
                {destino === "capas_referencia" ? (
                  <>
                    <input placeholder="Nombre de la capa" value={capa.nombre} onChange={(e) => setCapa({ ...capa, nombre: e.target.value })} className="campo" />
                    <select value={capa.categoria} onChange={(e) => setCapa({ ...capa, categoria: e.target.value })} className="campo">{CATEGORIAS.map(([v, e]) => <option key={v} value={v}>{e}</option>)}</select>
                  </>
                ) : (
                  <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)} className="campo">
                    <option value="">— Elegir —</option>
                    {datos?.destinos[destino].map((d) => <option key={d.id} value={d.id}>{d.nombre}{d.con ? " (reemplaza el actual)" : ""}</option>)}
                  </select>
                )}
                <button onClick={guardar} className="h-9 w-full cursor-pointer rounded-lg bg-marca text-sm font-medium text-white hover:bg-marca-fuerte">Guardar polígono</button>
              </div>
            )}
          </div>
        )}
        {seleccion && (
          <div className="rounded-2xl border border-borde bg-tarjeta p-4 text-sm">
            <div className="font-semibold">{seleccion.nombre}</div>
            <div className="mt-2 flex gap-2">
              {seleccion.capa !== "capas_referencia" && <a className="rounded-lg border border-borde px-3 py-1.5 hover:bg-marca-suave" href={`/m/${seleccion.capa === "predios" ? "predios" : "zonas"}/${seleccion.id}`}>Abrir ficha</a>}
              {puedeEditar && <button onClick={quitar} className="cursor-pointer rounded-lg border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50">Quitar polígono</button>}
            </div>
          </div>
        )}
        <div className="rounded-2xl border border-borde bg-tarjeta p-4">
          <h2 className="mb-2 font-semibold">Traslapes detectados</h2>
          {!datos ? <p className="text-sm text-tenue">Cargando…</p> : datos.traslapes.length === 0 ? <p className="text-sm text-tenue">Ningún predio con polígono se cruza con otra capa o con otro predio.</p> : (
            <ul className="space-y-2 text-sm">{datos.traslapes.map((t, i) => (
              <li key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <strong>{t.predio}</strong> con {t.categoria === "otro_predio" ? "el predio" : CATEGORIAS.find(([v]) => v === t.categoria)?.[1]?.toLowerCase() ?? t.categoria} <strong>{t.nombre}</strong>: {Number(t.area_ha).toLocaleString("es-CO")} ha
              </li>
            ))}</ul>
          )}
        </div>
      </div>
    </div>
  );
}
