"use client";

/** Abre el diálogo de impresión del navegador, desde donde se guarda la página como PDF. */
export function BotonImprimir({ children }: { children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-borde bg-tarjeta px-3.5 text-sm font-medium hover:bg-marca-suave">
      {children}
    </button>
  );
}
