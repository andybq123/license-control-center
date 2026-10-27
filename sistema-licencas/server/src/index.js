import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { generateKey, normalizeDomain, checkLicense, signPayload, signingKeys } from "./license.js";
import { lookupGeo } from "./geo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const ONLINE_MINUTES = Number(process.env.ONLINE_MINUTES || 15);
if (!process.env.JWT_SECRET) console.warn("[aviso] JWT_SECRET não definido; sessões caem ao reiniciar.");

// Primeiro administrador
if (db.prepare("SELECT COUNT(*) c FROM admins").get().c === 0) {
  const email = process.env.ADMIN_EMAIL, pass = process.env.ADMIN_PASSWORD;
  if (email && pass) {
    db.prepare("INSERT INTO admins (name,email,password_hash) VALUES (?,?,?)").run("Administrador", email.toLowerCase(), bcrypt.hashSync(pass, 10));
    console.log(`[setup] Administrador criado: ${email}`);
  } else console.warn("[setup] Nenhum administrador. Defina ADMIN_EMAIL e ADMIN_PASSWORD.");
}
signingKeys();

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "..", "public")));

const log = (license_id, action, result, ip, detail = "") =>
  db.prepare("INSERT INTO logs (license_id,action,result,ip,detail) VALUES (?,?,?,?,?)").run(license_id ?? null, action, result, ip, detail);

const licenseOk = (lic) => lic && lic.status === "active" && !(lic.expires_at && new Date(lic.expires_at + "T23:59:59Z") < new Date());
const statusOf = (inst, lic) => {
  if (inst.blocked) return "bloqueada";
  if (!licenseOk(lic)) return "licença inválida";
  const mins = (Date.now() - new Date(inst.last_seen.replace(" ", "T") + "Z").getTime()) / 60000;
  return mins <= ONLINE_MINUTES ? "online" : "offline";
};

/* ============ API PÚBLICA (chamada pelo seu sistema) ============ */
const publicLimiter = rateLimit({ windowMs: 60_000, limit: 60 });

function respond(res, httpStatus, payload) {
  res.status(httpStatus).json({ ...payload, signed: signPayload({ ...payload, ts: Date.now() }) });
}

async function handleCheck(req, res, action) {
  const { license_key, instance_id, url, app_version } = req.body || {};
  const ip = (req.ip || "").replace(/^::ffff:/, "");
  const domain = normalizeDomain(url || req.body?.domain);
  if (!license_key || !instance_id) return respond(res, 400, { valid: false, code: "bad_request", message: "license_key e instance_id são obrigatórios." });

  const lic = db.prepare("SELECT * FROM licenses WHERE license_key = ?").get(String(license_key).trim().toUpperCase());
  const existing = lic && db.prepare("SELECT * FROM installations WHERE license_id=? AND instance_id=?").get(lic.id, String(instance_id));

  if (action === "heartbeat" && lic && !existing) {
    log(lic.id, action, "not_activated", ip);
    return respond(res, 403, { valid: false, code: "not_activated", message: "Instalação não ativada." });
  }
  if (existing?.blocked) {
    // Continua registrando o contato, para o painel mostrar que a instância segue no ar (em modo consulta).
    const geo = await lookupGeo(ip);
    db.prepare("UPDATE installations SET ip=?, country=COALESCE(NULLIF(?,''),country), region=COALESCE(NULLIF(?,''),region), city=COALESCE(NULLIF(?,''),city), lat=COALESCE(?,lat), lon=COALESCE(?,lon), last_seen=datetime('now') WHERE id=?")
      .run(ip, geo.country, geo.region, geo.city, geo.lat ?? null, geo.lon ?? null, existing.id);
    log(lic.id, action, "instance_blocked", ip, domain);
    return respond(res, 403, { valid: false, code: "instance_blocked", message: existing.block_reason ? `Esta instalação foi bloqueada: ${existing.block_reason}` : "Esta instalação foi bloqueada pelo fornecedor da licença." });
  }
  const active = lic ? db.prepare("SELECT COUNT(*) c FROM installations WHERE license_id=? AND blocked=0").get(lic.id).c : 0;
  const r = checkLicense(lic, { domain, activeInstalls: active, isExisting: !!existing });
  if (!r.ok) {
    log(lic?.id, action, r.code, ip, domain);
    return respond(res, 403, { valid: false, code: r.code, message: r.message });
  }

  const geo = await lookupGeo(ip);
  if (existing) {
    db.prepare(`UPDATE installations SET domain=?, url=?, ip=?, country=COALESCE(NULLIF(?,''),country), region=COALESCE(NULLIF(?,''),region), city=COALESCE(NULLIF(?,''),city), lat=COALESCE(?,lat), lon=COALESCE(?,lon), app_version=COALESCE(?,app_version), last_seen=datetime('now') WHERE id=?`)
      .run(domain, url || existing.url, ip, geo.country, geo.region, geo.city, geo.lat ?? null, geo.lon ?? null, app_version || null, existing.id);
  } else {
    db.prepare(`INSERT INTO installations (license_id,instance_id,domain,url,ip,country,region,city,lat,lon,app_version) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(lic.id, String(instance_id), domain, url || "", ip, geo.country, geo.region, geo.city, geo.lat ?? null, geo.lon ?? null, app_version || null);
    // Sem domínios definidos: trava no domínio da primeira ativação
    if (!lic.allowed_domains) db.prepare("UPDATE licenses SET allowed_domains=? WHERE id=?").run(domain, lic.id);
  }
  log(lic.id, action, "valid", ip, domain);
  respond(res, 200, { valid: true, code: "valid", message: r.message, product: lic.product, expires_at: lic.expires_at });
}

const wrap = (action) => (req, res) => handleCheck(req, res, action).catch((e) => res.status(500).json({ valid: false, code: "error", message: e.message }));
app.post("/api/v1/activate", publicLimiter, wrap("activate"));
app.post("/api/v1/validate", publicLimiter, wrap("validate"));
app.post("/api/v1/heartbeat", publicLimiter, wrap("heartbeat"));
app.post("/api/v1/deactivate", publicLimiter, (req, res) => {
  const { license_key, instance_id } = req.body || {};
  const lic = db.prepare("SELECT id FROM licenses WHERE license_key=?").get(String(license_key || "").toUpperCase());
  if (!lic) return res.status(404).json({ ok: false });
  const r = db.prepare("DELETE FROM installations WHERE license_id=? AND instance_id=?").run(lic.id, String(instance_id || ""));
  log(lic.id, "deactivate", r.changes ? "ok" : "not_found", req.ip);
  res.json({ ok: r.changes > 0 });
});
app.get("/api/v1/public-key", (_req, res) => res.type("text/plain").send(signingKeys().publicKey));

/* ===== Compatibilidade com o OuviDesk (deploy.sh / comum.sh) =====
   Recebe { chave, dominio, instalacao_id, versao } e responde { valida, mensagem }. */
const ouvidesk = (action) => (req, res) => {
  const b = req.body || {};
  const dominio = b.dominio || b.domain || "";
  req.body = {
    license_key: b.chave || b.license_key,
    instance_id: b.instalacao_id || b.instance_id,
    url: b.url || (dominio ? (/^https?:\/\//i.test(dominio) ? dominio : `https://${dominio}`) : ""),
    app_version: b.versao || b.app_version,
  };
  const fake = {
    status(c) { this.code = c; return this; },
    // Sempre 200: o instalador do OuviDesk usa `curl -f`, que trata 4xx como "servidor fora do ar"
    // e esconderia o motivo real (domínio, limite, expirada...). O resultado vai em `valida`.
    json(p) { res.set("Cache-Control", "no-store").status(200).json({ valida: !!p.valid, mensagem: p.message || "", codigo: p.code, expira_em: p.expires_at || null, proxima_verificacao_segundos: 30 }); },
  };
  // Instalação/atualização do OuviDesk ativa (ou renova) a instalação.
  handleCheck(req, fake, action).catch((e) => res.status(500).json({ valida: false, mensagem: e.message }));
};
app.post("/api/public/validar", publicLimiter, ouvidesk("activate"));
app.post("/api/public/heartbeat", publicLimiter, ouvidesk("heartbeat"));
// Tentativas/etapas da instalação do OuviDesk (aceita também chave inválida, só registra).
const evText = (v, n) => String(v ?? "").slice(0, n);
app.post("/api/public/instalacao-evento", publicLimiter, async (req, res) => {
  const b = req.body || {};
  const event = evText(b.evento || b.etapa || b.event, 60).trim();
  if (!event) return res.status(400).json({ ok: false, mensagem: "Informe o campo evento." });
  const key = evText(b.chave || b.license_key, 40).trim().toUpperCase();
  const lic = key ? db.prepare("SELECT id FROM licenses WHERE license_key=?").get(key) : null;
  const ip = req.ip;
  const geo = await lookupGeo(ip);
  db.prepare(`INSERT INTO install_events (license_id,license_key,instance_id,domain,event,result,message,app_version,ip,country,region,city)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(lic?.id ?? null, key || null, evText(b.instalacao_id || b.instance_id, 100),
    evText(normalizeDomain(b.dominio || b.url || "") || b.dominio, 200), event, evText(b.resultado || b.status, 30),
    evText(b.mensagem || b.message, 500), evText(b.versao || b.app_version, 40), ip, geo.country, geo.region, geo.city);
  db.prepare("DELETE FROM install_events WHERE id < (SELECT MAX(id) - 5000 FROM install_events)").run();
  res.json({ ok: true });
});
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ============ PAINEL ADMIN ============ */
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20 });

app.post("/admin/api/login", loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const a = db.prepare("SELECT * FROM admins WHERE email=?").get(String(email || "").toLowerCase());
  if (!a || !bcrypt.compareSync(String(password || ""), a.password_hash)) return res.status(401).json({ error: "E-mail ou senha incorretos." });
  const token = jwt.sign({ id: a.id }, JWT_SECRET, { expiresIn: "12h" });
  res.cookie("session", token, { httpOnly: true, sameSite: "strict", secure: req.secure, maxAge: 12 * 3600_000 });
  res.json({ ok: true, name: a.name });
});
app.post("/admin/api/logout", (_req, res) => { res.clearCookie("session"); res.json({ ok: true }); });

function auth(req, res, next) {
  try {
    const { id } = jwt.verify(req.cookies.session || "", JWT_SECRET);
    req.admin = db.prepare("SELECT id,name,email FROM admins WHERE id=?").get(id);
    if (!req.admin) throw new Error();
    next();
  } catch { res.status(401).json({ error: "Faça login." }); }
}
const A = express.Router();
A.use(auth);
A.get("/me", (req, res) => res.json(req.admin));

A.get("/stats", (_req, res) => {
  const insts = db.prepare("SELECT i.*, l.status lstatus, l.expires_at FROM installations i JOIN licenses l ON l.id=i.license_id").all();
  const online = insts.filter((i) => statusOf(i, { status: i.lstatus, expires_at: i.expires_at }) === "online").length;
  res.json({
    clients: db.prepare("SELECT COUNT(*) c FROM clients").get().c,
    licenses: db.prepare("SELECT COUNT(*) c FROM licenses").get().c,
    active_licenses: db.prepare("SELECT COUNT(*) c FROM licenses WHERE status='active'").get().c,
    installations: insts.length, online,
  });
});

// Clientes
A.get("/clients", (_req, res) => res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM licenses WHERE client_id=c.id) licenses FROM clients c ORDER BY c.id DESC`).all()));
A.post("/clients", (req, res) => {
  const { name, email, document, phone, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: "Nome é obrigatório." });
  const r = db.prepare("INSERT INTO clients (name,email,document,phone,notes) VALUES (?,?,?,?,?)").run(name, email || "", document || "", phone || "", notes || "");
  res.json({ id: r.lastInsertRowid });
});
A.put("/clients/:id", (req, res) => {
  const { name, email, document, phone, notes } = req.body || {};
  db.prepare("UPDATE clients SET name=?,email=?,document=?,phone=?,notes=? WHERE id=?").run(name, email || "", document || "", phone || "", notes || "", req.params.id);
  res.json({ ok: true });
});
A.delete("/clients/:id", (req, res) => { db.prepare("DELETE FROM clients WHERE id=?").run(req.params.id); res.json({ ok: true }); });

// Licenças
const cleanDomains = (v) => String(v || "").split(",").map((d) => d.trim())
  .map((d) => (d.startsWith("*.") ? "*." + normalizeDomain(d.slice(2)) : normalizeDomain(d))).filter((d) => d && d !== "*.").join(",");

A.get("/licenses", (_req, res) => res.json(db.prepare(`SELECT l.*, c.name client_name,
  (SELECT COUNT(*) FROM installations WHERE license_id=l.id AND blocked=0) installs FROM licenses l JOIN clients c ON c.id=l.client_id ORDER BY l.id DESC`).all()));
A.post("/licenses", (req, res) => {
  const { client_id, product, expires_at, max_installs, allowed_domains, notes } = req.body || {};
  if (!client_id) return res.status(400).json({ error: "Escolha o cliente." });
  let key; do key = generateKey(); while (db.prepare("SELECT 1 FROM licenses WHERE license_key=?").get(key));
  const r = db.prepare("INSERT INTO licenses (client_id,license_key,product,expires_at,max_installs,allowed_domains,notes) VALUES (?,?,?,?,?,?,?)")
    .run(client_id, key, product || "default", expires_at || null, Math.max(1, Number(max_installs) || 1), cleanDomains(allowed_domains), notes || "");
  log(r.lastInsertRowid, "create", "ok", req.ip, `por ${req.admin.email}`);
  res.json({ id: r.lastInsertRowid, license_key: key });
});
A.put("/licenses/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM licenses WHERE id=?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Não encontrada." });
  const b = { ...cur, ...req.body };
  if (!["active", "suspended", "revoked"].includes(b.status)) return res.status(400).json({ error: "Status inválido." });
  db.prepare("UPDATE licenses SET product=?,status=?,expires_at=?,max_installs=?,allowed_domains=?,notes=? WHERE id=?")
    .run(b.product, b.status, b.expires_at || null, Math.max(1, Number(b.max_installs) || 1), cleanDomains(b.allowed_domains), b.notes || "", cur.id);
  log(cur.id, "update", b.status, req.ip, `por ${req.admin.email}`);
  res.json({ ok: true });
});
A.delete("/licenses/:id", (req, res) => { db.prepare("DELETE FROM licenses WHERE id=?").run(req.params.id); res.json({ ok: true }); });

// Instalações
A.get("/installations", async (_req, res, next) => {
  try {
  const rows = db.prepare(`SELECT i.*, l.license_key, l.status lstatus, l.expires_at, c.name client_name FROM installations i
    JOIN licenses l ON l.id=i.license_id JOIN clients c ON c.id=l.client_id ORDER BY i.last_seen DESC`).all();
  // Recupera instalações antigas sem ponto, mesmo que ainda não tenham enviado heartbeat.
  const missing = rows.filter(i => (i.lat == null || i.lon == null) && i.ip);
  for (let offset = 0; offset < missing.length; offset += 5) {
    await Promise.all(missing.slice(offset, offset + 5).map(async i => {
      const geo = await lookupGeo(i.ip);
      if (geo.lat == null || geo.lon == null) return;
      db.prepare("UPDATE installations SET country=?,region=?,city=?,lat=?,lon=? WHERE id=?")
        .run(geo.country, geo.region, geo.city, geo.lat, geo.lon, i.id);
      Object.assign(i, geo);
    }));
  }
  res.set("Cache-Control", "no-store");
  res.json(rows.map((i) => ({ ...i, status: statusOf(i, { status: i.lstatus, expires_at: i.expires_at }) })));
  } catch (error) { next(error); }
});
A.put("/installations/:id", (req, res) => {
  const blocked = req.body?.blocked ? 1 : 0;
  const reason = blocked ? String(req.body?.reason || "").slice(0, 300) : null;
  const r = db.prepare("UPDATE installations SET blocked=?, block_reason=? WHERE id=?").run(blocked, reason, req.params.id);
  const inst = db.prepare("SELECT license_id, domain FROM installations WHERE id=?").get(req.params.id);
  if (inst) log(inst.license_id, blocked ? "block" : "unblock", "ok", req.ip, `${inst.domain} por ${req.admin.email}${reason ? " — " + reason : ""}`);
  res.json({ ok: r.changes > 0 });
});
A.delete("/installations/:id", (req, res) => { db.prepare("DELETE FROM installations WHERE id=?").run(req.params.id); res.json({ ok: true }); });

A.get("/install-events", (_req, res) => res.json(db.prepare(`SELECT e.*, c.name client_name FROM install_events e LEFT JOIN licenses l ON l.id=e.license_id LEFT JOIN clients c ON c.id=l.client_id ORDER BY e.id DESC LIMIT 300`).all()));
A.get("/config", (_req, res) => res.json({ mapbox_token: process.env.MAPBOX_TOKEN || "pk.eyJ1Ijoic2V0YW1vbml0b3JhbWVudG8iLCJhIjoiY21xaWF0bHZ4MDR4ZTJwb3FsZGdlbXVlYyJ9.CDb9dIjIHuYyF2QZNY7WGA" }));
A.get("/logs", (_req, res) => res.json(db.prepare(`SELECT g.*, l.license_key FROM logs g LEFT JOIN licenses l ON l.id=g.license_id ORDER BY g.id DESC LIMIT 300`).all()));

// Administradores
A.get("/admins", (_req, res) => res.json(db.prepare("SELECT id,name,email,created_at FROM admins ORDER BY id").all()));
A.post("/admins", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: "Nome, e-mail e senha (mín. 8 caracteres) são obrigatórios." });
  try { db.prepare("INSERT INTO admins (name,email,password_hash) VALUES (?,?,?)").run(name, email.toLowerCase(), bcrypt.hashSync(password, 10)); }
  catch { return res.status(400).json({ error: "E-mail já cadastrado." }); }
  res.json({ ok: true });
});
A.put("/admins/me/password", (req, res) => {
  const { current, password } = req.body || {};
  const a = db.prepare("SELECT * FROM admins WHERE id=?").get(req.admin.id);
  if (!bcrypt.compareSync(String(current || ""), a.password_hash)) return res.status(400).json({ error: "Senha atual incorreta." });
  if (!password || password.length < 8) return res.status(400).json({ error: "Nova senha precisa de 8+ caracteres." });
  db.prepare("UPDATE admins SET password_hash=? WHERE id=?").run(bcrypt.hashSync(password, 10), a.id);
  res.json({ ok: true });
});
A.delete("/admins/:id", (req, res) => {
  if (Number(req.params.id) === req.admin.id) return res.status(400).json({ error: "Você não pode remover a si mesmo." });
  db.prepare("DELETE FROM admins WHERE id=?").run(req.params.id); res.json({ ok: true });
});

app.use("/admin/api", A);
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

app.listen(PORT, () => console.log(`Servidor de licenças rodando na porta ${PORT}`));
