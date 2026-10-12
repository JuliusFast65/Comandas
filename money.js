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
