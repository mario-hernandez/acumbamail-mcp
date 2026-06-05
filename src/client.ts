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
 * Acumbamail en form-urlencoded:
 *   - dict:   merge_fields[email]=...   (clave[subclave]=valor)
 *   - array:  email_list[0]=...         (clave[indice]=valor)
 * Excepción: algunos parámetros (p.ej. `lists`, `subscribers_data`) deben ir
 * como STRING JSON; en esos casos el handler ya pasa el string serializado.
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
}

export class AcumbamailClient {
  private authToken: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(opts: AcumbamailClientOptions) {
    // El token puede faltar al construir; se valida en la primera llamada real
    // (call), para que las tools con gate puedan responder sin tocar la API.
    this.authToken = opts.authToken ?? "";
    this.timeoutMs = opts.timeoutMs ?? 30000;
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

        // Rate limit → backoff exponencial y reintento.
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
            `Acumbamail devolvió HTTP ${res.status} en ${method}.`,
            res.status,
            text,
          );
        }

        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        // Reintenta solo errores de red/abort, no errores de API ya tipados.
        const retriable =
          !(err instanceof AcumbamailError) && attempt < this.maxRetries;
        if (retriable) {
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
