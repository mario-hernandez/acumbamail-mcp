/**
 * Definición de las tools del MCP de Acumbamail.
 *
 * Cada tool mapea a un método de la API. Las acciones que ENVÍAN correo o
 * BORRAN datos llevan un "gate" de confirmación: requieren `confirm: true`
 * explícito; si no, devuelven una advertencia y NO ejecutan nada.
 *
 * ⚠️ create_campaign ENVÍA la campaña de inmediato (Acumbamail no tiene
 * borrador vía API), por eso su gate es obligatorio.
 */

import { z, type ZodRawShape } from "zod";
import { AcumbamailClient } from "./client.js";

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (client: AcumbamailClient, args: Record<string, any>) => Promise<unknown> | unknown;
}

const GATE = {
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Debe ser true para ejecutar realmente. Sin él, la tool solo describe el efecto y no actúa.",
    ),
};

function gate(args: Record<string, any>, message: string): { needsConfirmation: true; message: string } | null {
  if (args.confirm === true) return null;
  return { needsConfirmation: true as const, message };
}

export const TOOLS: ToolDef[] = [
  // ───────────────────────── LISTAS ─────────────────────────
  {
    name: "acumbamail_get_lists",
    title: "Listar listas",
    description: "Devuelve todas las listas de suscriptores de la cuenta (id → datos).",
    inputSchema: {},
    handler: (c) => c.call("getLists"),
  },
  {
    name: "acumbamail_get_list_stats",
    title: "Estadísticas de lista",
    description: "Estadísticas de una lista: totales, altas, bajas, bounces.",
    inputSchema: { list_id: z.number().int().describe("ID de la lista") },
    handler: (c, a) => c.call("getListStats", { list_id: a.list_id }),
  },
  {
    name: "acumbamail_create_list",
    title: "Crear lista",
    description:
      "Crea una nueva lista de suscriptores. Los datos de empresa (company/country/city/address) son obligatorios por requisitos anti-spam.",
    inputSchema: {
      name: z.string().describe("Nombre de la lista"),
      sender_email: z.string().email().describe("Email remitente asociado a la lista"),
      company: z.string().describe("Nombre de la empresa"),
      country: z.string().describe("País"),
      city: z.string().describe("Ciudad"),
      address: z.string().describe("Dirección postal"),
      phone: z.string().optional().describe("Teléfono (opcional)"),
    },
    handler: (c, a) =>
      c.call("createList", {
        name: a.name,
        sender_email: a.sender_email,
        company: a.company,
        country: a.country,
        city: a.city,
        address: a.address,
        phone: a.phone,
      }),
  },
  {
    name: "acumbamail_delete_list",
    title: "Borrar lista",
    description:
      "Elimina una lista y TODOS sus suscriptores. Acción destructiva e irreversible. Requiere confirm:true.",
    inputSchema: { list_id: z.number().int().describe("ID de la lista"), ...GATE },
    handler: (c, a) => {
      const g = gate(
        a,
        `Vas a BORRAR la lista ${a.list_id} y todos sus suscriptores. Es irreversible. Vuelve a llamar con confirm:true para ejecutar.`,
      );
      return g ?? c.call("deleteList", { list_id: a.list_id });
    },
  },
  {
    name: "acumbamail_get_fields",
    title: "Campos de la lista",
    description: "Devuelve los merge fields (columnas) de una lista y su tipo.",
    inputSchema: { list_id: z.number().int().describe("ID de la lista") },
    handler: (c, a) => c.call("getFields", { list_id: a.list_id }),
  },
  {
    name: "acumbamail_add_merge_tag",
    title: "Añadir campo / merge tag",
    description:
      "Añade una columna (merge tag) a una lista. En el HTML se referencia como *|FIELD_NAME|*.",
    inputSchema: {
      list_id: z.number().int().describe("ID de la lista"),
      field_name: z.string().describe("Nombre del campo, p.ej. NOMBRE"),
      field_type: z
        .enum(["text", "char", "number", "date"])
        .default("text")
        .describe("Tipo de campo"),
    },
    handler: (c, a) =>
      c.call("addMergeTag", {
        list_id: a.list_id,
        field_name: a.field_name,
        field_type: a.field_type,
      }),
  },
  {
    name: "acumbamail_get_forms",
    title: "Formularios de la lista",
    description: "Lista los formularios de suscripción asociados a una lista.",
    inputSchema: { list_id: z.number().int().describe("ID de la lista") },
    handler: (c, a) => c.call("getForms", { list_id: a.list_id }),
  },

  // ─────────────────────── SUSCRIPTORES ───────────────────────
  {
    name: "acumbamail_get_subscribers",
    title: "Listar suscriptores",
    description:
      "Lista los suscriptores de una lista. status: 0 activos, 1 sin verificar, 2 baja, 3 hard bounced, 4 quejas. Listas grandes requieren paginar con block_index.",
    inputSchema: {
      list_id: z.number().int().describe("ID de la lista"),
      status: z.number().int().min(0).max(4).optional().describe("Filtro de estado 0-4"),
      complete_json: z
        .boolean()
        .optional()
        .describe("true para devolver objetos completos por suscriptor"),
      block_index: z.number().int().optional().describe("Índice de bloque para paginación"),
    },
    handler: (c, a) =>
      c.call("getSubscribers", {
        list_id: a.list_id,
        status: a.status,
        complete_json: a.complete_json ? 1 : undefined,
        block_index: a.block_index,
      }),
  },
  {
    name: "acumbamail_get_subscriber_details",
    title: "Detalle de suscriptor",
    description: "Detalle de un suscriptor concreto de una lista (el parámetro es su email).",
    inputSchema: {
      list_id: z.number().int().describe("ID de la lista"),
      subscriber: z.string().email().describe("Email del suscriptor"),
    },
    handler: (c, a) =>
      c.call("getSubscriberDetails", { list_id: a.list_id, subscriber: a.subscriber }),
  },
  {
    name: "acumbamail_add_subscriber",
    title: "Añadir suscriptor",
    description:
      "Añade UN suscriptor a una lista. merge_fields debe incluir al menos { email }. double_optin envía email de confirmación.",
    inputSchema: {
      list_id: z.number().int().describe("ID de la lista"),
      merge_fields: z
        .record(z.string())
        .describe('Campos del suscriptor, p.ej. {"email":"a@b.com","NOMBRE":"Ana"}'),
      double_optin: z.boolean().optional().describe("Activar doble opt-in (DOI)"),
      welcome_email: z.boolean().optional().describe("Enviar email de bienvenida"),
      update_subscriber: z
        .boolean()
        .optional()
        .describe("Actualizar si el email ya existe (upsert)"),
    },
    handler: (c, a) =>
      c.call("addSubscriber", {
        list_id: a.list_id,
        merge_fields: a.merge_fields,
        double_optin: a.double_optin ? 1 : undefined,
        welcome_email: a.welcome_email ? 1 : undefined,
        update_subscriber: a.update_subscriber ? 1 : undefined,
      }),
  },
  {
    name: "acumbamail_batch_add_subscribers",
    title: "Alta masiva de suscriptores",
    description:
      "Alta/actualización masiva. subscribers es un array de objetos con al menos email. Vía preferida para imports. update_subscriber hace upsert.",
    inputSchema: {
      list_id: z.number().int().describe("ID de la lista"),
      subscribers: z
        .array(z.record(z.string()))
        .describe('Array de suscriptores, p.ej. [{"email":"a@b.com","NOMBRE":"Ana"}]'),
      update_subscriber: z.boolean().optional().default(true).describe("Upsert si ya existe"),
      complete_json: z.boolean().optional().default(true).describe("Respuesta detallada"),
    },
    handler: (c, a) =>
      c.call("batchAddSubscribers", {
        list_id: a.list_id,
        subscribers_data: JSON.stringify(a.subscribers),
        update_subscriber: a.update_subscriber === false ? undefined : 1,
        complete_json: a.complete_json === false ? undefined : 1,
      }),
  },
  {
    name: "acumbamail_delete_subscriber",
    title: "Borrar suscriptor",
    description: "Elimina (no da de baja: borra) un suscriptor de una lista. Requiere confirm:true.",
    inputSchema: {
      list_id: z.number().int().describe("ID de la lista"),
      email: z.string().email().describe("Email del suscriptor a borrar"),
      ...GATE,
    },
    handler: (c, a) => {
      const g = gate(
        a,
        `Vas a BORRAR a ${a.email} de la lista ${a.list_id}. Vuelve a llamar con confirm:true para ejecutar.`,
      );
      return g ?? c.call("deleteSubscriber", { list_id: a.list_id, email: a.email });
    },
  },
  {
    name: "acumbamail_batch_delete_subscribers",
    title: "Borrado masivo de suscriptores",
    description: "Borra varios suscriptores de una lista por su email. Requiere confirm:true.",
    inputSchema: {
      list_id: z.number().int().describe("ID de la lista"),
      emails: z.array(z.string().email()).describe("Emails a borrar"),
      ...GATE,
    },
    handler: (c, a) => {
      const g = gate(
        a,
        `Vas a BORRAR ${a.emails?.length ?? 0} suscriptores de la lista ${a.list_id}. Vuelve a llamar con confirm:true para ejecutar.`,
      );
      return g ?? c.call("batchDeleteSubscribers", { list_id: a.list_id, email_list: a.emails });
    },
  },

  // ───────────────────────── CAMPAÑAS ─────────────────────────
  {
    name: "acumbamail_create_campaign",
    title: "Crear y ENVIAR campaña",
    description:
      "⚠️ Crea y ENVÍA una campaña de email INMEDIATAMENTE a las listas indicadas (Acumbamail no tiene borrador vía API). Requiere confirm:true. El HTML usa merge tags *|NOMBRE|* y DEBE incluir *|UNSUBSCRIBE_URL|* (anti-spam).",
    inputSchema: {
      name: z.string().describe("Nombre interno de la campaña"),
      from_name: z.string().describe("Nombre del remitente"),
      from_email: z.string().email().describe("Email del remitente (verificado en la cuenta)"),
      subject: z.string().describe("Asunto del email"),
      content: z.string().describe("HTML del email (con *|UNSUBSCRIBE_URL|*)"),
      lists: z.array(z.number().int()).min(1).describe("IDs de las listas destinatarias"),
      pre_header: z.string().optional().describe("Preheader (texto de vista previa)"),
      tracking_urls: z.boolean().optional().default(true).describe("Rastrear clics en enlaces"),
      ...GATE,
    },
    handler: (c, a) => {
      const g = gate(
        a,
        `⚠️ ENVÍO INMEDIATO. Vas a enviar la campaña "${a.subject}" a las listas [${(a.lists || []).join(", ")}] desde ${a.from_email}. Acumbamail la envía al instante (sin borrador). Verifica que el HTML incluye *|UNSUBSCRIBE_URL|*. Vuelve a llamar con confirm:true para enviar.`,
      );
      if (g) return g;
      if (!String(a.content).includes("*|UNSUBSCRIBE_URL|*")) {
        return {
          error:
            "El HTML no contiene *|UNSUBSCRIBE_URL|* (enlace de baja obligatorio anti-spam). Añádelo antes de enviar.",
        };
      }
      return c.call("createCampaign", {
        name: a.name,
        from_name: a.from_name,
        from_email: a.from_email,
        subject: a.subject,
        content: a.content,
        lists: JSON.stringify(a.lists),
        pre_header: a.pre_header,
        tracking_urls: a.tracking_urls === false ? 0 : 1,
      });
    },
  },
  {
    name: "acumbamail_get_campaigns",
    title: "Listar campañas",
    description: "Lista todas las campañas de la cuenta.",
    inputSchema: {},
    handler: (c) => c.call("getCampaigns"),
  },
  {
    name: "acumbamail_get_campaign_basic_information",
    title: "Info básica de campaña",
    description: "Información básica de una campaña (asunto, fecha, remitente…).",
    inputSchema: { campaign_id: z.number().int().describe("ID de la campaña") },
    handler: (c, a) => c.call("getCampaignBasicInformation", { campaign_id: a.campaign_id }),
  },
  {
    name: "acumbamail_get_campaign_total_information",
    title: "Estadísticas totales de campaña",
    description: "Estadísticas agregadas: enviados, aperturas, clics, bounces, bajas.",
    inputSchema: { campaign_id: z.number().int().describe("ID de la campaña") },
    handler: (c, a) => c.call("getCampaignTotalInformation", { campaign_id: a.campaign_id }),
  },
  {
    name: "acumbamail_get_campaign_html",
    title: "HTML de la campaña",
    description: "Devuelve el HTML de una campaña.",
    inputSchema: { campaign_id: z.number().int().describe("ID de la campaña") },
    handler: (c, a) => c.call("getCampaignHTML", { campaign_id: a.campaign_id }),
  },
  {
    name: "acumbamail_delete_campaign",
    title: "Borrar campaña",
    description: "Elimina una campaña. Acción destructiva. Requiere confirm:true.",
    inputSchema: { campaign_id: z.number().int().describe("ID de la campaña"), ...GATE },
    handler: (c, a) => {
      const g = gate(
        a,
        `Vas a BORRAR la campaña ${a.campaign_id}. Vuelve a llamar con confirm:true para ejecutar.`,
      );
      return g ?? c.call("deleteCampaign", { campaign_id: a.campaign_id });
    },
  },

  // ─────────────────────── ESTADÍSTICAS ───────────────────────
  {
    name: "acumbamail_get_campaign_openers",
    title: "Aperturas de campaña",
    description: "Lista de aperturas (quién abrió) de una campaña.",
    inputSchema: { campaign_id: z.number().int().describe("ID de la campaña") },
    handler: (c, a) => c.call("getCampaignOpeners", { campaign_id: a.campaign_id }),
  },
  {
    name: "acumbamail_get_campaign_clicks",
    title: "Clics de campaña",
    description: "Lista de clics de una campaña.",
    inputSchema: { campaign_id: z.number().int().describe("ID de la campaña") },
    handler: (c, a) => c.call("getCampaignClicks", { campaign_id: a.campaign_id }),
  },
  {
    name: "acumbamail_get_campaign_soft_bounces",
    title: "Soft bounces de campaña",
    description: "Lista de soft bounces de una campaña.",
    inputSchema: { campaign_id: z.number().int().describe("ID de la campaña") },
    handler: (c, a) => c.call("getCampaignSoftBounces", { campaign_id: a.campaign_id }),
  },
  {
    name: "acumbamail_get_campaign_hard_bounces",
    title: "Hard bounces de campaña",
    description:
      "Lista de hard bounces de una campaña. Clave para limpiar listas antes de reenviar.",
    inputSchema: { campaign_id: z.number().int().describe("ID de la campaña") },
    handler: (c, a) => c.call("getCampaignHardBounces", { campaign_id: a.campaign_id }),
  },

  // ─────────────────────── TRANSACCIONAL ───────────────────────
  {
    name: "acumbamail_send_one",
    title: "Enviar email transaccional (1-a-1)",
    description:
      "Envía un email transaccional individual vía la API SMTP de Acumbamail. Para correos 1-a-1 (no campañas masivas).",
    inputSchema: {
      from_email: z.string().email().describe("Remitente"),
      to_email: z.string().email().describe("Destinatario"),
      subject: z.string().describe("Asunto"),
      body: z.string().describe("Cuerpo (HTML o texto)"),
      category: z.string().optional().describe("Categoría para agrupar estadísticas SMTP"),
    },
    handler: (c, a) =>
      c.call("sendOne", {
        from_email: a.from_email,
        to_email: a.to_email,
        subject: a.subject,
        body: a.body,
        category: a.category,
      }),
  },
];
