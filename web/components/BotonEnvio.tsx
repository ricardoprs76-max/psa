"use client";

import { useFormStatus } from "react-dom";

/** Botón de envío que se bloquea y cambia de texto mientras el servidor trabaja (lecturas con IA, importaciones). */
export function BotonEnvio({ texto, enviando, tipo = "primario", name, value }: { texto: string; enviando: string; tipo?: "primario" | "suave"; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  const estilo = tipo === "primario" ? "bg-marca text-white hover:bg-marca-fuerte dark:text-[#0d1512]" : "border border-borde bg-tarjeta hover:bg-marca-suave";
  return (
    <button disabled={pending} name={name} value={value} className={`inline-flex h-9 cursor-pointer items-center justify-center rounded-lg px-3.5 text-sm font-medium disabled:cursor-wait disabled:opacity-60 ${estilo}`}>
      {pending ? enviando : texto}
    </button>
  );
}
