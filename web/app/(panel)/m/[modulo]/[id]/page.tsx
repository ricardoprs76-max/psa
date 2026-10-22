import { Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { nuevaVersionCosto } from "@/app/acciones";
import { generarDiagnosticoAccion, verificarEspeciesAccion } from "@/app/acciones3";
import { Autoria } from "@/components/Autoria";
import { BotonEnvio } from "@/components/BotonEnvio";
import { Expediente } from "@/components/Expediente";
import { Formulario } from "@/components/Formulario";
import { Tabla } from "@/components/Tabla";
import { Aviso, Boton, Enlace, Insignia, Tarjeta, Titulo } from "@/components/ui";
import { listar, obtener } from "@/lib/crud";
import { q, type Fila } from "@/lib/db";
import { MODULOS } from "@/lib/modulos";
import { exigir } from "@/lib/sesion";

export default async function Ficha({ params, searchParams }: { params: Promise<{ modulo: string; id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { modulo: clave, id } = await params;
  const sp = await searchParams;
  const modulo = MODULOS[clave];
  const usuario = await exigir();
  if (!modulo || !modulo.ven.includes(usuario.rol)) notFound();
  const nuevo = id === "nuevo";
  const fila = nuevo ? null : await obtener(clave, id);
  if (!nuevo && !fila) notFound();
  const puedeEditar = modulo.editan.includes(usuario.rol);
  // Campos que llegan fijados desde la ficha del padre (al crear un elemento de una lista hija).
  const fijos = Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && modulo.campos.some((c) => c.n === k && c.t === "ref")) as [string, string][]);
  const aqui = `/m/${clave}/${id}`;
  const alertas = fila && ["predios", "acuerdos"].includes(modulo.tabla)
    ? await q<Fila>("select severidad::text as severidad, mensaje from alertas_calidad where tabla = $1 and registro_id = $2 and not resuelta order by severidad desc", [modulo.tabla, id])
    : [];
  const hijas = fila && modulo.hijas
    ? await Promise.all(modulo.hijas.filter((h) => MODULOS[h.modulo].ven.includes(usuario.rol)).map(async (h) => ({ ...h, filas: (await listar(h.modulo, { filtros: { [h.fk]: id }, limite: 200 })).filas })))
    : [];
  return (
    <>
      <Titulo titulo={nuevo ? `Nuevo ${modulo.singular}` : String(fila![modulo.campos[0].n] ?? modulo.singular)} detalle={modulo.titulo}>
        {clave === "costos" && fila && puedeEditar && fila.estado === "vigente" && (
          <form action={nuevaVersionCosto}><input type="hidden" name="id" value={id} /><Boton tipo="suave">Nueva versión</Boton></form>
        )}
        {clave === "diagnosticos" && fila && puedeEditar && (
          <>
            <form action={verificarEspeciesAccion}><input type="hidden" name="id" value={id} /><BotonEnvio texto="Verificar nombres científicos" enviando="Consultando el catálogo…" tipo="suave" /></form>
            <form action={generarDiagnosticoAccion}><input type="hidden" name="id" value={id} /><BotonEnvio texto="Generar Word" enviando="Generando…" /></form>
          </>
        )}
        {clave === "diagnosticos" && fila?.documento_ruta && <a href={`/api/archivo?tipo=diagnostico&id=${id}`} className="inline-flex h-9 items-center rounded-lg border border-borde bg-tarjeta px-3.5 text-sm font-medium hover:bg-marca-suave">Descargar Word</a>}
        <Enlace href={sp.regreso ?? `/m/${clave}`}>Volver</Enlace>
      </Titulo>
      <Aviso ok={sp.ok} error={sp.error} />
      {alertas.length > 0 && (
        <Tarjeta className="mb-4 border-amber-300 p-4 dark:border-amber-800">
          <div className="mb-2 text-sm font-semibold">Alertas de calidad de datos</div>
          <ul className="space-y-1.5 text-sm">{alertas.map((a, i) => <li key={i} className="flex gap-2"><Insignia valor={a.severidad}>{a.severidad}</Insignia><span>{a.mensaje}</span></li>)}</ul>
        </Tarjeta>
      )}
      <Tarjeta className="p-6">
        <Formulario clave={clave} modulo={modulo} fila={fila} regreso={sp.regreso} fijos={fijos} puedeEditar={puedeEditar} />
        {fila && <Autoria tabla={modulo.tabla} id={id} />}
      </Tarjeta>
      {fila && (clave === "beneficiarios" || clave === "predios" || clave === "acuerdos") && (
        <Expediente ambito={clave === "beneficiarios" ? "beneficiario" : clave === "predios" ? "predio" : "acuerdo"} id={id} regreso={aqui} puedeEditar={usuario.rol === "administrador" || usuario.rol === "coordinador"} />
      )}
      {hijas.map((h) => (
        <Tarjeta key={h.modulo} className="mt-4">
          <div className="flex items-center justify-between border-b border-borde px-5 py-3">
            <h2 className="font-semibold">{h.titulo}</h2>
            {MODULOS[h.modulo].editan.includes(usuario.rol) && <Enlace href={`/m/${h.modulo}/nuevo?${h.fk}=${id}&regreso=${encodeURIComponent(aqui)}`}><Plus size={16} />Agregar</Enlace>}
          </div>
          {h.filas.length === 0 ? <p className="px-5 py-4 text-sm text-tenue">Sin registros.</p> : <Tabla clave={h.modulo} modulo={MODULOS[h.modulo]} filas={h.filas} omitir={[h.fk]} regreso={aqui} />}
        </Tarjeta>
      ))}
    </>
  );
}
