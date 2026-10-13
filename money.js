// Shared, integer-cent calculations matching the restored precuenta.
export function tariffFor(product, config) {
  return {
    precio: product.price_cents,
    iva: config.iva,
    servicio: config.servicio,
    incluidos: config.incluidos,
  };
}
export function amounts(tariff, quantity = 1) {
  const value = tariff.precio * quantity;
  if (tariff.incluidos) {
    const base = Math.round(value / (1 + (tariff.iva + tariff.servicio) / 100));
    const iva =
      tariff.servicio === 0
        ? value - base
        : Math.round((base * tariff.iva) / 100);
    return { base, iva, servicio: value - base - iva, total: value };
  }
  const iva = Math.round((value * tariff.iva) / 100),
    servicio = Math.round((value * tariff.servicio) / 100);
  return { base: value, iva, servicio, total: value + iva + servicio };
}
export function totals(items) {
  return items.reduce(
    (sum, item) => {
      const value = amounts(item.tariff, item.quantity);
      for (const key of Object.keys(sum)) sum[key] += value[key];
      return sum;
    },
    { base: 0, iva: 0, servicio: 0, total: 0 },
  );
}
// A discount lowers the consumption of one account; base, IVA and service shrink in proportion.
export function discountCents(total, discount) {
  if (!discount?.type) return 0;
  return Math.min(
    total.total,
    discount.type === "percent" ? Math.round((total.total * discount.value) / 100) : discount.value,
  );
}
export function applyDiscount(total, discount) {
  const descuento = discountCents(total, discount);
  if (!descuento) return total;
  const pay = total.total - descuento,
    base = Math.round((total.base * pay) / total.total),
    iva = Math.round((total.iva * pay) / total.total);
  return { base, iva, servicio: pay - base - iva, total: pay, descuento };
}
