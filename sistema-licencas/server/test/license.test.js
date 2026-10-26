import { test } from "node:test";
import assert from "node:assert";
import { checkLicense, domainAllowed, normalizeDomain, generateKey } from "../src/license.js";

const base = { status: "active", expires_at: null, max_installs: 1, allowed_domains: "" };

test("chave no formato XXXXX-XXXXX-XXXXX-XXXXX-XXXXX", () => assert.match(generateKey(), /^([A-Z2-9]{5}-){4}[A-Z2-9]{5}$/));
test("chave inexistente bloqueia", () => assert.equal(checkLicense(null, { domain: "a.com" }).code, "invalid_key"));
test("licença revogada bloqueia", () => assert.equal(checkLicense({ ...base, status: "revoked" }, { domain: "a.com" }).ok, false));
test("licença suspensa bloqueia", () => assert.equal(checkLicense({ ...base, status: "suspended" }, { domain: "a.com" }).code, "suspended"));
test("licença expirada bloqueia", () =>
  assert.equal(checkLicense({ ...base, expires_at: "2026-01-01" }, { domain: "a.com", now: new Date("2026-01-02T12:00:00Z") }).code, "expired"));
test("vale até o fim do dia da validade", () =>
  assert.equal(checkLicense({ ...base, expires_at: "2026-01-01" }, { domain: "a.com", now: new Date("2026-01-01T20:00:00Z") }).ok, true));
test("limite de instalações bloqueia nova instalação", () =>
  assert.equal(checkLicense(base, { domain: "a.com", activeInstalls: 1 }).code, "install_limit"));
test("instalação já existente continua válida no limite", () =>
  assert.equal(checkLicense(base, { domain: "a.com", activeInstalls: 1, isExisting: true }).ok, true));
test("domínio fora da lista bloqueia", () =>
  assert.equal(checkLicense({ ...base, allowed_domains: "cliente.com" }, { domain: "outro.com" }).code, "domain_not_allowed"));
test("curinga *.cliente.com aceita subdomínio", () => assert.equal(domainAllowed("app.cliente.com", "*.cliente.com"), true));
test("normaliza URL para domínio", () => assert.equal(normalizeDomain("https://www.Cliente.com:8080/x"), "cliente.com"));
