import { guardarMetodologia } from "@/app/acciones";
import { Aviso, Boton, Etiqueta, Insignia, Tarjeta, Titulo } from "@/components/ui";
import { calcular, numero, pesos, type Parametros } from "@/lib/calculo";
import { q, type Fila } from "@/lib/db";
import { metodologiaVigente, tablaIpc } from "@/lib/proyecciones";
import { exigir, puede } from "@/lib/sesion";

export default async function Calculadora({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const usuario = await exigir("administrador", "coordinador", "financiero");
  const sp = await searchParams;
  const met = await metodologiaVigente();
  const ipc = await tablaIpc();
  const predios = await q<Fila>("select id, nombre, municipio, area_conservacion_ha, area_total_ha, zona_id from predios where eliminado_en is null order by nombre limit 2000");
  const costos = await q<Fila>(
    `select c.id, c.uso_suelo, c.valor_ha_anio, c.anio_base, c.aplicacion::text as aplicacion, c.justificacion, c.reajuste_ipc, c.zona_id, z.nombre as zona
     from costo_oportunidad c join zonas_conservacion z on z.id = c.zona_id where c.estado = 'vigente' and c.eliminado_en is null order by z.nombre, c.uso_suelo`);
  const anioActual = new Date().getFullYear();
  const predio = predios.find((p) => p.id === sp.predio);
  const costo = costos.find((c) => c.id === sp.costo);
  const area = Number(sp.area || predio?.area_conservacion_ha || predio?.area_total_ha || 0);
  const anios = Math.min(50, Math.max(1, Number(sp.anios) || 5));
  const inicio = Number(sp.inicio) || anioActual;
  const p: Parametros = costo && !costo.reajuste_ipc ? { ...met.parametros, reajuste: "ninguno" } : met.parametros;
  const resultado = costo && costo.aplicacion !== "no_aplica" && area > 0
    ? calcular({ area_ha: area, valor_ha_anio: Number(costo.valor_ha_anio), anio_base: costo.anio_base, anio_inicio: inicio, anios, ipc }, p)
    : null;
  const editar = puede(usuario, "administrador", "coordinador");
  const mp = met.parametros;
  return (
    <>
      <Titulo titulo="Calculadora de incentivo" detalle="Valor proyectado según el área, el costo de oportunidad de la zona y los años." />
      <Aviso ok={sp.ok} error={sp.error} />
      {!met.aprobada && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <strong>Metodología provisional.</strong> La fórmula oficial todavía no está definida: debe replicar las proyecciones históricas de la entidad. Los resultados de esta pantalla son de prueba hasta que coordinación revise los parámetros de abajo y los marque como aprobados.
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Tarjeta className="p-5">
          <form className="space-y-4">
            <Etiqueta texto="Predio (opcional)" ayuda="Trae su área en conservación">
              <select name="predio" defaultValue={sp.predio ?? ""} className="campo"><option value="">—</option>{predios.map((x) => <option key={x.id} value={x.id}>{x.nombre} · {x.municipio}</option>)}</select>
            </Etiqueta>
            <Etiqueta texto="Área (ha)" ayuda="Vacío = área en conservación del predio"><input name="area" type="number" step="any" min="0" defaultValue={sp.area ?? ""} className="campo" /></Etiqueta>
            <Etiqueta texto="Costo de oportunidad vigente" requerido>
              <select name="costo" defaultValue={sp.costo ?? ""} className="campo" required>
                <option value="">— Elegir zona y uso —</option>
                {costos.map((c) => <option key={c.id} value={c.id}>{c.zona} · {c.uso_suelo} · {c.aplicacion === "no_aplica" ? "no aplica" : `${pesos(c.valor_ha_anio)} (${c.anio_base})`}</option>)}
              </select>
            </Etiqueta>
            <div className="grid grid-cols-2 gap-3">
              <Etiqueta texto="Año de inicio"><input name="inicio" type="number" defaultValue={inicio} className="campo" /></Etiqueta>
              <Etiqueta texto="Años"><input name="anios" type="number" min="1" max="50" defaultValue={anios} className="campo" /></Etiqueta>
            </div>
            <Boton className="w-full">Calcular</Boton>
            {costos.length === 0 && <p className="text-xs text-tenue">No hay costos de oportunidad vigentes. Créalos en Territorio → Costo de oportunidad (primero la zona).</p>}
          </form>
        </Tarjeta>
        <Tarjeta className="p-5">
          {!costo ? <p className="text-sm text-tenue">Elige un costo de oportunidad y pulsa Calcular.</p> : costo.aplicacion === "no_aplica" ? (
            <div className="text-sm"><Insignia valor="no_aplica">No aplica</Insignia><p className="mt-2">Para <strong>{costo.zona} · {costo.uso_suelo}</strong> el costo de oportunidad no aplica.</p><p className="mt-1 text-tenue">Justificación: {costo.justificacion}</p></div>
          ) : !resultado ? <p className="text-sm text-tenue">Indica un área mayor que cero.</p> : (
            <>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div><div className="text-xs uppercase tracking-wide text-tenue">Valor total proyectado</div><div className="text-3xl font-semibold tracking-tight">{pesos(resultado.total)}</div></div>
                <div className="text-right text-sm text-tenue">{numero(area)} ha · {anios} año(s) · {met.nombre}{costo.aplicacion === "valor_especial" && <> · <Insignia valor="valor_especial">valor especial</Insignia></>}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-borde text-left text-xs text-tenue"><th className="py-2">Año</th><th>Reajuste</th><th className="text-right">Valor por ha</th><th className="text-right">Valor del año</th></tr></thead>
                  <tbody>{resultado.filas.map((f) => (
                    <tr key={f.anio} className="border-b border-borde/60 last:border-0"><td className="py-2 font-medium">{f.anio}</td><td className="text-tenue">{f.variacion_pct === null ? f.origen : `${f.variacion_pct.toLocaleString("es-CO")} % · ${f.origen}`}</td><td className="text-right">{pesos(f.valor_ha)}</td><td className="text-right">{pesos(f.valor)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              {resultado.avisos.map((a, i) => <p key={i} className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{a}</p>)}
            </>
          )}
        </Tarjeta>
      </div>
      <Tarjeta className="mt-4 p-5">
        <div className="mb-3 flex items-center gap-2"><h2 className="font-semibold">Metodología de cálculo</h2><Insignia tono={met.aprobada ? "verde" : "ambar"}>{met.aprobada ? "aprobada" : "provisional"}</Insignia><span className="text-sm text-tenue">{met.nombre}</span></div>
        <form action={guardarMetodologia}>
          <fieldset disabled={!editar} className="grid gap-4 md:grid-cols-3">
            <Etiqueta texto="Nombre"><input name="nombre" defaultValue={met.id ? met.nombre.replace(/ v\d+$/, "") : "Metodología PSA"} className="campo" /></Etiqueta>
            <Etiqueta texto="Reajuste anual">
              <select name="reajuste" defaultValue={mp.reajuste} className="campo"><option value="ipc">Por IPC</option><option value="tasa_fija">Tasa fija</option><option value="ninguno">Sin reajuste</option></select>
            </Etiqueta>
            <Etiqueta texto="El valor del año N se ajusta con">
              <select name="ipc_de" defaultValue={mp.ipc_de} className="campo"><option value="anio_anterior">El IPC del año anterior (N−1)</option><option value="mismo_anio">El IPC del mismo año (N)</option></select>
            </Etiqueta>
            <Etiqueta texto="Años sin IPC registrado">
              <select name="ipc_faltante" defaultValue={mp.ipc_faltante} className="campo"><option value="ultimo_conocido">Usar el último IPC conocido</option><option value="tasa">Usar la tasa de abajo</option><option value="sin_reajuste">No reajustar</option></select>
            </Etiqueta>
            <Etiqueta texto="Tasa anual (%)" ayuda="Para tasa fija o años sin IPC"><input name="tasa_pct" type="number" step="any" defaultValue={mp.tasa_pct} className="campo" /></Etiqueta>
            <Etiqueta texto="Redondeo">
              <select name="redondeo" defaultValue={mp.redondeo} className="campo"><option value="peso">Al peso</option><option value="cien">A la centena</option><option value="mil">Al millar</option><option value="ninguno">Sin redondeo</option></select>
            </Etiqueta>
            <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="actualizar_base" defaultChecked={mp.actualizar_base} className="h-4 w-4" />Llevar el valor base desde su año de precios hasta el año de inicio</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="aprobada" className="h-4 w-4" />Marcar como aprobada (coincide con las proyecciones históricas)</label>
            <Etiqueta texto="Descripción o sustento" ancho><textarea name="descripcion" rows={2} className="campo" placeholder="Acto, acta o archivo que respalda esta metodología" /></Etiqueta>
          </fieldset>
          {editar && <div className="mt-4"><Boton tipo="suave">Guardar como versión nueva</Boton></div>}
        </form>
      </Tarjeta>
    </>
  );
}
