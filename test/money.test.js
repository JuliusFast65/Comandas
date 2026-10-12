import { test } from "node:test";
import assert from "node:assert/strict";
import { amounts, totals, tariffFor } from "../money.js";
test("precuenta: cargos incluidos, separados, redondeos y sumas por cuenta", () => {
  const tariff = { precio: 1000, iva: 15, servicio: 10, incluidos: true };
  const config = { iva: 15, servicio: 10, incluidos: true };
  assert.deepEqual(tariffFor({ name: "Ensalada", price_cents: 1000 }, config), tariff);
  assert.deepEqual(amounts(tariff, 3), {
    base: 2400,
    iva: 360,
    servicio: 240,
    total: 3000,
  });
  assert.deepEqual(amounts({ ...tariff, incluidos: false }, 3), {
    base: 3000,
    iva: 450,
    servicio: 300,
    total: 3750,
  });
  assert.deepEqual(amounts({ ...tariff, servicio: 0 }), {
    base: 870,
    iva: 130,
    servicio: 0,
    total: 1000,
  });
  for (const price of [1, 3, 99, 250, 1234]) {
    const result = amounts({ ...tariff, precio: price }, 7);
    assert.equal(result.base + result.iva + result.servicio, result.total);
    assert.equal(result.total, price * 7);
  }
  assert.equal(
    totals([
      { tariff, quantity: 3 },
      { tariff: { ...tariff, precio: 250 }, quantity: 1 },
    ]).total,
    3250,
  );
});
