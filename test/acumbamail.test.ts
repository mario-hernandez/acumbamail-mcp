/**
 * Tests locales (sin red, sin CI): blindan los caminos cuyo fallo cuesta dinero.
 * Ejecutar con `npm test`. fetch se mockea: cero llamadas reales, cero correo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AcumbamailClient, AcumbamailError } from "../src/client.ts";
import { TOOLS } from "../src/tools.ts";

const origFetch = globalThis.fetch;
function setFetch(fn: unknown) {
  (globalThis as Record<string, unknown>).fetch = fn;
}
function restore() {
  (globalThis as Record<string, unknown>).fetch = origFetch;
}
function tool(name: string) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error("tool no encontrada: " + name);
  return t;
}

// (a) Serialización: arrays → clave[i]=, dicts → clave[k]= (formato del SDK oficial).
test("serializa lists[] y merge_fields al formato indexado", async () => {
  const bodies: string[] = [];
  setFetch(async (_u: string, opts: { body: string }) => {
    bodies.push(decodeURIComponent(opts.body));
    return { status: 200, ok: true, text: async () => '{"ok":1}' };
  });
  const c = new AcumbamailClient({ authToken: "t" });
  await c.call("createCampaign", { lists: [11, 22] });
  await c.call("addSubscriber", { merge_fields: { email: "a@b.com", NOMBRE: "Ana" } });
  restore();
  assert.ok(bodies[0].includes("lists[0]=11"), "lists[0]=11");
  assert.ok(bodies[0].includes("lists[1]=22"), "lists[1]=22");
  assert.ok(!bodies[0].includes("[11,22]"), "NO debe ir como JSON string");
  assert.ok(bodies[1].includes("merge_fields[email]=a@b.com"), "merge_fields[email]");
  assert.ok(bodies[1].includes("merge_fields[NOMBRE]=Ana"), "merge_fields[NOMBRE]");
});

// (b) Idempotencia: los POST (escritura) NO se reintentan ante error de red; los GET sí.
test("no reintenta escrituras ante error de red; sí reintenta lecturas", async () => {
  let calls = 0;
  setFetch(async () => {
    calls++;
    throw new TypeError("network fail");
  });
  const c = new AcumbamailClient({ authToken: "t", maxRetries: 1 });
  await assert.rejects(() => c.call("createCampaign", { lists: [1] }));
  assert.equal(calls, 1, "createCampaign NO debe reintentar (evita doble envío)");
  calls = 0;
  await assert.rejects(() => c.call("getLists"));
  assert.equal(calls, 2, "getLists debe reintentar (maxRetries=1 → 2 intentos)");
  restore();
});

// (c) Un HTTP 200 con cuerpo de error NO debe pasar como éxito.
test("HTTP 200 con cuerpo de error lanza AcumbamailError", async () => {
  setFetch(async () => ({
    status: 200,
    ok: true,
    text: async () => JSON.stringify({ error: "List does not exist" }),
  }));
  const c = new AcumbamailClient({ authToken: "t" });
  await assert.rejects(
    () => c.call("getListStats", { list_id: 999 }),
    (e: unknown) => e instanceof AcumbamailError,
  );
  restore();
});

// (d) Gate: create_campaign sin confirm NO debe tocar la API.
test("create_campaign sin confirm:true no llama a la API (gate)", async () => {
  let calls = 0;
  setFetch(async () => {
    calls++;
    return { status: 200, ok: true, text: async () => '{"id":1}' };
  });
  const c = new AcumbamailClient({ authToken: "t" });
  const res = (await tool("acumbamail_create_campaign").handler(c, {
    name: "x", from_name: "X", from_email: "a@b.com", subject: "s",
    content: "<p>*|UNSUBSCRIBE_URL|*</p>", lists: [1],
  })) as Record<string, unknown>;
  restore();
  assert.equal(res.needsConfirmation, true);
  assert.equal(calls, 0, "no debe tocar la API sin confirm");
});

// (e) Anti-spam: con confirm pero sin enlace de baja, se rechaza SIN enviar.
test("create_campaign con confirm pero sin *|UNSUBSCRIBE_URL|* se rechaza sin enviar", async () => {
  let calls = 0;
  setFetch(async () => {
    calls++;
    return { status: 200, ok: true, text: async () => '{"id":1}' };
  });
  const c = new AcumbamailClient({ authToken: "t" });
  const res = (await tool("acumbamail_create_campaign").handler(c, {
    name: "x", from_name: "X", from_email: "a@b.com", subject: "s",
    content: "<p>sin baja</p>", lists: [1], confirm: true,
  })) as Record<string, unknown>;
  restore();
  assert.ok(res.error, "debe devolver error");
  assert.equal(calls, 0, "no debe enviar sin enlace de baja");
});

// (f) Rate limit: reintenta ante 429 y luego resuelve.
test("reintenta ante 429 y resuelve al recuperarse", async () => {
  let calls = 0;
  setFetch(async () => {
    calls++;
    if (calls < 2) return { status: 429, ok: false, text: async () => "rate" };
    return { status: 200, ok: true, text: async () => '{"ok":1}' };
  });
  const c = new AcumbamailClient({ authToken: "t", maxRetries: 2 });
  const r = await c.call("getLists");
  restore();
  assert.equal(calls, 2, "debe haber reintentado una vez");
  assert.deepEqual(r, { ok: 1 });
});
