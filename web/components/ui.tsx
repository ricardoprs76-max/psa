import Link from "next/link";
import type { ReactNode } from "react";

/** Piezas de interfaz al estilo shadcn/ui, escritas a mano para no depender de su instalador. */

export function Tarjeta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-borde bg-tarjeta shadow-sm ${className}`}>{children}</div>;
}

export function Titulo({ titulo, detalle, children }: { titulo: string; detalle?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {detalle && <p className="mt-1 text-sm text-tenue">{detalle}</p>}
      </div>
      <div className="no-imprimir flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const estilos = {
  primario: "bg-marca text-white hover:bg-marca-fuerte dark:text-[#0d1512]",
  suave: "border border-borde bg-tarjeta hover:bg-marca-suave",
  peligro: "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950",
};
const base = "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer";

export function Boton({ children, tipo = "primario", className = "", ...resto }: { children: ReactNode; tipo?: keyof typeof estilos } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`${base} ${estilos[tipo]} ${className}`} {...resto}>{children}</button>;
}

export function Enlace({ children, href, tipo = "suave", className = "" }: { children: ReactNode; href: string; tipo?: keyof typeof estilos; className?: string }) {
  return <Link href={href} className={`${base} ${estilos[tipo]} ${className}`}>{children}</Link>;
}

const tonos: Record<string, string> = {
  verde: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  ambar: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  rojo: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  gris: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  azul: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
};

const tonoDe: Record<string, string> = {
  vigente: "verde", activo: "verde", pagado: "verde", aprobada: "verde", enviada: "azul", recibido: "verde", aplica: "verde",
  borrador: "gris", pendiente: "ambar", en_revision: "ambar", suspendido: "ambar", en_estructuracion: "ambar", valor_especial: "azul", advertencia: "ambar",
  incumplido: "rojo", retenido_incumplimiento: "rojo", vencido: "rojo", rechazado: "rojo", anulado: "gris", terminado: "gris", liquidado: "gris",
  reemplazado: "gris", no_aplica: "gris", error: "rojo", informativa: "azul",
};

export function Insignia({ children, valor, tono }: { children: ReactNode; valor?: string; tono?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tonos[tono ?? tonoDe[valor ?? ""] ?? "gris"]}`}>{children}</span>;
}

/** Mensaje de resultado que llega en la dirección (?ok=… o ?error=…). */
export function Aviso({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div role="status" className={`mb-4 rounded-xl border px-4 py-3 text-sm ${error ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200" : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"}`}>
      {error ?? ok}
    </div>
  );
}

export function Etiqueta({ texto, ayuda, requerido, children, ancho }: { texto: string; ayuda?: string; requerido?: boolean; children: ReactNode; ancho?: boolean }) {
  return (
    <label className={`block ${ancho ? "md:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-tenue">{texto}{requerido && <span className="text-red-600"> *</span>}</span>
      {children}
      {ayuda && <span className="mt-1 block text-xs text-tenue">{ayuda}</span>}
    </label>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-borde px-6 py-10 text-center text-sm text-tenue">{children}</div>;
}
