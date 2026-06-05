#!/usr/bin/env node
/**
 * Servidor MCP de Acumbamail.
 *
 * Transporte: stdio. Token de la API leído de la variable de entorno
 * ACUMBAMAIL_AUTH_TOKEN (nunca hardcodeado, nunca versionado).
 *
 * Registro en Claude Code (la clave se inyecta desde el Keychain, no se escribe
 * en ningún archivo):
 *   claude mcp add acumbamail \
 *     -e ACUMBAMAIL_AUTH_TOKEN="$(security find-generic-password -s acumbamail-api -w)" \
 *     -- npx -y acumbamail-mcp
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AcumbamailClient } from "./client.js";
import { TOOLS } from "./tools.js";

const VERSION = "0.1.0";

let _client: AcumbamailClient | null = null;
function getClient(): AcumbamailClient {
  if (_client) return _client;
  // El token puede no estar presente: el cliente solo lo exige al hacer una
  // llamada real, de modo que los gates de confirmación funcionan sin él.
  const token = process.env.ACUMBAMAIL_AUTH_TOKEN ?? "";
  const timeoutMs = process.env.ACUMBAMAIL_TIMEOUT_MS
    ? Number(process.env.ACUMBAMAIL_TIMEOUT_MS)
    : undefined;
  _client = new AcumbamailClient({ authToken: token, timeoutMs });
  return _client;
}

function toText(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

async function main(): Promise<void> {
  const server = new McpServer({ name: "acumbamail", version: VERSION });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: Record<string, any>) => {
        try {
          const result = await tool.handler(getClient(), args ?? {});
          return { content: [{ type: "text", text: toText(result) }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // No escribir en stdout (rompe el protocolo stdio); los avisos van a stderr.
  process.stderr.write(`acumbamail-mcp v${VERSION} listo · ${TOOLS.length} tools\n`);
}

main().catch((err) => {
  process.stderr.write(`Fallo al iniciar acumbamail-mcp: ${err?.message ?? err}\n`);
  process.exit(1);
});
