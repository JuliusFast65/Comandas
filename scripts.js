import { tariffFor, amounts, totals } from "./money.js";
let user = null,
  state = { tables: [], products: [], orders: [], waiters: [], stations: [], users: [], settings: null },
  view = "mesas",
  selected = null,
  pendingTable = null,
  lastWorkedOrder = null,
  confirming = false,
  billingAccount = 1,
  events = null;
let busy = false,
  syncing = null,
  pendingRuns = 0,
  runQueue = Promise.resolve(),
  refreshAgain = false,
  mobileDetail = false,
  activeWaiter = null,
  onlyMine = false;
const menus = new Map();
// A free table becomes a saved order with its first product; later taps follow it here.
const createdOrders = new Map();
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
  supervisor: "Supervisor",
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
  text = "Los productos se enviaron a sus estaciones de preparación.",
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
    ["admin", "supervisor"].includes(user?.role) ||
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
  return ["admin", "supervisor", "mesero"].includes(user?.role);
}
function confirmOtherWaiter(o, name) {
  if (user?.role !== "mesero" || !o.table_number || !o.waiter_id || o.waiter_id === user.waiter_id)
    return {};
  const operation = name === "bill" ? "pedir la cuenta" : "retirar productos";
  if (!window.confirm(`${orderTitle(o)} pertenece a ${waiterName(o.waiter_id)}. ¿Quieres ${operation} de esta orden de otro mesero?`))
    return null;
  return { confirmedOtherWaiterId: o.waiter_id };
}
function accountSent(o, number) {
  return o.accounts.some((a) => a.number === number && a.lsoft?.json);
}
// Corrections after sending: note, account and voiding, until the account is invoiced.
function mayCorrect(o, i) {
  return owned(o) && !o.pending && o.status !== "closed" && !accountSent(o, i.account);
}
function mayVoid(o, i) {
  return mayCorrect(o, i) && i.status !== "draft" &&
    (user.role !== "mesero" || i.status === "preparing");
}
function mayAudit() {
  return ["admin", "supervisor", "caja", "auditor"].includes(user?.role);
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
  createdOrders.clear();
  state = { tables: [], products: [], orders: [], waiters: [], stations: [], users: [], settings: null };
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
      .map((n) => [n.id, n.type === "checkbox" ? n.checked : n.value]),
  );
}
function restoreForms(values) {
  for (const [id, value] of values) {
    const n = document.getElementById(id);
    if (n) {
      if (n.type === "checkbox") n.checked = value;
      else n.value = value;
      n.closest("form").dataset.dirty = "true";
    }
  }
}
// A forced refresh runs between saved changes, when no operation is in flight.
async function refresh(force = false) {
  if (!user || user.must_change_password) return;
  if (force === true) while (syncing) await syncing;
  else if (busy || syncing) {
    refreshAgain = true;
    return;
  }
  let finished;
  syncing = new Promise((resolve) => (finished = resolve));
  try {
    const [next, liveMe] = await Promise.all([api("/state"), api("/me")]);
    if (!user) return;
    if (busy) {
      // Queued taps keep their buttons; they only need the latest versions.
      if (force === true) state = next;
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
    if (user.role !== liveMe.role && liveMe.role === "supervisor") onlyMine = false;
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
    syncing = null;
    finished();
    if (refreshAgain && !busy) {
      refreshAgain = false;
      await refresh();
    }
  }
}
// Queued changes (quantity taps) wait their turn; any other change is ignored while one is running.
function run(fn, queued = false) {
  if (pendingRuns && !queued) return Promise.resolve(false);
  pendingRuns++;
  busy = true;
  $("#workspace").setAttribute("aria-busy", "true");
  const result = runQueue.then(async () => {
    try {
      await fn();
      message("Cambio guardado.");
      return true;
    } catch (e) {
      message(e.message, true);
      return false;
    } finally {
      pendingRuns--;
      if (!pendingRuns) {
        busy = false;
        $("#workspace").removeAttribute("aria-busy");
      }
      await refresh(true);
    }
  });
  runQueue = result;
  return result;
}
// Product and quantity taps are queued. Their fields may be a function of the latest order,
// evaluated when the change is sent; returning null skips it.
function action(o, name, fields = {}) {
  const queued = ["add", "edit", "remove"].includes(name);
  let current = latest(o);
  if (current.pending && !queued) {
    if (name === "account") {
      current.accounts = [{ number: fields.account, name: fields.name, customer: fields.customer }];
      render();
      return;
    }
    if (name === "assign") {
      current.waiter_id = fields.waiterId;
      render();
      return;
    }
    if (name !== "occupy") return;
  }
  const confirmation = ["pickup", "pickup_all", "bill"].includes(name)
    ? confirmOtherWaiter(current, name) : {};
  if (confirmation === null) return;
  return run(async () => {
    current = latest(o);
    const body = typeof fields === "function" ? fields(current) : fields;
    if (!body) return;
    if (current.pending) {
      if (!["add", "occupy"].includes(name)) return;
      const created = await api("/orders", {
        tableNumber: current.table_number, waiterId: current.waiter_id,
        firstItem: name === "add" ? body : undefined,
        occupiedExplicitly: name === "occupy",
        firstAccount: current.accounts.find((a) => a.number === body.account),
      });
      const m = menus.get(current.id);
      if (m) menus.set(created.id, m);
      createdOrders.set(current.id, created.id);
      selected = created.id;
      pendingTable = null;
      return;
    }
    await api(`/orders/${current.id}/actions`, {
      action: name,
      version: current.version,
      ...body,
      ...confirmation,
    });
  }, queued);
}
function latest(o) {
  const id = createdOrders.get(o.id) ?? o.id;
  return state.orders.find((order) => order.id === id) ?? o;
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
function passwordField(form, id, label, autocomplete) {
  return labeled(form, label, el("input", null, {
    id, type: "password", autocomplete, required: "", maxlength: "256",
    ...(autocomplete === "new-password" ? { minlength: "8" } : {}),
  }));
}
// With required=true the dialog stays open until the temporary password is replaced.
function openPasswordChange(required = false) {
  const dialog = el("dialog", null, { class: "note-dialog password-dialog", "aria-labelledby": "password-title" }),
    form = el("form"),
    status = el("p", "", { role: "status", class: "error" }),
    footer = el("div", null, { class: "footer" }),
    save = el("button", "Guardar contraseña", { type: "submit" });
  form.append(
    el("h3", "Cambiar contraseña", { id: "password-title" }),
    el("p", required
      ? "Tu contraseña es temporal. Define una propia, de al menos 8 caracteres, para continuar."
      : "Usa al menos 8 caracteres. Tus otros dispositivos deberán iniciar sesión de nuevo."),
  );
  const current = passwordField(form, "password-current", required ? "Contraseña temporal" : "Contraseña actual", "current-password"),
    next = passwordField(form, "password-new", "Nueva contraseña", "new-password"),
    repeat = passwordField(form, "password-repeat", "Repetir nueva contraseña", "new-password");
  footer.append(save, required
    ? button("Cerrar sesión", async () => {
        await api("/logout", {}).catch(() => {});
        logoutUI();
      })
    : button("Cancelar", () => dialog.close()));
  form.append(status, footer);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (next.value !== repeat.value) {
      status.textContent = "Las contraseñas nuevas no coinciden.";
      return;
    }
    save.disabled = true;
    try {
      await api("/password", { current: current.value, password: next.value });
      if (required) user = await api("/me");
      dialog.close();
      message("Contraseña actualizada.");
      if (required) signedIn();
    } catch (error) {
      status.textContent = error.message;
      save.disabled = false;
    }
  });
  if (required) dialog.addEventListener("cancel", (e) => e.preventDefault());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  current.focus();
}
function signedIn() {
  lastWorkedOrder = null;
  pageHistory = [];
  historyIndex = -1;
  $("#login-screen").hidden = true;
  if (user.must_change_password) {
    openPasswordChange(true);
    return;
  }
  $("#session-header").hidden = false;
  $("#workspace").hidden = false;
  onlyMine = user.role === "mesero";
  activeWaiter = user.waiter_id;
  view = ["admin", "supervisor", "mesero"].includes(user.role)
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
  const stations = activeStations().map((s) => s.code);
  if (user.role === "admin")
    return [
      "mesas",
      ...stations,
      "caja",
      "historial",
      "auditoria",
      "configuracion",
      "meseros",
      "usuarios",
    ];
  if (user.role === "mesero") return ["mesas", ...stations, "caja"];
  if (user.role === "supervisor") return ["mesas", ...stations, "caja", "historial"];
  if (user.role === "auditor") return ["caja", "historial", "auditoria"];
  if (user.role === "caja") return ["caja", "historial"];
  if (user.role === "estacion") return user.stations;
  return [user.role];
}
const areaNames = {
  mesas: "Mesas",
  cocina: "Cocina",
  bar: "Bar",
  caja: "LSoft · Caja",
  historial: "Operaciones cerradas",
  auditoria: "Auditoría",
  configuracion: "Configuración",
  meseros: "Equipo de meseros",
  usuarios: "Usuarios y permisos",
};
function areaName(code) {
  return state.stations.find((s) => s.code === code)?.name || areaNames[code] || code;
}
function activeStations() {
  const rank = (code) => code === "cocina" ? 0 : code === "bar" ? 1 : 2;
  return state.stations.filter((s) => s.active).sort((a,b) => rank(a.code)-rank(b.code) || a.name.localeCompare(b.name));
}
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
      ? user.stations.map(areaName).join(" / ") || roles.estacion
      : roles[user.role]),
    button("Cambiar contraseña", () => {
      chip.open = false;
      openPasswordChange();
    }),
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
    const b = button(areaName(area), () => navigate(area));
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
  if (view !== "precuenta" && !areas().includes(view))
    view = areas()[0] || "sin-estacion";
  document
    .querySelectorAll("dialog[data-order-detail]")
    .forEach((d) => d.remove());
  const content = $("#content");
  content.replaceChildren();
  const o = state.orders.find((o) => o.id === selected) ??
    (pendingTable?.id === selected ? pendingTable : null);
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
  } else if (state.stations.some((s) => s.code === view && s.active))
    renderPreparation(page(content, view + "-screen"));
  else if (view === "caja") renderCash(page(content, "caja-screen"));
  else if (view === "historial")
    renderHistory(page(content, "historial-screen"));
  else if (view === "auditoria") renderAudit(page(content, "auditoria-screen"));
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
  for (const area of [...activeStations().map((s) => s.code), "caja"].filter((a) =>
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
          : `${areaName(area)} · ${r.preparing} pendientes · ${r.ready} por retirar`,
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
      else {
        pendingTable = {
          id: "pending-table-" + table, pending: true, table_number: table,
          waiter_id: activeWaiter, status: "open", version: 0, items: [], accounts: [],
        };
        menus.delete(pendingTable.id);
        createdOrders.delete(pendingTable.id);
        navigate("mesas", pendingTable.id);
      }
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
            : table ? "Ocupada · Sin pedido" : "Sin productos",
    ),
  );
  if (r.draft && (r.ready || r.preparing))
    b.append(el("small", `${r.draft} sin enviar a preparación`));
  if (o?.waiter_id) {
    b.append(waiterBadge(o));
  }
  if (o?.status === "bill_requested")
    b.append(el("small", o.items.length && o.items.every((i) => o.accounts.some((a) => a.number === i.account && a.lsoft?.json)) ? "Enviada a LSoft · Pendiente de liberar" : "Cuenta pedida", { class: "table-label" }));
  if (o && !table && !o.items.length && editableOrder(o)) {
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
  if (["admin", "supervisor"].includes(user.role))
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
  if (!o.pending) lastWorkedOrder = o.id;
  const m = menu(o),
    editable = editableOrder(o),
    header = el("div", null, { class: "order-header" });
  header.append(heading(confirming ? "Confirmar Orden" : orderTitle(o)));
  if (!confirming && o.table_number && editable) {
    if (o.pending || !o.occupied_explicitly)
      header.append(button("Ocupar mesa", () => action(o, "occupy"), o.items.length > 0 || o.status !== "open"));
    if (!o.pending && !o.items.length)
      header.append(button("Liberar mesa", () => action(o, "release")));
    if (o.occupied_explicitly && !o.items.length)
      header.append(el("p", "Ocupada · Sin pedido"));
  }
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
    if (["admin", "supervisor"].includes(user.role) && !o.accounts.some((a) => a.lsoft?.json))
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
    else if (["admin", "supervisor"].includes(user.role))
      header.append(el("small", "Mesero: " + waiterName(o.waiter_id)));
  }
  const freeTables = state.tables.filter((t) => !state.orders.some((other) => other.table_number === t.number));
  if (!confirming && !o.pending && o.table_number && editable && freeTables.length) {
    const transfer = select("Cambiar a mesa ", [["", "—"], ...freeTables.map((t) => [t.number, `Mesa ${t.number}`])], "",
      (v) => v && action(o, "transfer", { tableNumber: Number(v) }));
    transfer.querySelector("select").id = "cambiar-mesa";
    header.append(transfer);
  }
  content.append(header);
  if (!confirming) renderRelease(content, o);
  const layout = el("div", null, { class: "order-content" });
  if (!confirming) {
    const selection = el("div", null, { class: "selection-area" });
    if (mayPickup() && summaryOf(o).ready > 0)
      selection.append(pickupAllButton(o));
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
  if (!confirming) renderVoids(summary, o);
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
              version: latest(o).version,
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
              version: latest(o).version,
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
    if (!o.pending && mayAudit()) summary.append(button("Ver bitácora", () => openEvents(o)));
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
    button(
      "Enviar a Preparación",
      () =>
        run(async () => {
          await api(`/orders/${o.id}/actions`, {
            action: "send",
            version: latest(o).version,
          });
          showOrderSent();
        }),
      !editableOrder(o) || !o.items.some((i) => i.status === "draft"),
    ),
    button(
      o.status === "bill_requested" ? "Ver precuenta" : "Pedir Cuenta",
      () => openBill(o),
      !(mayBill(o) || user?.role === "mesero") ||
        !o.items.length ||
        o.items.some((i) => i.status === "draft"),
    ),
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
            if ($("#cuentas") && !$("#cuentas").reportValidity()) return;
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
            const account = m.account;
            action(o, "edit", (current) => {
              const item = [...current.items].reverse().find(
                (i) => i.product_id === p.id && i.account === account && i.status === "draft",
              );
              if (!item) return null;
              return item.quantity === 1
                ? { action: "remove", itemId: item.id }
                : { itemId: item.id, quantity: item.quantity - 1, note: item.note };
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
    if (area && i.note_changed_at) li.append(el("small", "Nota modificada", { class: "note-changed" }));
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
      const controls = el("div", null, { class: "quantity-controls" }),
        change = (step) => (current) => {
          const item = current.items.find((item) => item.id === i.id && item.status === "draft");
          if (!item || item.quantity + step < 1 || item.quantity + step > 999) return null;
          return { itemId: item.id, quantity: item.quantity + step, note: item.note };
        };
      controls.append(
        button("−", () => action(o, "edit", change(-1)), i.quantity <= 1),
        el("span", String(i.quantity)),
        button("+", () => action(o, "edit", change(1)), i.quantity >= 999),
      );
      li.append(
        controls,
        button("Nota", () => editNote(o, i)),
        button("Quitar", () => action(o, "remove", (current) =>
          current.items.some((item) => item.id === i.id) ? { itemId: i.id } : null)),
      );
    }
    if (!area && i.status !== "draft" && mayCorrect(o, i)) {
      const corrections = el("div", null, { class: "item-corrections" });
      if (i.status === "preparing") corrections.append(button("Nota", () => editNote(o, i)));
      corrections.append(button("Mover", () => openMove(o, i)));
      if (mayVoid(o, i))
        corrections.append(button("Anular", () => openVoid(o, i), false, "pickup-button void-button"));
      li.append(corrections);
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
      // A product already sent keeps its quantity; the station sees the new note.
      await api(`/orders/${current.id}/actions`, {
        action: item.status === "draft" ? "edit" : "note",
        version: current.version,
        itemId: item.id,
        ...(item.status === "draft" ? { quantity: item.quantity } : {}),
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
      "Órdenes en " + areaName(view),
      view === "cocina" ? "utensils" : "glass-cheers",
    ),
  );
  const cards = el("div", null, { class: "cocina-list", id: view + "-list" }),
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
    const notices = (o.voids || []).filter((v) => v.area === view && !v.acknowledged_at);
    if (!items.some((i) => remaining(i) > 0) && !notices.length) continue;
    const card = el("section", null, { class: "cocina-item" });
    card.append(stationOrderHeading(o));
    for (const v of notices) {
      const notice = el("div", null, { class: "void-notice", role: "status" });
      notice.append(
        el("strong", `ANULADO · ${v.quantity} × ${v.product_name}`),
        el("small", `Cuenta ${v.account} · ${v.reason}`),
      );
      if (mayPrepare(view))
        notice.append(button("Enterado", () => action(o, "void_seen", { voidId: Number(v.id) })));
      card.append(notice);
    }
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
  const identification = form.elements.namedItem("identification");
  const lookupStatus = el("p", "", { role: "status" });
  form.append(lookupStatus);
  let lookupTimer, lookupSequence = 0;
  identification.addEventListener("input", () => {
    clearTimeout(lookupTimer);
    const sequence = ++lookupSequence;
    const value = identification.value.trim();
    lookupStatus.textContent = "";
    if (!value || locked || ["mesero", "supervisor"].includes(user.role)) return;
    lookupTimer = setTimeout(async () => {
      try {
        const result = await api(`/customers?identification=${encodeURIComponent(value)}`);
        if (sequence !== lookupSequence || !form.isConnected || identification.value.trim() !== value) return;
        if (result.customer) {
          for (const key of ["name", "address", "phone", "email"])
            form.elements.namedItem(key).value = result.customer[key] || "";
          lookupStatus.textContent = "Datos del cliente recuperados. Puedes revisarlos y corregirlos.";
        } else lookupStatus.textContent = "Cliente sin registro previo. Ingresa sus datos.";
      } catch {
        if (sequence === lookupSequence && form.isConnected)
          lookupStatus.textContent = "No se pudo consultar el cliente. Puedes ingresar sus datos manualmente.";
      }
    }, 350);
  });
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
        version: latest(o).version,
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
  if (!["mesero", "supervisor"].includes(user.role)) content.append(form);
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
    ["bill_delivered", "Precuenta entregada al cliente", ["mesero", "supervisor", "admin"]],
    ["collected", "Cobrado con Datafast · precuenta firmada y voucher recogidos", ["mesero", "supervisor", "admin"]],
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
  if (!["mesero", "supervisor"].includes(user.role) && mayBill(o) && response)
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
        button(["mesero", "supervisor"].includes(user.role) ? "Ver precuenta" : "Registrar datos del papel / facturar", () => {
          billingAccount = a.number;
          navigate("precuenta", o.id);
        }),
      );
      card.append(accountCard);
    }
    const unsent = accounts.some((a) => !a.lsoft?.json),
      pending = o.items.some((i) => i.status !== "ready");
    renderRelease(card, o);
    if (mayAudit()) card.append(button("Ver bitácora", () => openEvents(o)));
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
  if (["admin", "supervisor", "caja", "auditor"].includes(user.role))
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
      view = ["admin", "supervisor", "mesero"].includes(user.role) ? "mesas" : "caja";
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
          version: latest(o).version,
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
      renderVoids(card, o);
      for (const a of o.accounts) {
        card.append(
          el("h4", `Cuenta ${a.number} · ${a.customer.name || "Sin datos"}`),
        );
        consumption(card, o, a.number, a.tip_cents);
        card.append(
          el("pre", JSON.stringify(a.lsoft, null, 2), { class: "lsoft-json" }),
        );
      }
      const log = el("details");
      log.append(el("summary", `Bitácora (${o.events.length})`), eventTable(o.events));
      card.append(log);
      content.append(card);
    }
    if (!orders.length)
      content.append(el("p", "Todavía no hay pedidos cerrados."));
  } catch (e) {
    message(e.message, true);
  }
}
function renderVoids(content, o) {
  if (!o.voids?.length) return;
  const section = el("div", null, { class: "void-list" });
  section.append(el("p", "Anulados", { class: "collection-title" }));
  for (const v of o.voids)
    section.append(el("p",
      `${v.quantity} × ${v.product_name} · Cuenta ${v.account} · ${money(amounts(v.tariff, v.quantity).total)} · ${v.reason} · ${v.username}, ${new Date(v.voided_at).toLocaleTimeString()}`));
  content.append(section);
}
function correctionDialog(title, submitLabel) {
  const dialog = el("dialog", null, { class: "note-dialog correction-dialog", "aria-label": title }),
    form = el("form"),
    footer = el("div", null, { class: "footer" });
  form.append(el("h3", title));
  footer.append(el("button", submitLabel, { type: "submit" }), button("Cancelar", () => dialog.close()));
  dialog.addEventListener("close", () => dialog.remove());
  dialog.append(form);
  return { dialog, form, footer };
}
function quantityField(form, id, i) {
  return labeled(form, `Cantidad (de ${i.quantity})`, el("input", null, {
    id, type: "number", min: "1", max: String(i.quantity), step: "1", value: String(i.quantity), required: "",
  }));
}
function openVoid(o, i) {
  const { dialog, form, footer } = correctionDialog(`Anular ${i.product_name} · Cuenta ${i.account}`, "Anular"),
    quantity = quantityField(form, "void-quantity", i),
    reasons = ["Error al tomar el pedido", "El cliente cambió de opinión", "Producto agotado",
      "Demora en la preparación", "Producto devuelto", "Otro motivo"],
    reason = select("Motivo ", reasons.map((r) => [r, r]), reasons[0]),
    reasonInput = reason.querySelector("select");
  reasonInput.id = "void-reason";
  form.append(reason);
  const detail = labeled(form, "Detalle", el("input", null, { id: "void-detail", type: "text", maxlength: "120" }));
  reasonInput.addEventListener("change", () => (detail.required = reasonInput.value === "Otro motivo"));
  if (i.status === "ready" || i.picked_up_quantity)
    form.append(el("p", i.picked_up_quantity
      ? `Este producto ya fue preparado y ${i.picked_up_quantity} se retiraron. La anulación lo quita de la cuenta.`
      : "Este producto ya fue preparado. La anulación lo quita de la cuenta.", { class: "consumption-notice" }));
  else form.append(el("p", "La estación verá el aviso de anulación.", { class: "menu-help" }));
  form.append(footer);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const text = detail.value.trim(),
      motive = reasonInput.value === "Otro motivo" ? text : reasonInput.value + (text ? ": " + text : "");
    run(async () => {
      await api(`/orders/${o.id}/actions`, {
        action: "void", version: latest(o).version, itemId: i.id,
        quantity: Number(quantity.value), reason: motive,
      });
      dialog.close();
    });
  });
  document.body.append(dialog);
  dialog.showModal();
}
function openMove(o, i) {
  const { dialog, form, footer } = correctionDialog(`Mover ${i.product_name} · Cuenta ${i.account}`, "Mover"),
    quantity = quantityField(form, "move-quantity", i),
    account = labeled(form, "Cuenta de destino", el("input", null, {
      id: "move-account", type: "number", min: "1", max: "99", step: "1", required: "",
      value: String(i.account === 1 ? 2 : 1),
    }));
  form.append(footer);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    run(async () => {
      await api(`/orders/${o.id}/actions`, {
        action: "move", version: latest(o).version, itemId: i.id,
        quantity: Number(quantity.value), toAccount: Number(account.value),
      });
      dialog.close();
    });
  });
  document.body.append(dialog);
  dialog.showModal();
}
function describeEvent(e) {
  const d = e.details || {},
    q = (x) => `${x.quantity} × ${x.product}`,
    list = (items) => (items?.length ? ": " + items.map(q).join(", ") : ""),
    account = d.account ? ` · Cuenta ${d.account}` : "";
  switch (e.action) {
    case "created": return "Abrió el pedido" + (d.product ? ` con ${q(d)}` : "");
    case "add": return d.product ? `Añadió ${q(d)}${account}${d.note ? " · Nota: " + d.note : ""}` : "Añadió un producto";
    case "edit": return d.product
      ? `Modificó ${d.product} sin enviar${account}: cantidad ${d.from.quantity} → ${d.to.quantity}` +
        (d.from.note !== d.to.note ? ` · nota «${d.from.note}» → «${d.to.note}»` : "")
      : "Modificó un producto";
    case "remove": return d.product ? `Quitó ${q(d)} sin enviar${account}` : "Quitó un producto";
    case "send": return "Envió a preparación" + list(d.items);
    case "ready": return d.product ? `${d.ready ? "Marcó preparado" : "Desmarcó preparado"}: ${q(d)}${account}` : "Cambió la preparación";
    case "pickup": return d.product ? `Retiró ${q(d)}${account}` : "Retiró productos";
    case "pickup_all": return "Retiró todo lo listo" + list(d.items);
    case "void": return `ANULÓ ${q(d)}${account} · ${money(d.cents)} · Motivo: ${d.reason}` +
      (d.picked_up ? ` · ${d.picked_up} ya retirados` : d.status === "ready" ? " · ya preparado" : "");
    case "void_seen": return `La estación confirmó la anulación de ${q(d)}`;
    case "note": return `Cambió la nota de ${d.product}${account}: «${d.from}» → «${d.to}»`;
    case "move": return `Movió ${q(d)} de Cuenta ${d.from} a Cuenta ${d.to}`;
    case "transfer": return `Cambió de Mesa ${d.from} a Mesa ${d.to}`;
    case "assign": return "Reasignó el mesero" + (d.to ? `: ${d.from ?? "Sin asignar"} → ${d.to}` : "");
    case "account": return `Actualizó los datos de la cuenta${account}`;
    case "bill": return "Pidió la cuenta";
    case "send_lsoft": return `${d.retry ? "Reintentó el envío" : "Envió la cuenta"} a LSoft${account}` + (d.cents !== undefined ? ` · ${money(d.cents)}` : "");
    case "pay": return `Registró el pago${account}` + (d.method ? ` · ${d.method}` : "");
    case "bill_delivered": return `Entregó la precuenta${account}`;
    case "collected": return `Confirmó el cobro${account}`;
    case "documents_received": return `Caja recibió precuenta y voucher${account}`;
    case "close": return "Cerró el pedido";
    case "new_consumption": return "Archivó la cuenta y abrió un nuevo consumo";
    case "occupy": return "Ocupó la mesa";
    case "release": return d.automatic ? "Mesa liberada al quedar sin productos" : "Liberó la mesa";
    case "delete_empty": return "Cerró el pedido vacío";
    case "login": return "Inició sesión";
    case "login_failed": return "Intento de ingreso con contraseña incorrecta";
    case "password_changed": return "Cambió su contraseña";
    case "user_created": return `Creó el usuario ${d.username} (${roles[d.role] || d.role})`;
    case "password_reset": return `Restableció la contraseña de ${d.username}`;
    case "user_activated": return `Reactivó el usuario ${d.username}`;
    case "user_deactivated": return `Desactivó el usuario ${d.username}`;
    case "station_created": return `Creó la estación ${d.name}`;
    case "station_changed": return `Modificó la estación ${d.name} (${d.active ? "activa" : "inactiva"})`;
    case "products_station": return `Asignó ${d.products} productos a la estación ${areaName(d.station)}`;
    case "user_stations": return `Cambió las estaciones de ${userName(d.user)}: ${d.stations.map(areaName).join(", ") || "ninguna"}`;
    case "user_waiter": return `Vinculó a ${userName(d.user)} con el mesero ${d.waiter}`;
    case "user_role": return `Cambió el rol de ${userName(d.user)} a ${roles[d.role] || d.role}`;
    case "config_changed": return "Cambió la configuración: " + ([
      ...["iva", "servicio", "incluidos"].filter((k) => d[k]).map((k) => `${k} ${d[k].from} → ${d[k].to}`),
      ...Object.entries(d.precios || {}).map(([name, p]) => `${name} ${p.from === null ? "predeterminado" : money(p.from)} → ${money(p.to)}`),
    ].join(" · ") || "sin diferencias");
    case "product_help": return `Editó la ficha de ${state.products.find((p) => p.id === d.product)?.name || "un producto"}`;
    case "waiters_changed": return `Actualizó el equipo de meseros: ${d.names.join(", ")}`;
    case "order_deleted": return `Eliminó el pedido para llevar ${d.number}, vacío`;
    default: return e.action;
  }
}
function userName(id) {
  return state.users?.find((u) => u.id === id)?.username || "un usuario";
}
function eventTable(events, withOrder = false) {
  const table = el("table", null, { class: "consumption-table audit-table" }),
    head = el("tr"),
    body = el("tbody");
  for (const title of ["Fecha", "Usuario", ...(withOrder ? ["Pedido"] : []), "Registro"])
    head.append(el("th", title, { scope: "col" }));
  for (const e of events) {
    const row = el("tr", null, e.action === "void" ? { class: "audit-void" } : {});
    row.append(el("td", new Date(e.created_at).toLocaleString()), el("td", e.username));
    if (withOrder)
      row.append(el("td", e.scope !== "pedido" ? "—"
        : e.table_number ? `Mesa ${e.table_number} · N.º ${e.order_number}` : `Para llevar ${e.order_number}`));
    row.append(el("td", describeEvent(e)));
    body.append(row);
  }
  if (!events.length) {
    const row = el("tr");
    row.append(el("td", "Sin registros.", { colspan: withOrder ? "4" : "3" }));
    body.append(row);
  }
  const wrapper = el("div", null, { class: "audit-scroll" });
  table.append(el("thead"), body);
  table.querySelector("thead").append(head);
  wrapper.append(table);
  return wrapper;
}
async function openEvents(o) {
  const dialog = el("dialog", null, { class: "note-dialog events-dialog", "aria-label": "Bitácora de " + orderTitle(o) }),
    header = el("div", null, { class: "summary-heading" }),
    close = button("✕", () => dialog.close());
  close.setAttribute("aria-label", "Cerrar bitácora");
  header.append(el("h3", "Bitácora · " + orderTitle(o)), close);
  dialog.append(header);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  try {
    dialog.append(eventTable(await api(`/orders/${o.id}/events`)));
  } catch (e) {
    dialog.append(el("p", e.message, { class: "error" }));
  }
}
let auditScope = "";
async function renderAudit(content) {
  content.append(
    heading("Auditoría"),
    el("p", "Últimos 300 registros de pedidos, anulaciones, accesos y administración. El detalle completo permanece en PostgreSQL."),
  );
  const filter = select("Mostrar ", [
    ["", "Todo"],
    ["correcciones", "Anulaciones y correcciones"],
    ["pedido", "Pedidos"],
    ["administracion", "Accesos y administración"],
  ], auditScope, (v) => {
    auditScope = v;
    render();
  });
  filter.querySelector("select").id = "audit-scope";
  content.append(filter);
  try {
    const events = await api("/audit" + (auditScope ? "?scope=" + auditScope : ""));
    if (view !== "auditoria" || !user || !content.isConnected) return;
    content.append(eventTable(events, true));
  } catch (e) {
    message(e.message, true);
  }
}
function renderConfig(content) {
  const links = el("div", null, { class: "footer" });
  links.append(button("Estaciones y productos", () => {
    document.getElementById("station-settings").scrollIntoView({ behavior: "smooth" });
  }), button("Usuarios y estaciones", () => navigate("usuarios")));
  content.append(heading("Configuración"), links);
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
  form.append(el("input", null, { id: "config-form-version", type: "hidden", value: String(settings.version) }));
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
        version: configVersion(form),
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
  renderStationSettings(content);
}
function stationConfigForm(id) {
  const form = el("form", null, { id, class: "station-settings-form" });
  form.append(el("input", null, {
    id: id + "-version", type: "hidden", value: String(state.settings.version),
  }));
  return form;
}
function configVersion(form) {
  return Number(form.querySelector('input[type="hidden"]').value);
}
function checkbox(form, label, id, checked) {
  const row = el("label", null, { class: "station-choice", for: id });
  const input = el("input", null, { type: "checkbox", id });
  input.checked = checked;
  input.addEventListener("change", () => (form.dataset.dirty = "true"));
  row.append(input, el("span", label));
  return row;
}
function submitConfiguration(form, label, save) {
  form.append(el("button", label, { type: "submit" }));
  form.append(button("Descartar cambios", () => {
    delete form.dataset.dirty;
    render();
  }));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    run(async () => {
      await save();
      delete form.dataset.dirty;
    });
  });
}
function renderStationSettings(content) {
  const section = el("section", null, { id: "station-settings" });
  section.append(heading("Estaciones"), el("p",
    "Asigna productos y personas a cada estación. Los pedidos existentes conservan su destino. Para desactivar una estación, reasigna sus productos y retira los pendientes."));
  const create = stationConfigForm("station-create");
  const name = labeled(create, "Nombre de la nueva estación", el("input", null,
    { id: "station-create-name", required: "", maxlength: "60" }));
  submitConfiguration(create, "Crear estación", () => api("/stations", {
    name: name.value, version: configVersion(create),
  }));
  section.append(create);
  for (const station of state.stations) {
    const form = stationConfigForm("station-edit-" + station.code);
    const title = labeled(form, "Nombre de estación", el("input", null, {
      id: "station-name-" + station.code, value: station.name, required: "", maxlength: "60",
    }));
    const active = checkbox(form, "Estación activa", "station-active-" + station.code, station.active);
    form.append(active);
    const assigned = state.products.filter((p) => p.area === station.code).length;
    form.append(el("p", `${assigned} productos asignados`));
    submitConfiguration(form, "Guardar estación", () => api(`/stations/${station.code}`, {
      name: title.value, active: active.querySelector("input").checked, version: configVersion(form),
    }));
    section.append(form);
  }
  section.append(heading("Asignar productos"), el("p", "Selecciona los productos y la estación que recibirá los nuevos pedidos."));
  const products = stationConfigForm("station-products");
  const destination = select("Estación de destino ", state.stations.filter((s) => s.active).map((s) => [s.code,s.name]), null);
  const destinationInput = destination.querySelector("select");
  destinationInput.id = "station-products-destination";
  destinationInput.required = true;
  destinationInput.selectedIndex = 0;
  destinationInput.addEventListener("change", () => (products.dataset.dirty = "true"));
  products.append(destination);
  for (const category of [...new Set(state.products.map((p) => p.category))]) {
    const group = el("details", null, { id: "station-products-" + category });
    group.append(el("summary", categoryNames[category] || category));
    group.append(button("Seleccionar categoría", () => {
      group.querySelectorAll('input[type="checkbox"]').forEach((input) => (input.checked = true));
      products.dataset.dirty = "true";
    }));
    for (const p of state.products.filter((p) => p.category === category)) {
      const field = checkbox(products, `${p.name} · ${areaName(p.area)}`, "station-product-" + p.id, false);
      field.querySelector("input").value = p.id;
      group.append(field);
    }
    products.append(group);
  }
  submitConfiguration(products, "Asignar productos seleccionados", () => api("/products/station", {
    stationCode: destinationInput.value,
    productIds: [...products.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value),
    version: configVersion(products),
  }));
  section.append(products);
  content.append(section);
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
function renderUsers(content) {
  content.append(
    heading("Usuarios y permisos"),
    el(
      "p",
      "Cada persona define su contraseña al entrar por primera vez con la contraseña temporal que le entregues. Restablecerla o desactivar la cuenta cierra sus sesiones.",
    ),
  );
  try {
    const users = state.users || [];
    if (view !== "usuarios" || !user) return;
    renderUserCreate(content);
    for (const u of users) {
      const card = el("section", null, { class: "client-info" });
      card.append(
        el(
          "strong",
          u.username + " · " + roles[u.role] + (u.active ? "" : " · Inactivo") +
            (u.must_change_password ? " · Contraseña temporal" : ""),
        ),
      );
      if (u.id !== user.id) {
        const access = el("div", null, { class: "footer" });
        access.append(
          button("Restablecer contraseña", () => openPasswordReset(u)),
          button(u.active ? "Desactivar usuario" : "Reactivar usuario", () =>
            run(() => api(`/users/${u.id}/active`, { active: !u.active }))),
        );
        card.append(access);
      }
      if (["mesero", "supervisor"].includes(u.role))
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
      if (["mesero", "supervisor"].includes(u.role)) {
        const roleForm = stationConfigForm("user-role-" + u.id);
        const choice = select("Rol en el salón ", [["mesero", "Mesero"], ["supervisor", "Supervisor"]], u.role);
        const input = choice.querySelector("select");
        input.id = "user-role-choice-" + u.id;
        input.addEventListener("change", () => (roleForm.dataset.dirty = "true"));
        roleForm.append(choice);
        submitConfiguration(roleForm, "Guardar rol", () => api(`/users/${u.id}/role`, {
          role: input.value, version: configVersion(roleForm),
        }));
        card.append(roleForm);
      }
      const assignments = stationConfigForm("user-stations-" + u.id);
      assignments.append(el("p", "Estaciones de preparación"));
      for (const station of state.stations) {
        const field = checkbox(assignments, station.name + (station.active ? "" : " · Inactiva"),
          "user-station-" + u.id + "-" + station.code, u.stations.includes(station.code));
        field.querySelector("input").value = station.code;
        assignments.append(field);
      }
      if (u.role === "admin") assignments.append(el("p", "El administrador puede operar todas las estaciones activas."));
      submitConfiguration(assignments, "Guardar estaciones", () => api(`/users/${u.id}/stations`, {
        stations: [...assignments.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value),
        version: configVersion(assignments),
      }));
      card.append(assignments);
      content.append(card);
    }
  } catch (e) {
    message(e.message, true);
  }
}
function renderUserCreate(content) {
  const form = el("form", null, { id: "user-create", class: "client-info" });
  form.append(el("strong", "Nuevo usuario"));
  const username = labeled(form, "Usuario", el("input", null, {
      id: "user-create-username", required: "", maxlength: "40", autocomplete: "off",
      autocapitalize: "none", pattern: "[a-z0-9][a-z0-9._\\-]{2,39}",
      title: "De 3 a 40 letras minúsculas, números, puntos o guiones",
    })),
    role = select("Rol ", ["mesero", "supervisor", "estacion", "caja", "auditor", "admin"].map((r) => [r, roles[r]]), "mesero"),
    waiter = select("Mesero vinculado ", [["", "Sin vincular"], ...state.waiters.filter((w) => w.active).map((w) => [w.id, w.name])], ""),
    roleInput = role.querySelector("select"),
    waiterInput = waiter.querySelector("select");
  roleInput.id = "user-create-role";
  waiterInput.id = "user-create-waiter";
  const linkable = () => {
    waiter.hidden = !["mesero", "supervisor"].includes(roleInput.value);
    waiterInput.required = roleInput.value === "mesero";
  };
  for (const input of [roleInput, waiterInput])
    input.addEventListener("change", () => {
      form.dataset.dirty = "true";
      linkable();
    });
  form.append(role, waiter);
  const password = labeled(form, "Contraseña temporal (mínimo 8 caracteres)", el("input", null, {
    id: "user-create-password", type: "text", required: "", minlength: "8", maxlength: "256", autocomplete: "off",
  }));
  form.append(el("button", "Crear usuario", { type: "submit" }));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    linkable();
    if (!form.reportValidity()) return;
    run(async () => {
      await api("/users", {
        username: username.value, role: roleInput.value, password: password.value,
        waiterId: waiter.hidden || !waiterInput.value ? null : waiterInput.value,
      });
      delete form.dataset.dirty;
    });
  });
  content.append(form);
  // Restored selections are applied after rendering; keep the linked waiter in step.
  queueMicrotask(linkable);
  linkable();
}
function openPasswordReset(u) {
  const dialog = el("dialog", null, { class: "note-dialog password-dialog", "aria-labelledby": "reset-title" }),
    form = el("form"),
    status = el("p", "", { role: "status", class: "error" }),
    footer = el("div", null, { class: "footer" }),
    save = el("button", "Restablecer", { type: "submit" });
  form.append(
    el("h3", `Restablecer contraseña de ${u.username}`, { id: "reset-title" }),
    el("p", "Entrega esta contraseña temporal a la persona. Deberá cambiarla al entrar y se cerrarán sus sesiones abiertas."),
  );
  const password = labeled(form, "Contraseña temporal (mínimo 8 caracteres)", el("input", null, {
    id: "reset-password", type: "text", required: "", minlength: "8", maxlength: "256", autocomplete: "off",
  }));
  footer.append(save, button("Cancelar", () => dialog.close()));
  form.append(status, footer);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    save.disabled = true;
    try {
      await api(`/users/${u.id}/password`, { password: password.value });
      dialog.close();
      message("Contraseña restablecida.");
      refresh();
    } catch (error) {
      status.textContent = error.message;
      save.disabled = false;
    }
  });
  dialog.addEventListener("close", () => dialog.remove());
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  password.focus();
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
