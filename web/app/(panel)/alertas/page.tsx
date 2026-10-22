import Link from "next/link";
import { resolverAlerta } from "@/app/acciones";
import { Boton, Insignia, Tarjeta, Titulo, Vacio } from "@/components/ui";
import { q, type Fila } from "@/lib/db";
import { exigir, puede } from "@/lib/sesion";

const REGLAS: Record<string, string> = {
  area_conservacion_mayor: "Conservación mayor que el total", unidades_sospechosas: "Posible error de unidades (m² / ha)",
  area_difiere_poligono: "Área distinta a la del polígono", area_total_fuentes_inconsistentes: "Las fuentes no coinciden",
  sin_titular: "Sin titular", escritura_futura: "Escritura con fecha futura", area_mayor_que_predio: "Acuerdo mayor que el predio",
  firma_posterior_inicio: "Firma posterior al inicio", fuera_del_convenio: "Antes del convenio", beneficiario_no_titular: "Beneficiario no es titular",
};

export default async function Alertas() {
  const usuario = await exigir("administrador", "coordinador", "financiero", "consulta");
  const alertas = await q<Fila>(
    `select a.id, a.tabla, a.registro_id, a.regla, a.severidad::text as severidad, a.mensaje, a.creado_en::date::text as fecha,
            coalesce(p.nombre, ac.codigo, 'Registro') as nombre
     from alertas_calidad a left join predios p on a.tabla = 'predios' and p.id = a.registro_id left join acuerdos ac on a.tabla = 'acuerdos' and ac.id = a.registro_id
     where not a.resuelta order by a.severidad desc, a.creado_en desc limit 300`);
  const editar = puede(usuario, "administrador", "coordinador");
  return (
    <>
      <Titulo titulo="Calidad de datos" detalle="Datos que se contradicen o están incompletos. El sistema no los rechaza: los señala para que alguien los revise." />
      {alertas.length === 0 ? <Vacio>No hay alertas pendientes.</Vacio> : (
        <div className="space-y-3">{alertas.map((a) => (
          <Tarjeta key={a.id} className="flex flex-wrap items-start gap-3 p-4">
            <Insignia valor={a.severidad}>{a.severidad}</Insignia>
            <div className="min-w-[240px] flex-1">
              <div className="text-sm font-semibold">{REGLAS[a.regla] ?? a.regla} · <Link className="text-marca-fuerte hover:underline" href={`/m/${a.tabla}/${a.registro_id}`}>{a.nombre}</Link></div>
              <p className="mt-0.5 text-sm">{a.mensaje}</p>
              <p className="mt-1 text-xs text-tenue">Detectada el {a.fecha}</p>
            </div>
            {editar && (
              <form action={resolverAlerta} className="flex items-center gap-2">
                <input type="hidden" name="id" value={a.id} />
                <input name="nota" placeholder="Nota (cómo se resolvió)" className="campo w-56" />
                <Boton tipo="suave">Marcar revisada</Boton>
              </form>
            )}
          </Tarjeta>
        ))}</div>
      )}
    </>
  );
}
