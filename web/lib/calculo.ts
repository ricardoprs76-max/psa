/**
 * Calculadora del incentivo.
 *
 * IMPORTANTE: la metodología oficial todavía NO está definida. Debe replicar las proyecciones históricas de la
 * entidad, y hasta que se revisen esos archivos nada de lo que hay aquí es "la fórmula": son opciones
 * configurables (tabla metodologias_calculo). Mientras ninguna esté marcada como aprobada, todo resultado
 * sale con el aviso "metodología provisional".
 */

export type Parametros = {
  /** Cómo cambia el valor por hectárea de un año al siguiente. */
  reajuste: "ninguno" | "ipc" | "tasa_fija";
  /** Con "ipc": qué IPC ajusta el valor del año N. */
  ipc_de: "anio_anterior" | "mismo_anio";
  /** Tasa anual (%) para "tasa_fija" y para los años sin IPC cuando ipc_faltante = "tasa". */
  tasa_pct: number;
  /** Qué hacer con los años que aún no tienen IPC registrado. */
  ipc_faltante: "ultimo_conocido" | "tasa" | "sin_reajuste";
  /** ¿El valor base se lleva primero desde su año de precios hasta el primer año del acuerdo? */
  actualizar_base: boolean;
  redondeo: "ninguno" | "peso" | "cien" | "mil";
};

export const PARAMETROS_INICIALES: Parametros = {
  reajuste: "ipc", ipc_de: "anio_anterior", tasa_pct: 0, ipc_faltante: "ultimo_conocido", actualizar_base: true, redondeo: "peso",
};

export type Entrada = {
  area_ha: number;
  valor_ha_anio: number;      // costo de oportunidad a precios del año base
  anio_base: number;
  anio_inicio: number;
  anios: number;
  ipc: Record<number, { pct: number; proyectado: boolean }>;
};

export type FilaCalculo = { anio: number; variacion_pct: number | null; origen: string; valor_ha: number; valor: number };
export type Resultado = { filas: FilaCalculo[]; total: number; avisos: string[] };

const redondear = (v: number, modo: Parametros["redondeo"]) =>
  modo === "ninguno" ? v : modo === "peso" ? Math.round(v) : modo === "cien" ? Math.round(v / 100) * 100 : Math.round(v / 1000) * 1000;

export function calcular(e: Entrada, p: Parametros): Resultado {
  const avisos: string[] = [];
  const conocidos = Object.keys(e.ipc).map(Number).sort((a, b) => a - b);
  const ultimo = conocidos.length ? e.ipc[conocidos[conocidos.length - 1]].pct : null;
  const faltantes = new Set<number>();
  const proyectados = new Set<number>();

  /** Variación (%) que lleva el valor del año anterior al año dado, y de dónde sale. */
  const variacion = (anio: number): { pct: number; origen: string } => {
    if (p.reajuste === "ninguno") return { pct: 0, origen: "sin reajuste" };
    if (p.reajuste === "tasa_fija") return { pct: p.tasa_pct, origen: `tasa fija ${p.tasa_pct} %` };
    const anioIpc = p.ipc_de === "anio_anterior" ? anio - 1 : anio;
    const dato = e.ipc[anioIpc];
    if (dato) {
      if (dato.proyectado) proyectados.add(anioIpc);
      return { pct: dato.pct, origen: `IPC ${anioIpc}${dato.proyectado ? " (proyectado)" : ""}` };
    }
    faltantes.add(anioIpc);
    if (p.ipc_faltante === "tasa") return { pct: p.tasa_pct, origen: `sin IPC ${anioIpc}: tasa ${p.tasa_pct} %` };
    if (p.ipc_faltante === "ultimo_conocido" && ultimo !== null) return { pct: ultimo, origen: `sin IPC ${anioIpc}: último conocido` };
    return { pct: 0, origen: `sin IPC ${anioIpc}: sin reajuste` };
  };

  let valorHa = e.valor_ha_anio;
  if (p.actualizar_base) for (let a = e.anio_base + 1; a <= e.anio_inicio; a++) valorHa *= 1 + variacion(a).pct / 100;
  else if (e.anio_inicio !== e.anio_base) avisos.push(`El valor base es de ${e.anio_base} y se usa sin actualizar para ${e.anio_inicio}.`);

  const filas: FilaCalculo[] = [];
  for (let i = 0; i < e.anios; i++) {
    const anio = e.anio_inicio + i;
    let v: { pct: number; origen: string } | null = null;
    if (i > 0) { v = variacion(anio); valorHa *= 1 + v.pct / 100; }
    const ha = redondear(valorHa, p.redondeo);
    filas.push({ anio, variacion_pct: v?.pct ?? null, origen: v?.origen ?? "valor inicial", valor_ha: ha, valor: redondear(ha * e.area_ha, p.redondeo) });
  }
  if (faltantes.size) avisos.push(`No hay IPC registrado para: ${[...faltantes].sort().join(", ")}. Se aplicó la regla "${p.ipc_faltante}".`);
  if (proyectados.size) avisos.push(`Se usaron IPC proyectados (no oficiales) para: ${[...proyectados].sort().join(", ")}.`);
  return { filas, total: filas.reduce((s, f) => s + f.valor, 0), avisos };
}

export const pesos = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? "" : "$ " + Math.round(Number(v)).toLocaleString("es-CO");
export const numero = (v: number | string | null | undefined, decimales = 4) =>
  v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: decimales });
