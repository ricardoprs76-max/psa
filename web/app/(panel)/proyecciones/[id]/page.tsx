import { Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alternarReferencia, buscarReferencias, calcularAccion, cambiarEstadoAccion, generarDocumentoAccion, guardarRevision } from "@/app/acciones";
import { BotonEnvio } from "@/components/BotonEnvio";
import { Aviso, Boton, Enlace, Etiqueta, Insignia, Tarjeta, Titulo } from "@/components/ui";
import { pesos, type Resultado } from "@/lib/calculo";
import { q, q1, type Fila } from "@/lib/db";
import type { DatosExtraidos } from "@/lib/ia";
import { validarDatos } from "@/lib/proyecciones";
import { exigir, puede } from "@/lib/sesion";

const ESTADOS: Record<string, string> = { borrador: "Borrador", en_revision: "En revisión", aprobada: "Aprobada", enviada: "Enviada" };
const PASOS: Record<string, [estado: string, texto: string, tipo: "primario" | "suave"][]> = {
  borrador: [["en_revision", "Enviar a revisión", "primario"]],
  en_revision: [["aprobada", "Aprobar", "primario"], ["borrador", "Devolver a borrador", "suave"]],
  aprobada: [["enviada", "Marcar como enviada", "primario"], ["en_revision", "Reabrir revisión", "suave"]],
  enviada: [],
};

function Paso({ n, titulo, children, hecho }: { n: number; titulo: string; children: React.ReactNode; hecho?: boolean }) {
  return (
    <Tarjeta className="mt-4 p-5">
      <h2 className="mb-3 flex items-center gap-2.5 font-semibold">
        <span className={`grid h-7 w-7 place-items-center rounded-full text-sm ${hecho ? "bg-marca text-white" : "bg-marca-suave text-marca-fuerte"}`}>{hecho ? "✓" : n}</span>{titulo}
      </h2>
      {children}
    </Tarjeta>
  );
}

export default async function Proyeccion({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const usuario = await exigir("administrador", "coordinador", "financiero");
  const pr = await q1<Fila>(
    `select p.*, p.fecha_solicitud::text as fecha_txt, p.estado::text as estado_txt, p.origen::text as origen_txt, left(p.texto_fuente, 1500) as extracto,
            to_char(p.extraccion_revisada_en at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as revisada_txt, to_char(p.aprobada_en at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as aprobada_txt,
            to_char(p.enviada_en at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as enviada_txt, to_char(p.creado_en at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as creada_txt,
            (select nombre from perfiles where id = p.extraccion_revisada_por) as revisor, (select nombre from perfiles where id = p.aprobada_por) as aprobador,
            (select nombre from perfiles where id = p.creado_por) as creador
     from proyecciones p where p.id = $1 and p.eliminado_en is null`, [id]).catch(() => null);
  if (!pr) notFound();
  const predios = await q<Fila>("select * from proyeccion_predios where proyeccion_id = $1 order by nombre", [id]);
  const costos = await q<Fila>(
    `select c.id, c.uso_suelo, c.valor_ha_anio, c.anio_base, c.aplicacion::text as aplicacion, z.nombre as zona from costo_oportunidad c
     join zonas_conservacion z on z.id = c.zona_id where (c.estado = 'vigente' and c.eliminado_en is null) or c.id = $1 order by z.nombre, c.uso_suelo`, [pr.costo_oportunidad_id]);
  const referencias = await q<Fila>(
    `select r.id, r.consecutivo, r.solicitante, r.asunto, r.fecha_solicitud::text as fecha, r.valor_total, r.origen::text as origen, pr.puntaje, pr.motivo, pr.incluida
     from proyeccion_referencias pr join proyecciones r on r.id = pr.referencia_id where pr.proyeccion_id = $1 order by pr.puntaje desc`, [id]);
  const versiones = await q<Fila>(
    `select v.id, v.version, v.comentario, to_char(v.creado_en at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as fecha, (select nombre from perfiles where id = v.creado_por) as autor
     from proyeccion_versiones v where v.proyeccion_id = $1 order by v.version desc`, [id]);
  const extraido = pr.datos_extraidos as DatosExtraidos | null;
  const avisos = await validarDatos({
    fecha_solicitud: pr.fecha_txt, area_ha: pr.area_ha === null ? null : Number(pr.area_ha),
    predios: predios.map((p) => ({ nombre: p.nombre, fmi: p.fmi, codigo_catastral: p.codigo_catastral, vereda: p.vereda, municipio: p.municipio, area_ha: p.area_ha === null ? null : Number(p.area_ha), area_texto: null })),
  });
  const resultado = pr.resultado as Resultado | null;
  const editable = puede(usuario, "administrador", "coordinador") && (pr.estado_txt === "borrador" || pr.estado_txt === "en_revision");
  const esHistorica = pr.origen_txt === "importada_excel";
  const puedeCompletar = editable || (esHistorica && puede(usuario, "administrador", "coordinador"));
  const filasPredio = [...predios, ...(puedeCompletar ? [{}, {}] : [])] as Fila[];
  const anioInicio = (pr.reajuste as { anio_inicio?: number } | null)?.anio_inicio ?? new Date().getFullYear();

  return (
    <>
      <Titulo titulo={pr.consecutivo} detalle={esHistorica ? `Proyección histórica importada · ${pr.archivo_origen_nombre}` : pr.origen_txt === "solicitud_ia" ? "Solicitud analizada con IA" : "Proyección manual"}>
        <Insignia valor={pr.estado_txt}>{ESTADOS[pr.estado_txt]}</Insignia>
        {PASOS[pr.estado_txt].map(([estado, texto, tipo]) => (
          <form key={estado} action={cambiarEstadoAccion}><input type="hidden" name="id" value={id} /><input type="hidden" name="estado" value={estado} /><Boton tipo={tipo}>{texto}</Boton></form>
        ))}
        <Enlace href="/proyecciones">Volver</Enlace>
      </Titulo>
      <Aviso ok={sp.ok} error={sp.error} />

      <Paso n={1} titulo="Revisión de los datos" hecho={!!pr.revisada_txt}>
        <div className={`grid gap-5 ${pr.solicitud_pdf_ruta ? "xl:grid-cols-2" : ""}`}>
          {pr.solicitud_pdf_ruta && (
            <div>
              <iframe src={`/api/archivo?tipo=solicitud&id=${id}`} title="Solicitud original" className="h-[640px] w-full rounded-xl border border-borde bg-white" />
              <p className="mt-1 text-xs text-tenue">PDF original, tal como se recibió.</p>
            </div>
          )}
          <div>
            {pr.origen_txt === "solicitud_ia" && (
              <p className="mb-3 rounded-lg bg-marca-suave px-3 py-2 text-sm">Estos datos los extrajo la IA ({pr.modelo_ia}). Compáralos con el documento, corrige lo necesario y apruébalos: nada continúa sin esta revisión.</p>
            )}
            {extraido?.dudas?.length ? (
              <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <div className="font-semibold">La IA pide verificar:</div><ul className="ml-4 list-disc">{extraido.dudas.map((d, i) => <li key={i}>{d}</li>)}</ul>
                {extraido.area_texto && <div className="mt-1">Área tal como aparece: <strong>{extraido.area_texto}</strong></div>}
              </div>
            ) : null}
            {avisos.length > 0 && (
              <ul className="mb-3 space-y-1 text-sm">{avisos.map((a, i) => <li key={i} className="flex gap-2"><Insignia valor={a.nivel}>{a.nivel}</Insignia><span>{a.mensaje}</span></li>)}</ul>
            )}
            {esHistorica && pr.extracto && (
              <details className="mb-3 text-sm"><summary className="cursor-pointer text-marca-fuerte">Ver contenido del Excel importado</summary><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-fondo p-3 text-xs">{pr.extracto}</pre></details>
            )}
            <form action={guardarRevision}>
              <input type="hidden" name="id" value={id} />
              <fieldset disabled={!editable && !esHistorica} className="grid gap-3 md:grid-cols-2">
                <Etiqueta texto="Solicitante" requerido><input name="solicitante" defaultValue={pr.solicitante === "[PENDIENTE]" ? "" : pr.solicitante} className="campo" /></Etiqueta>
                <Etiqueta texto="Cédula o NIT"><input name="solicitante_documento" defaultValue={pr.solicitante_documento ?? ""} className="campo" /></Etiqueta>
                <Etiqueta texto="Radicado"><input name="radicado" defaultValue={pr.radicado ?? ""} className="campo" /></Etiqueta>
                <Etiqueta texto="Fecha de la solicitud"><input name="fecha_solicitud" type="date" defaultValue={pr.fecha_txt ?? ""} className="campo" /></Etiqueta>
                <Etiqueta texto="Asunto" ancho><input name="asunto" defaultValue={pr.asunto ?? ""} className="campo" /></Etiqueta>
                <Etiqueta texto="Municipio"><input name="municipio" defaultValue={pr.municipio ?? ""} className="campo" /></Etiqueta>
                <Etiqueta texto="Vereda"><input name="vereda" defaultValue={pr.vereda ?? ""} className="campo" /></Etiqueta>
                <Etiqueta texto="Área total (ha)" ayuda="En hectáreas. 10.000 m² = 1 ha"><input name="area_ha" type="number" step="any" min="0" defaultValue={pr.area_ha ?? ""} className="campo" /></Etiqueta>
                <Etiqueta texto="Años a proyectar"><input name="anios" type="number" min="1" max="50" defaultValue={pr.anios ?? ""} className="campo" /></Etiqueta>
                <Etiqueta texto="Costo de oportunidad (zona y uso)" ancho ayuda={costos.length ? undefined : "No hay costos vigentes: créalos en Territorio → Costo de oportunidad."}>
                  <select name="costo_oportunidad_id" defaultValue={pr.costo_oportunidad_id ?? ""} className="campo">
                    <option value="">[PENDIENTE]</option>
                    {costos.map((c) => <option key={c.id} value={c.id}>{c.zona} · {c.uso_suelo} · {c.aplicacion === "no_aplica" ? "no aplica" : `${pesos(c.valor_ha_anio)} (${c.anio_base})`}</option>)}
                  </select>
                </Etiqueta>
                <div className="md:col-span-2">
                  <div className="mb-1 text-xs font-medium text-tenue">Predios</div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead><tr className="text-left text-xs text-tenue"><th>Nombre</th><th>Matrícula (FMI)</th><th>Código catastral</th><th>Vereda</th><th>Municipio</th><th>Área (ha)</th></tr></thead>
                      <tbody>{filasPredio.map((p, i) => (
                        <tr key={p.id ?? `nuevo-${i}`}>
                          <td className="p-0.5"><input name="predio_nombre" defaultValue={p.nombre ?? ""} className="campo" />{p.predio_id && <Link href={`/m/predios/${p.predio_id}`} className="text-xs text-marca-fuerte hover:underline">registrado</Link>}</td>
                          <td className="p-0.5 align-top"><input name="predio_fmi" defaultValue={p.fmi ?? ""} className="campo" placeholder="000-12345" /></td>
                          <td className="p-0.5 align-top"><input name="predio_catastral" defaultValue={p.codigo_catastral ?? ""} className="campo" /></td>
                          <td className="p-0.5 align-top"><input name="predio_vereda" defaultValue={p.vereda ?? ""} className="campo" /></td>
                          <td className="p-0.5 align-top"><input name="predio_municipio" defaultValue={p.municipio ?? ""} className="campo" /></td>
                          <td className="p-0.5 align-top"><input name="predio_area" type="number" step="any" min="0" defaultValue={p.area_ha ?? ""} className="campo w-24" /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              </fieldset>
              {(editable || (esHistorica && puede(usuario, "administrador", "coordinador"))) && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Boton tipo="suave" name="_accion" value="guardar">Guardar cambios</Boton>
                  {!esHistorica && <Boton name="_accion" value="aprobar">Aprobar datos revisados</Boton>}
                </div>
              )}
              {pr.revisada_txt && <p className="mt-2 text-xs text-tenue">Datos aprobados por {pr.revisor ?? "—"} el {pr.revisada_txt}.</p>}
            </form>
          </div>
        </div>
      </Paso>

      {!esHistorica && (
        <>
          <Paso n={2} titulo="Proyecciones anteriores parecidas" hecho={referencias.some((r) => r.incluida)}>
            <p className="mb-3 text-sm text-tenue">Se buscan en el banco las proyecciones aprobadas más parecidas. Tú decides cuáles se citan en la respuesta.</p>
            {referencias.length > 0 && (
              <ul className="mb-3 space-y-2">{referencias.map((r) => (
                <li key={r.id} className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm ${r.incluida ? "border-marca bg-marca-suave/50" : "border-borde opacity-70"}`}>
                  <span className="grid h-10 w-12 place-items-center rounded-lg bg-tarjeta text-sm font-semibold">{Math.round(Number(r.puntaje))}</span>
                  <div className="min-w-[200px] flex-1">
                    <Link href={`/proyecciones/${r.id}`} className="font-medium text-marca-fuerte hover:underline">{r.consecutivo}</Link> · {r.solicitante === "[PENDIENTE]" ? r.asunto : r.solicitante} {r.valor_total && <>· {pesos(r.valor_total)}</>}
                    <div className="text-xs text-tenue">Coincide por: {r.motivo}</div>
                  </div>
                  {editable && <form action={alternarReferencia}><input type="hidden" name="id" value={id} /><input type="hidden" name="referencia" value={r.id} /><Boton tipo="suave">{r.incluida ? "Excluir" : "Incluir"}</Boton></form>}
                </li>
              ))}</ul>
            )}
            {editable && <form action={buscarReferencias}><input type="hidden" name="id" value={id} /><BotonEnvio texto={referencias.length ? "Buscar de nuevo" : "Buscar parecidas"} enviando="Buscando…" tipo="suave" /></form>}
          </Paso>

          <Paso n={3} titulo="Cálculo de la proyección" hecho={!!resultado}>
            {editable && (
              <form action={calcularAccion} className="mb-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={id} />
                <Etiqueta texto="Año de inicio"><input name="anio_inicio" type="number" defaultValue={anioInicio} className="campo w-32" /></Etiqueta>
                <Boton tipo="suave">{resultado ? "Recalcular" : "Calcular"}</Boton>
                <span className="text-xs text-tenue">Usa el área, los años y el costo de oportunidad del paso 1 (guárdalos antes).</span>
              </form>
            )}
            {resultado ? (
              <>
                <div className="mb-2 text-sm">Total proyectado: <strong className="text-lg">{pesos(resultado.total)}</strong> <span className="text-tenue">· {pr.escenario}</span></div>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-borde text-left text-xs text-tenue"><th className="py-2">Año</th><th>Reajuste</th><th className="text-right">Valor por ha</th><th className="text-right">Valor del año</th></tr></thead>
                  <tbody>{resultado.filas.map((f) => <tr key={f.anio} className="border-b border-borde/60 last:border-0"><td className="py-1.5">{f.anio}</td><td className="text-tenue">{f.variacion_pct === null ? f.origen : `${f.variacion_pct.toLocaleString("es-CO")} % · ${f.origen}`}</td><td className="text-right">{pesos(f.valor_ha)}</td><td className="text-right">{pesos(f.valor)}</td></tr>)}</tbody>
                </table></div>
                {resultado.avisos.map((a, i) => <p key={i} className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{a}</p>)}
              </>
            ) : <p className="text-sm text-tenue">Sin calcular. Si falta el costo de oportunidad o no hay referencia, el valor quedará como [PENDIENTE] en la respuesta.</p>}
          </Paso>

          <Paso n={4} titulo="Documento de respuesta (Word)" hecho={!!pr.documento_ruta}>
            <p className="mb-3 text-sm text-tenue">Se genera con la plantilla institucional activa (o la carta genérica si no hay). Los datos que falten salen resaltados como [PENDIENTE] y el archivo abre con control de cambios.</p>
            <div className="flex flex-wrap items-center gap-2">
              {editable && <form action={generarDocumentoAccion}><input type="hidden" name="id" value={id} /><BotonEnvio texto={pr.documento_ruta ? "Generar versión nueva" : "Generar documento"} enviando="Generando…" /></form>}
              {pr.documento_ruta && <a href={`/api/archivo?tipo=respuesta&id=${id}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-borde bg-tarjeta px-3.5 text-sm font-medium hover:bg-marca-suave"><Download size={16} />Descargar versión {pr.version}</a>}
            </div>
            {versiones.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">{versiones.map((v) => (
                <li key={v.id} className="flex flex-wrap gap-x-3 text-tenue"><a href={`/api/archivo?tipo=version&id=${v.id}`} className="font-medium text-marca-fuerte hover:underline">Versión {v.version}</a><span>{v.fecha}</span><span>{v.autor}</span><span>{v.comentario}</span></li>
              ))}</ul>
            )}
          </Paso>
        </>
      )}

      <Tarjeta className="mt-4 p-5 text-sm">
        <h2 className="mb-2 font-semibold">Trazabilidad</h2>
        <dl className="grid gap-x-6 gap-y-1 md:grid-cols-2">
          <div><dt className="inline text-tenue">Registrada: </dt><dd className="inline">{pr.creada_txt} · {pr.creador ?? "—"}</dd></div>
          <div><dt className="inline text-tenue">Modelo de IA: </dt><dd className="inline">{pr.modelo_ia ?? "no se usó"}</dd></div>
          <div><dt className="inline text-tenue">Datos revisados: </dt><dd className="inline">{pr.revisada_txt ? `${pr.revisada_txt} · ${pr.revisor}` : "pendiente"}</dd></div>
          <div><dt className="inline text-tenue">Aprobada: </dt><dd className="inline">{pr.aprobada_txt ? `${pr.aprobada_txt} · ${pr.aprobador}` : "pendiente"}</dd></div>
          <div><dt className="inline text-tenue">Enviada: </dt><dd className="inline">{pr.enviada_txt ?? "pendiente"}</dd></div>
          {pr.archivo_origen_ruta && <div><a href={`/api/archivo?tipo=origen&id=${id}`} className="text-marca-fuerte hover:underline">Descargar el Excel original</a></div>}
        </dl>
      </Tarjeta>
    </>
  );
}
