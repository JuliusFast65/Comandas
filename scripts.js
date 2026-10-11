import { tariffFor, amounts, totals } from "./money.js";
let user = null,
  state = { tables: [], products: [], orders: [], waiters: [], settings: null },
  view = "mesas",
  selected = null,
  lastWorkedOrder = null,
  confirming = false,
  billingAccount = 1,
  events = null;
let busy = false,
  syncing = false,
  refreshAgain = false,
  mobileDetail = false,
  activeWaiter = null,
  onlyMine = false;
const menus = new Map();
let pageHistory = [], historyIndex = -1;
function recordPage() {
  const entry = { view, selected, confirming, billingAccount };
  const current = pageHistory[historyIndex];
  if (!current || Object.keys(entry).some((key) => entry[key] !== current[key])) {
    pageHistory.splice(historyIndex + 1);
    pageHistory.push(entry);
    historyIndex = pageHistory.length - 1;
  }
  $("#page-back").disabled = historyIndex <= 0;
  $("#page-forward").disabled = historyIndex >= pageHistory.length - 1;
}
function movePage(direction) {
  const next = historyIndex + direction;
  if (!user || next < 0 || next >= pageHistory.length) return;
  historyIndex = next;
  ({ view, selected, confirming, billingAccount } = pageHistory[next]);
  mobileDetail = false;
  closeMenu();
  render();
}
const roles = {
  admin: "Administrador",
  mesero: "Mesero",
  cocina: "Cocina",
  bar: "Bar",
  caja: "Caja",
  auditor: "Auditor / Sistemas",
  estacion: "Personal de estación",
};
const categoryNames = {
  entradas: "Entradas",
  platos: "Platos fuertes",
  postres: "Postres",
  bebidas: "Bebidas",
  bebidasAlcoolicas: "Bebidas alcohólicas",
  adicionales: "Adicionales",
};
const $ = (selector) => document.querySelector(selector),
  money = (cents) => `$${(cents / 100).toFixed(2)}`,
  cents = (value) => Math.round(Number(value) * 100);
function el(tag, content, attributes = {}) {
  const n = document.createElement(tag);
  if (content !== null && content !== undefined) n.textContent = content;
  for (const [k, v] of Object.entries(attributes)) n.setAttribute(k, v);
  return n;
}
function button(label, fn, disabled = false, className = "pickup-button") {
  const b = el("button", label, { type: "button", class: className });
  b.disabled = disabled;
  b.addEventListener("click", fn);
  return b;
}
function heading(text, icon) {
  const h = el("h2");
  if (icon)
    h.append(el("i", null, { class: "fas fa-" + icon, "aria-hidden": "true" }));
  h.append(document.createTextNode(" " + text));
  return h;
}
function message(value, error = false) {
  $("#message").textContent = value;
  $("#message").className = error ? "error" : "";
}
function showOrderSent(
  title = "Orden enviada",
  text = "Los alimentos se enviaron a Cocina y las bebidas al Bar.",
) {
  const dialog = el("dialog", null, {
    class: "order-sent-dialog",
    "aria-labelledby": "aviso-titulo",
    "aria-describedby": "aviso-mensaje",
  });
  dialog.append(
    el("div", "✓", { class: "order-sent-icon", "aria-hidden": "true" }),
    el("h2", title, { id: "aviso-titulo" }),
    el("p", text, {
      id: "aviso-mensaje",
    }),
    button("Entendido", () => dialog.close()),
  );
  dialog.addEventListener("close", () => {
    dialog.remove();
    navigate("mesas");
  });
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector("button").focus();
}
function owned(o) {
  return (
    user?.role === "admin" ||
    (user?.role === "mesero" &&
      (!o.waiter_id || o.waiter_id === user.waiter_id))
  );
}
function mayPrepare(area) {
  return user?.role === "admin" || user?.stations?.includes(area);
}
function mayBill(o) {
  return owned(o) || user?.role === "caja";
}
function mayPickup() {
  return ["admin", "mesero"].includes(user?.role);
}
function confirmOtherWaiter(o, name) {
  if (user?.role !== "mesero" || !o.table_number || !o.waiter_id || o.waiter_id === user.waiter_id)
    return {};
  const operation = name === "bill" ? "pedir la cuenta" : "retirar productos";
  if (!window.confirm(`${orderTitle(o)} pertenece a ${waiterName(o.waiter_id)}. ¿Quieres ${operation} de esta orden de otro mesero?`))
    return null;
  return { confirmedOtherWaiterId: o.waiter_id };
}
function editableOrder(o) {
  return (
    owned(o) && o.status !== "closed" && !o.accounts.some((a) => a.lsoft?.json)
  );
}
function waiterName(id) {
  return state.waiters.find((w) => w.id === id)?.name || "Sin asignar";
}
function waiterBadge(o) {
  const name = waiterName(o.waiter_id);
  return el("span", name.trim().split(/\s+/).map((n) => n[0]).join("").slice(0, 3).toUpperCase(), {
    class: "waiter-badge",
    title: name,
    "aria-label": `Mesero: ${name}`,
  });
}
function stationOrderHeading(o) {
  const header = el("h3", orderTitle(o) + " · " + waiterName(o.waiter_id), {
    class: "station-order-heading",
  });
  if (o.waiter_id) header.append(waiterBadge(o));
  return header;
}
function menu(o) {
  if (!menus.has(o.id))
    menus.set(o.id, {
      category: "entradas",
      query: "",
      searchOpen: false,
      account: 1,
    });
  return menus.get(o.id);
}
function orderTitle(o) {
  return o.table_number ? `Mesa ${o.table_number}` : `Para Llevar ${o.number}`;
}
function remaining(i) {
  return i.quantity - i.picked_up_quantity;
}
function summaryOf(o, area = null) {
  return o.items
    .filter((i) => !area || i.area === area)
    .reduce(
      (r, i) => {
        if (i.status === "draft") r.draft += i.quantity;
        if (i.status === "preparing") r.preparing += remaining(i);
        if (i.status === "ready") r.ready += remaining(i);
        r.picked += i.picked_up_quantity;
        return r;
      },
      { draft: 0, preparing: 0, ready: 0, picked: 0 },
    );
}
async function api(path, body) {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/login") logoutUI();
    throw new Error(data.error || "No se pudo completar la operación.");
  }
  return data;
}
function logoutUI() {
  pageHistory = [];
  historyIndex = -1;
  user = null;
  selected = null;
  confirming = false;
  mobileDetail = false;
  menus.clear();
  state = { tables: [], products: [], orders: [], waiters: [], settings: null };
  document.querySelectorAll("dialog").forEach((d) => {
    if (d.id === "app-menu") {
      if (d.open) d.close();
    } else d.remove();
  });
  events?.close();
  events = null;
  $("#session-header").hidden = true;
  $("#identity").replaceChildren();
  $("#login-screen").hidden = false;
  $("#workspace").hidden = true;
  $("#content").replaceChildren();
  $("#navigation").replaceChildren();
}
function captureForms() {
  return new Map(
    [
      ...document.querySelectorAll(
        '#content form[data-dirty="true"] input,#content form[data-dirty="true"] select,#content form[data-dirty="true"] textarea',
      ),
    ]
      .filter((n) => n.id)
      .map((n) => [n.id, n.value]),
  );
}
function restoreForms(values) {
  for (const [id, value] of values) {
    const n = document.getElementById(id);
    if (n) {
      n.value = value;
      n.closest("form").dataset.dirty = "true";
    }
  }
}
async function refresh() {
  if (!user) return;
  if (busy) {
    refreshAgain = true;
    return;
  }
  if (syncing) {
    refreshAgain = true;
    return;
  }
  syncing = true;
  try {
    const [next, liveMe] = await Promise.all([api("/state"), api("/me")]);
    if (!user) return;
    if (busy) {
      refreshAgain = true;
      return;
    }
    // Capture edits only after all network waits, immediately before rendering.
    const values = captureForms(),
      focused = document.activeElement,
      focusId = focused?.id,
      caret = focused?.selectionStart,
      scroll = window.scrollY;
    const details = new Set(
      [...$("#content").querySelectorAll("details[open]")].map((n) => n.id),
    );
    user = liveMe;
    state = next;
    if (user.role === "mesero") activeWaiter = user.waiter_id;
    if (!activeWaiter)
      activeWaiter = state.waiters.find((w) => w.active)?.id ?? null;
    render();
    restoreForms(values);
    for (const id of details) {
      const n = document.getElementById(id);
      if (n) n.open = true;
    }
    const focus = focusId && document.getElementById(focusId);
    if (focus) {
      focus.focus({ preventScroll: true });
      if (
        typeof caret === "number" &&
        ["text", "search", "email"].includes(focus.type)
      ) {
        try {
          focus.setSelectionRange(caret, caret);
        } catch {}
      }
    }
    window.scrollTo(0, scroll);
  } catch (e) {
    message(e.message, true);
  } finally {
    syncing = false;
    if (refreshAgain) {
      refreshAgain = false;
      await refresh();
    }
  }
}
async function run(fn) {
  if (busy) return false;
  busy = true;
  $("#workspace").setAttribute("aria-busy", "true");
  try {
    await fn();
    message("Cambio guardado.");
    return true;
  } catch (e) {
    message(e.message, true);
    return false;
  } finally {
    busy = false;
    $("#workspace").removeAttribute("aria-busy");
    await refresh();
  }
}
function action(o, name, fields = {}) {
  const current = state.orders.find((order) => order.id === o.id) ?? o;
  const confirmation = ["pickup", "pickup_all", "bill"].includes(name)
    ? confirmOtherWaiter(current, name) : {};
  if (confirmation === null) return;
  return run(() =>
    api(`/orders/${o.id}/actions`, {
      action: name,
      version: current.version,
      ...fields,
      ...confirmation,
    }),
  );
}
function navigate(area, id = null) {
  view = area;
  selected = id;
  confirming = false;
  mobileDetail = false;
  closeMenu();
  render();
}
function closeMenu() {
  if ($("#app-menu").open) $("#app-menu").close();
  $("#open-menu").setAttribute("aria-expanded", "false");
}
$("#page-back").addEventListener("click", () => movePage(-1));
$("#page-forward").addEventListener("click", () => movePage(1));
$("#open-menu").addEventListener("click", () => {
  $("#app-menu").showModal();
  $("#open-menu").setAttribute("aria-expanded", "true");
});
$("#app-menu").addEventListener("close", () =>
  $("#open-menu").setAttribute("aria-expanded", "false"),
);
function signedIn() {
  lastWorkedOrder = null;
  pageHistory = [];
  historyIndex = -1;
  $("#session-header").hidden = false;
  $("#login-screen").hidden = true;
  $("#workspace").hidden = false;
  onlyMine = user.role === "mesero";
  activeWaiter = user.waiter_id;
  view = ["admin", "mesero"].includes(user.role)
    ? "mesas"
    : ["caja", "auditor"].includes(user.role)
      ? "caja"
      : user.role === "estacion" ? (user.stations[0] || "sin-estacion") : user.role;
  events?.close();
  events = new EventSource("/api/events");
  events.addEventListener("changed", refresh);
  events.onerror = () => message("Reconectando con el servidor…", true);
  events.onopen = () => {
    message("Conectado.");
    refresh();
  };
  refresh();
}
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target,
    b = form.querySelector("button");
  b.disabled = true;
  try {
    user = await api("/login", Object.fromEntries(new FormData(form)));
    form.reset();
    signedIn();
  } catch (error) {
    message(error.message, true);
  } finally {
    b.disabled = false;
  }
});
function areas() {
  if (user.role === "admin")
    return [
      "mesas",
      "cocina",
      "bar",
      "caja",
      "historial",
      "configuracion",
      "meseros",
      "usuarios",
    ];
  if (user.role === "mesero") return ["mesas", "cocina", "bar", "caja"];
  if (["caja", "auditor"].includes(user.role)) return ["caja", "historial"];
  if (user.role === "estacion") return user.stations;
  return [user.role];
}
const areaNames = {
  mesas: "Mesas",
  cocina: "Cocina",
  bar: "Bar",
  caja: "LSoft · Caja",
  historial: "Operaciones cerradas",
  configuracion: "Precios y cargos",
  meseros: "Equipo de meseros",
  usuarios: "Usuarios y permisos",
};
function renderNavigation() {
  const identity = $("#identity"),
    userOpen = identity.querySelector("details")?.open,
    chip = el("details", null, { class: "user-menu" });
  chip.open = !!userOpen;
  const title = el("summary");
  title.append(
    el("span", user.username.slice(0, 2).toUpperCase(), {
      class: "user-avatar",
    }),
    el("span", user.username, { id: "user-name" }),
  );
  const dropdown = el("div", null, { class: "user-dropdown" });
  dropdown.append(
    el("small", user.role === "estacion"
      ? user.stations.map((s) => areaNames[s] || s).join(" / ") || roles.estacion
      : roles[user.role]),
    button("Cerrar sesión", async () => {
      try {
        await api("/logout", {});
        logoutUI();
        message("Sesión cerrada.");
      } catch (e) {
        message(e.message, true);
      }
    }),
  );
  chip.append(title, dropdown);
  identity.replaceChildren(chip);
  const nav = $("#navigation"),
    head = el("div", null, { class: "drawer-heading" });
  head.append(heading("Comandas"), button("×", closeMenu));
  nav.replaceChildren(head);
  for (const area of areas()) {
    const b = button(areaNames[area], () => navigate(area));
    if (view === area) b.setAttribute("aria-current", "page");
    nav.append(b);
  }
}
function page(content, id) {
  const wrapper = el("section", null, { id, class: "screen active" }),
    container = el("div", null, { class: "container" });
  wrapper.append(container);
  content.append(wrapper);
  return container;
}
function render() {
  if (!user) return;
  document
    .querySelectorAll("dialog[data-order-detail]")
    .forEach((d) => d.remove());
  const content = $("#content");
  content.replaceChildren();
  const o = state.orders.find((o) => o.id === selected);
  if (!o) {
    selected = null;
    confirming = false;
    if (view === "precuenta") view = "caja";
  }
  recordPage();
  renderNavigation();
  if (view === "mesas" && o) {
    renderOrder(
      page(content, confirming ? "confirmacion-screen" : "toma-ordenes-screen"),
      o,
    );
    return;
  }
  if (view === "precuenta" && o) {
    renderBill(page(content, "facturacion-screen"), o);
    return;
  }
  if (view === "mesas") {
    selected = null;
    renderTables(page(content, "seleccion-mesas-screen"));
  } else if (["cocina", "bar"].includes(view))
    renderPreparation(page(content, view + "-screen"));
  else if (view === "caja") renderCash(page(content, "caja-screen"));
  else if (view === "historial")
    renderHistory(page(content, "historial-screen"));
  else if (view === "configuracion")
    renderConfig(page(content, "configuracion-screen"));
  else if (view === "meseros") renderWaiters(page(content, "meseros-screen"));
  else if (view === "usuarios") renderUsers(page(content, "usuarios-screen"));
  else if (user.role === "estacion" && !user.stations.length)
    content.append(el("p", "No tienes estaciones activas asignadas. Consulta al administrador."));
  else navigate("caja");
}
function select(label, options, value, change) {
  const wrapper = el("label", label),
    node = el("select");
  for (const [id, name] of options)
    node.append(el("option", name, { value: id }));
  node.value = value ?? "";
  if (change) node.addEventListener("change", () => change(node.value));
  wrapper.append(node);
  return wrapper;
}
function labeled(form, label, node) {
  const field = el("div"),
    l = el("label", label, { for: node.id });
  field.append(l, node);
  form.append(field);
  node.addEventListener("input", () => (form.dataset.dirty = "true"));
  node.addEventListener("change", () => (form.dataset.dirty = "true"));
  return node;
}
function operationLinks(content) {
  const footer = el("div", null, { class: "footer" });
  for (const area of ["cocina", "bar", "caja"].filter((a) =>
    areas().includes(a),
  )) {
    const r = state.orders.reduce(
      (s, o) => {
        const v = summaryOf(o, area);
        s.preparing += v.preparing;
        s.ready += v.ready;
        return s;
      },
      { preparing: 0, ready: 0 },
    );
    footer.append(
      button(
        area === "caja"
          ? "LSoft · Caja"
          : `${roles[area]} · ${r.preparing} pendientes · ${r.ready} por retirar`,
        () => navigate(area),
      ),
    );
  }
  content.append(footer);
}
function tableCard(table, o) {
  const r = o ? summaryOf(o) : { draft: 0, preparing: 0, ready: 0, picked: 0 },
    stateName = !o
      ? "libre"
      : r.ready
        ? "por-retirar"
        : r.preparing
          ? "en-preparacion"
          : !r.draft && r.picked > 0
            ? "retirada"
            : "ocupada";
  const b = button(
    "",
    () => {
      if (o) navigate("mesas", o.id);
      else
        run(async () => {
          const created = await api(
            "/orders",
            table
              ? { tableNumber: table, waiterId: activeWaiter }
              : { waiterId: activeWaiter },
          );
          selected = created.id;
          confirming = false;
          mobileDetail = false;
          view = "mesas";
        });
    },
    false,
    `mesa ${stateName}`,
  );
  if (o && o.id === lastWorkedOrder) {
    b.classList.add("mesa-seleccionada");
  }
  b.append(
    el("strong", table ? `Mesa ${table}` : orderTitle(o)),
    el(
      "small",
      !o
        ? "Libre"
        : r.ready || r.preparing
          ? `${r.ready} por retirar · ${r.preparing} en preparación`
          : r.draft
            ? "Sin enviar a preparación"
            : r.picked > 0
            ? "Todo retirado"
            : "Sin productos",
    ),
  );
  if (r.draft && (r.ready || r.preparing))
    b.append(el("small", `${r.draft} sin enviar a preparación`));
  if (o?.waiter_id) {
    b.append(waiterBadge(o));
  }
  if (o?.status === "bill_requested")
    b.append(el("small", o.items.length && o.items.every((i) => o.accounts.some((a) => a.number === i.account && a.lsoft?.json)) ? "Enviada a LSoft · Pendiente de liberar" : "Cuenta pedida", { class: "table-label" }));
  if (o && !table && !o.items.length && editableOrder(o) && o.status === "open") {
    const card = el("div", null, { class: "takeaway-card" });
    const trash = button("", () => action(o, "delete_empty"), false, "delete-empty-order");
    trash.setAttribute("aria-label", `Eliminar ${orderTitle(o)} vacío`);
    trash.title = "Eliminar pedido vacío";
    trash.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
    card.append(b, trash);
    return card;
  }
  return b;
}
function renderTables(content) {
  const header = el("div", null, { class: "tables-header" });
  const mineToggle = button("", () => {
    onlyMine = !onlyMine;
    render();
    $("#only-my-tables")?.focus({ preventScroll: true });
  }, false, "tables-filter");
  mineToggle.setAttribute("id", "only-my-tables");
  mineToggle.setAttribute("role", "switch");
  mineToggle.setAttribute("aria-checked", String(onlyMine));
  mineToggle.setAttribute("aria-label", "Mis mesas y libres sin asignar");
  mineToggle.setAttribute("title", "Activado: mis mesas y libres sin asignar. Desactivado: todas las mesas.");
  mineToggle.append(
    el("span", "Mis mesas"),
    el("span", null, { class: "tables-filter-track", "aria-hidden": "true" }),
  );
  header.append(heading("Seleccionar Mesa", "chair"));
  content.append(header);
  const toolbar = el("div", null, { class: "waiter-toolbar" });
  if (user.role === "admin")
    toolbar.append(
      select(
        "Estoy atendiendo como ",
        state.waiters.filter((w) => w.active).map((w) => [w.id, w.name]),
        activeWaiter,
        (v) => {
          activeWaiter = v;
          render();
        },
      ),
    );
  if (toolbar.childElementCount) content.append(toolbar);
  const statusRow = el("div", null, { class: "tables-status-row" });
  const legend = el("p", null, { class: "table-legend" });
  for (const label of ["🔵 En preparación", "🟠 Listo para retirar", "🟢 Todo retirado"])
    legend.append(el("span", label));
  statusRow.append(legend, mineToggle);
  content.append(statusRow);
  const visible = (o) =>
      !onlyMine || !o || !o.waiter_id || o.waiter_id === activeWaiter,
    grid = el("div", null, { class: "mesas", id: "mesas" });
  for (const t of state.tables) {
    const o = state.orders.find((o) => o.table_number === t.number);
    if (visible(o)) grid.append(tableCard(t.number, o));
  }
  const takeaway = el("div", null, { class: "para-llevar", id: "para-llevar" });
  for (const o of state.orders.filter((o) => !o.table_number && visible(o)))
    takeaway.append(tableCard(null, o));
  content.append(
    grid,
    heading("Para Llevar", "shopping-bag"),
    takeaway,
    button(
      "Nueva Orden Para Llevar",
      () =>
        run(async () => {
          const o = await api("/orders", { waiterId: activeWaiter });
          view = "mesas";
          selected = o.id;
        }),
      false,
      "center-button",
    ),
  );
  operationLinks(content);
}
function accountName(o, n) {
  return o.accounts.find((a) => a.number === n)?.name || "";
}
function renderOrder(content, o) {
  lastWorkedOrder = o.id;
  const m = menu(o),
    editable = editableOrder(o),
    header = el("div", null, { class: "order-header" });
  header.append(heading(confirming ? "Confirmar Orden" : orderTitle(o)));
  if (!confirming) {
    const form = el("form", null, {
        class: "mesa-info",
        id: "account-selector",
      }),
      account = labeled(
        form,
        "Cuenta:",
        el("input", null, {
          id: "cuentas",
          type: "number",
          min: "1",
          max: "99",
          value: String(m.account),
          required: "",
        }),
      ),
      name = el("input", null, {
        id: "nombre-cuenta",
        type: "text",
        value: accountName(o, m.account),
        maxlength: "100",
        placeholder: "Nombre de la cuenta",
        "aria-label": "Nombre de la cuenta",
      });
    const nameField = el("div");
    nameField.append(name);
    form.append(nameField);
    name.disabled = !editable;
    account.addEventListener("change", () => {
      if (account.checkValidity()) {
        m.account = Number(account.value);
        render();
      }
    });
    name.addEventListener("change", () => {
      if (editable) {
        const previous = o.accounts.find((a) => a.number === m.account);
        action(o, "account", {
          account: m.account,
          name: name.value,
          customer: previous?.customer || {},
        });
      }
    });
    form.addEventListener("submit", (e) => e.preventDefault());
    header.append(form);
    if (user.role === "admin" && !o.accounts.some((a) => a.lsoft?.json))
      header.append(
        select(
          "Mesero responsable ",
          state.waiters
            .filter((w) => w.active || w.id === o.waiter_id)
            .map((w) => [w.id, w.name]),
          o.waiter_id,
          (v) => action(o, "assign", { waiterId: v }),
        ),
      );
    else if (user.role === "admin")
      header.append(el("small", "Mesero: " + waiterName(o.waiter_id)));
  }
  content.append(header);
  if (!confirming) renderRelease(content, o);
  const layout = el("div", null, { class: "order-content" });
  if (!confirming) {
    const selection = el("div", null, { class: "selection-area" });
    renderMenu(selection, o, editable);
    layout.append(selection);
  }
  const summary = el("div", null, {
      class: "order-summary",
      id: "order-summary",
    }),
    summaryHead = el("div", null, { class: "summary-heading" });
  summaryHead.append(
    el("h3", confirming ? "Productos por enviar" : "Detalle de la orden", {
      id: "detalle-titulo",
    }),
  );
  if (!confirming) {
    const close = button("✕", () => {
      mobileDetail = false;
      $("#detalle-dialogo")?.close();
    });
    close.id = "cerrar-detalle";
    close.setAttribute("aria-label", "Cerrar detalle");
    summaryHead.append(close);
  }
  summary.append(summaryHead);
  renderItems(
    summary,
    confirming
      ? { ...o, items: o.items.filter((i) => i.status === "draft") }
      : o,
  );
  const total = totals(o.items).total,
    totalLine = el("p", "Total ", { class: "summary-total" });
  totalLine.append(el("strong", money(total)));
  summary.append(totalLine);
  const footer = el("div", null, { class: "footer" });
  if (confirming)
    footer.append(
      button(
        "Enviar a Preparación",
        () =>
          run(async () => {
            await api(`/orders/${o.id}/actions`, {
              action: "send",
              version: o.version,
            });
            confirming = false;
            showOrderSent();
          }),
        !editable || !o.items.some((i) => i.status === "draft"),
      ),
      button("Editar Orden", () => {
        confirming = false;
        render();
      }),
    );
  else {
    footer.append(
      button(
        "Enviar a Preparación",
        () =>
          run(async () => {
            await api(`/orders/${o.id}/actions`, {
              action: "send",
              version: o.version,
            });
            mobileDetail = false;
            $("#detalle-dialogo")?.close();
            showOrderSent();
          }),
        !editable || !o.items.some((i) => i.status === "draft"),
      ),
      button("Volver a Mesas", () => navigate("mesas")),
      button(
        o.status === "bill_requested" ? "Ver precuenta" : "Pedir Cuenta",
        () => openBill(o),
        !(mayBill(o) || user?.role === "mesero") ||
          !o.items.length ||
          o.items.some((i) => i.status === "draft"),
      ),
    );
    if (mayPickup()) summary.append(pickupAllButton(o));
  }
  summary.append(footer);
  layout.append(summary);
  content.append(layout);
  if (!confirming) {
    const bar = el("div", null, { class: "mobile-order-bar" }),
      text = el("div");
    text.append(
      el("strong", `${o.items.reduce((n, i) => n + i.quantity, 0)} productos · ${o.items.filter((i) => i.status === "draft").reduce((n, i) => n + i.quantity, 0)} por enviar`),
      el("small", money(total)),
    );
    bar.append(
      text,
      button(
        "Ver orden",
        () => {
          mobileDetail = true;
          showOrderDetail(summary);
        },
        false,
        "",
      ),
    );
    content.append(bar);
    if (mobileDetail && window.innerWidth < 900) showOrderDetail(summary);
  }
}
function showOrderDetail(summary) {
  let dialog = $("#detalle-dialogo");
  if (!dialog) {
    dialog = el("dialog", null, {
      id: "detalle-dialogo",
      "data-order-detail": "true",
      "aria-labelledby": "detalle-titulo",
    });
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      mobileDetail = false;
      const layout = $("#toma-ordenes-screen .order-content");
      if (layout && summary.isConnected) layout.append(summary);
      dialog.remove();
    });
  }
  dialog.append(summary);
  if (!dialog.open) dialog.showModal();
}
window.addEventListener("resize", () => {
  if (window.innerWidth >= 900 && mobileDetail) {
    mobileDetail = false;
    $("#detalle-dialogo")?.close();
  }
});
function renderMenu(content, o, editable) {
  const m = menu(o),
    nav = el("nav", null, {
      id: "categories",
      class: "categories",
      "aria-label": "Categorías del menú",
    });
  const search = button(
    "⌕",
    () => {
      if (m.searchOpen && m.query.trim()) {
        $("#buscar-producto").focus();
        return;
      }
      m.searchOpen = !m.searchOpen;
      search.setAttribute("aria-expanded", String(m.searchOpen));
      searchBox.hidden = !m.searchOpen;
      if (m.searchOpen) input.focus();
    },
    false,
    "category search-chip",
  );
  search.id = "abrir-busqueda";
  search.setAttribute("aria-label", "Buscar productos");
  search.setAttribute("aria-expanded", String(m.searchOpen));
  search.setAttribute("aria-controls", "menu-search");
  const searchBox = el("div", null, {
    id: "menu-search",
    class: "menu-search",
  });
  searchBox.hidden = !m.searchOpen;
  const controls = el("div", null, { class: "search-controls" }),
    input = el("input", null, {
      id: "buscar-producto",
      type: "search",
      "aria-label": "Buscar en todo el menú",
      placeholder: "Buscar productos…",
      autocomplete: "off",
    });
  input.value = m.query;
  const clear = button(
    "Limpiar",
    () => {
      m.query = "";
      input.value = "";
      updateProducts();
      input.focus();
    },
    false,
    "",
  );
  clear.id = "limpiar-busqueda";
  controls.append(input, clear);
  searchBox.append(controls);
  nav.append(search, searchBox);
  for (const [key, label] of Object.entries(categoryNames)) {
    const b = button(
      label,
      () => {
        m.category = key;
        m.query = "";
        input.value = "";
        updateProducts();
      },
      false,
      "category",
    );
    b.dataset.categoria = key;
    nav.append(b);
  }
  const count = el("small", "", {
      id: "buscar-resultados",
      role: "status",
      "aria-live": "polite",
    }),
    title = el("div", null, { class: "menu-heading" }),
    h = el("h3", null, { id: "menu-titulo" });
  title.append(
    h,
    el("span", `Cuenta ${m.account}`, { id: "menu-cuenta" }),
  );
  const products = el("div", null, { class: "products", id: "products" });
  content.append(
    nav,
    count,
    title,
    products,
  );
  const normalize = (value) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  function updateProducts() {
    const query = normalize(m.query.trim()),
      list = state.products.filter((p) =>
        query ? normalize(p.name).includes(query) : p.category === m.category,
      );
    products.replaceChildren();
    clear.hidden = !m.query;
    count.textContent = query ? `${list.length} resultados` : "";
    h.textContent = categoryNames[m.category];
    h.hidden = !!query;
    for (const b of nav.querySelectorAll("[data-categoria]")) {
      const active = !query && b.dataset.categoria === m.category;
      b.classList.toggle("category-active", active);
      b.setAttribute("aria-pressed", String(active));
    }
    for (const p of list) {
      const orderedItems = o.items.filter(
          (i) => i.product_id === p.id && i.account === m.account,
        ),
        draftItems = orderedItems
          .filter(
            (i) =>
              i.product_id === p.id &&
              i.account === m.account &&
              i.status === "draft",
          ),
        quantity = draftItems.reduce((s, i) => s + i.quantity, 0),
        orderedQuantity = orderedItems.reduce((s, i) => s + i.quantity, 0),
        orderedSummary = summaryOf({ items: orderedItems }),
        b = button(
          "",
          () => {
            if (!$("#cuentas").reportValidity()) return;
            action(o, "add", {
              productId: p.id,
              quantity: 1,
              account: m.account,
              note: "",
            });
          },
          !editable,
          "product" + (orderedQuantity ? " product-selected" : ""),
        );
      b.append(
        el("strong", p.name),
        el("span", money(amounts(tariffFor(p, state.settings.config)).total), {
          class: "product-price",
        }),
      );
      if (orderedQuantity) {
        b.append(el("small", `En la orden · ${orderedQuantity}`, { class: "product-quantity" }));
        const statuses = el("span", null, { class: "product-statuses" });
        for (const [status, label] of [
          ["draft", "Por confirmar"],
          ["preparing", "En preparación"],
          ["ready", "Listos para retirar"],
          ["picked", "Retirados"],
        ]) {
          if (orderedSummary[status])
            statuses.append(el("small", `${label} · ${orderedSummary[status]}`, {
              class: `product-status product-status-${status}`,
            }));
        }
        b.append(statuses);
      }
      const card = el("div", null, { class: "product-card" }),
        help = button("ⓘ", () => openProductHelp(p), false, "product-help");
      help.setAttribute("aria-label", `Ingredientes y preparación de ${p.name}`);
      help.setAttribute("aria-haspopup", "dialog");
      card.append(b, help);
      if (quantity) {
        const remove = button(
          "−",
          () => {
            const item = [...o.items].reverse().find(
              (i) => i.product_id === p.id && i.account === m.account && i.status === "draft",
            );
            if (!item) return;
            if (item.quantity === 1) action(o, "remove", { itemId: item.id });
            else action(o, "edit", {
              itemId: item.id,
              quantity: item.quantity - 1,
              note: item.note,
            });
          },
          !editable,
          "product-remove",
        );
        remove.setAttribute("aria-label", `Quitar una unidad de ${p.name} de Cuenta ${m.account}`);
        const hasNotes = draftItems.some((i) => i.note.trim()),
          notes = button(
            "✎",
            () => editProductNotes(o, p, m.account),
            !editable,
            "product-notes" + (hasNotes ? " product-notes-active" : ""),
          ),
          controls = el("div", null, { class: "product-card-controls" });
        notes.setAttribute("aria-label", `Añadir o editar notas de ${p.name} de Cuenta ${m.account}`);
        notes.setAttribute("aria-haspopup", "dialog");
        if (hasNotes)
          notes.title = draftItems.filter((i) => i.note.trim()).map((i) => `${i.quantity} ×: ${i.note}`).join("\n");
        controls.append(notes, remove);
        card.append(controls);
      }
      products.append(card);
    }
    if (!list.length)
      products.append(
        el("p", "Sin resultados", {
          class: "search-empty",
        }),
      );
  }
  input.addEventListener("input", () => {
    m.query = input.value;
    updateProducts();
  });
  updateProducts();
}
function openProductHelp(p) {
  const dialog = el("dialog", null, {
      class: "product-help-dialog",
      "aria-labelledby": "product-help-title",
    }),
    header = el("div", null, { class: "summary-heading" }),
    close = button("✕", () => dialog.close());
  close.setAttribute("aria-label", "Cerrar ayuda");
  header.append(el("h2", p.name, { id: "product-help-title" }), close);
  dialog.append(header);
  const fields = [
    ["ingredients", "Ingredientes principales"],
    ["preparation", "Preparación habitual"],
    ["sides", "Acompañamientos incluidos"],
  ], custom = state.settings.config.productHelp?.[p.id], info = custom || p.help || {};
  if (!custom && p.help) dialog.append(el("p", "Ficha de ejemplo · Datos ficticios", { class: "help-example" }));
  if (user.role === "admin") {
    const form = el("form"), inputs = {}, version = state.settings.version;
    for (const [key, label] of fields) {
      inputs[key] = labeled(form, label, el("textarea", info[key] || "", {
        maxlength: "600", rows: "2", name: key,
      }));
    }
    const status = el("p", "", { role: "status" }),
      save = el("button", "Guardar ficha", { type: "submit" });
    form.append(status, save);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      save.disabled = true;
      try {
        await api("/product-help", {
          productId: p.id, version,
          info: Object.fromEntries(fields.map(([key]) => [key, inputs[key].value.trim()])),
        });
        await refresh();
        dialog.close();
      } catch (error) {
        status.textContent = error.message;
        save.disabled = false;
      }
    });
    dialog.append(form);
  } else {
    const details = el("dl");
    for (const [key, label] of fields) {
      if (info[key]) details.append(el("dt", label), el("dd", info[key]));
    }
    dialog.append(details.children.length ? details : el("p", "La ficha de este producto está pendiente de completar."));
  }
  dialog.addEventListener("click", (e) => {
    const rect = dialog.getBoundingClientRect();
    if (e.target === dialog && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
function pickupAllButton(o, area = null) {
  const r = summaryOf(o, area);
  return button(
    `Retirar todo lo listo (${r.ready})`,
    () => action(o, "pickup_all", area ? { area } : {}),
    !r.ready,
  );
}
function renderItems(content, o, area = null) {
  const list = el("ul", null, {
      class: "items orden-list",
      id: !area ? "orden-list" : "items-" + o.id,
    }),
    items = o.items.filter(
      (i) =>
        !area || (i.area === area && i.status !== "draft" && remaining(i) > 0),
    );
  for (const i of items) {
    const li = el("li", null, { class: area ? `preparation-row order-item${i.status === "ready" ? " preparation-ready" : ""}` : "order-item" });
    li.append(
      el(
        "strong",
        `${i.quantity} × ${i.product_name}`,
        { class: "item-title" },
      ),
      el(
        "span",
        i.status === "draft"
          ? "Sin enviar"
          : `${remaining(i)} ${i.status === "ready" ? "listos para retirar" : "en preparación"} · ${i.picked_up_quantity} retirados`,
        { class: "item-status" },
      ),
    );
    li.append(el("small", `Cuenta ${i.account}${i.additional ? " · Adicional" : ""}`, { class: "item-account" }));
    if (i.note) li.append(el("p", i.note, { class: "item-note" }));
    if (!area)
      li.append(el("small", money(amounts(i.tariff, i.quantity).total), { class: "item-price" }));
    if (area) {
      if (i.sent_at)
        li.append(
          el("small", `Enviado: ${new Date(i.sent_at).toLocaleTimeString()}`),
          el("small", "", {
            class: "elapsed",
            "data-start": i.sent_at,
            ...(i.ready_at ? { "data-stop": i.ready_at } : {}),
          }),
        );
      const label = el("label"),
        check = el("input", null, {
          type: "checkbox",
          "aria-label": `Preparado: ${i.product_name}, cuenta ${i.account}`,
        });
      check.checked = i.status === "ready";
      check.disabled = !mayPrepare(area) || i.picked_up_quantity > 0;
      check.addEventListener("change", () =>
        action(o, "ready", { itemId: i.id, ready: check.checked }),
      );
      label.append(check, " Preparado");
      li.append(label);
      if (mayPickup() && i.status === "ready") {
        const form = el("form", null, { class: "pickup-controls" }),
          input = el("input", null, {
            type: "number",
            id: `pickup-${i.id}`,
            name: "quantity",
            min: "1",
            max: String(remaining(i)),
            step: "1",
            value: String(remaining(i)),
            required: "",
            "aria-label": `Cantidad a retirar de ${i.product_name}, cuenta ${i.account}`,
          });
        labeled(form, "Cantidad a retirar", input);
        form.append(
          el("button", "Retirar", { type: "submit", class: "pickup-button" }),
        );
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          if (form.reportValidity())
            action(o, "pickup", {
              itemId: i.id,
              quantity: Number(input.value),
            });
        });
        li.append(form);
      }
    }
    if (!area && i.status === "draft" && editableOrder(o)) {
      const controls = el("div", null, { class: "quantity-controls" });
      controls.append(
        button(
          "−",
          () =>
            action(o, "edit", {
              itemId: i.id,
              quantity: i.quantity - 1,
              note: i.note,
            }),
          i.quantity <= 1,
        ),
        el("span", String(i.quantity)),
        button(
          "+",
          () =>
            action(o, "edit", {
              itemId: i.id,
              quantity: i.quantity + 1,
              note: i.note,
            }),
          i.quantity >= 999,
        ),
      );
      li.append(
        controls,
        button("Nota", () => editNote(o, i)),
        button("Quitar", () => action(o, "remove", { itemId: i.id })),
      );
    }
    list.append(li);
  }
  if (!items.length)
    list.append(
      el(
        "li",
        area
          ? "Todo al día. No hay productos pendientes de preparar o retirar."
          : "No hay productos.",
      ),
    );
  content.append(list);
}
function editProductNotes(o, p, account) {
  const current = state.orders.find((order) => order.id === o.id),
    items = current?.items.filter(
      (i) => i.product_id === p.id && i.account === account && i.status === "draft",
    ) || [];
  if (!items.length) return;
  if (items.length === 1) return editNote(current, items[0]);
  const dialog = el("dialog", null, {
    class: "note-dialog",
    "aria-labelledby": "product-notes-title",
  });
  dialog.append(
    el("h3", `Notas de ${p.name} · Cuenta ${account}`, { id: "product-notes-title" }),
    el("p", "¿Qué grupo quieres editar?"),
  );
  for (const item of items) {
    dialog.append(button(
      `${item.quantity} × ${item.note || "Sin nota"}`,
      () => {
        dialog.close();
        editNote(current, item);
      },
      false,
      "product-note-choice",
    ));
  }
  dialog.append(button("Cancelar", () => dialog.close()));
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
function editNote(o, i) {
  const dialog = el("dialog", null, {
      class: "note-dialog",
      "aria-labelledby": "note-title",
    }),
    form = el("form"),
    note = el("textarea", i.note, {
      id: "note-text",
      maxlength: "500",
      "aria-label": "Nota del producto",
    }),
    footer = el("div", null, { class: "footer" });
  footer.append(
    el("button", "Guardar Nota", { type: "submit" }),
    button("Cancelar", () => dialog.close()),
  );
  form.append(
    el("h3", `Nota de ${i.product_name} · Cuenta ${i.account}`, { id: "note-title" }),
    el("p", `Se aplica a ${i.quantity} ${i.quantity === 1 ? "unidad" : "unidades"}.`),
    note, footer,
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const current = state.orders.find((o) => o.id === i.order_id),
      item = current?.items.find((item) => item.id === i.id);
    if (!item) {
      dialog.close();
      return;
    }
    run(async () => {
      await api(`/orders/${current.id}/actions`, {
        action: "edit",
        version: current.version,
        itemId: item.id,
        quantity: item.quantity,
        note: note.value,
      });
      dialog.close();
    });
  });
  dialog.addEventListener("close", () => dialog.remove());
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  note.focus();
}
function renderPreparation(content) {
  content.append(
    heading(
      "Órdenes en " + roles[view],
      view === "cocina" ? "utensils" : "glass-cheers",
    ),
  );
  const cards = el("div", null, { class: view + "-list", id: view + "-list" }),
    history = el("details", null, {
      class: "withdrawn-history",
      id: view + "-withdrawn",
    }),
    withdrawn = el("div");
  let count = 0;
  const firstPendingTime = (o) => Math.min(
    ...o.items
      .filter((i) => i.area === view && i.status !== "draft" && remaining(i) > 0)
      .map((i) => {
        const timestamp = i.sent_at ? new Date(i.sent_at).getTime() : NaN;
        return Number.isFinite(timestamp) ? timestamp : Infinity;
      }),
  );
  const orders = [...state.orders].sort(
    (a, b) => firstPendingTime(a) - firstPendingTime(b),
  );
  for (const o of orders) {
    const items = o.items.filter(
      (i) => i.area === view && i.status !== "draft",
    );
    for (const i of items.filter((i) => i.picked_up_quantity > 0)) {
      count += i.picked_up_quantity;
      withdrawn.append(
        el(
          "p",
          `${orderTitle(o)} · ${i.product_name} · ${i.picked_up_quantity} retirados · Cuenta ${i.account}${i.note ? " · Nota: " + i.note : ""}`,
          { class: "withdrawn-row" },
        ),
      );
    }
    if (!items.some((i) => remaining(i) > 0)) continue;
    const card = el("section", null, { class: view + "-item" });
    card.append(stationOrderHeading(o));
    if (mayPickup()) {
      const pickupAll = pickupAllButton(o, view);
      pickupAll.classList.add("station-pickup-all");
      card.append(pickupAll);
    }
    renderItems(card, o, view);
    cards.append(card);
  }
  if (!cards.children.length)
    cards.append(
      el(
        "p",
        "Todo al día. No hay productos pendientes de preparar o retirar.",
        { class: "area-empty" },
      ),
    );
  if (!withdrawn.children.length)
    withdrawn.append(el("p", "No hay retiros en los pedidos actuales."));
  history.append(el("summary", `Ver retirados (${count})`), withdrawn);
  content.append(cards, history);
  updateTimers();
  if (areas().includes("mesas"))
    content.append(
      button("Volver a Mesas", () => navigate("mesas"), false, "center-button"),
    );
}
function openBill(o) {
  o = state.orders.find((order) => order.id === o.id) ?? o;
  const confirmation = o.status === "open" ? confirmOtherWaiter(o, "bill") : {};
  if (confirmation === null) return;
  const accounts = o.accounts.filter((a) =>
    o.items.some((i) => i.account === a.number),
  );
  billingAccount =
    accounts.find((a) => !a.lsoft?.json)?.number ?? accounts[0]?.number ?? 1;
  if (o.status === "open")
    run(async () => {
      await api(`/orders/${o.id}/actions`, {
        action: "bill",
        version: o.version,
        ...confirmation,
      });
      mobileDetail = false;
      $("#detalle-dialogo")?.close();
      view = "precuenta";
      selected = o.id;
    });
  else navigate("precuenta", o.id);
}
function consumption(content, o, number, tip = 0, printed = false) {
  const items = o.items.filter(
      (i) => i.account === number && i.status !== "draft",
    ),
    total = totals(items),
    table = el("table", null, { class: "consumption-table" }),
    head = el("thead"),
    row = el("tr");
  for (const title of ["Producto", "Cantidad", "Importe"])
    row.append(el("th", title, { scope: "col" }));
  head.append(row);
  table.append(head);
  const body = el("tbody");
  for (const i of items) {
    const r = el("tr");
    r.append(
      el("td", i.product_name),
      el("td", String(i.quantity)),
      el("td", money(amounts(i.tariff, i.quantity).total)),
    );
    body.append(r);
  }
  table.append(body);
  const foot = el("tfoot");
  for (const [label, value] of [
    ["Consumo base", total.base],
    ["IVA", total.iva],
    ["Servicio", total.servicio],
    ...(printed ? [["Total", total.total]] : []),
    ["Propina voluntaria", printed ? null : tip],
    ["Total a pagar", printed ? null : total.total + tip],
  ]) {
    const r = el("tr");
    if (printed && label === "Propina voluntaria") r.className = "bill-tip";
    if (printed && label === "Total") r.className = "bill-total";
    r.append(
      el("th", label, { colspan: "2", scope: "row" }),
      el("td", value === null ? "________________" : money(value)),
    );
    foot.append(r);
  }
  table.append(foot);
  content.append(table);
}
function renderBill(content, o) {
  content.append(
    heading("Precuenta", "file-invoice"),
    el("p", orderTitle(o) + " · " + waiterName(o.waiter_id)),
  );
  const accounts = o.accounts.filter((a) =>
    o.items.some((i) => i.account === a.number),
  );
  if (!accounts.some((a) => a.number === billingAccount))
    billingAccount = accounts[0]?.number ?? 1;
  content.append(
    select(
      "Cuenta ",
      accounts.map((a) => [
        a.number,
        `Cuenta ${a.number}${a.name ? " · " + a.name : ""}`,
      ]),
      billingAccount,
      (v) => {
        billingAccount = Number(v);
        render();
      },
    ),
  );
  const a = accounts.find((a) => a.number === billingAccount);
  if (!a) return;
  const consume = el("div", null, { id: "precuenta-consumo" });
  consumption(consume, o, billingAccount, a.tip_cents);
  content.append(
    consume,
    el(
      "p",
      "Entrega la precuenta para que el cliente revise el total y llene sus datos. El mesero cobra con Datafast y lleva la precuenta firmada y el voucher a Caja.",
      { class: "menu-help" },
    ),
  );
  const form = el("form", null, { class: "client-info", id: "billing-form" }),
    locked = !!a.lsoft?.json || !mayBill(o),
    fields = {
      accountName: "Nombre de la cuenta",
      identification: "Cédula / RUC",
      name: "Nombre completo",
      address: "Dirección",
      phone: "Teléfono",
      email: "Correo",
    };
  for (const [key, label] of Object.entries(fields)) {
    const input = labeled(
      form,
      label,
      el("input", null, {
        id: `billing-${o.id}-${a.number}-${key}`,
        name: key,
        type: key === "email" ? "email" : "text",
        maxlength: key === "accountName" ? "100" : "200",
        value: key === "accountName" ? a.name : a.customer?.[key] || "",
        ...(["identification", "name"].includes(key) ? { required: "" } : {}),
      }),
    );
    input.disabled = locked;
  }
  const tip = labeled(
    form,
    "Propina voluntaria",
    el("input", null, {
      id: `billing-${o.id}-${a.number}-tip`,
      name: "tip",
      type: "number",
      min: "0",
      max: "100000",
      step: "0.01",
      value: (a.tip_cents / 100).toFixed(2),
    }),
  );
  tip.disabled = locked;
  tip.addEventListener("input", () => {
    if (tip.checkValidity()) {
      consume.replaceChildren();
      consumption(consume, o, billingAccount, cents(tip.value));
    }
  });
  const footer = el("div", null, { class: "footer" }),
    submit = el(
      "button",
      a.lsoft?.json ? "Cuenta enviada" : "Enviar cuenta a LSoft (simulado)",
      { type: "submit" },
    );
  submit.disabled = locked;
  footer.append(
    submit,
    button("Imprimir precuenta", () => printBill(o, a, form)),
    button("Volver a Caja", () => navigate("caja")),
    button("Volver a Mesas", () => navigate("mesas")),
  );
  form.append(footer);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const { accountName, tip, ...customer } = Object.fromEntries(
      new FormData(form),
    );
    run(async () => {
      await api(`/orders/${o.id}/actions`, {
        action: "account",
        version: o.version,
        account: a.number,
        name: accountName,
        customer,
        tipCents: cents(tip),
      });
      const fresh = (await api("/state")).orders.find(
        (item) => item.id === o.id,
      );
      await api(`/orders/${o.id}/actions`, {
        action: "send_lsoft",
        version: fresh.version,
        account: a.number,
      });
      const next = fresh.accounts.find(
        (account) =>
          account.number !== a.number &&
          !account.lsoft?.json &&
          fresh.items.some((i) => i.account === account.number),
      );
      if (next) {
        billingAccount = next.number;
        view = "precuenta";
        selected = o.id;
      } else {
        view = "caja";
        selected = null;
      }
    });
  });
  if (user.role !== "mesero") content.append(form);
  else content.append(button("Imprimir precuenta", () => printBill(o, a)));
  renderCollection(content, o, a);
  if (a.lsoft?.json) renderLSoft(content, o, a);
  renderRelease(content, o);
}
function printBill(o, a) {
  const target = $("#precuenta-impresion");
  target.replaceChildren(
    heading(`Precuenta · ${orderTitle(o)} · Cuenta ${a.number}`),
  );
  for (const label of Object.values({
    identification: "Cédula / RUC",
    name: "Cliente",
    address: "Dirección",
    phone: "Teléfono",
    email: "Correo",
  })) {
    const field = el("p", null, { class: "bill-customer-field" });
    field.append(
      el("span", label + ":"),
      el("span", null, { class: "bill-writing-line", "aria-hidden": "true" }),
    );
    target.append(field);
  }
  consumption(target, o, a.number, 0, true);
  target.append(el("p", "Firma del cliente: ________________________________"));
  target.append(el("p", "Precuenta informativa. No es una factura fiscal."));
  window.print();
}
function renderCollection(content, o, a) {
  const steps = [
    ["bill_delivered", "Precuenta entregada al cliente", ["mesero", "admin"]],
    ["collected", "Cobrado con Datafast · precuenta firmada y voucher recogidos", ["mesero", "admin"]],
    ["documents_received", "Caja recibió la precuenta firmada y el voucher", ["caja", "admin"]],
  ];
  const section = el("div", null, { class: "collection-steps" });
  section.append(el("p", "Entrega y cobro", { class: "collection-title" }));
  for (let index = 0; index < steps.length; index++) {
    const [name, label, roles] = steps[index];
    if (a.collection?.[name]) section.append(el("p", "Confirmado: " + label));
    else if (roles.includes(user.role) && mayBill(o)) section.append(button(
      "Confirmar: " + label, () => action(o, name, { account: a.number }),
      o.status !== "bill_requested" || (index > 0 && !a.collection?.[steps[index - 1][0]]),
    ));
    else section.append(el("p", "Pendiente: " + label));
  }
  content.append(section);
}
function renderLSoft(content, o, a) {
  const panel = el("section", null, { class: "lsoft-controls" }),
    response = a.lsoft?.response;
  panel.append(
    el(
      "p",
      response
        ? `${response.pedidoId} · Enviada a LSoft (simulado)`
        : "Sin enviar a LSoft",
    ),
  );
  const json = el("details", null, { id: `json-${o.id}-${a.number}` });
  json.append(
    el("summary", "Ver JSON provisional"),
    el("pre", JSON.stringify(a.lsoft?.json || {}, null, 2), {
      class: "lsoft-json",
    }),
  );
  panel.append(json, button("Consultar estado", refresh, !response));
  if (user.role !== "mesero" && mayBill(o) && response)
    panel.append(
      button("Reintentar envío", () =>
        action(o, "send_lsoft", { account: a.number }),
      ),
    );
  content.append(panel);
}
function renderRelease(content, o) {
  if (!mayBill(o)) return;
  const sent = o.items.length > 0 && o.items.every((i) =>
    o.accounts.some((a) => a.number === i.account && a.lsoft?.json),
  );
  if (!sent) return;
  const pending = o.items.some((i) => i.status !== "ready"),
    panel = el("section", null, { class: "consumption-controls", "aria-label": "Estado y acciones del consumo" }),
    statuses = el("div", null, { class: "consumption-statuses", role: "status" }),
    actions = el("div", null, { class: "consumption-actions" });
  statuses.append(
    el("span", "Enviada a LSoft", { class: "consumption-status consumption-status-sent" }),
    el("span", o.table_number === null ? "Pedido pendiente de finalizar" : "Mesa ocupada", { class: "consumption-status consumption-status-occupied" }),
  );
  panel.append(statuses, actions);
  if (o.table_number !== null) {
    const paid = o.items.every((i) => o.accounts.some((a) =>
      a.number === i.account && (a.collection?.collected || a.lsoft?.response?.estado === "pagado"),
    ));
    actions.append(button("Abrir nuevo consumo", () => confirmNewConsumption(o), pending || !paid));
    if (!paid) panel.append(el("p", "Confirma el cobro de todas las cuentas para abrir un nuevo consumo.", { class: "consumption-notice", role: "status" }));
  }
  actions.append(
    button(o.table_number === null ? "Finalizar pedido" : "Liberar mesa", () => confirmClose(o), pending),
  );
  if (pending) panel.append(el("p", o.table_number === null
    ? "No puedes finalizar el pedido: hay productos pendientes de preparación. El botón se habilitará cuando todos estén listos."
    : "Hay productos pendientes de preparación. Podrás abrir un nuevo consumo o liberar la mesa cuando todos estén listos.",
  { class: "consumption-notice", role: "status" }));
  content.append(panel);
}
function renderCash(content) {
  content.append(
    heading("LSoft · Caja", "cash-register"),
    el(
      "p",
      "Imprime las precuentas solicitadas. El mesero entrega el papel y cobra con Datafast. Recibe la precuenta firmada y el voucher y registra los datos para facturar. El envío a LSoft es simulado.",
      { class: "menu-help" },
    ),
  );
  const cards = el("div", null, { class: "caja-list" }),
    orders = state.orders.filter(
      (o) =>
        o.status === "bill_requested" && (user.role !== "mesero" || owned(o)),
    );
  for (const o of orders) {
    const card = el("section", null, { class: "caja-item" });
    card.append(stationOrderHeading(o));
    const accounts = o.accounts.filter((a) =>
      o.items.some((i) => i.account === a.number),
    );
    if (accounts.some((a) => !a.collection?.bill_delivered)) {
      card.classList.add("bill-alert");
      card.append(el("p", "Solicita cuenta · pendiente de entregar precuenta", { class: "bill-alert-label", role: "status" }));
    }
    for (const a of accounts) {
      const accountCard = el("section", null, { class: "cash-account" });
      accountCard.append(
        el("h4", `Cuenta ${a.number}${a.name ? " · " + a.name : ""}`),
      );
      consumption(accountCard, o, a.number, a.tip_cents);
      accountCard.append(button("Imprimir precuenta", () => printBill(o, a)));
      renderCollection(accountCard, o, a);
      renderLSoft(accountCard, o, a);
      accountCard.append(
        button(user.role === "mesero" ? "Ver precuenta" : "Registrar datos del papel / facturar", () => {
          billingAccount = a.number;
          navigate("precuenta", o.id);
        }),
      );
      card.append(accountCard);
    }
    const unsent = accounts.some((a) => !a.lsoft?.json),
      pending = o.items.some((i) => i.status !== "ready");
    renderRelease(card, o);
    if (unsent || pending)
      card.append(
        el(
          "p",
          unsent
            ? "Hay cuentas pendientes de enviar a LSoft."
            : "Esperando productos preparados.",
        ),
      );
    cards.append(card);
  }
  if (!orders.length) cards.append(el("p", "No hay cuentas pendientes."));
  content.append(cards);
  if (["admin", "caja", "auditor"].includes(user.role))
    content.append(
      button("Ver operaciones cerradas", () => navigate("historial")),
    );
}
function confirmNewConsumption(o) {
  const dialog = el("dialog", null, { class: "note-dialog", "aria-label": "Abrir nuevo consumo" }),
    footer = el("div", null, { class: "footer" });
  footer.append(
    button("Abrir nuevo consumo", () => run(async () => {
      const current = state.orders.find((order) => order.id === o.id) ?? o;
      const result = await api(`/orders/${o.id}/actions`, {
        action: "new_consumption", version: current.version,
      });
      selected = result.orderId;
      view = ["admin", "mesero"].includes(user.role) ? "mesas" : "caja";
      confirming = false;
      mobileDetail = false;
      dialog.close();
    })),
    button("Cancelar", () => dialog.close()),
  );
  dialog.append(
    heading("Nuevo consumo · " + orderTitle(o)),
    el("p", "La cuenta actual quedará archivada. Se abrirá una orden vacía en la misma mesa y con el mismo mesero. La mesa seguirá ocupada."),
    footer,
  );
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
function confirmClose(o) {
  const dialog = el("dialog", null, {
      class: "note-dialog",
      "aria-label": o.table_number === null ? "Finalizar pedido" : "Liberar mesa",
    }),
    footer = el("div", null, { class: "footer" });
  footer.append(
    button(o.table_number === null ? "Finalizar pedido" : "Liberar mesa", () =>
      run(async () => {
        await api(`/orders/${o.id}/actions`, {
          action: "close",
          version: o.version,
        });
        dialog.close();
      }),
    ),
    button("Cancelar", () => dialog.close()),
  );
  dialog.append(
    heading((o.table_number === null ? "Finalizar " : "Liberar ") + orderTitle(o)),
    el("p", o.table_number === null ? "¿Deseas finalizar el pedido? Se conservará en el historial con las confirmaciones de entrega y cobro registradas." : "¿Los clientes ya se retiraron y deseas liberar la mesa? La cuenta y sus confirmaciones se conservarán en el historial."),
    footer,
  );
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
async function renderHistory(content) {
  content.append(heading("Operaciones cerradas"));
  try {
    const orders = await api("/history");
    if (view !== "historial" || !user) return;
    for (const o of orders) {
      const card = el("details");
      card.append(
        el(
          "summary",
          `${orderTitle(o)} · ${new Date(o.closed_at).toLocaleString()}`,
        ),
      );
      renderItems(card, o);
      for (const a of o.accounts) {
        card.append(
          el("h4", `Cuenta ${a.number} · ${a.customer.name || "Sin datos"}`),
        );
        consumption(card, o, a.number, a.tip_cents);
        card.append(
          el("pre", JSON.stringify(a.lsoft, null, 2), { class: "lsoft-json" }),
        );
      }
      content.append(card);
    }
    if (!orders.length)
      content.append(el("p", "Todavía no hay pedidos cerrados."));
  } catch (e) {
    message(e.message, true);
  }
}
function renderConfig(content) {
  const settings = state.settings,
    config = settings.config;
  content.append(
    heading("Precios y cargos"),
    el(
      "p",
      "Los productos ya pedidos conservan su tarifa. Los cambios se comparten entre dispositivos.",
    ),
  );
  const form = el("form", null, { id: "config-form" });
  for (const [key, label] of [
    ["iva", "IVA (%)"],
    ["servicio", "Servicio (%) — 0 para desactivar"],
  ])
    labeled(
      form,
      label,
      el("input", null, {
        id: "config-" + key,
        name: key,
        type: "number",
        min: "0",
        max: "100",
        step: "0.01",
        value: String(config[key]),
        required: "",
      }),
    );
  const included = select(
    "Interpretación de precios ",
    [
      ["incluidos", "Precio final: incluye IVA y servicio"],
      ["separados", "Precio base: añadir IVA y servicio"],
    ],
    config.incluidos ? "incluidos" : "separados",
  );
  included.querySelector("select").id = "config-incluidos";
  included.querySelector("select").name = "included";
  included
    .querySelector("select")
    .addEventListener("change", () => (form.dataset.dirty = "true"));
  form.append(
    included,
    el(
      "p",
      "IVA y servicio se calculan sobre la misma base. La propina voluntaria va aparte. Cambiar el modo conserva los números escritos y cambia su interpretación.",
    ),
  );
  const prices = el("div", null, { class: "price-settings" }),
    seen = new Set();
  for (const p of state.products) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    const input = labeled(
      prices,
      p.name,
      el("input", null, {
        id: "price-" + p.id,
        type: "number",
        min: "0",
        max: "100000",
        step: "0.01",
        value: (tariffFor(p, config).precio / 100).toFixed(2),
        required: "",
      }),
    );
    input.dataset.product = p.name;
    input.addEventListener("input", () => (form.dataset.dirty = "true"));
  }
  form.append(prices);
  const footer = el("div", null, { class: "footer" });
  footer.append(
    el("button", "Guardar configuración", { type: "submit" }),
    button("Cancelar", () => navigate("mesas")),
  );
  form.append(footer);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const precios = Object.fromEntries(
      [...prices.querySelectorAll("input")].map((i) => [
        i.dataset.product,
        cents(i.value),
      ]),
    );
    run(async () => {
      await api("/config", {
        version: settings.version,
        config: {
          iva: Number($("#config-iva").value),
          servicio: Number($("#config-servicio").value),
          incluidos: $("#config-incluidos").value === "incluidos",
          precios,
        },
      });
      navigate("mesas");
    });
  });
  content.append(form);
}
function renderWaiters(content) {
  content.append(
    heading("Equipo de meseros"),
    el(
      "p",
      "Un nombre por línea. Las mesas asignadas conservan su responsable aunque salga de la lista.",
    ),
  );
  const form = el("form"),
    input = labeled(
      form,
      "Meseros",
      el(
        "textarea",
        state.waiters
          .filter((w) => w.active)
          .map((w) => w.name)
          .join("\n"),
        { id: "lista-meseros", class: "waiter-list", rows: "8", required: "" },
      ),
    );
  const footer = el("div", null, { class: "footer" });
  footer.append(
    el("button", "Guardar meseros", { type: "submit" }),
    button("Cancelar", () => navigate("mesas")),
  );
  form.append(footer);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const names = [
      ...new Set(
        input.value
          .split("\n")
          .map((n) => n.trim())
          .filter(Boolean),
      ),
    ];
    run(async () => {
      await api("/waiters", { version: state.settings.version, names });
      navigate("mesas");
    });
  });
  content.append(form);
}
async function renderUsers(content) {
  content.append(
    heading("Usuarios y permisos"),
    el(
      "p",
      "Las cuentas usan la contraseña configurada al inicializar la base. Las contraseñas existentes se conservan.",
    ),
  );
  try {
    const users = await api("/users");
    if (view !== "usuarios" || !user) return;
    for (const u of users) {
      const card = el("section", null, { class: "client-info" });
      card.append(
        el(
          "strong",
          u.username + " · " + roles[u.role] + (u.active ? "" : " · Inactivo"),
        ),
      );
      if (u.role === "mesero")
        card.append(
          select(
            "Mesero vinculado ",
            state.waiters
              .filter((w) => w.active || w.id === u.waiter_id)
              .map((w) => [w.id, w.name]),
            u.waiter_id,
            (v) => run(() => api(`/users/${u.id}/waiter`, { waiterId: v })),
          ),
        );
      content.append(card);
    }
  } catch (e) {
    message(e.message, true);
  }
}
setInterval(refresh, 15000);
function updateTimers() {
  document.querySelectorAll(".elapsed").forEach((node) => {
    const seconds = Math.max(
      0,
      Math.floor(
        ((node.dataset.stop
          ? new Date(node.dataset.stop).getTime()
          : Date.now()) -
          new Date(node.dataset.start).getTime()) /
          1000,
      ),
    );
    node.textContent = `Prep. ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    node.classList.toggle("elapsed-normal", seconds < 600);
    node.classList.toggle("elapsed-warning", seconds >= 600 && seconds < 1200);
    node.classList.toggle("elapsed-late", seconds >= 1200);
    node.title = `Tiempo de preparación${node.dataset.stop ? " final" : ""}`;
  });
}
setInterval(updateTimers, 1000);
api("/me")
  .then((me) => {
    user = me;
    signedIn();
  })
  .catch(() => logoutUI());
