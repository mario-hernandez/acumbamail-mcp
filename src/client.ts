/**
 * Cliente HTTP de la API de Acumbamail.
 *
 * Base URL:  https://acumbamail.com/api/1/<method>/   (el método va EN LA RUTA)
 * Auth:      parámetro `auth_token` (token de cuenta, leído de la env var,
 *            NUNCA hardcodeado).
 * Formato:   POST application/x-www-form-urlencoded. Salida JSON: se envían
 *            tanto `response_type=json` (doc/SDK PHP) como `_response_type=json`
 *            (confirmado en uso real) para máxima compatibilidad.
 *
 * Códigos de estado: 200 OK · 201 modificado OK · 400 argumento inválido ·
 * 401 auth fallida · 429 rate limit · 500 error de servidor.
 */

const BASE_URL = "https://acumbamail.com/api/1";

export class AcumbamailError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "AcumbamailError";
    this.status = status;
    this.body = body;
  }
}

/** Valor admisible en los parámetros de una llamada. */
export type ParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ParamValue[]
  | { [key: string]: ParamValue };

export type Params = Record<string, ParamValue>;

/**
 * Aplana un objeto de parámetros a pares clave/valor en el formato que espera
 * Acumbamail en form-urlencoded (igual que el SDK PHP oficial):
 *   - array:  lists[0]=..., email_list[0]=...   (clave[indice]=valor)
 *   - dict:   merge_fields[email]=...           (clave[subclave]=valor)
 * Único parámetro que va como STRING JSON: `subscribers_data` (batchAddSubscribers);
 * el handler ya pasa el `JSON.stringify`. Los demás arrays (p.ej. `lists`) se pasan
 * como array y se aplanan aquí a notación indexada.
 */
function appendParam(usp: URLSearchParams, key: string, value: ParamValue): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => appendParam(usp, `${key}[${i}]`, v));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      appendParam(usp, `${key}[${k}]`, v);
    }
    return;
  }
  usp.append(key, String(value));
}

export interface AcumbamailClientOptions {
  authToken: string;
  timeoutMs?: number;
  /** Reintentos ante 429 / errores de red transitorios. */
  maxRetries?: number;
  /** Si true, registra método + status HTTP por stderr (nunca el token ni el cuerpo). */
  debug?: boolean;
}

export class AcumbamailClient {
  private authToken: string;
  private timeoutMs: number;
  private maxRetries: number;
  private debug: boolean;

  constructor(opts: AcumbamailClientOptions) {
    // El token puede faltar al construir; se valida en la primera llamada real
    // (call), para que las tools con gate puedan responder sin tocar la API.
    this.authToken = opts.authToken ?? "";
    this.debug = opts.debug ?? false;
    // `?? 30000` no captura NaN (Number('abc')) ni 0 (Number('')): guarda explícita.
    this.timeoutMs =
      Number.isFinite(opts.timeoutMs) && (opts.timeoutMs as number) > 0
        ? (opts.timeoutMs as number)
        : 30000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  /**
   * Llama a un método de la API. Devuelve el JSON parseado (objeto/array) o el
   * texto crudo si la respuesta no es JSON.
   */
  async call(method: string, params: Params = {}): Promise<unknown> {
    if (!this.authToken) {
      throw new Error(
        "Falta la variable de entorno ACUMBAMAIL_AUTH_TOKEN. Configúrala al registrar el MCP (ver README). No la escribas en ningún archivo.",
      );
    }
    const url = `${BASE_URL}/${method}/`;

    const build = () => {
      const usp = new URLSearchParams();
      usp.append("auth_token", this.authToken);
      usp.append("response_type", "json");
      usp.append("_response_type", "json");
      for (const [k, v] of Object.entries(params)) appendParam(usp, k, v);
      return usp;
    };

    // Solo los métodos de lectura (get*) son idempotentes: ante un fallo de red
    // o timeout es seguro reintentarlos. Los mutadores (create/add/batch/delete/
    // send) NO se reintentan ante error de red, porque el POST podría haber
    // llegado y ejecutado (p.ej. una campaña que se envía al instante) y un
    // reintento causaría un DOBLE ENVÍO.
    const idempotent = method.startsWith("get");

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: build().toString(),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const text = await res.text();

        if (this.debug) {
          process.stderr.write(
            `[acumbamail] ${method} → HTTP ${res.status}${attempt > 0 ? ` (reintento ${attempt})` : ""}\n`,
          );
        }

        // Rate limit → backoff exponencial. Seguro de reintentar siempre: un 429
        // significa que la petición fue rechazada sin llegar a procesarse.
        if (res.status === 429 && attempt < this.maxRetries) {
          await sleep(500 * Math.pow(2, attempt));
          continue;
        }

        if (res.status === 401) {
          throw new AcumbamailError(
            "Autenticación fallida (401). Revisa ACUMBAMAIL_AUTH_TOKEN.",
            401,
            text,
          );
        }
        if (!res.ok) {
          throw new AcumbamailError(
            `Acumbamail devolvió HTTP ${res.status} en ${method}: ${text.slice(0, 300)}`,
            res.status,
            text,
          );
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return text;
        }
        // Acumbamail puede devolver HTTP 200 con un cuerpo de error (p.ej.
        // {"error": {...}}). Tratarlo como fallo, no reportarlo como éxito.
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          "error" in parsed &&
          (parsed as Record<string, unknown>).error
        ) {
          throw new AcumbamailError(
            `Acumbamail devolvió un error en ${method}: ${JSON.stringify((parsed as Record<string, unknown>).error)}`,
            res.status,
            text,
          );
        }
        return parsed;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        // No reintentar errores de API ya tipados. Errores de red/abort: reintentar
        // SOLO si el método es idempotente (lectura), nunca en escrituras.
        const networkError = !(err instanceof AcumbamailError);
        if (networkError && idempotent && attempt < this.maxRetries) {
          await sleep(500 * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`Fallo llamando a ${method}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
