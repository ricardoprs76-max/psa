import { eliminarRegistro, guardarRegistro } from "@/app/acciones";
import { Boton, Enlace, Etiqueta } from "@/components/ui";
import { opcionesRef } from "@/lib/crud";
import type { Fila } from "@/lib/db";
import type { Campo, Modulo } from "@/lib/modulos";

/** Control de formulario según el tipo del campo. */
async function Control({ campo, valor, fijo }: { campo: Campo; valor: unknown; fijo?: boolean }) {
  const v = valor === null || valor === undefined ? "" : String(valor);
  const comun = { name: campo.n, required: campo.req, className: "campo", defaultValue: v };
  if (campo.soloLectura) return <input className="campo" value={v || "—"} readOnly />;
  if (campo.t === "si_no") return <input type="checkbox" name={campo.n} defaultChecked={valor === true || v === "true"} className="h-5 w-5 accent-[var(--marca)]" />;
  if (campo.t === "parrafo") return <textarea {...comun} rows={3} />;
  if (campo.t === "fecha") return <input type="date" {...comun} defaultValue={v.slice(0, 10)} />;
  if (campo.t === "numero" || campo.t === "moneda") return <input type="number" step="any" inputMode="decimal" {...comun} />;
  if (campo.t === "entero") return <input type="number" step="1" {...comun} />;
  if (campo.t === "opcion") {
    return <select {...comun}>{!campo.req && <option value="">—</option>}{campo.ops!.map(([valorOp, e]) => <option key={valorOp} value={valorOp}>{e}</option>)}</select>;
  }
  if (campo.t === "ref") {
    const ops = await opcionesRef(campo);
    // En una lista hija el padre ya está decidido: va oculto.
    if (fijo) return <input type="hidden" name={campo.n} value={v} />;
    return <select {...comun}><option value="">— Elegir —</option>{ops.map(([id, e]) => <option key={id} value={id}>{e}</option>)}</select>;
  }
  return <input type="text" {...comun} />;
}

export async function Formulario({ clave, modulo, fila, regreso, fijos = {}, puedeEditar }: {
  clave: string; modulo: Modulo; fila: Fila | null; regreso?: string; fijos?: Record<string, string>; puedeEditar: boolean;
}) {
  const id = fila ? String(fila[modulo.pk ?? "id"]) : "";
  const aqui = `/m/${clave}/${id || "nuevo"}${Object.keys(fijos).length ? "?" + new URLSearchParams(fijos) : ""}`;
  return (
    <>
      <form action={guardarRegistro}>
        <input type="hidden" name="_modulo" value={clave} />
        <input type="hidden" name="_id" value={id} />
        <input type="hidden" name="_aqui" value={aqui} />
        {regreso && <input type="hidden" name="_regreso" value={regreso} />}
        <fieldset disabled={!puedeEditar} className="grid gap-4 md:grid-cols-2">
          {modulo.campos.map((c) => {
            const valor = fila ? fila[c.n] : fijos[c.n] ?? (c.t === "si_no" ? ["principal", "reajuste_ipc", "activo", "activa", "obligatorio"].includes(c.n) : c.n === "departamento" ? "Boyacá" : c.n === "version" ? 1 : c.n === "formato_codigo" ? "F-RE-08" : "");
            if (c.n in fijos) return <Control key={c.n} campo={c} valor={fijos[c.n]} fijo />;
            if (c.soloLectura && !fila) return null;
            return <Etiqueta key={c.n} texto={c.e} ayuda={c.ayuda} requerido={c.req} ancho={c.ancho}><Control campo={c} valor={valor} /></Etiqueta>;
          })}
        </fieldset>
        {puedeEditar && (
          <div className="mt-6 flex gap-2">
            <Boton>Guardar</Boton>
            <Enlace href={regreso ?? `/m/${clave}`}>Cancelar</Enlace>
          </div>
        )}
      </form>
      {puedeEditar && fila && (
        <form action={eliminarRegistro} className="mt-3">
          <input type="hidden" name="_modulo" value={clave} />
          <input type="hidden" name="_id" value={id} />
          <input type="hidden" name="_regreso" value={regreso ?? `/m/${clave}`} />
          <Boton tipo="peligro">Eliminar {modulo.singular}</Boton>
        </form>
      )}
    </>
  );
}
