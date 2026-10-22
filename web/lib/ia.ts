import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { q1 } from "./db";
import { descifrar } from "./sesion";

/**
 * Lectura de solicitudes en PDF con la API de Claude. Siempre desde el servidor.
 * La clave NO se toma del entorno ni se configura sola: es la que un administrador escribe en Ajustes → Inteligencia artificial.
 */

export const MODELO_POR_DEFECTO = "claude-opus-5-5";

export const Extraccion = z.object({
  solicitante: z.string().nullable().describe("Persona o entidad que firma la solicitud"),
  solicitante_documento: z.string().nullable().describe("Cédula o NIT del solicitante, solo si aparece"),
  radicado: z.string().nullable().describe("Número de radicado, solo si aparece en el documento"),
  fecha_solicitud: z.string().nullable().describe("Fecha del documento en formato AAAA-MM-DD"),
  asunto: z.string().nullable(),
  municipio: z.string().nullable(),
  vereda: z.string().nullable(),
  area_ha: z.number().nullable().describe("Área total solicitada en hectáreas, convertida si viene en m²"),
  area_texto: z.string().nullable().describe("El área exactamente como está escrita, con su unidad"),
  anios: z.number().nullable().describe("Número de años que se pide proyectar, solo si se indica"),
  predios: z.array(z.object({
    nombre: z.string().nullable(),
    fmi: z.string().nullable().describe("Folio de matrícula inmobiliaria, ej. 000-12345"),
    codigo_catastral: z.string().nullable().describe("Número predial de 30 dígitos, tal como aparece"),
    vereda: z.string().nullable(),
    municipio: z.string().nullable(),
    area_ha: z.number().nullable(),
    area_texto: z.string().nullable(),
  })),
  resumen: z.string().describe("Qué se pide, en dos o tres frases"),
  dudas: z.array(z.string()).describe("Datos ilegibles, contradictorios o ausentes que la persona debe verificar"),
});
export type DatosExtraidos = z.infer<typeof Extraccion>;

const SISTEMA = `Extraes datos de solicitudes dirigidas a una autoridad ambiental colombiana sobre Pagos por Servicios Ambientales (PSA): oficios, peticiones y diagnósticos de predios. El documento puede venir escaneado.

Tu salida la revisa una persona antes de usarse y de ella sale una respuesta oficial, así que un dato inventado es peor que un dato vacío:
- Copia solo lo que está en el documento. Si un dato no aparece o no se lee, devuélvelo como null y explícalo en "dudas".
- No completes radicados, cédulas, matrículas ni códigos catastrales por inferencia; si faltan dígitos, cópialos como están y anótalo en "dudas".
- Si el documento da áreas que se contradicen (por ejemplo una en m² y otra en hectáreas que no coinciden), no elijas en silencio: pon en area_ha la que el documento presenta como área del predio, deja el texto original en area_texto y describe la contradicción en "dudas".
- 1 hectárea = 10.000 m². En Colombia el punto separa miles y la coma decimales (10.285,77 m² = 1,0286 ha).
- Si aparecen nombres de otros predios o personas que parecen copiados de otro documento, menciónalo en "dudas".`;

export class ErrorIA extends Error {}

export async function configuracionIA(): Promise<{ clave: string | null; modelo: string }> {
  const secreto = await q1<{ valor_cifrado: string }>("select valor_cifrado from secretos where clave = 'anthropic_api_key'");
  const conf = await q1<{ valor: { modelo?: string } }>("select valor from configuracion where clave = 'ia'");
  return { clave: secreto ? descifrar(secreto.valor_cifrado) : null, modelo: conf?.valor?.modelo?.trim() || MODELO_POR_DEFECTO };
}

// Modelos que admiten el respaldo automático del servidor cuando el modelo principal declina responder.
const conRespaldo = (modelo: string) => /^claude-(opus-5|fable-5-1|sonnet-5-5)/.test(modelo);

async function pedir(clave: string, modelo: string, contenido: Anthropic.Beta.BetaContentBlockParam[], maxTokens: number, formato?: ReturnType<typeof zodOutputFormat>) {
  const cliente = new Anthropic({ apiKey: clave });
  try {
    const respuesta = await cliente.beta.messages.create({
      model: modelo,
      max_tokens: maxTokens,
      system: SISTEMA,
      messages: [{ role: "user", content: contenido }],
      output_config: { effort: "medium", ...(formato ? { format: formato } : {}) },
      ...(conRespaldo(modelo) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (respuesta.stop_reason === "refusal") throw new ErrorIA("El modelo no quiso procesar este documento. Regístralo manualmente.");
    if (respuesta.stop_reason === "max_tokens") throw new ErrorIA("El documento es demasiado largo para leerlo de una vez. Divídelo o regístralo manualmente.");
    return { texto: respuesta.content.map((b) => (b.type === "text" ? b.text : "")).join(""), modelo: respuesta.model };
  } catch (e) {
    if (e instanceof ErrorIA) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new ErrorIA("La clave de la API no es válida o no tiene permiso. Revísala en Ajustes.");
    if (e instanceof Anthropic.NotFoundError) throw new ErrorIA(`El modelo "${modelo}" no existe o tu clave no tiene acceso. Revísalo en Ajustes.`);
    if (e instanceof Anthropic.RateLimitError) throw new ErrorIA("Se alcanzó el límite de uso de la API. Espera un momento e intenta de nuevo.");
    if (e instanceof Anthropic.BadRequestError) throw new ErrorIA(`La API rechazó la petición: ${e.message}`);
    if (e instanceof Anthropic.APIConnectionError) throw new ErrorIA("No hay conexión con la API de Claude. Revisa el acceso a internet del servidor.");
    if (e instanceof Anthropic.APIError) throw new ErrorIA(`La API respondió con un error (${e.status ?? "sin código"}). Intenta más tarde.`);
    throw e;
  }
}

/** Lee la solicitud en PDF y devuelve los datos estructurados junto con el modelo que respondió. */
export async function analizarSolicitud(pdf: Buffer): Promise<{ datos: DatosExtraidos; modelo: string }> {
  const { clave, modelo } = await configuracionIA();
  if (!clave) throw new ErrorIA("No hay clave de API configurada. Un administrador debe escribirla en Ajustes → Inteligencia artificial.");
  const r = await pedir(clave, modelo, [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
    { type: "text", text: "Extrae los datos de esta solicitud." },
  ], 16000, zodOutputFormat(Extraccion));
  let json: unknown;
  try { json = JSON.parse(r.texto); } catch { throw new ErrorIA("La respuesta del modelo no se pudo interpretar. Intenta de nuevo."); }
  const datos = Extraccion.safeParse(json);
  if (!datos.success) throw new ErrorIA("La respuesta del modelo no trae el formato esperado. Intenta de nuevo.");
  return { datos: datos.data, modelo: r.modelo };
}

/** Comprueba que la clave y el modelo funcionan. */
export async function probarIA(): Promise<string> {
  const { clave, modelo } = await configuracionIA();
  if (!clave) throw new ErrorIA("Primero guarda la clave de la API.");
  const r = await pedir(clave, modelo, [{ type: "text", text: "Responde solo: conexión correcta." }], 1000);
  return `${r.texto.trim()} (modelo ${r.modelo})`;
}
