import Link from "next/link";
import { Insignia } from "@/components/ui";
import { numero, pesos } from "@/lib/calculo";
import type { Fila } from "@/lib/db";
import { etiquetaOpcion, type Campo, type Modulo } from "@/lib/modulos";

export function celda(campo: Campo, fila: Fila): React.ReactNode {
  const v = fila[campo.n];
  if (v === null || v === undefined || v === "") return <span className="text-tenue">—</span>;
  if (campo.t === "ref") return fila[`${campo.n}__e`] ?? "—";
  if (campo.t === "opcion") return <Insignia valor={String(v)}>{etiquetaOpcion(campo, v)}</Insignia>;
  if (campo.t === "moneda") return pesos(v);
  if (campo.t === "numero") return numero(v);
  if (campo.t === "si_no") return v ? "Sí" : "No";
  if (campo.t === "fecha") return String(v).slice(0, 10);
  return String(v);
}

/** Tabla de un módulo; cada fila lleva a su ficha. `omitir` quita columnas (por ejemplo el padre en una lista hija). */
export function Tabla({ clave, modulo, filas, omitir = [], regreso }: { clave: string; modulo: Modulo; filas: Fila[]; omitir?: string[]; regreso?: string }) {
  const columnas = modulo.campos.filter((c) => c.lista && !omitir.includes(c.n));
  const derecha = (c: Campo) => (c.t === "moneda" || c.t === "numero" || c.t === "entero" ? "text-right" : "");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-borde text-left text-xs text-tenue">{columnas.map((c) => <th key={c.n} className={`whitespace-nowrap px-3 py-2.5 font-medium ${derecha(c)}`}>{c.e}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const id = String(f[modulo.pk ?? "id"]);
            const href = `/m/${clave}/${id}${regreso ? `?regreso=${encodeURIComponent(regreso)}` : ""}`;
            return (
              <tr key={id} className="border-b border-borde/60 last:border-0 hover:bg-marca-suave/50">
                {columnas.map((c, i) => (
                  <td key={c.n} className={`px-3 py-2.5 ${derecha(c)}`}>{i === 0 ? <Link href={href} className="font-medium text-marca-fuerte hover:underline">{celda(c, f)}</Link> : celda(c, f)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
