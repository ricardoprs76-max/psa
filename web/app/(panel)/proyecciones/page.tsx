import { FileUp, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { importarProyecciones, nuevaProyeccionManual, subirSolicitud } from "@/app/acciones";
import { BotonEnvio } from "@/components/BotonEnvio";
import { Aviso, Boton, Insignia, Tarjeta, Titulo, Vacio } from "@/components/ui";
import { pesos } from "@/lib/calculo";
import { q, type Fila } from "@/lib/db";
import { configuracionIA } from "@/lib/ia";
import { exigir, puede } from "@/lib/sesion";

const ESTADOS: Record<string, string> = { borrador: "Borrador", en_revision: "En revisión", aprobada: "Aprobada", enviada: "Enviada" };
const ORIGEN: Record<string, string> = { manual: "Manual", importada_excel: "Histórica (Excel)", solicitud_ia: "Solicitud PDF" };

export default async function Proyecciones({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const usuario = await exigir("administrador", "coordinador", "financiero");
  const sp = await searchParams;
  const editar = puede(usuario, "administrador", "coordinador");
  const ia = await configuracionIA();
  const params: unknown[] = [];
  const donde = ["p.eliminado_en is null"];
  if (sp.q?.trim()) { params.push(`%${sp.q.trim()}%`); donde.push(`unaccent(concat_ws(' ', p.consecutivo, p.solicitante, p.radicado, p.asunto, p.municipio, p.vereda, p.archivo_origen_nombre)) ilike unaccent($${params.length})`); }
  if (sp.estado) { params.push(sp.estado); donde.push(`p.estado::text = $${params.length}`); }
  const filas = await q<Fila>(
    `select p.id, p.consecutivo, p.solicitante, p.radicado, p.asunto, p.municipio, p.fecha_solicitud::text as fecha, p.area_ha, p.anios, p.valor_total, p.estado::text as estado, p.origen::text as origen
     from proyecciones p where ${donde.join(" and ")} order by p.creado_en desc limit 200`, params);
  return (
    <>
      <Titulo titulo="Banco de proyecciones" detalle="Solicitudes recibidas, proyecciones históricas y respuestas generadas." />
      <Aviso ok={sp.ok} error={sp.error} />
      {editar && (
        <div className="mb-4 grid gap-4 lg:grid-cols-3">
          <Tarjeta className="p-5">
            <h2 className="flex items-center gap-2 font-semibold"><Sparkles size={18} className="text-marca" />Analizar una solicitud (PDF)</h2>
            <p className="mt-1 text-sm text-tenue">La IA extrae los datos y tú los revisas antes de continuar. Sirve también para PDF escaneados.</p>
            {ia.clave ? (
              <form action={subirSolicitud} className="mt-3 space-y-2">
                <input type="file" name="pdf" accept="application/pdf,.pdf" required className="campo" />
                <BotonEnvio texto="Analizar con IA" enviando="Leyendo el PDF… puede tardar un minuto" />
                <p className="text-xs text-tenue">El PDF se envía a la API de Claude ({ia.modelo}) para su lectura.</p>
              </form>
            ) : (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                El análisis con IA está desactivado porque no hay clave de API. {usuario.rol === "administrador" ? <Link href="/ajustes" className="underline">Escríbela en Ajustes</Link> : "Pídele al administrador que la configure en Ajustes."}
              </p>
            )}
          </Tarjeta>
          <Tarjeta className="p-5">
            <h2 className="flex items-center gap-2 font-semibold"><FileUp size={18} className="text-marca" />Importar proyecciones históricas</h2>
            <p className="mt-1 text-sm text-tenue">Sube los Excel de proyecciones anteriores. Cada archivo entra al banco con su contenido completo para poder encontrarlo después.</p>
            <form action={importarProyecciones} className="mt-3 space-y-2">
              <input type="file" name="excel" accept=".xlsx,.xls,.csv" multiple required className="campo" />
              <BotonEnvio texto="Importar" enviando="Importando…" tipo="suave" />
            </form>
          </Tarjeta>
          <Tarjeta className="p-5">
            <h2 className="flex items-center gap-2 font-semibold"><Plus size={18} className="text-marca" />Proyección manual</h2>
            <p className="mt-1 text-sm text-tenue">Registra una solicitud digitando los datos, sin PDF ni IA.</p>
            <form action={nuevaProyeccionManual} className="mt-3"><Boton tipo="suave">Crear en blanco</Boton></form>
          </Tarjeta>
        </div>
      )}
      <Tarjeta>
        <form className="flex flex-wrap items-end gap-3 border-b border-borde p-4">
          <label className="min-w-[220px] flex-1"><span className="mb-1 block text-xs text-tenue">Buscar</span><input name="q" defaultValue={sp.q} placeholder="Solicitante, radicado, municipio, asunto…" className="campo" /></label>
          <label><span className="mb-1 block text-xs text-tenue">Estado</span><select name="estado" defaultValue={sp.estado ?? ""} className="campo"><option value="">Todos</option>{Object.entries(ESTADOS).map(([v, e]) => <option key={v} value={v}>{e}</option>)}</select></label>
          <Boton tipo="suave">Filtrar</Boton>
        </form>
        {filas.length === 0 ? <div className="p-6"><Vacio>El banco está vacío. Importa las proyecciones históricas o analiza la primera solicitud.</Vacio></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-borde text-left text-xs text-tenue"><th className="px-3 py-2.5">Consecutivo</th><th>Solicitante / asunto</th><th>Municipio</th><th>Fecha</th><th className="text-right">Área (ha)</th><th className="text-right">Valor total</th><th className="px-3">Origen</th><th>Estado</th></tr></thead>
              <tbody>{filas.map((f) => (
                <tr key={f.id} className="border-b border-borde/60 last:border-0 hover:bg-marca-suave/50">
                  <td className="px-3 py-2.5"><Link href={`/proyecciones/${f.id}`} className="font-medium text-marca-fuerte hover:underline">{f.consecutivo}</Link></td>
                  <td><div>{f.solicitante}</div><div className="text-xs text-tenue">{[f.radicado, f.asunto].filter(Boolean).join(" · ")}</div></td>
                  <td>{f.municipio ?? "—"}</td><td>{f.fecha ?? "—"}</td>
                  <td className="text-right">{f.area_ha ? Number(f.area_ha).toLocaleString("es-CO") : "—"}</td><td className="text-right">{pesos(f.valor_total) || "—"}</td>
                  <td className="px-3 text-tenue">{ORIGEN[f.origen]}</td><td><Insignia valor={f.estado}>{ESTADOS[f.estado]}</Insignia></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Tarjeta>
    </>
  );
}
