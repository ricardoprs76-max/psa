import Link from "next/link";
import { Insignia, Tarjeta, Titulo, Vacio } from "@/components/ui";
import { q, type Fila } from "@/lib/db";
import { exigir } from "@/lib/sesion";

export default async function Visitas({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await exigir("administrador", "coordinador", "financiero", "consulta");
  const sp = await searchParams;
  const filas = await q<Fila>(
    `select v.id, to_char(v.fecha_hora at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as fecha, p.nombre as predio, p.municipio, f.nombre as funcionario, lower(u.email) as correo, v.cumple_compromisos,
            v.estado_conservacion, v.revision, v.firma_ruta is not null as firmada, v.conflicto_resuelto is not null as hubo_conflicto,
            (select count(*)::int from visita_fotos x where x.visita_id = v.id and x.eliminado_en is null) as fotos
     from visitas_campo v join predios p on p.id = v.predio_id join perfiles f on f.id = v.funcionario_id left join auth.users u on u.id = v.funcionario_id
     where v.eliminado_en is null and ($1 = '' or unaccent(p.nombre || ' ' || f.nombre || ' ' || coalesce(u.email, '') || ' ' || coalesce(p.municipio, '')) ilike unaccent('%' || $1 || '%'))
     order by v.fecha_hora desc limit 300`, [sp.q?.trim() ?? ""]);
  return (
    <>
      <Titulo titulo="Visitas de campo" detalle="Llegan desde la app Android cuando el teléfono sincroniza. Los predios se asignan a cada funcionario en la ficha del predio." />
      <Tarjeta>
        <form className="border-b border-borde p-4"><input name="q" defaultValue={sp.q} placeholder="Buscar por predio, municipio, funcionario o correo…" className="campo max-w-md" /></form>
        {filas.length === 0 ? <div className="p-6"><Vacio>Aún no hay visitas sincronizadas.</Vacio></div> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-borde text-left text-xs text-tenue"><th className="px-4 py-2.5">Fecha</th><th>Predio</th><th>Funcionario</th><th>Estado de conservación</th><th>Compromisos</th><th>Fotos</th><th>Firma</th></tr></thead>
            <tbody>{filas.map((v) => (
              <tr key={v.id} className="border-b border-borde/60 last:border-0 hover:bg-marca-suave/50">
                <td className="whitespace-nowrap px-4 py-2.5"><Link href={`/visitas/${v.id}`} className="font-medium text-marca-fuerte hover:underline">{v.fecha}</Link></td>
                <td>{v.predio}<div className="text-xs text-tenue">{v.municipio}</div></td><td>{v.funcionario}<div className="text-xs text-tenue">{v.correo}</div></td><td>{v.estado_conservacion ?? "—"}</td>
                <td>{v.cumple_compromisos === null ? "—" : <Insignia tono={v.cumple_compromisos ? "verde" : "rojo"}>{v.cumple_compromisos ? "cumple" : "no cumple"}</Insignia>}</td>
                <td>{v.fotos}</td><td>{v.firmada ? "Sí" : "No"}{v.hubo_conflicto && <> <Insignia tono="ambar">conflicto resuelto</Insignia></>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Tarjeta>
    </>
  );
}
