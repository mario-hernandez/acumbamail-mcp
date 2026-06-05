# acumbamail-mcp

Servidor **MCP (Model Context Protocol)** para [Acumbamail](https://acumbamail.com) — el ESP español de email marketing. Expone listas, suscriptores, campañas, estadísticas y email transaccional como tools que un agente (Claude, etc.) puede usar.

> A junio de 2026 **no existía ningún MCP nativo de Acumbamail** (solo wrappers genéricos tipo Pipedream o nodos n8n). Este lo es: servidor dedicado en TypeScript sobre el SDK oficial de MCP.

## Características

- **24 tools** sobre la API REST de Acumbamail, agrupadas en: listas, suscriptores, campañas, estadísticas y transaccional.
- **Gates de seguridad** en las acciones peligrosas: `create_campaign`, `delete_list`, `delete_campaign`, `delete_subscriber`, `batch_delete_subscribers` requieren `confirm: true` explícito. Sin él, la tool describe el efecto y **no actúa**.
- **Protección anti-envío-accidental:** `create_campaign` en Acumbamail **envía la campaña de inmediato** (no hay borrador vía API). Por eso su gate es obligatorio y, además, **rechaza** cualquier HTML que no incluya el enlace de baja `*|UNSUBSCRIBE_URL|*`.
- **Robustez:** backoff exponencial ante rate-limit (429), timeout configurable, manejo de errores tipado.
- **Clave por entorno:** el token jamás se escribe en disco ni en el repositorio.

## Requisitos

- Node.js ≥ 18
- Un token de la API de Acumbamail (lo encuentras logueado en <https://acumbamail.com/apidoc/>)

## Instalación

```bash
git clone git@github.com:mario-hernandez/acumbamail-mcp.git
cd acumbamail-mcp
npm install
npm run build
```

## Configuración del token

El servidor lee el token **solo** de la variable de entorno `ACUMBAMAIL_AUTH_TOKEN`. Nunca lo pongas en un archivo versionado.

Para desarrollo local, copia `.env.example` a `.env` (ya está en `.gitignore`):

```bash
cp .env.example .env
# edita .env y pon tu token
```

## Registro en Claude Code

Inyecta el token desde el llavero de macOS (no lo escribas en ningún archivo):

```bash
claude mcp add acumbamail \
  -e ACUMBAMAIL_AUTH_TOKEN="$(security find-generic-password -s acumbamail-api -w)" \
  -- node /ruta/a/acumbamail-mcp/dist/index.js
```

O, una vez publicado en npm:

```bash
claude mcp add acumbamail \
  -e ACUMBAMAIL_AUTH_TOKEN="$(security find-generic-password -s acumbamail-api -w)" \
  -- npx -y acumbamail-mcp
```

Comprueba con `claude mcp list` que aparece `acumbamail … ✓ Connected`.

## Tools

### Listas
| Tool | Descripción |
|---|---|
| `acumbamail_get_lists` | Lista todas las listas de la cuenta |
| `acumbamail_get_list_stats` | Estadísticas de una lista (totales, altas, bajas, bounces) |
| `acumbamail_create_list` | Crea una lista (datos de empresa obligatorios anti-spam) |
| `acumbamail_delete_list` | 🔒 Borra una lista y sus suscriptores (`confirm`) |
| `acumbamail_get_fields` | Merge fields (columnas) de una lista |
| `acumbamail_add_merge_tag` | Añade una columna / merge tag a una lista |
| `acumbamail_get_forms` | Formularios de suscripción de una lista |

### Suscriptores
| Tool | Descripción |
|---|---|
| `acumbamail_get_subscribers` | Lista suscriptores (filtro por estado, paginable) |
| `acumbamail_get_subscriber_details` | Detalle de un suscriptor |
| `acumbamail_add_subscriber` | Alta de un suscriptor (con DOI opcional) |
| `acumbamail_batch_add_subscribers` | Alta/actualización masiva (vía preferida para imports) |
| `acumbamail_delete_subscriber` | 🔒 Borra un suscriptor (`confirm`) |
| `acumbamail_batch_delete_subscribers` | 🔒 Borrado masivo (`confirm`) |

### Campañas
| Tool | Descripción |
|---|---|
| `acumbamail_create_campaign` | 🔒⚠️ Crea y **ENVÍA** una campaña al instante (`confirm` + exige `*\|UNSUBSCRIBE_URL\|*`) |
| `acumbamail_get_campaigns` | Lista todas las campañas |
| `acumbamail_get_campaign_basic_information` | Info básica de una campaña |
| `acumbamail_get_campaign_total_information` | Estadísticas agregadas de una campaña |
| `acumbamail_get_campaign_html` | HTML de una campaña |
| `acumbamail_delete_campaign` | 🔒 Borra una campaña (`confirm`) |

### Estadísticas
| Tool | Descripción |
|---|---|
| `acumbamail_get_campaign_openers` | Quién abrió la campaña |
| `acumbamail_get_campaign_clicks` | Clics de la campaña |
| `acumbamail_get_campaign_soft_bounces` | Soft bounces |
| `acumbamail_get_campaign_hard_bounces` | Hard bounces (clave para limpiar listas) |

### Transaccional
| Tool | Descripción |
|---|---|
| `acumbamail_send_one` | Envía un email transaccional individual (SMTP) |

🔒 = requiere `confirm: true` · ⚠️ = envío inmediato e irreversible

## Notas de la API de Acumbamail (gotchas)

- **`create_campaign` envía al instante**: no existe borrador vía API. Maqueta y valida el HTML *antes*.
- **`lists`** debe ser un array de IDs (`[123]`); el cliente lo serializa correctamente.
- **Merge tags** usan sintaxis `*|TAG|*` (p.ej. `*|NOMBRE|*`, `*|UNSUBSCRIBE_URL|*`).
- **Naming inconsistente**: `get_subscriber_details` usa el parámetro `subscriber` (email); `delete_subscriber` usa `email`.
- **Rate limit (429)**: el cliente reintenta con backoff exponencial.
- **Paginación**: `get_subscribers` en listas grandes usa `block_index`.

## Roadmap (v2)

Métodos de la API aún por verificar contra el panel logueado antes de exponerlos: `updateList`, `unsubscribeSubscriber`, webhooks (`createWebhook`/`getWebhooks`), SMS (`sendSMS`, campañas SMS), info SMTP (`getSMTPInfo`/log), y senders/credit de cuenta.

## Licencia

MIT © Mario Hernández
