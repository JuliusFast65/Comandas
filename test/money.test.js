import { test } from "node:test";
import assert from "node:assert/strict";
import { amounts, totals, tariffFor, applyDiscount, discountCents } from "../money.js";
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

test("descuentos: porcentaje, monto fijo, límites y componentes proporcionales", () => {
  const total = { base: 2400, iva: 360, servicio: 240, total: 3000 };
  assert.equal(applyDiscount(total, {}), total);
  assert.equal(applyDiscount(total, undefined), total);
  assert.deepEqual(applyDiscount(total, { type: "percent", value: 10 }),
    { base: 2160, iva: 324, servicio: 216, total: 2700, descuento: 300 });
  assert.deepEqual(applyDiscount(total, { type: "amount", value: 500 }),
    { base: 2000, iva: 300, servicio: 200, total: 2500, descuento: 500 });
  // The parts always add up to the amount charged, also with odd cents.
  for (const value of [1, 7.5, 33.33, 99.99]) {
    const reduced = applyDiscount({ base: 801, iva: 120, servicio: 80, total: 1001 }, { type: "percent", value });
    assert.equal(reduced.base + reduced.iva + reduced.servicio, reduced.total);
    assert.equal(reduced.total + reduced.descuento, 1001);
  }
  assert.equal(discountCents(total, { type: "amount", value: 9999 }), 3000);
  assert.deepEqual(applyDiscount(total, { type: "percent", value: 100 }),
    { base: 0, iva: 0, servicio: 0, total: 0, descuento: 3000 });
});
