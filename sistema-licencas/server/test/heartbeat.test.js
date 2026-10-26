import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "license-heartbeat-"));
process.env.LICENSE_ID_FILE = join(temp, "instance-id");
const { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, heartbeatInterval, startHeartbeat } = await import("../../client/license-client.js");

test("bloqueio é consultado em 30 segundos com margem inferior a 60 segundos", () => {
  assert.equal(heartbeatInterval(), 30_000);
  assert.ok(HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS < 60_000);
  assert.equal(heartbeatInterval(10), 30_000);
});
test("desbloqueio é consultado em no máximo 60 segundos", () => {
  assert.equal(heartbeatInterval(1), 30_000);
  assert.ok(heartbeatInterval(1) + HEARTBEAT_TIMEOUT_MS < 60_000);
});
test("resposta válida executa retorno ao uso normal", async () => {
  const fetch = globalThis.fetch, interval = globalThis.setInterval;
  let restored = false;
  globalThis.fetch = async () => ({ json: async () => ({ valid: true }) });
  globalThis.setInterval = () => 1;
  try {
    startHeartbeat({ server: "https://example.test", key: "test", onValid: () => { restored = true; } });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(restored, true);
  } finally { globalThis.fetch = fetch; globalThis.setInterval = interval; rmSync(temp, { recursive: true, force: true }); }
});