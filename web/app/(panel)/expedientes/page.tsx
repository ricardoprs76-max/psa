import Link from "next/link";
import { BotonImprimir } from "@/components/BotonImprimir";
import { Insignia, Tarjeta, Titulo, Vacio } from "@/components/ui";
import { completitudAcuerdos } from "@/lib/expediente";
import { exigir } from "@/lib/sesion";

export default async function Expedientes() {
  await exigir("administrador", "coordinador", "financiero", "consulta");
  const filas = await completitudAcuerdos();
  return (
    <>
      <Titulo titulo="Listas de chequeo" detalle="Completitud documental de cada acuerdo: sus documentos, los del predio y los del beneficiario."><BotonImprimir>PDF</BotonImprimir></Titulo>
      {filas.length === 0 ? <Vacio>Aún no hay acuerdos. Los documentos de predios y beneficiarios se cargan desde su ficha.</Vacio> : (
        <Tarjeta>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-borde text-left text-xs text-tenue"><th className="px-4 py-2.5">Acuerdo</th><th>Beneficiario</th><th>Predio</th><th>Estado</th><th className="w-56">Completitud</th><th className="px-4">Falta</th></tr></thead>
              <tbody>{filas.map((a) => (
                <tr key={a.id} className="border-b border-borde/60 align-top last:border-0">
                  <td className="px-4 py-2.5"><Link href={`/m/acuerdos/${a.id}`} className="font-medium text-marca-fuerte hover:underline">{a.codigo ?? "Sin código"}</Link><div className="text-xs text-tenue">{a.convenio}</div></td>
                  <td className="py-2.5"><Link href={`/m/beneficiarios/${a.beneficiario_id}`} className="hover:underline">{a.beneficiario}</Link></td>
                  <td className="py-2.5"><Link href={`/m/predios/${a.predio_id}`} className="hover:underline">{a.predio}</Link></td>
                  <td className="py-2.5"><Insignia valor={a.estado}>{a.estado}</Insignia></td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2"><div className="h-2.5 flex-1 overflow-hidden rounded-full bg-borde"><div className={`h-full rounded-full ${a.porcentaje === 100 ? "bg-emerald-600" : a.porcentaje >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${a.porcentaje}%` }} /></div><strong className="w-12 text-right">{a.porcentaje} %</strong></div>
                    <div className="text-xs text-tenue">{a.cumplidos} de {a.exigidos} documentos</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-tenue">{a.faltan.length ? a.faltan.join(" · ") : "Completo"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Tarjeta>
      )}
    </>
  );
}
