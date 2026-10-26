import { test } from "node:test";
import assert from "node:assert/strict";
import { coordinates, lookupGeo } from "../src/geo.js";

test("coordenadas no equador ou meridiano zero continuam válidas", () => {
  assert.deepEqual(coordinates(0, -47), { lat: 0, lon: -47 });
  assert.deepEqual(coordinates(-23, 0), { lat: -23, lon: 0 });
});
test("coordenadas ausentes e fora dos limites não geram ponto fictício", () => {
  assert.equal(coordinates(null, null), null);
  assert.equal(coordinates(91, 0), null);
  assert.equal(coordinates(0, 181), null);
});
test("falha temporária não fica em cache e localização pode ser recuperada", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ({ ok: true, json: async () => ++calls === 1 ? { status: "fail" } : { status: "success", country: "Brasil", lat: 0, lon: -47 } });
  try {
    assert.equal((await lookupGeo("8.8.4.4")).lat, null);
    assert.equal((await lookupGeo("8.8.4.4")).lat, 0);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});