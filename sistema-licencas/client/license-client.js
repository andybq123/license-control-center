// Cliente de licença para Node.js 18+ (sem dependências).
// Use no instalador e no seu sistema rodando.
//
//   import { activate, startHeartbeat } from "./license-client.js";
//   const r = await activate({ server: "https://licencas.seudominio.com", key: "XXXXX-...", url: "https://app.cliente.com" });
//   if (!r.valid) { console.error(r.message); process.exit(1); }   // bloqueia a instalação
//   startHeartbeat({ server, key, url, onInvalid: (r) => { /* bloquear o sistema */ } });

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Cole aqui o conteúdo de https://SEU-SERVIDOR/api/v1/public-key (evita servidor falso).
export const PUBLIC_KEY = process.env.LICENSE_PUBLIC_KEY || "";

const ID_FILE = process.env.LICENSE_ID_FILE || path.join(process.cwd(), ".instance-id");

export function instanceId() {
  if (fs.existsSync(ID_FILE)) return fs.readFileSync(ID_FILE, "utf8").trim();
  const id = crypto.randomUUID();
  fs.writeFileSync(ID_FILE, id);
  return id;
}

function verify(body) {
  if (!PUBLIC_KEY) return true; // sem chave pública configurada, confia no HTTPS
  try {
    const ok = crypto.verify(null, Buffer.from(body.signed.data), PUBLIC_KEY, Buffer.from(body.signed.signature, "base64"));
    const d = JSON.parse(body.signed.data);
    return ok && d.valid === body.valid && Math.abs(Date.now() - d.ts) < 5 * 60_000;
  } catch { return false; }
}

async function call(endpoint, { server, key, url, version }) {
  try {
    const res = await fetch(`${server.replace(/\/$/, "")}/api/v1/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license_key: key, instance_id: instanceId(), url, app_version: version, hostname: os.hostname() }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json();
    if (!verify(body)) return { valid: false, code: "bad_signature", message: "Resposta do servidor de licenças não confere." };
    return body;
  } catch (e) {
    return { valid: false, code: "unreachable", message: "Não foi possível contatar o servidor de licenças: " + e.message };
  }
}

export const activate = (o) => call("activate", o);
export const validate = (o) => call("validate", o);
export const heartbeat = (o) => call("heartbeat", o);

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 10_000;
export function heartbeatInterval(minutes = 0.5) {
  return Math.min(HEARTBEAT_INTERVAL_MS, Math.max(1000, (Number(minutes) || 0.5) * 60_000));
}

export function startHeartbeat(o, minutes = 0.5) {
  let fails = 0;
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const r = await heartbeat(o);
      if (r.valid) { fails = 0; o.onValid?.(r); }
      else if (r.code === "unreachable") { ++fails; o.onUnreachable?.(r, fails); } // mantém o último estado
      else { fails = 0; o.onInvalid?.(r); }
    } finally { inFlight = false; }
  };
  tick();
  return setInterval(tick, heartbeatInterval(minutes));
}

// Uso direto no terminal:  node license-client.js https://licencas.seudominio.com CHAVE https://app.cliente.com
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const [server, key, url] = process.argv.slice(2);
  const r = await activate({ server, key, url });
  console.log(r.valid ? "✔ " : "✘ ", r.message);
  process.exit(r.valid ? 0 : 1);
}
