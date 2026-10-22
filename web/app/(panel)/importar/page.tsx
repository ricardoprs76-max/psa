import { ejecutarImportacion, prepararImportacion } from "@/app/acciones3";
import { BotonEnvio } from "@/components/BotonEnvio";
import { Aviso, Enlace, Etiqueta, Tarjeta, Titulo } from "@/components/ui";
import { leerArchivo } from "@/lib/archivos";
import { IMPORTABLES, leerTabla, sugerirMapa } from "@/lib/importar";
import { MODULOS } from "@/lib/modulos";
import { exigir } from "@/lib/sesion";

export default async function Importar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await exigir("administrador", "coordinador");
  const sp = await searchParams;
  const modulo = sp.modulo && IMPORTABLES.includes(sp.modulo) ? MODULOS[sp.modulo] : null;
  let tabla: ReturnType<typeof leerTabla> | null = null;
  if (modulo && sp.archivo && /^[\w.\- ]+$/.test(sp.archivo)) {
    tabla = await leerArchivo(`importaciones/${sp.archivo}`).then(leerTabla).catch(() => null);
  }
  const mapa = modulo && tabla ? sugerirMapa(sp.modulo!, tabla.encabezados) : {};
  return (
    <>
      <Titulo titulo="Importar datos" detalle="Desde Excel o CSV, incluidas las exportaciones de ODK. Cada fila pasa por las mismas validaciones que el formulario." />
      <Aviso ok={sp.ok} error={sp.error} />
      {!tabla || !modulo ? (
        <Tarjeta className="max-w-xl p-5">
          <form action={prepararImportacion} className="space-y-4">
            <Etiqueta texto="¿Qué vas a importar?" requerido>
              <select name="modulo" required defaultValue={sp.modulo ?? ""} className="campo"><option value="">— Elegir —</option>{IMPORTABLES.map((c) => <option key={c} value={c}>{MODULOS[c].titulo}</option>)}</select>
            </Etiqueta>
            <Etiqueta texto="Archivo" requerido ayuda="La primera fila debe traer los nombres de las columnas. Importa primero lo que otros necesitan: convenios, beneficiarios y predios antes que acuerdos y pagos.">
              <input type="file" name="archivo" accept=".xlsx,.xls,.csv" required className="campo" />
            </Etiqueta>
            <BotonEnvio texto="Continuar" enviando="Leyendo el archivo…" />
          </form>
        </Tarjeta>
      ) : (
        <Tarjeta className="p-5">
          <p className="text-sm">Archivo <strong>{sp.archivo!.replace(/^[0-9a-f]{8}_/, "")}</strong>, hoja “{tabla.hoja}”: <strong>{tabla.filas.length}</strong> fila(s) para <strong>{modulo.titulo}</strong>. Revisa a qué columna corresponde cada campo.</p>
          <form action={ejecutarImportacion} className="mt-4">
            <input type="hidden" name="modulo" value={sp.modulo} /><input type="hidden" name="archivo" value={sp.archivo} />
            <div className="grid gap-3 md:grid-cols-3">
              {modulo.campos.filter((c) => !c.soloLectura).map((c) => (
                <Etiqueta key={c.n} texto={c.e} requerido={c.req} ayuda={c.t === "ref" ? "Se busca por nombre, número o código" : undefined}>
                  <select name={`col_${c.n}`} defaultValue={mapa[c.n] ?? ""} className="campo"><option value="">(no importar)</option>{tabla!.encabezados.map((h) => <option key={h} value={h}>{h}</option>)}</select>
                </Etiqueta>
              ))}
            </div>
            <div className="mt-5 overflow-x-auto rounded-xl border border-borde">
              <table className="w-full text-xs">
                <thead><tr className="bg-fondo text-left">{tabla.encabezados.map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5">{h}</th>)}</tr></thead>
                <tbody>{tabla.filas.slice(0, 5).map((f, i) => <tr key={i} className="border-t border-borde/60">{tabla!.encabezados.map((h) => <td key={h} className="max-w-[220px] truncate px-2 py-1.5">{f[h] instanceof Date ? (f[h] as Date).toISOString().slice(0, 10) : String(f[h] ?? "")}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-tenue">Vista previa de las primeras 5 filas.</p>
            <div className="mt-4 flex gap-2"><BotonEnvio texto={`Importar ${tabla.filas.length} fila(s)`} enviando="Importando…" /><Enlace href="/importar">Elegir otro archivo</Enlace></div>
          </form>
        </Tarjeta>
      )}
    </>
  );
}
