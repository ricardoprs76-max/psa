import { Download, Plus, Printer } from "lucide-react";
import { notFound } from "next/navigation";
import { BotonImprimir } from "@/components/BotonImprimir";
import { Tabla } from "@/components/Tabla";
import { Aviso, Boton, Enlace, Tarjeta, Titulo, Vacio } from "@/components/ui";
import { listar } from "@/lib/crud";
import { MODULOS } from "@/lib/modulos";
import { exigir } from "@/lib/sesion";

const POR_PAGINA = 50;

export default async function Lista({ params, searchParams }: { params: Promise<{ modulo: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { modulo: clave } = await params;
  const sp = await searchParams;
  const modulo = MODULOS[clave];
  const usuario = await exigir();
  if (!modulo || modulo.grupo === "interno" || !modulo.ven.includes(usuario.rol)) notFound();
  const filtros = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k.startsWith("f_") && v).map(([k, v]) => [k.slice(2), v as string]));
  const pagina = Math.max(1, Number(sp.pagina) || 1);
  const { filas, total } = await listar(clave, { buscar: sp.q, filtros, limite: POR_PAGINA, pagina });
  const conFiltro = modulo.campos.filter((c) => c.t === "opcion" && c.lista);
  const consulta = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !["ok", "error", "pagina"].includes(k)) as [string, string][]);
  const paginas = Math.ceil(total / POR_PAGINA);
  return (
    <>
      <Titulo titulo={modulo.titulo} detalle={`${total} registro(s)`}>
        <Enlace href={`/api/exportar/${clave}?${consulta}`}><Download size={16} />Excel</Enlace>
        <BotonImprimir><Printer size={16} />PDF</BotonImprimir>
        {modulo.editan.includes(usuario.rol) && <Enlace href={`/m/${clave}/nuevo`} tipo="primario"><Plus size={16} />Nuevo</Enlace>}
      </Titulo>
      <Aviso ok={sp.ok} error={sp.error} />
      <Tarjeta>
        <form className="no-imprimir flex flex-wrap items-end gap-3 border-b border-borde p-4">
          <label className="min-w-[220px] flex-1"><span className="mb-1 block text-xs text-tenue">Buscar</span><input name="q" defaultValue={sp.q} placeholder={`Buscar en ${modulo.titulo.toLowerCase()}…`} className="campo" /></label>
          {conFiltro.map((c) => (
            <label key={c.n}><span className="mb-1 block text-xs text-tenue">{c.e}</span>
              <select name={`f_${c.n}`} defaultValue={filtros[c.n] ?? ""} className="campo"><option value="">Todos</option>{c.ops!.map(([v, e]) => <option key={v} value={v}>{e}</option>)}</select>
            </label>
          ))}
          <Boton tipo="suave">Filtrar</Boton>
        </form>
        {filas.length === 0 ? <div className="p-6"><Vacio>No hay registros{sp.q || Object.keys(filtros).length ? " que coincidan con la búsqueda" : " todavía"}.</Vacio></div> : <Tabla clave={clave} modulo={modulo} filas={filas} />}
        {paginas > 1 && (
          <div className="no-imprimir flex items-center justify-between border-t border-borde p-3 text-sm text-tenue">
            <span>Página {pagina} de {paginas}</span>
            <div className="flex gap-2">
              {pagina > 1 && <Enlace href={`/m/${clave}?${new URLSearchParams({ ...Object.fromEntries(consulta), pagina: String(pagina - 1) })}`}>Anterior</Enlace>}
              {pagina < paginas && <Enlace href={`/m/${clave}?${new URLSearchParams({ ...Object.fromEntries(consulta), pagina: String(pagina + 1) })}`}>Siguiente</Enlace>}
            </div>
          </div>
        )}
      </Tarjeta>
    </>
  );
}
