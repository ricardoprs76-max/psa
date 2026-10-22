import Link from "next/link";
import { Insignia, Tarjeta, Titulo, Vacio } from "@/components/ui";
import { numero, pesos } from "@/lib/calculo";
import { q, q1, type Fila } from "@/lib/db";
import { exigir } from "@/lib/sesion";

function Indicador({ titulo, valor, detalle, href }: { titulo: string; valor: string; detalle?: string; href?: string }) {
  const cuerpo = (
    <Tarjeta className="h-full p-5 transition-shadow hover:shadow-md">
      <div className="text-xs font-medium uppercase tracking-wide text-tenue">{titulo}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{valor}</div>
      {detalle && <div className="mt-1 text-xs text-tenue">{detalle}</div>}
    </Tarjeta>
  );
  return href ? <Link href={href}>{cuerpo}</Link> : cuerpo;
}

export default async function Tablero() {
  const usuario = await exigir();
  if (usuario.rol === "funcionario_campo") {
    return <Vacio>Tu rol es de campo: los predios asignados y las visitas se gestionan desde la aplicación móvil (fase 4).</Vacio>;
  }
  const t = (await q1<Fila>("select * from tablero_indicadores"))!;
  const territorio = await q<Fila>("select * from indicadores_territorio order by hectareas_psa desc, predios desc limit 12");
  const vigencias = await q<Fila>("select * from indicadores_vigencia order by vigencia desc limit 6");
  const porVencer = await q<Fila>(
    `select v.id, v.codigo, v.fecha_fin_efectiva::text as fin, v.dias_restantes, p.nombre as predio, b.nombre as beneficiario
     from acuerdos_por_vencer v join predios p on p.id = v.predio_id join beneficiarios b on b.id = v.beneficiario_id order by v.fecha_fin_efectiva limit 8`);
  const maximo = Math.max(1, ...vigencias.map((v) => Number(v.programado)));
  return (
    <>
      <Titulo titulo="Tablero" detalle={`Hola, ${usuario.nombre.split(" ")[0]}. Así va el esquema de Pagos por Servicios Ambientales.`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador titulo="Hectáreas en PSA" valor={`${numero(t.hectareas_psa, 2)} ha`} detalle="En acuerdos activos" href="/m/acuerdos" />
        <Indicador titulo="Beneficiarios activos" valor={String(t.beneficiarios_activos)} detalle={`${t.predios} predios registrados`} href="/m/beneficiarios" />
        <Indicador titulo="Inversión acumulada" valor={pesos(t.inversion_acumulada) || "$ 0"} detalle="Pagos efectuados" href="/m/pagos" />
        <Indicador titulo="Pagos pendientes" valor={pesos(t.pagos_pendientes_valor) || "$ 0"} detalle={`${t.pagos_pendientes} cuota(s)`} href="/m/pagos?f_estado=pendiente" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Tarjeta className="p-5 xl:col-span-2">
          <h2 className="mb-3 font-semibold">Por municipio y vereda</h2>
          {territorio.length === 0 ? <Vacio>Aún no hay predios.</Vacio> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-borde text-left text-xs text-tenue"><th className="py-2">Municipio</th><th>Vereda</th><th className="text-right">Predios</th><th className="text-right">Acuerdos activos</th><th className="text-right">Hectáreas PSA</th></tr></thead>
                <tbody>{territorio.map((r, i) => (
                  <tr key={i} className="border-b border-borde/60 last:border-0"><td className="py-2">{r.municipio}</td><td>{r.vereda ?? "—"}</td><td className="text-right">{r.predios}</td><td className="text-right">{r.acuerdos_activos}</td><td className="text-right">{numero(r.hectareas_psa, 2)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Tarjeta>
        <Tarjeta className="p-5">
          <h2 className="mb-3 font-semibold">Acuerdos por vencer <span className="text-sm font-normal text-tenue">(90 días)</span></h2>
          {porVencer.length === 0 ? <p className="text-sm text-tenue">Ninguno por ahora.</p> : (
            <ul className="space-y-3 text-sm">{porVencer.map((a) => (
              <li key={a.id}><Link href={`/m/acuerdos/${a.id}`} className="block rounded-lg p-2 hover:bg-marca-suave">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{a.codigo ?? a.predio}</span><Insignia tono={a.dias_restantes < 0 ? "rojo" : "ambar"}>{a.dias_restantes < 0 ? `venció hace ${-a.dias_restantes} d` : `${a.dias_restantes} días`}</Insignia></div>
                <div className="text-xs text-tenue">{a.beneficiario} · {a.predio} · {a.fin}</div>
              </Link></li>
            ))}</ul>
          )}
        </Tarjeta>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Tarjeta className="p-5 xl:col-span-2">
          <h2 className="mb-3 font-semibold">Pagos por vigencia</h2>
          {vigencias.length === 0 ? <p className="text-sm text-tenue">Sin pagos programados.</p> : (
            <div className="space-y-3">{vigencias.map((v) => (
              <div key={v.vigencia} className="text-sm">
                <div className="mb-1 flex justify-between"><span className="font-medium">{v.vigencia}</span><span className="text-tenue">{pesos(v.pagado) || "$ 0"} de {pesos(v.programado)}</span></div>
                <div className="h-2.5 overflow-hidden rounded-full bg-borde" style={{ width: `${Math.max(8, (Number(v.programado) / maximo) * 100)}%` }}>
                  <div className="h-full rounded-full bg-marca" style={{ width: `${Number(v.programado) > 0 ? Math.min(100, (Number(v.pagado) / Number(v.programado)) * 100) : 0}%` }} />
                </div>
              </div>
            ))}</div>
          )}
        </Tarjeta>
        <Indicador titulo="Alertas de calidad de datos" valor={String(t.alertas_calidad)} detalle="Datos que se contradicen o están incompletos" href="/alertas" />
      </div>
    </>
  );
}
