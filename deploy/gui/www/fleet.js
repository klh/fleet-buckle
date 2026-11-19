// fleet.js — fleet page: vanilla DOM, no frameworks. Layers are
// registered in LAYERS; each maps the /api/fleet/board payload to rows.
// Poll v1; upgrades to SSE (/api/fleet/watch) which triggers refetch.
const LAYERS = [];
export function registerLayer(layer) {
  LAYERS.push(layer);
}
const list = (board, ...keys) => {
  for (const k of keys) if (Array.isArray(board?.[k])) return board[k];
  return [];
};
registerLayer({ id: "tasks", title: "Tasks", rows: (b) => list(b, "tasks") });
registerLayer({ id: "lanes", title: "Lanes", rows: (b) => list(b, "lanes", "workers") });
registerLayer({
  id: "health",
  title: "Health",
  rows: (b) => (b?.health && typeof b.health === "object" ? Object.entries(b.health).map(([k, v]) => ({ check: k, status: v })) : list(b, "health")),
});

const root = document.getElementById("fleet");
const cell = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""));

function renderLayer(layer, board) {
  const sec = document.createElement("section");
  const h = document.createElement("h2");
  h.textContent = layer.title;
  sec.append(h);
  const rows = layer.rows(board);
  if (rows.length === 0) {
    const p = document.createElement("p");
    p.textContent = "none";
    sec.append(p);
    return sec;
  }
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  for (const c of cols) head.insertCell().textContent = c;
  const body = table.createTBody();
  for (const r of rows) {
    const tr = body.insertRow();
    for (const c of cols) tr.insertCell().textContent = cell(r[c]);
  }
  sec.append(table);
  return sec;
}

async function refresh() {
  try {
    const res = await fetch("/api/fleet/board");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const board = await res.json();
    root.replaceChildren(...LAYERS.map((l) => renderLayer(l, board)));
  } catch (err) {
    const p = document.createElement("p");
    p.textContent = `fleet unavailable: ${err.message}`;
    root.replaceChildren(p);
  }
}

let timer = null;
let es = null;
function start() {
  void refresh();
  timer = setInterval(refresh, 5000);
  if (typeof EventSource === "function") {
    es = new EventSource("/api/fleet/watch");
    es.onmessage = () => void refresh();
    es.onerror = () => {}; // polling keeps running; EventSource auto-reconnects
  }
}
function stop() {
  clearInterval(timer);
  es?.close();
  es = null;
}
function route() {
  const on = location.hash === "#/fleet";
  root.hidden = !on;
  document.querySelector("buckle-console").hidden = on;
  stop();
  if (on) start();
}
addEventListener("hashchange", route);
route();
