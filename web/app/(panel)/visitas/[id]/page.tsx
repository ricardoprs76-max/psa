import Link from "next/link";
import { notFound } from "next/navigation";
import { BotonImprimir } from "@/components/BotonImprimir";
import { Enlace, Insignia, Tarjeta, Titulo } from "@/components/ui";
import { q, q1, type Fila } from "@/lib/db";
import { exigir } from "@/lib/sesion";

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return <div><dt className="text-xs text-tenue">{etiqueta}</dt><dd className="whitespace-pre-wrap">{children || "—"}</dd></div>;
}

export default async function Visita({ params }: { params: Promise<{ id: string }> }) {
  await exigir("administrador", "coordinador", "financiero", "consulta");
  const { id } = await params;
  const v = await q1<Fila>(
    `select v.*, to_char(v.fecha_hora at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as fecha, st_y(v.ubicacion) as lat, st_x(v.ubicacion) as lon, p.nombre as predio, p.municipio, p.vereda,
            f.nombre as funcionario, lower(u.email) as correo, a.codigo as acuerdo, a.compromisos,
            case when v.ubicacion is not null and p.geom is not null then round(st_distance(v.ubicacion::geography, p.geom::geography)::numeric) end as distancia_m
     from visitas_campo v join predios p on p.id = v.predio_id join perfiles f on f.id = v.funcionario_id left join auth.users u on u.id = v.funcionario_id left join acuerdos a on a.id = v.acuerdo_id
     where v.id = $1 and v.eliminado_en is null`, [id]).catch(() => null);
  if (!v) notFound();
  const fotos = await q<Fila>("select id, descripcion, to_char(tomada_en at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as fecha, st_y(ubicacion) as lat, st_x(ubicacion) as lon from visita_fotos where visita_id = $1 and eliminado_en is null order by tomada_en", [id]);
  const coord = (lat: number | null, lon: number | null) => (lat === null || lon === null ? "sin GPS" : `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`);
  return (
    <>
      <Titulo titulo={`Visita a ${v.predio}`} detalle={`${v.fecha} · Registrada por ${v.correo ?? v.funcionario} (${v.funcionario})`}><BotonImprimir>PDF</BotonImprimir><Enlace href="/visitas">Volver</Enlace></Titulo>
      {v.distancia_m !== null && Number(v.distancia_m) > 300 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">El punto GPS de la visita quedó a {Number(v.distancia_m).toLocaleString("es-CO")} m del polígono del predio.</div>
      )}
      <Tarjeta className="p-5">
        <dl className="grid gap-4 text-sm md:grid-cols-3">
          <Dato etiqueta="Predio"><Link href={`/m/predios/${v.predio_id}`} className="text-marca-fuerte hover:underline">{v.predio}</Link> · {v.vereda}, {v.municipio}</Dato>
          <Dato etiqueta="Acuerdo">{v.acuerdo}</Dato>
          <Dato etiqueta="Ubicación GPS">{coord(v.lat, v.lon)}{v.precision_m ? ` (± ${Number(v.precision_m)} m)` : ""}{v.altitud ? ` · ${Number(v.altitud)} msnm` : ""}</Dato>
          <Dato etiqueta="Cobertura">{v.cobertura}</Dato>
          <Dato etiqueta="Estado de conservación">{v.estado_conservacion}</Dato>
          <Dato etiqueta="Presiones">{(v.presiones ?? []).join(", ")}</Dato>
          <Dato etiqueta="Cumplimiento de compromisos">{v.cumple_compromisos === null ? "" : <Insignia tono={v.cumple_compromisos ? "verde" : "rojo"}>{v.cumple_compromisos ? "cumple" : "no cumple"}</Insignia>} {v.cumplimiento_detalle}</Dato>
          <Dato etiqueta="Compromisos del acuerdo">{v.compromisos}</Dato>
          <Dato etiqueta="Sincronización">revisión {v.revision}{v.dispositivo_id ? ` · dispositivo ${String(v.dispositivo_id).slice(0, 8)}` : ""}</Dato>
          <div className="md:col-span-3"><Dato etiqueta="Hallazgos">{v.hallazgos}</Dato></div>
          <div className="md:col-span-3"><Dato etiqueta="Recomendaciones">{v.recomendaciones}</Dato></div>
        </dl>
      </Tarjeta>
      <Tarjeta className="mt-4 p-5">
        <h2 className="mb-3 font-semibold">Fotos ({fotos.length})</h2>
        {fotos.length === 0 ? <p className="text-sm text-tenue">Sin fotos (o aún no han terminado de subir).</p> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fotos.map((f) => (
            <figure key={f.id} className="overflow-hidden rounded-xl border border-borde">
              <a href={`/api/archivo?tipo=foto&id=${f.id}`} target="_blank"><img src={`/api/archivo?tipo=foto&id=${f.id}`} alt={f.descripcion ?? "Foto de la visita"} className="h-52 w-full object-cover" /></a>
              <figcaption className="px-3 py-2 text-xs text-tenue">{f.fecha} · {coord(f.lat, f.lon)}{f.descripcion ? ` · ${f.descripcion}` : ""}</figcaption>
            </figure>
          ))}</div>
        )}
      </Tarjeta>
      <Tarjeta className="mt-4 p-5 text-sm">
        <h2 className="mb-2 font-semibold">Firma del beneficiario</h2>
        {v.firma_ruta ? <img src={`/api/archivo?tipo=firma&id=${id}`} alt="Firma" className="h-32 rounded-lg border border-borde bg-white" /> : <p className="text-tenue">Sin firma.</p>}
        <p className="mt-2">{v.firmante_nombre}{v.firmante_documento ? ` · CC ${v.firmante_documento}` : ""}</p>
      </Tarjeta>
      {v.conflicto_resuelto && (
        <Tarjeta className="mt-4 p-5 text-sm"><h2 className="mb-1 font-semibold">Conflicto de sincronización resuelto</h2><p className="text-tenue">El funcionario conservó la versión de su teléfono. La versión que había en el servidor quedó guardada en este registro y en la bitácora de auditoría.</p></Tarjeta>
      )}
    </>
  );
}
