import { revisarDocumento, subirDocumento } from "@/app/acciones3";
import { BotonEnvio } from "@/components/BotonEnvio";
import { Insignia, Tarjeta } from "@/components/ui";
import type { Fila } from "@/lib/db";
import { expedienteDe, situacionDe, type Ambito, type Situacion } from "@/lib/expediente";

const TEXTO: Record<Situacion, string> = { falta: "Falta", pendiente: "Por verificar", recibido: "Recibido", vencido: "Vencido", rechazado: "Rechazado" };
const TONO: Record<Situacion, string> = { falta: "gris", pendiente: "ambar", recibido: "verde", vencido: "rojo", rechazado: "rojo" };

function Documento({ d, regreso, puedeEditar }: { d: Fila; regreso: string; puedeEditar: boolean }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tenue">
      {d.con_archivo && <a href={`/api/archivo?tipo=documento&id=${d.id}`} className="font-medium text-marca-fuerte hover:underline">{d.archivo_nombre}</a>}
      <span>v{d.version}</span>
      {d.emision && <span>emitido {d.emision}</span>}
      {d.vencimiento && <span>vence {d.vencimiento}</span>}
      {d.verificador && <span>verificó {d.verificador}</span>}
      {d.observaciones && <span>“{d.observaciones}”</span>}
      {puedeEditar && (
        <form action={revisarDocumento} className="ml-auto flex items-center gap-2">
          <input type="hidden" name="id" value={d.id} /><input type="hidden" name="_regreso" value={regreso} />
          {d.estado !== "recibido" && <button name="_accion" value="verificar" className="cursor-pointer font-medium text-emerald-700 underline dark:text-emerald-400">Verificar</button>}
          {d.estado !== "rechazado" && <button name="_accion" value="rechazar" className="cursor-pointer text-red-700 underline dark:text-red-400">Rechazar</button>}
          <button name="_accion" value="eliminar" className="cursor-pointer underline">Eliminar</button>
        </form>
      )}
    </div>
  );
}

/** Lista de chequeo del expediente, con carga y verificación de cada documento. */
export async function Expediente({ ambito, id, regreso, puedeEditar }: { ambito: Ambito; id: string; regreso: string; puedeEditar: boolean }) {
  const exp = await expedienteDe(ambito, id);
  if (exp.items.length === 0 && exp.otros.length === 0) {
    return <Tarjeta className="mt-4 p-5 text-sm text-tenue"><strong className="text-texto">Documentos.</strong> No hay una lista de chequeo que aplique a este expediente. Se definen en Expedientes → Plantillas de chequeo.</Tarjeta>;
  }
  return (
    <Tarjeta className="mt-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-borde px-5 py-3">
        <h2 className="font-semibold">Documentos · lista de chequeo</h2>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-tenue">{exp.cumplidos} de {exp.exigidos} obligatorios</span>
          <div className="h-2.5 w-40 overflow-hidden rounded-full bg-borde"><div className={`h-full rounded-full ${exp.porcentaje === 100 ? "bg-emerald-600" : exp.porcentaje >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${exp.porcentaje}%` }} /></div>
          <strong>{exp.porcentaje} %</strong>
        </div>
      </div>
      <ul className="divide-y divide-borde/60">
        {exp.items.map((i) => (
          <li key={i.tipo_id} className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Insignia tono={TONO[i.situacion]}>{TEXTO[i.situacion]}</Insignia>
              <span className="font-medium">{i.nombre}</span>
              {!i.obligatorio && <span className="text-xs text-tenue">(opcional)</span>}
              {i.vigencia_dias && <span className="text-xs text-tenue">vigencia {i.vigencia_dias} días</span>}
            </div>
            {i.ayuda && <p className="mt-0.5 text-xs text-tenue">{i.ayuda}</p>}
            {i.documento && <Documento d={i.documento} regreso={regreso} puedeEditar={puedeEditar} />}
            {puedeEditar && (
              <details className="mt-1.5 text-sm">
                <summary className="cursor-pointer text-xs text-marca-fuerte">{i.documento ? "Cargar una versión nueva" : "Cargar documento"}</summary>
                <form action={subirDocumento} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="ambito" value={ambito} /><input type="hidden" name="id" value={id} /><input type="hidden" name="tipo_id" value={i.tipo_id} /><input type="hidden" name="_regreso" value={regreso} />
                  <input type="file" name="archivo" required className="campo max-w-xs" />
                  <label className="text-xs text-tenue">Fecha de emisión<input type="date" name="fecha_emision" required={!!i.vigencia_dias} className="campo" /></label>
                  {!i.vigencia_dias && <label className="text-xs text-tenue">Vence (opcional)<input type="date" name="fecha_vencimiento" className="campo" /></label>}
                  <input name="observaciones" placeholder="Observación (opcional)" className="campo max-w-xs" />
                  <BotonEnvio texto="Cargar" enviando="Cargando…" tipo="suave" />
                </form>
              </details>
            )}
          </li>
        ))}
      </ul>
      {exp.otros.length > 0 && (
        <div className="border-t border-borde px-5 py-3">
          <div className="text-xs font-medium text-tenue">Otros documentos y versiones anteriores</div>
          {exp.otros.map((d) => <div key={d.id} className="mt-1.5 text-sm"><Insignia tono={TONO[situacionDe(d)]}>{TEXTO[situacionDe(d)]}</Insignia> <span>{d.tipo}</span><Documento d={d} regreso={regreso} puedeEditar={puedeEditar} /></div>)}
        </div>
      )}
    </Tarjeta>
  );
}
