"use strict";
const WIZ = "hr.timesheet.stop.timer.confirmation.wizard";
const $ = (s) => document.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

// --- État (tout reste dans le stockage local de l'appareil) ---
let cfg = LS.get("cfg", null);            // {url, db, login, key}
let uid = LS.get("uid", null);
let uidFresh = false;
let timers = LS.get("timers", {});        // { "model:id": {acc, start|null, it} } — survit à la fermeture de l'app
let data = LS.get("cache", { tasks: [], tickets: [], terr: null, ts: 0 });
let fold = LS.get("fold", {});
let wizF, stopKey = null;
const rowItems = new Map();

const pad = (n) => String(n).padStart(2, "0");
function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
const elapsed = (t) => t.acc + (t.start ? Date.now() - t.start : 0);
const saveTimers = () => LS.set("timers", timers);
function h(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
let tt;
function toast(msg, err) {
  const e = $("#toast");
  e.textContent = msg; e.className = "toast" + (err ? " err" : ""); e.hidden = false;
  clearTimeout(tt); tt = setTimeout(() => { e.hidden = true; }, err ? 7000 : 2500);
}
function setSt(msg, err) {
  const e = $("#st");
  e.textContent = msg || ""; e.className = "st" + (err ? " err" : ""); e.hidden = !msg;
}

// --- API Odoo (JSON-RPC, clé API, sans cookies) ---
async function rpc(base, params) {
  const r = await fetch(base + "/jsonrpc", {
    method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: Date.now(), params })
  });
  if (!r.ok) throw new Error("Requête HTTP échouée (" + r.status + ")");
  const d = await r.json();
  if (d.error) throw new Error(d.error.data?.message || d.error.message || "Erreur Odoo");
  return d.result;
}
async function auth() {
  uid = await rpc(cfg.url, { service: "common", method: "authenticate", args: [cfg.db, cfg.login, cfg.key, {}] });
  if (!uid) throw new Error("Authentification échouée : vérifiez base, identifiant et clé API.");
  uidFresh = true; LS.set("uid", uid);
}
async function call(model, method, args, kw = {}) {
  if (!cfg) throw new Error("Connexion non configurée (⚙).");
  if (!uid) await auth();
  const run = () => rpc(cfg.url, { service: "object", method: "execute_kw", args: [cfg.db, uid, cfg.key, model, method, args, kw] });
  try { return await run(); }
  catch (e) {
    // uid en cache périmé : on se ré-authentifie une seule fois (jamais pour une erreur métier)
    if (!uidFresh && /access ?denied/i.test(e.message)) { await auth(); return run(); }
    throw e;
  }
}

// --- Chronos ---
function startT(k) { timers[k] = { acc: 0, start: Date.now(), it: rowItems.get(k) }; saveTimers(); render(); }
function pauseT(k) { const t = timers[k]; t.acc = elapsed(t); t.start = null; saveTimers(); render(); }
function resumeT(k) { timers[k].start = Date.now(); saveTimers(); render(); }
function adj(k, d) {
  const t = timers[k], run = t.start ? Date.now() - t.start : 0;
  t.acc = Math.max(0, t.acc + run + d) - run;
  saveTimers(); tick();
}
function openRec(k) {
  const it = rowItems.get(k);
  if (it) window.open(`${cfg.url}/web#id=${it.id}&model=${it.model}&view_type=form`, "_blank", "noopener");
}

// --- Rendu ---
function row(it) {
  const k = it.model + ":" + it.id, t = timers[k];
  rowItems.set(k, it);
  const r = h("div", "row" + (t ? " active" : ""));
  r.dataset.k = k;
  r.append(h("div", "title", it.name));
  if (it.sub) r.append(h("div", "sub", it.sub));
  const L = h("div", "ctl"), R = h("div", "ctl"), line = h("div", "line");
  const btn = (cls, txt, act, label) => {
    const b = h("button", "b " + cls, txt);
    b.dataset.act = act; b.setAttribute("aria-label", label); return b;
  };
  if (t) {
    const tm = h("span", "time", fmt(elapsed(t)));
    tm.dataset.tk = k;
    L.append(btn("sm", "−1", "m1", "Retirer une minute"), tm, btn("sm", "+1", "p1", "Ajouter une minute"));
    R.append(t.start ? btn("pause", "⏸", "pause", "Mettre en pause") : btn("play", "▶", "resume", "Reprendre"),
             btn("stop", "⏹", "stop", "Arrêter"));
  } else {
    R.append(btn("play", "▶", "start", "Démarrer"));
  }
  R.append(btn("open", "↗", "open", "Ouvrir dans Odoo"));
  line.append(L, R);
  r.append(line);
  return r;
}

function render() {
  const q = $("#q").value.trim().toLowerCase();
  const box = $("#list");
  box.replaceChildren();
  const match = (it) => !q || (it.name + " " + (it.sub || "") + " " + (it.grp || "")).toLowerCase().includes(q);
  const key = (it) => it.model + ":" + it.id;

  function section(title, list, id, always) {
    const f = list.filter(match);
    if (!f.length) return;
    const s = h("div", "sec");
    const hd = h("button", "sech", (fold[id] && !always ? "▸ " : "▾ ") + title + " (" + f.length + ")");
    if (!always) { hd.dataset.act = "fold"; hd.dataset.s = id; }
    s.append(hd);
    if (always || !fold[id] || q) {
      const groups = new Map();
      f.forEach((it) => { const g = it.grp || ""; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it); });
      [...groups.keys()].sort((a, b) => a.localeCompare(b, "fr")).forEach((g) => {
        if (g) s.append(h("div", "grp", g));
        groups.get(g).forEach((it) => s.append(row(it)));
      });
    }
    box.append(s);
  }

  const active = Object.values(timers).map((t) => t.it).filter(Boolean);
  section("En cours", active, "act", true);
  section("Tâches projet", data.tasks.filter((it) => !timers[key(it)]), "tasks");
  section("Tickets Helpdesk", data.tickets.filter((it) => !timers[key(it)]), "tickets");
  if (data.terr) box.append(h("div", "st", "Tickets non chargés : " + data.terr));
  if (!box.children.length) box.append(h("div", "st", cfg ? "Aucune tâche ni ticket ouvert." : "Ouvrez les réglages (⚙) pour configurer la connexion Odoo."));

  const n = Object.keys(timers).length;
  $("#badge").textContent = n; $("#badge").hidden = !n;
}

function tick() {
  document.querySelectorAll("[data-tk]").forEach((e) => {
    const t = timers[e.dataset.tk];
    if (t) e.textContent = fmt(elapsed(t));
  });
}

// --- Chargement ---
async function load() {
  if (!cfg) { openSettings(); return; }
  setSt("Actualisation…");
  try {
    if (!uid) await auth();
    const tasks = await call("project.task", "search_read",
      [[["user_ids", "in", [uid]], ["state", "not in", ["1_done", "1_canceled"]]]],
      { fields: ["id", "name", "project_id"], limit: 50, order: "write_date desc" });
    let tickets = [], terr = null;
    try {
      tickets = await call("helpdesk.ticket", "search_read",
        [[["user_id", "=", uid], ["stage_id.fold", "=", false]]],
        { fields: ["id", "name", "team_id", "stage_id"], limit: 50, order: "write_date desc" });
    } catch (e) { terr = e.message; }
    data = {
      tasks: tasks.map((t) => ({ model: "project.task", id: t.id, name: t.name, sub: "", grp: t.project_id ? t.project_id[1] : "Sans projet" })),
      tickets: tickets.map((t) => ({ model: "helpdesk.ticket", id: t.id, name: "#" + t.id + " – " + t.name, sub: t.stage_id ? t.stage_id[1] : "", grp: t.team_id ? t.team_id[1] : "Sans équipe" })),
      terr, ts: Date.now()
    };
    LS.set("cache", data);
    setSt("");
  } catch (e) { setSt(e.message, true); }
  render();
}

// --- Arrêt et enregistrement (même séquence que l'extension) ---
function askStop(k) {
  const t = timers[k];
  if (t.start) { t.acc = elapsed(t); t.start = null; saveTimers(); }
  stopKey = k;
  $("#sn").textContent = t.it.name;
  $("#sd").textContent = "Durée : " + fmt(t.acc) + " (" + (Math.round(t.acc / 36000) / 100).toString().replace(".", ",") + " h)";
  $("#cm").value = "";
  $("#sheet").hidden = false;
  render();
}
async function wizFields() {
  if (wizF !== undefined) return wizF;
  try { wizF = await call(WIZ, "fields_get", [], { attributes: ["string", "type"] }); } catch { wizF = false; }
  return wizF;
}
async function confirmStop() {
  const k = stopKey, t = timers[k];
  if (!t) return;
  const ok = $("#ok");
  ok.disabled = true;
  try {
    const hours = Math.round(t.acc / 36000) / 100;
    const comment = $("#cm").value.trim();
    const { model, id } = t.it;
    await call(model, "action_timer_start", [[id]]);
    const res = await call(model, "action_timer_stop", [[id]]);
    if (res && typeof res === "object" && res.res_model === WIZ) {
      const f = await wizFields();
      const cf = f && ["timesheet_name", "description", "name", "comment", "note", "notes", "message"].find((x) => f[x] && ["char", "text"].includes(f[x].type));
      const tf = f && (f.time_spent && f.time_spent.type === "float" ? "time_spent" : Object.keys(f).find((x) => f[x].type === "float" && /time|duration|hour|spent/i.test(x)));
      const vals = {};
      if (cf && comment) vals[cf] = comment;
      if (tf) vals[tf] = hours;
      const cr = await call(WIZ, "create", [[vals]], { context: res.context || {} });
      await call(WIZ, "action_save_timesheet", [[Array.isArray(cr) ? cr[0] : cr]]);
    } else if (res && typeof res === "object" && res.res_model) {
      toast("Confirmation Odoo inattendue (" + res.res_model + ") : vérifiez la feuille de temps dans Odoo.", true);
    }
    delete timers[k]; saveTimers();
    $("#sheet").hidden = true; stopKey = null;
    if (!(res && typeof res === "object" && res.res_model && res.res_model !== WIZ)) toast("Temps enregistré ✓");
    render();
  } catch (e) {
    toast("Échec de l'envoi : " + e.message + " — chrono conservé, réessayez.", true);
  } finally { ok.disabled = false; }
}

// --- Réglages ---
function openSettings() {
  const c = cfg || {};
  $("#fu").value = c.url || ""; $("#fd").value = c.db || ""; $("#fl").value = c.login || ""; $("#fk").value = "";
  $("#fk").placeholder = c.key ? "•••••• enregistrée (vide = conserver)" : "Clé API Odoo";
  setCs(""); $("#settings").hidden = false;
}
function setCs(msg, err) { const e = $("#cs"); e.textContent = msg; e.className = "cs" + (err ? " err" : ""); }
async function saveSettings() {
  const url = $("#fu").value.trim().replace(/\/+$/, ""), db = $("#fd").value.trim(), login = $("#fl").value.trim();
  const key = $("#fk").value.trim() || (cfg && cfg.key) || "";
  if (!/^https:\/\/[^\s/]+/.test(url)) return setCs("L'URL doit commencer par https://", true);
  if (!db || !login || !key) return setCs("Tous les champs sont requis.", true);
  const prev = cfg;
  cfg = { url, db, login, key }; uid = null; LS.del("uid");
  setCs("Connexion…");
  try {
    await auth();
    LS.set("cfg", cfg);
    setCs("Connexion réussie ✓ (uid " + uid + ")");
    $("#settings").hidden = true; load();
  } catch (e) { cfg = prev; setCs("Échec : " + e.message, true); }
}

// --- Événements ---
$("#list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) { const t = e.target.closest(".title"); if (t) t.classList.toggle("exp"); return; }
  const act = b.dataset.act;
  if (act === "fold") { fold[b.dataset.s] = !fold[b.dataset.s]; LS.set("fold", fold); return render(); }
  const k = b.closest(".row").dataset.k;
  ({ start: () => startT(k), pause: () => pauseT(k), resume: () => resumeT(k), stop: () => askStop(k),
     m1: () => adj(k, -60000), p1: () => adj(k, 60000), open: () => openRec(k) })[act]();
});
$("#q").addEventListener("input", render);
$("#rf").addEventListener("click", () => { uid = null; load(); });
$("#cfgb").addEventListener("click", openSettings);
$("#cls").addEventListener("click", () => { $("#settings").hidden = true; });
$("#sv").addEventListener("click", saveSettings);
$("#wipe").addEventListener("click", () => {
  if (confirm("Effacer la clé API, la configuration et tous les chronos de cet appareil ?")) { localStorage.clear(); location.reload(); }
});
$("#ok").addEventListener("click", confirmStop);
$("#back").addEventListener("click", () => { $("#sheet").hidden = true; stopKey = null; });
$("#drop").addEventListener("click", () => {
  if (stopKey && confirm("Abandonner ce chrono sans rien enregistrer ?")) {
    delete timers[stopKey]; saveTimers(); stopKey = null; $("#sheet").hidden = true; render();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  tick();
  if (cfg && Date.now() - (data.ts || 0) > 300000) load();
});
setInterval(() => { if (document.visibilityState === "visible") tick(); }, 1000);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render();          // affichage immédiat depuis le cache local
load();            // puis actualisation en arrière-plan
