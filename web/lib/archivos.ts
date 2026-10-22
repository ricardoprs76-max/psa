import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DIR_DATOS } from "./db";
import { bajarArchivo, subirArchivo } from "./nube";

/**
 * Almacén de archivos (solicitudes, plantillas, comprobantes). Se guardan en web/.datos/archivos y en la nube (lib/nube.ts);
 * las rutas que se guardan en la base son relativas, de modo que al pasar a Supabase Storage solo cambia este módulo.
 */
const RAIZ = path.join(DIR_DATOS, "archivos");

function rutaSegura(relativa: string): string {
  const completa = path.resolve(RAIZ, relativa);
  if (!completa.startsWith(RAIZ + path.sep)) throw new Error("Ruta de archivo no válida.");
  return completa;
}

const limpiar = (nombre: string) => nombre.normalize("NFD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-80) || "archivo";

/** Guarda el archivo en la carpeta indicada y devuelve su ruta relativa. */
export async function guardarArchivo(carpeta: string, nombre: string, datos: Buffer): Promise<string> {
  const relativa = `${carpeta}/${crypto.randomUUID().slice(0, 8)}_${limpiar(nombre)}`;
  const completa = rutaSegura(relativa);
  await fs.mkdir(path.dirname(completa), { recursive: true });
  await fs.writeFile(completa, datos);
  await subirArchivo(relativa, datos);
  return relativa;
}

export async function leerArchivo(relativa: string): Promise<Buffer> {
  const completa = rutaSegura(relativa);
  try {
    return await fs.readFile(completa);
  } catch (e) {
    // Servidor recién encendido o computador nuevo: el archivo está en la nube y se deja a mano para la próxima vez.
    const datos = await bajarArchivo(relativa);
    if (!datos) throw e;
    await fs.mkdir(path.dirname(completa), { recursive: true });
    await fs.writeFile(completa, datos);
    return datos;
  }
}

export function tipoMime(nombre: string): string {
  const ext = path.extname(nombre).toLowerCase();
  return ({
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".csv": "text/csv",
  } as Record<string, string>)[ext] ?? "application/octet-stream";
}
