import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I

export function generateKey(groups = 5, size = 5) {
  const bytes = crypto.randomBytes(groups * size);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  const out = [];
  for (let i = 0; i < groups; i++) out.push(chars.slice(i * size, (i + 1) * size).join(""));
  return out.join("-");
}

export function normalizeDomain(input) {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();
  try {
    if (!/^[a-z]+:\/\//.test(s)) s = "http://" + s;
    s = new URL(s).hostname;
  } catch {
    return "";
  }
  return s.replace(/^www\./, "");
}

export function domainAllowed(domain, allowedList) {
  const list = allowedList.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return true;
  return list.some((rule) =>
    rule.startsWith("*.") ? domain === rule.slice(2) || domain.endsWith(rule.slice(1)) : domain === rule
  );
}

/**
 * Regras de validação. Retorna { ok, code, message }.
 * activeInstalls: instalações ativas da licença; isExisting: esta instalação já foi ativada antes.
 */
export function checkLicense(license, { domain, now = new Date(), activeInstalls = 0, isExisting = false }) {
  if (!license) return { ok: false, code: "invalid_key", message: "Chave de licença inválida." };
  if (license.status === "revoked") return { ok: false, code: "revoked", message: "Licença revogada." };
  if (license.status === "suspended") return { ok: false, code: "suspended", message: "Licença suspensa." };
  if (license.expires_at && new Date(license.expires_at + "T23:59:59Z") < now)
    return { ok: false, code: "expired", message: "Licença expirada." };
  if (!domain) return { ok: false, code: "invalid_domain", message: "Domínio da instalação não informado." };
  if (!domainAllowed(domain, license.allowed_domains || ""))
    return { ok: false, code: "domain_not_allowed", message: "Domínio não autorizado para esta licença." };
  if (!isExisting && activeInstalls >= license.max_installs)
    return { ok: false, code: "install_limit", message: "Limite de instalações atingido." };
  return { ok: true, code: "valid", message: "Licença válida." };
}

// Chave Ed25519 para assinar as respostas (o cliente confere com a chave pública).
let keys;
export function signingKeys() {
  if (keys) return keys;
  const dir = process.env.DATA_DIR || path.resolve("data");
  const priv = path.join(dir, "signing_private.pem");
  const pub = path.join(dir, "signing_public.pem");
  if (!fs.existsSync(priv)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(priv, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    fs.writeFileSync(pub, publicKey.export({ type: "spki", format: "pem" }));
  }
  keys = { privateKey: fs.readFileSync(priv, "utf8"), publicKey: fs.readFileSync(pub, "utf8") };
  return keys;
}

export function signPayload(payload) {
  const data = JSON.stringify(payload);
  const signature = crypto.sign(null, Buffer.from(data), signingKeys().privateKey).toString("base64");
  return { data, signature };
}
