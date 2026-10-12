'use strict';
/* =========================================================
   حاضر — نظام الحضور والغياب والمدفوعات للمدرس
   كل البيانات محفوظة محلياً في المتصفح (localStorage)
   ========================================================= */

/* ---------- Utilities ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, l = 2) => String(n).padStart(l, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const isEn = () => DB.data?.settings.lang === 'en';
const t = (s, p) => {
  let r = (isEn() && window.I18N_EN && I18N_EN[s]) || s;
  if (p) for (const k in p) r = r.split('{' + k + '}').join(p[k]);
  return r;
};
const sum = arr => arr.reduce((a, p) => a + Number(p.amount || 0), 0);
const byName = (a, b) => a.name.localeCompare(b.name, 'ar');

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = key => { const m = +key.split('-')[1]; return (isEn() ? MONTHS_EN : MONTHS_AR)[m - 1]; };
const monthLabel = key => `${monthName(key)} ${key.split('-')[0]}`;
const shiftMonth = (key, n) => { const [y, m] = key.split('-').map(Number); return monthKey(new Date(y, m - 1 + n, 1)); };
const monthRange = () => { const c = monthKey(); return Array.from({ length: 12 }, (_, i) => shiftMonth(c, i - 4)); };
const locale = () => isEn() ? 'en-GB' : 'ar-EG-u-nu-latn';
const fmtTime = ts => new Date(ts).toLocaleTimeString(isEn() ? 'en-US' : 'ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const fmtDate = ts => new Date(ts).toLocaleDateString(locale(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const fmtShortDate = ts => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
const money = n => `${(Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-US')} ${t('ج.م')}`;
const normCode = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('');
const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const waNum = p => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('0')) d = '20' + d.slice(1); else if (d.length === 10 && d.startsWith('1')) d = '20' + d; return d; };
const waLink = (p, text = '') => `https://wa.me/${waNum(p)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/* ---------- Storage ---------- */
const DB = {
  key: 'hader-db-v1',
  data: null,
  defaults() {
    return {
      settings: { teacherName: '', subject: 'الدراسات الاجتماعية', centerName: '', lang: 'ar', theme: 'dark', accent: 'marigold', prefix: 'ASMA', nextCode: 1, placeFee: 0, qrCols: 4, qrRows: 5, sound: true },
      users: [], classes: [], students: [], batches: [], sessions: [], payments: [], classFees: {}, activeSession: null
    };
  },
  load() {
    let d = null, prefs = {};
    try { d = Cloud.enabled ? null : JSON.parse(localStorage.getItem(this.key) || 'null'); } catch (e) { d = null; }
    try { prefs = JSON.parse(localStorage.getItem('hader-prefs') || '{}'); } catch (e) { prefs = {}; }
    const def = this.defaults();
    this.data = Object.assign(def, d || {});
    this.data.settings = Object.assign(this.defaults().settings, d?.settings || {}, pickPrefs(prefs));
  },
  save() {
    try { localStorage.setItem('hader-prefs', JSON.stringify(pickPrefs(this.data.settings))); } catch (e) { }
    if (Cloud.enabled) { Cloud.push(); return; }
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); }
    catch (e) { toast(t('تعذر الحفظ — مساحة التخزين ممتلئة'), 'error'); }
  }
};
const S = () => DB.data.settings;
const classById = id => DB.data.classes.find(c => c.id === id);
const studentById = id => DB.data.students.find(s => s.id === id);
const studentByCode = code => code ? DB.data.students.find(s => s.code === code) : null;
const studentsOf = cid => DB.data.students.filter(s => s.classId === cid).sort(byName);
const formatCode = (n, prefix = S().prefix) => `${prefix}-${pad(n, 4)}`;
const feeFor = cid => DB.data.classFees[cid] ?? Number(S().placeFee || 0);

/* ---------- Icons ---------- */
const svg = p => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const I = {
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
  scan: svg('<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>'),
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
  wallet: svg('<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><circle cx="16" cy="14" r="1.5"/>'),
  chart: svg('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),
  qr: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
  alert: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  camera: svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'),
  printer: svg('<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
  trash: svg('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'),
  chat: svg('<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.7A8.4 8.4 0 1 1 21 11.5z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  clock: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  stop: svg('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
  play: svg('<path d="M6 4l14 8-14 8z"/>'),
  flip: svg('<path d="M21 2v6h-6M3 22v-6h6"/><path d="M3.5 9a9 9 0 0 1 15-3.4L21 8M3 16l2.5 2.4A9 9 0 0 0 20.5 15"/>'),
  key: svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14 9l2 2"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>'),
  layers: svg('<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>'),
  calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  coins: svg('<circle cx="8" cy="8" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.3 18"/><path d="M7 6h1v4"/>'),
  globe: svg('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>'),
  shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  palette: svg('<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c1 0 1.6-.8 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2A5.6 5.6 0 0 0 22 11 10 10 0 0 0 12 2z"/>'),
  db: svg('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>'),
  keyboard: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M8 16h8"/>'),
  eye: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>')
};
const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="13" fill="var(--accent)"/><path d="M13 19v-4a2 2 0 0 1 2-2h4M29 13h4a2 2 0 0 1 2 2v4M35 29v4a2 2 0 0 1-2 2h-4M19 35h-4a2 2 0 0 1-2-2v-4" stroke="var(--on-accent)" stroke-width="3" fill="none" stroke-linecap="round"/><path d="m18 24.5 4.5 4.5 8-9" stroke="var(--on-accent)" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const ACCENTS = {
  marigold: ['#f5b335', '#1b1405'],
  teal: ['#2dd4bf', '#04201c'],
  coral: ['#ff7a5c', '#2a0d05'],
  sky: ['#5aa9ff', '#04152b'],
  rose: ['#f472b6', '#2b0618'],
  lime: ['#a3e635', '#152004']
};
const CLASS_COLORS = ['#f5b335', '#2dd4bf', '#ff7a5c', '#5aa9ff', '#f472b6', '#a3e635', '#c4a1ff', '#fb923c', '#38bdf8', '#e879f9'];

/* ---------- QR helpers ---------- */
const qrCache = new Map();
function qrMatrix(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return { n: q.getModuleCount(), dark: (r, c) => q.isDark(r, c) };
}
function qrSvg(text) {
  if (qrCache.has(text)) return qrCache.get(text);
  if (!window.qrcode) return '';
  const { n, dark } = qrMatrix(text);
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (dark(r, c)) { let e = c; while (e + 1 < n && dark(r, e + 1)) e++; d += `M${c} ${r}h${e - c + 1}v1h-${e - c + 1}z`; c = e + 1; } else c++;
    }
  }
  const out = `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="crispEdges" aria-hidden="true"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><path d="${d}" fill="#10131f"/></svg>`;
  qrCache.set(text, out);
  return out;
}
function drawQR(doc, text, x, y, size) {
  const { n, dark } = qrMatrix(text); const m = size / n;
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (dark(r, c)) { let e = c; while (e + 1 < n && dark(r, e + 1)) e++; doc.rect(x + c * m, y + r * m, (e - c + 1) * m + 0.02, m + 0.02, 'F'); c = e + 1; } else c++;
    }
  }
}
function textImage(text) {
  const font = '600 44px "IBM Plex Sans Arabic", Tahoma, sans-serif';
  const c = document.createElement('canvas'); let ctx = c.getContext('2d'); ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 24; c.width = w; c.height = 64;
  ctx = c.getContext('2d'); ctx.font = font; ctx.fillStyle = '#444a5c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.direction = isEn() ? 'ltr' : 'rtl'; ctx.fillText(text, w / 2, 34);
  return { url: c.toDataURL('image/png'), ratio: w / 64 };
}

/* ---------- UI primitives ---------- */
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<span class="t-ic">${type === 'error' ? I.x : type === 'success' ? I.check : I.info}</span><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 3000);
}
let modalOnClose = null;
function openModal({ title, body, footer = '', size = '', onClose }) {
  closeModal();
  const w = document.createElement('div');
  w.className = 'modal-wrap';
  w.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true"><div class="modal-head"><h3>${title}</h3><button class="icon-btn" data-act="close-modal" aria-label="${t('إغلاق')}">${I.x}</button></div><div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ''}</div>`;
  w.addEventListener('mousedown', e => { if (e.target === w) closeModal(); });
  $('#modals').appendChild(w);
  modalOnClose = onClose || null;
  requestAnimationFrame(() => w.classList.add('in'));
  setTimeout(() => w.querySelector('.modal-body input:not([type=hidden]):not([type=radio]),.modal-body select')?.focus(), 80);
  return w;
}
function closeModal() {
  const w = $('#modals .modal-wrap'); if (!w) return;
  const cb = modalOnClose; modalOnClose = null; cb?.(); w.remove();
}
function confirmBox(msg, { okText = t('تأكيد'), danger = false } = {}) {
  return new Promise(res => {
    openModal({
      title: t('تأكيد'), size: 'sm', body: `<p class="confirm-msg">${esc(msg)}</p>`,
      footer: `<button class="btn ghost" data-act="close-modal">${t('إلغاء')}</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cfm-ok">${okText}</button>`,
      onClose: () => res(false)
    });
    $('#cfm-ok').onclick = () => { modalOnClose = null; closeModal(); res(true); };
  });
}
function busy(on, text = '') { $('#busy').hidden = !on; $('#busy-text').textContent = text; }

let audioCtx, flashTimer;
function beep(type) {
  if (S().sound === false) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const notes = type === 'success' ? [880, 1320] : type === 'warn' ? [600, 600] : [240, 180];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type === 'error' ? 'square' : 'sine'; o.frequency.value = f;
      const st = audioCtx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(type === 'error' ? 0.08 : 0.22, st + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.11);
      o.connect(g).connect(audioCtx.destination); o.start(st); o.stop(st + 0.13);
    });
  } catch (e) { /* audio not available */ }
}
function flash(type, title, name, sub = '') {
  const el = $('#flash');
  const icon = type === 'success' ? `<svg viewBox="0 0 52 52" class="check-anim"><circle cx="26" cy="26" r="24"/><path d="m15 27 7 7 15-16"/></svg>` : type === 'warn' ? I.alert : I.x;
  el.className = 'flash show ' + type;
  el.innerHTML = `<div class="flash-card"><div class="flash-icon">${icon}</div><div class="flash-title">${esc(title)}</div><div class="flash-name">${esc(name)}</div>${sub ? `<div class="flash-sub">${esc(sub)}</div>` : ''}</div>`;
  beep(type);
  try { navigator.vibrate?.(type === 'success' ? 60 : [80, 60, 80]); } catch (e) { }
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('show'), type === 'success' ? 1600 : 2200);
}

const field = (name, label, type = 'text', o = {}) => `<label class="field ${o.cls || ''}"><span>${label}</span><input id="f-${name}" name="${name}" type="${type}" ${o.required ? 'required' : ''} ${o.value !== undefined ? `value="${esc(o.value)}"` : ''} ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ''} ${o.dir ? `dir="${o.dir}"` : ''} ${o.autocomplete ? `autocomplete="${o.autocomplete}"` : ''} ${o.attrs || ''}></label>`;
const stat = (icon, label, value, foot = '', tone = 'a') => `<div class="stat tone-${tone}"><div class="stat-ic">${I[icon]}</div><div class="stat-body"><span>${label}</span><b>${value}</b>${foot ? `<small>${foot}</small>` : ''}</div></div>`;
const emptyState = (icon, title, text = '', action = '') => `<div class="empty"><div class="empty-ic">${I[icon]}</div><h4>${title}</h4>${text ? `<p>${text}</p>` : ''}${action}</div>`;
const avatar = (name, size = 'sm') => `<div class="avatar ${size}" style="--h:${hue(name)}">${esc(initials(name))}</div>`;
const chip = c => `<span class="chip" style="--c:${c?.color || '#8a8fa3'}">${esc(c?.name || '—')}</span>`;
const phoneCell = p => p ? `<a class="phone" href="${waLink(p)}" target="_blank" rel="noopener" dir="ltr">${I.chat}<span>${esc(p)}</span></a>` : '<span class="muted">—</span>';
function ring(pct, a, b, big = false) {
  const r = 52, c = 2 * Math.PI * r;
  return `<div class="ring ${big ? 'big' : ''}"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" class="ring-bg"/><circle cx="60" cy="60" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct / 100)).toFixed(1)}"/></svg><div class="ring-txt"><b>${pct}%</b><small>${a} / ${b}</small></div></div>`;
}
function heroArt() {
  return `<div class="art"><div class="art-qr">${qrSvg(formatCode(S().nextCode > 1 ? 1 : 1))}<span class="art-beam"></span><i></i><i></i><i></i><i></i></div><div class="art-badge">${I.check}<span>${t('تم تسجيل الحضور')}</span></div></div>`;
}
function attendanceCounts() { const m = {}; DB.data.sessions.forEach(s => s.present.forEach(p => { m[p.sid] = (m[p.sid] || 0) + 1; })); return m; }
function resolveStudent(q, prefer = []) {
  const c = normCode(q); const all = DB.data.students;
  let st = all.find(s => s.code === c); if (st) return st;
  const ql = q.trim().toLowerCase();
  for (const pool of [prefer, all]) {
    st = pool.find(s => s.name.trim().toLowerCase() === ql); if (st) return st;
    const m = pool.filter(s => s.name.toLowerCase().includes(ql)); if (m.length === 1) return m[0];
  }
  return null;
}
function firstFreeCode() {
  const used = new Set(DB.data.students.map(s => s.code).filter(Boolean));
  const bs = [...DB.data.batches].sort((a, b) => a.createdAt - b.createdAt);
  for (const b of bs) for (let n = b.from; n <= b.to; n++) { const c = formatCode(n, b.prefix); if (!used.has(c)) return c; }
  return null;
}

/* ---------- Camera scanner ---------- */
let scanHandler = null;
/* قارئ QR خاص: يقرأ من الإطار الأصلي للكاميرا بدون تمطيط.
   يستخدم BarcodeDetector المدمج (Chrome أندرويد) وإلا jsQR (آيفون وغيره). */
const QR = {
  detector: undefined,
  async init() {
    if (this.detector !== undefined) return;
    this.detector = null;
    if ('BarcodeDetector' in window) {
      try { if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) this.detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { }
    }
  },
  async read(canvas, ctx) {
    try {
      if (this.detector) { const r = await this.detector.detect(canvas); if (r && r[0]) return r[0].rawValue; }
    } catch (e) { }
    if (window.jsQR) {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = jsQR(img.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
      if (r && r.data) return r.data;
    }
    return null;
  }
};
const Scan = {
  stream: null, video: null, timer: null, elId: null, onCode: null, last: '', lastAt: 0, facing: 'environment', n: 0,
  canvas: document.createElement('canvas'),
  get inst() { return this.stream; },
  async start(elId, onCode) {
    await this.stop();
    if (!navigator.mediaDevices?.getUserMedia) { toast(t('الكاميرا المباشرة مش متاحة هنا — استخدم «صوّر الكود»'), 'error'); return false; }
    const host = document.getElementById(elId); if (!host) return false;
    this.elId = elId; this.onCode = onCode;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: this.facing }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch (e) {
      console.warn(e); toast(t('تعذر تشغيل الكاميرا — اسمح للمتصفح باستخدامها'), 'error'); return false;
    }
    const v = document.createElement('video');
    v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.muted = true; v.autoplay = true; v.srcObject = this.stream;
    host.innerHTML = ''; host.appendChild(v); this.video = v;
    try { await v.play(); } catch (e) { }
    const track = this.stream.getVideoTracks()[0];
    try { const caps = track.getCapabilities?.(); if (caps?.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { }
    await QR.init();
    this.loop();
    return true;
  },
  loop() {
    this.timer = setTimeout(async () => {
      if (!this.video) return;
      try { await this.tick(); } catch (e) { }
      if (this.video) this.loop();
    }, 100);
  },
  async tick() {
    const v = this.video; if (!v || v.readyState < 2 || !v.videoWidth) return;
    const vw = v.videoWidth, vh = v.videoHeight, c = this.canvas;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    // بالتبادل: منتصف الصورة بدقة كاملة، ثم الإطار كله مصغّر
    if (this.n++ % 2 === 0) {
      const side = Math.floor(Math.min(vw, vh) * 0.8), out = Math.min(side, 800);
      c.width = c.height = out;
      ctx.drawImage(v, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, out, out);
    } else {
      const k = Math.min(1, 960 / Math.max(vw, vh));
      c.width = Math.round(vw * k); c.height = Math.round(vh * k);
      ctx.drawImage(v, 0, 0, c.width, c.height);
    }
    const txt = await QR.read(c, ctx);
    if (txt) this.hit(txt);
  },
  hit(txt) {
    const code = normCode(txt), now = Date.now();
    if (code === this.last && now - this.lastAt < 2500) return;
    this.last = code; this.lastAt = now; this.onCode?.(code);
  },
  async stop() {
    clearTimeout(this.timer); this.timer = null;
    const v = this.video; this.video = null;
    if (this.stream) { this.stream.getTracks().forEach(tr => tr.stop()); this.stream = null; }
    if (v) { try { v.srcObject = null; v.remove(); } catch (e) { } }
  },
  async flip() {
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    if (this.elId) await camStart(this.elId);
  }
};
/* قراءة الكود من صورة (زرار «صوّر الكود») */
async function decodeImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    await QR.init();
    const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
    for (const max of [1280, 800, 1800]) {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const txt = await QR.read(c, ctx);
      if (txt) return txt;
    }
    return null;
  } finally { URL.revokeObjectURL(url); }
}
const SCAN_TARGETS = { reader: c => attendScan(c), 'pay-reader': c => payScan(c), 'm-reader': c => modalCodeScan(c) };
function scannerBox(id) {
  return `<div class="scanner-box" data-scanbox="${id}">
    <div id="${id}" class="reader"></div>
    <div class="scan-overlay"><div class="frame"><i></i><i></i><i></i><i></i><span class="beam"></span></div></div>
    <div class="cam-off"><div class="cam-icon">${I.camera}</div>
      <div class="btn-row center-row">
        ${window.isSecureContext ? `<button type="button" class="btn primary" data-act="cam-start" data-target="${id}">${I.camera}<span>${t('تشغيل الكاميرا')}</span></button>` : ''}
        <label class="btn ${window.isSecureContext ? 'glass' : 'primary'}">${I.scan}<span>${t('صوّر الكود')}</span><input type="file" accept="image/*" capture="environment" data-change="snap" data-target="${id}" hidden></label>
      </div>
      <small>${window.isSecureContext ? t('أو اكتب الكود يدوياً / استخدم قارئ الباركود') : t('اضغط «صوّر الكود» والتقط صورة قريبة وواضحة للكود')}</small></div>
    <div class="cam-ctrl"><button type="button" class="icon-btn glassy" data-act="cam-flip" title="${t('تبديل الكاميرا')}">${I.flip}</button><button type="button" class="icon-btn glassy" data-act="cam-stop" title="${t('إيقاف الكاميرا')}">${I.stop}</button></div>
  </div>`;
}
async function camStart(target) {
  const box = $(`[data-scanbox="${target}"]`); if (!box) return;
  box.classList.add('loading');
  const ok = await Scan.start(target, SCAN_TARGETS[target]);
  box.classList.remove('loading'); box.classList.toggle('on', ok);
}
async function camStop() { await Scan.stop(); $$('.scanner-box.on').forEach(b => b.classList.remove('on')); }

/* keyboard-wedge barcode readers type fast and end with Enter */
const wedge = { buf: '', t: 0 };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); return; }
  if (!scanHandler || $('#modals .modal-wrap')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const now = Date.now(); if (now - wedge.t > 80) wedge.buf = ''; wedge.t = now;
  if (e.key === 'Enter') { if (wedge.buf.length >= 4) scanHandler(normCode(wedge.buf)); wedge.buf = ''; return; }
  if (e.key.length === 1) wedge.buf += e.key;
});

/* ---------- Auth ---------- */
let currentUser = null;
const isAdmin = () => currentUser?.role === 'admin';
async function hash(str) {
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'f' + (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
}
const passHash = (u, p) => hash('hader|' + u.toLowerCase() + '|' + p);
function applyPrefs() {
  const s = S(), root = document.documentElement;
  root.dataset.theme = s.theme; root.lang = s.lang; root.dir = s.lang === 'ar' ? 'rtl' : 'ltr';
  const [a, on] = ACCENTS[s.accent] || ACCENTS.marigold;
  root.style.setProperty('--accent', a); root.style.setProperty('--on-accent', on);
  document.title = `${t('حاضر')} — ${t('الحضور والغياب')}`;
}
function boot() {
  applyPrefs();
  if (Cloud.enabled) { Cloud.boot(); return; }
  let id = null;
  try { id = sessionStorage.getItem('hader-uid') || localStorage.getItem('hader-uid'); } catch (e) { }
  currentUser = DB.data.users.find(u => u.id === id) || null;
  if (!currentUser) renderAuth(); else { renderShell(); renderView(); }
}
function loginAs(u, remember) {
  currentUser = u;
  try { (remember ? localStorage : sessionStorage).setItem('hader-uid', u.id); } catch (e) { }
  state.view = firstView(); boot();
}
function rerenderAll() { if (currentUser) { renderShell(); renderView(); } else renderAuth(); }

let authMode = 'login';
function renderAuth() {
  const setup = Cloud.enabled ? authMode === 'setup' : !DB.data.users.length;
  $('#root').innerHTML = `<div class="paper-bg"></div>
  <div class="auth">
    <div class="auth-card">
      <div class="auth-side">
        <div class="brand big"><div class="logo">${LOGO}</div><div><b>${t('حاضر')}</b><small>${t('دفتر الحضور الذكي للمدرس')}</small></div></div>
        <div class="auth-art">${heroArt()}</div>
        <ul class="auth-feats">
          <li>${I.scan}<span>${t('حضور الطالب بمسح الكود في ثانية')}</span></li>
          <li>${I.wallet}<span>${t('متابعة اشتراكات الشهور والمدفوعات')}</span></li>
          <li>${I.download}<span>${t('تقارير PDF جاهزة للطباعة')}</span></li>
        </ul>
      </div>
      <form class="auth-form" data-form="${setup ? 'setup' : 'login'}" autocomplete="off">
        <div class="auth-top"><h2>${setup ? t('أهلاً بك! لنجهّز حسابك') : t('تسجيل الدخول')}</h2><p class="muted">${setup ? t('أنشئ حساب المدرس الرئيسي. ستستخدمه للدخول لاحقاً.') : t('أدخل اسم المستخدم وكلمة المرور')}</p></div>
        ${setup ? field('teacherName', t('اسم المدرس'), 'text', { required: true, placeholder: t('مثال: أحمد محمود') }) + field('subject', t('المادة'), 'text', { value: t('الدراسات الاجتماعية') }) : ''}
        ${field('username', t('اسم المستخدم'), 'text', { required: true, dir: 'ltr', autocomplete: 'username' })}
        ${field('password', t('كلمة المرور'), 'password', { required: true, autocomplete: setup ? 'new-password' : 'current-password', attrs: 'minlength="6"' })}
        ${setup ? field('password2', t('تأكيد كلمة المرور'), 'password', { required: true }) : `<label class="check"><input type="checkbox" name="remember" checked><span>${t('تذكرني على هذا الجهاز')}</span></label>`}
        <button class="btn primary lg block">${setup ? t('إنشاء الحساب والبدء') : t('دخول')}</button>
        ${Cloud.enabled ? `<p class="auth-switch">${setup ? t('عندك حساب بالفعل؟') : t('مدرس جديد؟')} <button type="button" class="link" data-act="auth-mode">${setup ? t('تسجيل الدخول') : t('أنشئ حساب مدرس')}</button></p>` : ''}
        <div class="auth-tools">
          <button type="button" class="link" data-act="toggle-lang">${I.globe}<span>${isEn() ? 'العربية' : 'English'}</span></button>
          <button type="button" class="link" data-act="toggle-theme">${S().theme === 'dark' ? I.sun : I.moon}<span>${S().theme === 'dark' ? t('نهاري') : t('ليلي')}</span></button>
        </div>
      </form>
    </div>
  </div>`;
}

/* ---------- Shell & routing ---------- */
const NAV = [
  { id: 'dashboard', icon: 'home', label: 'الرئيسية', admin: false },
  { id: 'attendance', icon: 'scan', label: 'الحضور', admin: false },
  { id: 'students', icon: 'users', label: 'الطلاب', admin: false },
  { id: 'payments', icon: 'wallet', label: 'الدفع', admin: false },
  { id: 'accounts', icon: 'chart', label: 'الحسابات', admin: true },
  { id: 'codes', icon: 'qr', label: 'الأكواد', admin: true },
  { id: 'settings', icon: 'settings', label: 'الإعدادات', admin: false }
];
/* صلاحيات المساعد: المدرس يحدد الأقسام اللي تظهر لكل مساعد من الإعدادات */
const PERM_SECTIONS = ['dashboard', 'attendance', 'students', 'payments', 'accounts', 'codes'];
const DEFAULT_PERMS = { dashboard: true, attendance: true, students: true, payments: true, accounts: false, codes: false };
const permsOf = u => u?.role === 'admin' ? Object.fromEntries(PERM_SECTIONS.map(k => [k, true])) : { ...DEFAULT_PERMS, ...(u?.perms || {}) };
const can = id => isAdmin() || !!permsOf(currentUser)[id];
const canView = id => { const n = NAV.find(x => x.id === id); return !!n && (id === 'settings' || can(id)); };
const firstView = () => (NAV.find(n => canView(n.id)) || NAV[NAV.length - 1]).id;
const state = { view: 'dashboard', classId: null, stuSearch: '', payStudentId: null, accMonth: monthKey() };
let liveTimer = null;

function renderShell() {
  const s = S();
  const tools = `<button class="icon-btn" data-act="toggle-theme" title="${s.theme === 'dark' ? t('الوضع النهاري') : t('الوضع الليلي')}">${s.theme === 'dark' ? I.sun : I.moon}</button><button class="icon-btn" data-act="toggle-lang" title="${isEn() ? 'العربية' : 'English'}">${I.globe}</button><button class="icon-btn" data-act="logout" title="${t('تسجيل الخروج')}">${I.logout}</button>`;
  $('#root').innerHTML = `<div class="paper-bg"></div>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="logo">${LOGO}</div><div><b>${t('حاضر')}</b><small>${esc(s.subject || t('دفتر الحضور الذكي'))}</small></div></div>
      <button class="live-pill" data-act="go" data-view="attendance" ${DB.data.activeSession ? '' : 'hidden'}><span class="live-dot"></span>${t('حصة جارية')}</button>
      <nav class="nav">${NAV.filter(n => canView(n.id)).map(n => `<button class="nav-item" data-act="go" data-view="${n.id}" data-nav="${n.id}">${I[n.icon]}<span>${t(n.label)}</span></button>`).join('')}</nav>
      <div class="side-foot">
        <div class="me">${avatar(currentUser.name)}<div><b>${esc(currentUser.name)}</b><small>${currentUser.role === 'admin' ? t('المدرس') : t('مساعد')}</small></div></div>
        <div class="side-actions">${tools}</div>
      </div>
    </aside>
    <main class="main" id="main">
      <header class="topbar"><div class="tb-text"><h1 id="view-title"></h1><p id="view-sub"></p>${Cloud.enabled ? '<span class="sync" id="sync"></span>' : ''}</div><div class="top-actions" id="top-actions"></div><div class="mob-tools">${tools}</div></header>
      <section id="view" class="view"></section>
    </main>
  </div>`;
}
function go(view) { state.view = view; renderView(); $('#main')?.scrollTo(0, 0); }
function renderView() {
  Scan.stop(); scanHandler = null; clearInterval(liveTimer);
  if (!VIEWS[state.view] || !canView(state.view)) state.view = firstView();
  const out = VIEWS[state.view]();
  $('#view-title').textContent = out.title;
  $('#view-sub').textContent = out.sub || '';
  $('#top-actions').innerHTML = out.actions || '';
  const view = $('#view');
  view.innerHTML = out.html;
  view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.nav === state.view));
  const pill = $('.live-pill'); if (pill) pill.hidden = !DB.data.activeSession;
  out.mount?.();
  if (Cloud.enabled) Cloud.status();
}
/* لو جهازين سجلوا نفس الطالب في نفس اللحظة نعرضه مرة واحدة */
const uniquePresent = list => { const seen = new Set(); return list.filter(p => !seen.has(p.sid) && seen.add(p.sid)); };
const VIEWS = {};

/* ================= Dashboard ================= */
VIEWS.dashboard = () => {
  const d = DB.data, s = S(), tk = todayKey(), mk = monthKey();
  const h = new Date().getHours();
  const todaySes = d.sessions.filter(x => todayKey(new Date(x.startedAt)) === tk);
  const todayPresent = todaySes.reduce((a, x) => a + x.present.length, 0);
  const payToday = d.payments.filter(p => todayKey(new Date(p.date)) === tk);
  const payMonth = d.payments.filter(p => p.month === mk);
  const paidMonthIds = new Set(payMonth.map(p => p.sid));
  const classesHtml = d.classes.length ? d.classes.map(c => {
    const st = studentsOf(c.id);
    const paid = st.filter(x => paidMonthIds.has(x.id)).length;
    const last = d.sessions.find(x => x.classId === c.id);
    const rate = last && last.total ? Math.round(last.present.filter(p => !p.guest).length / last.total * 100) : null;
    const pr = st.length ? Math.round(paid / st.length * 100) : 0;
    return `<div class="class-row" style="--c:${c.color}">
      <div class="cr-name"><i></i><div><b>${esc(c.name)}</b><small>${t('{n} طالب', { n: st.length })}</small></div></div>
      <div class="cr-bar"><label>${t('دفعوا الشهر')}<span>${paid}/${st.length}</span></label><div class="bar"><span style="width:${pr}%"></span></div></div>
      <div class="cr-bar"><label>${t('آخر حضور')}<span>${rate === null ? '—' : rate + '%'}</span></label><div class="bar alt"><span style="width:${rate || 0}%"></span></div></div>
    </div>`;
  }).join('') : emptyState('layers', t('لا توجد صفوف بعد'), t('ابدأ بإضافة صف من قسم الطلاب'), `<button class="btn primary" data-act="go" data-view="students">${I.plus}<span>${t('إضافة صف')}</span></button>`);
  let lastExport = 0;
  try { lastExport = +localStorage.getItem('hader-last-export') || 0; } catch (e) { }
  const needBackup = isAdmin() && (d.students.length || d.payments.length) && Date.now() - lastExport > 7 * 864e5;
  return {
    title: t('الرئيسية'), sub: fmtDate(Date.now()),
    html: `
    ${needBackup ? `<div class="backup-nag"><div class="bn-ic">${I.shield}</div><div class="bn-text"><b>${t('نزّل نسخة احتياطية على جهازك')}</b><small>${lastExport ? t('آخر نسخة كانت {d}', { d: fmtShortDate(lastExport) }) : t('لسه ما نزّلتش أي نسخة على الجهاز ده')} · ${t('نسخة على جهازك بتحمي بيانات الطلاب والفلوس حتى لو حصل أي حاجة للحساب')}</small></div><button class="btn primary" data-act="export-data">${I.download}<span>${t('تنزيل الآن')}</span></button></div>` : ''}
    <div class="hero">
      <div class="hero-text">
        <span class="kicker">${h < 12 ? t('صباح الخير') : t('مساء الخير')}</span>
        <h2>${s.teacherName ? t('أ/ {n}', { n: esc(s.teacherName) }) : esc(currentUser.name)}</h2>
        <p>${esc(s.subject || '')}${s.centerName ? ' · ' + esc(s.centerName) : ''}</p>
        <div class="hero-actions">
          <button class="btn primary lg" data-act="go" data-view="attendance">${I.scan}<span>${d.activeSession ? t('متابعة الحصة الجارية') : t('بدء تسجيل الحضور')}</span></button>
          <button class="btn glass lg" data-act="go" data-view="payments">${I.wallet}<span>${t('تسجيل دفع')}</span></button>
        </div>
      </div>
      <div class="hero-art">${heroArt()}</div>
    </div>
    <div class="stats">
      ${stat('users', t('إجمالي الطلاب'), d.students.length, t('في {n} صف', { n: d.classes.length }), 'a')}
      ${stat('scan', t('حضور اليوم'), todayPresent, t('{n} حصة اليوم', { n: todaySes.length }), 'b')}
      ${stat('wallet', t('مدفوعات اليوم'), payToday.length, money(sum(payToday)), 'c')}
      ${stat('calendar', t('دفعوا شهر {m}', { m: monthName(mk) }), paidMonthIds.size, money(sum(payMonth)), 'd')}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>${I.layers}<span>${t('الصفوف')}</span></h3><button class="btn ghost sm" data-act="go" data-view="students">${t('إدارة الصفوف')}</button></div>${classesHtml}</div>
      <div class="card"><div class="card-head"><h3>${I.history}<span>${t('آخر الحصص')}</span></h3></div>${sessionsList(d.sessions.slice(0, 6))}</div>
    </div>`
  };
};
function sessionsList(list, withDel = false) {
  if (!list.length) return `<div class="empty-mini">${I.history}<p>${t('لا توجد حصص مسجلة بعد')}</p></div>`;
  return `<div class="ses-list">${list.map(s => {
    const inC = s.present.filter(p => !p.guest).length;
    const pct = s.total ? Math.round(inC / s.total * 100) : 0;
    const c = classById(s.classId);
    const dur = s.endedAt ? Math.max(1, Math.round((s.endedAt - s.startedAt) / 60000)) : 0;
    return `<div class="ses-item" style="--c:${c?.color || '#8a8fa3'}">
      <div class="ses-date"><b>${new Date(s.startedAt).getDate()}</b><small>${monthName(monthKey(new Date(s.startedAt)))}</small></div>
      <div class="ses-info"><b>${esc(s.className)}</b><small>${fmtTime(s.startedAt)} · ${t('{n} دقيقة', { n: dur })} · ${t('{a} حاضر من {b}', { a: inC, b: s.total })}</small><div class="mini-bar"><span style="width:${pct}%"></span></div></div>
      <span class="ses-pct">${pct}%</span>
      <div class="actions"><button class="icon-btn sm" data-act="session-view" data-id="${s.id}" title="${t('عرض')}">${I.eye}</button><button class="icon-btn sm" data-act="session-pdf" data-id="${s.id}" title="PDF">${I.download}</button>${withDel && isAdmin() ? `<button class="icon-btn sm danger" data-act="session-del" data-id="${s.id}" title="${t('حذف')}">${I.trash}</button>` : ''}</div>
    </div>`;
  }).join('')}</div>`;
}

/* ================= Attendance ================= */
VIEWS.attendance = () => {
  const d = DB.data, a = d.activeSession;
  if (!a) {
    const pick = d.classes.length ? `<div class="class-pick">${d.classes.map((c, i) => `<label class="pick" style="--c:${c.color}"><input type="radio" name="cls" value="${c.id}" ${i === 0 ? 'checked' : ''}><span class="pick-body"><i></i><b>${esc(c.name)}</b><small>${t('{n} طالب', { n: studentsOf(c.id).length })}</small></span></label>`).join('')}</div>
      <div class="start-row"><button class="btn primary xl" data-act="start-session">${I.play}<span>${t('بدء الحصة وتشغيل الكاميرا')}</span></button></div>`
      : emptyState('layers', t('لا توجد صفوف بعد'), t('أضف صفاً وطلاباً من قسم الطلاب أولاً'), `<button class="btn primary" data-act="go" data-view="students">${I.plus}<span>${t('إضافة صف')}</span></button>`);
    return {
      title: t('الحضور'), sub: t('اختر الصف وابدأ الحصة'),
      html: `<div class="card"><div class="card-head"><h3>${I.layers}<span>${t('اختر الصف')}</span></h3></div>${pick}</div>
      <div class="card"><div class="card-head"><h3>${I.history}<span>${t('سجل الحصص')}</span></h3><span class="muted">${t('{n} حصة', { n: d.sessions.length })}</span></div>${sessionsList(d.sessions, true)}</div>`
    };
  }
  const cls = classById(a.classId);
  return {
    title: t('تسجيل الحضور'), sub: `${cls?.name || ''} · ${t('بدأت {t}', { t: fmtTime(a.startedAt) })}`,
    actions: `<button class="btn ghost" data-act="cancel-session">${I.x}<span>${t('إلغاء الحصة')}</span></button>`,
    html: `<div class="live-grid">
      <div class="card scanner-card">
        <div class="live-head"><span class="live-dot"></span><b>${t('مباشر')}</b>${chip(cls)}<span class="timer" id="live-timer">00:00</span></div>
        ${scannerBox('reader')}
        <form class="manual" data-form="att-manual" autocomplete="off">
          <div class="input-icon">${I.keyboard}<input id="att-q" name="q" list="att-list" placeholder="${t('اكتب الكود أو اسم الطالب...')}"></div>
          <button class="btn primary">${t('تسجيل')}</button>
          <datalist id="att-list">${d.students.map(s => `<option value="${esc(s.code || s.name)}">${esc(s.name)}</option>`).join('')}</datalist>
        </form>
      </div>
      <div class="card live-side">
        <div class="ring-wrap" id="live-ring"></div>
        <div class="card-head"><h3>${I.check}<span>${t('الحاضرون')}</span></h3></div>
        <div class="present-list" id="present-list"></div>
      </div>
    </div>
    <div class="end-bar"><button class="btn danger xl" data-act="end-session">${I.stop}<span>${t('أخذ الغياب وإنهاء الحصة')}</span></button></div>`,
    mount() { updateLive(); tick(); liveTimer = setInterval(tick, 1000); scanHandler = attendScan; }
  };
};
function tick() {
  const a = DB.data.activeSession, el = $('#live-timer'); if (!a || !el) return;
  const s = Math.floor((Date.now() - a.startedAt) / 1000);
  el.textContent = (s >= 3600 ? Math.floor(s / 3600) + ':' : '') + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
}
function updateLive() {
  const a = DB.data.activeSession; if (!a || !$('#live-ring')) return;
  a.present = uniquePresent(a.present || []);
  const total = studentsOf(a.classId).length;
  const inCls = a.present.filter(p => !p.guest).length;
  const pct = total ? Math.round(inCls / total * 100) : 0;
  $('#live-ring').innerHTML = ring(pct, inCls, total) + `<div class="ring-stats"><div><b class="ok">${a.present.length}</b><span>${t('حاضر')}</span></div><div><b class="bad">${Math.max(total - inCls, 0)}</b><span>${t('لم يحضر بعد')}</span></div><div><b>${total}</b><span>${t('عدد الصف')}</span></div></div>`;
  const list = [...a.present].reverse();
  $('#present-list').innerHTML = list.length ? list.map((p, i) => `<div class="p-item ${i === 0 ? 'new' : ''}">${avatar(p.name)}<div class="p-info"><b>${esc(p.name)}</b><small><span dir="ltr">${esc(p.code || '')}</span> · ${fmtTime(p.t)}${p.guest ? ` · <em>${t('من صف آخر')}</em>` : ''}</small></div><button class="icon-btn sm" data-act="unmark" data-sid="${p.sid}" title="${t('إزالة')}">${I.x}</button></div>`).join('')
    : `<div class="empty-mini">${I.scan}<p>${t('امسح كود أول طالب لبدء التسجيل')}</p></div>`;
}
function attendScan(code, st = studentByCode(code)) {
  const a = DB.data.activeSession; if (!a) return;
  if (!st) { flash('error', t('كود غير مسجل'), code, t('هذا الكود غير مرتبط بأي طالب')); return; }
  if (a.present.some(p => p.sid === st.id)) { flash('warn', t('مسجل حضوره بالفعل'), st.name); return; }
  const guest = st.classId !== a.classId;
  const entry = { sid: st.id, name: st.name, code: st.code || '', t: Date.now(), guest };
  a.present.push(entry);
  if (Cloud.enabled) Cloud.addPresent(entry); else DB.save();
  const c = classById(st.classId);
  flash('success', t('تم تسجيل الحضور'), st.name, guest ? t('من صف آخر: {c}', { c: c?.name || '' }) : `${c?.name || ''} · ${fmtTime(Date.now())}`);
  updateLive();
}
function absentMsg(name, ses) {
  return t('السلام عليكم، نحيط سيادتكم علماً بأن الطالب/ة {n} تغيب عن حصة {s} بتاريخ {d}. مع تحيات {t}', {
    n: name, s: S().subject || '', d: fmtShortDate(ses.startedAt), t: S().teacherName ? t('أ/ {n}', { n: S().teacherName }) : ''
  });
}
function sessionResult(ses, title = t('انتهت الحصة')) {
  const inCls = ses.present.filter(p => !p.guest).length;
  const pct = ses.total ? Math.round(inCls / ses.total * 100) : 0;
  openModal({
    title, size: 'md',
    body: `<div class="result">${ring(pct, inCls, ses.total, true)}<div class="result-nums"><div class="rn ok"><b>${ses.present.length}</b><span>${t('حاضر')}</span></div><div class="rn bad"><b>${ses.absent.length}</b><span>${t('غائب')}</span></div><div class="rn"><small>${esc(ses.className)}</small><small>${fmtShortDate(ses.startedAt)}</small></div></div></div>
    ${ses.absent.length ? `<h4 class="sub-title">${t('الغائبون')}</h4><div class="absent-list">${ses.absent.map(a => `<div class="ab-item">${avatar(a.name)}<div class="p-info"><b>${esc(a.name)}</b><small dir="ltr">${esc(a.code || '')}</small></div>${a.parent ? `<a class="btn sm wa" target="_blank" rel="noopener" href="${waLink(a.parent, absentMsg(a.name, ses))}">${I.chat}<span>${t('إبلاغ ولي الأمر')}</span></a>` : ''}</div>`).join('')}</div>` : `<p class="full-att">${I.check}<span>${t('حضور كامل! لا يوجد غياب')}</span></p>`}`,
    footer: `<button class="btn ghost" data-act="close-modal">${t('إغلاق')}</button><button class="btn primary" data-act="session-pdf" data-id="${ses.id}">${I.download}<span>${t('تنزيل تقرير PDF')}</span></button>`
  });
}

/* ================= Students ================= */
VIEWS.students = () => {
  const d = DB.data;
  if (!d.classes.length) return {
    title: t('الطلاب'), sub: t('إدارة الصفوف والطلاب'),
    html: `<div class="card">${emptyState('layers', t('ابدأ بإضافة أول صف'), t('مثال: الصف الأول الإعدادي، الصف الثاني الإعدادي'), `<button class="btn primary lg" data-act="class-add">${I.plus}<span>${t('إضافة صف')}</span></button>`)}</div>`
  };
  if (state.classId !== 'all' && !classById(state.classId)) state.classId = d.classes[0].id;
  const sel = state.classId, cls = sel === 'all' ? null : classById(sel);
  const cards = `<button class="cls-card ${sel === 'all' ? 'active' : ''}" data-act="class-select" data-id="all" style="--c:var(--accent)"><span class="cls-dot"></span><b>${t('كل الطلاب')}</b><small>${d.students.length}</small></button>`
    + d.classes.map(c => `<button class="cls-card ${sel === c.id ? 'active' : ''}" data-act="class-select" data-id="${c.id}" style="--c:${c.color}"><span class="cls-dot"></span><b>${esc(c.name)}</b><small>${studentsOf(c.id).length}</small></button>`).join('')
    + (isAdmin() ? `<button class="cls-card add" data-act="class-add">${I.plus}<b>${t('صف جديد')}</b></button>` : '');
  return {
    title: t('الطلاب'), sub: t('إدارة الصفوف والطلاب'),
    actions: `<button class="btn primary" data-act="stu-add">${I.plus}<span>${t('إضافة طالب')}</span></button>`,
    html: `<div class="cls-strip">${cards}</div>
    <div class="card">
      <div class="card-head wrap">
        <div class="ch-title"><h3>${cls ? `<span class="dot" style="--c:${cls.color}"></span><span>${esc(cls.name)}</span>` : `<span>${t('كل الطلاب')}</span>`}</h3>${cls?.fee ? `<span class="chip soft">${t('الاشتراك')}: ${money(cls.fee)}</span>` : ''}</div>
        <div class="ch-tools">
          <div class="input-icon sm">${I.search}<input id="stu-search" data-input="stu-search" value="${esc(state.stuSearch)}" placeholder="${t('بحث بالاسم أو الكود أو الرقم...')}"></div>
          ${cls && isAdmin() ? `<button class="icon-btn" data-act="class-edit" data-id="${cls.id}" title="${t('تعديل الصف')}">${I.edit}</button><button class="icon-btn danger" data-act="class-del" data-id="${cls.id}" title="${t('حذف الصف')}">${I.trash}</button>` : ''}
        </div>
      </div>
      <div id="stu-table"></div>
    </div>`,
    mount() { renderStudentTable(); }
  };
};
function renderStudentTable() {
  const el = $('#stu-table'); if (!el) return;
  const sel = state.classId;
  let list = sel === 'all' ? [...DB.data.students].sort(byName) : studentsOf(sel);
  const q = state.stuSearch.trim().toLowerCase();
  if (q) list = list.filter(s => [s.name, s.code, s.whatsapp, s.parentPhone].some(v => String(v || '').toLowerCase().includes(q)));
  if (!list.length) {
    el.innerHTML = emptyState('users', q ? t('لا توجد نتائج') : t('لا يوجد طلاب في هذا الصف'), q ? '' : t('اضغط "إضافة طالب" وامسح الكود الملصق على كتابه'), q ? '' : `<button class="btn primary" data-act="stu-add">${I.plus}<span>${t('إضافة طالب')}</span></button>`);
    return;
  }
  const att = attendanceCounts(), mk = monthKey();
  const paid = new Set(DB.data.payments.filter(p => p.month === mk).map(p => p.sid));
  el.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>${t('الطالب')}</th><th>${t('الكود')}</th>${sel === 'all' ? `<th>${t('الصف')}</th>` : ''}<th>${t('واتساب')}</th><th>${t('ولي الأمر')}</th><th>${t('مرات الحضور')}</th><th>${t('شهر {m}', { m: monthName(mk) })}</th><th></th></tr></thead><tbody>${list.map((s, i) => `<tr class="clickable" data-act="stu-view" data-id="${s.id}" title="${t('عرض ملف الطالب')}">
    <td class="muted num">${i + 1}</td>
    <td><div class="who">${avatar(s.name)}<b>${esc(s.name)}</b></div></td>
    <td>${s.code ? `<span class="code-chip">${esc(s.code)}</span>` : `<span class="muted">—</span>`}</td>
    ${sel === 'all' ? `<td>${chip(classById(s.classId))}</td>` : ''}
    <td>${phoneCell(s.whatsapp)}</td><td>${phoneCell(s.parentPhone)}</td>
    <td class="num"><b>${att[s.id] || 0}</b></td>
    <td>${paid.has(s.id) ? `<span class="badge ok">${I.check}${t('دفع')}</span>` : `<span class="badge bad">${t('لم يدفع')}</span>`}</td>
    <td class="actions"><button class="icon-btn sm" data-act="stu-edit" data-id="${s.id}" title="${t('تعديل')}">${I.edit}</button>${isAdmin() ? `<button class="icon-btn sm danger" data-act="stu-del" data-id="${s.id}" title="${t('حذف')}">${I.trash}</button>` : ''}</td>
  </tr>`).join('')}</tbody></table></div>`;
}
function classModal(c) {
  const d = DB.data;
  openModal({
    title: c ? t('تعديل الصف') : t('إضافة صف جديد'), size: 'sm',
    body: `<form data-form="class" id="cls-form" class="stack"><input type="hidden" name="id" value="${c?.id || ''}">
      ${field('name', t('اسم الصف'), 'text', { required: true, value: c?.name || '', placeholder: t('مثال: الصف الأول الإعدادي') })}
      ${field('fee', t('قيمة الاشتراك الشهري (اختياري)'), 'number', { value: c?.fee || '', attrs: 'min="0" step="any"' })}
      <div class="field"><span>${t('لون الصف')}</span><div class="swatches">${CLASS_COLORS.map((col, i) => `<label class="swatch" style="--c:${col}"><input type="radio" name="color" value="${col}" ${(c ? c.color === col : i === d.classes.length % CLASS_COLORS.length) ? 'checked' : ''}><i></i></label>`).join('')}</div></div>
    </form>`,
    footer: `<button class="btn ghost" data-act="close-modal">${t('إلغاء')}</button><button class="btn primary" type="submit" form="cls-form">${I.check}<span>${t('حفظ')}</span></button>`
  });
}
let editingStudentId = null;
function studentModal(st) {
  const d = DB.data, free = firstFreeCode();
  editingStudentId = st?.id || null;
  const defCls = st ? st.classId : (state.classId && state.classId !== 'all' ? state.classId : d.classes[0]?.id);
  openModal({
    title: st ? t('تعديل بيانات الطالب') : t('إضافة طالب جديد'), size: 'md',
    body: `<form data-form="student" id="stu-form" autocomplete="off"><input type="hidden" name="id" value="${st?.id || ''}">
      <div class="form-grid">
        ${field('name', t('اسم الطالب'), 'text', { required: true, value: st?.name || '', cls: 'span2' })}
        <label class="field span2"><span>${t('الصف')}</span><select id="f-classId" name="classId" required>${d.classes.map(c => `<option value="${c.id}" ${defCls === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        ${field('whatsapp', t('رقم واتساب الطالب'), 'tel', { value: st?.whatsapp || '', dir: 'ltr', placeholder: '01xxxxxxxxx' })}
        ${field('parentPhone', t('رقم ولي الأمر'), 'tel', { value: st?.parentPhone || '', dir: 'ltr', placeholder: '01xxxxxxxxx' })}
      </div>
      <div class="code-assign">
        <div class="ca-head"><b>${I.qr}<span>${t('كود الطالب')}</span></b>${free && !st?.code ? `<button type="button" class="link" data-act="use-free-code" data-code="${free}">${t('استخدم أول كود متاح')} <span dir="ltr" class="mono">${free}</span></button>` : ''}</div>
        <div class="ca-row"><input name="code" id="m-code" dir="ltr" class="code-input" value="${esc(st?.code || '')}" placeholder="${esc(S().prefix)}-0001"><button type="button" class="btn glass" data-act="m-scan">${I.camera}<span>${t('مسح الكود')}</span></button></div>
        <div class="m-scan-wrap" id="m-scan-wrap" hidden>${scannerBox('m-reader')}</div>
        <small class="code-msg" id="m-code-msg"></small>
      </div>
    </form>`,
    footer: `<button class="btn ghost" data-act="close-modal">${t('إلغاء')}</button><button class="btn primary" type="submit" form="stu-form">${I.check}<span>${t('حفظ الطالب')}</span></button>`,
    onClose: () => Scan.stop()
  });
}
function checkModalCode(code) {
  const msg = $('#m-code-msg'); if (!msg) return true;
  if (!code) { msg.textContent = ''; msg.className = 'code-msg'; return true; }
  const other = studentByCode(code);
  if (other && other.id !== editingStudentId) { msg.textContent = t('هذا الكود مستخدم بالفعل للطالب: {n}', { n: other.name }); msg.className = 'code-msg bad'; return false; }
  msg.textContent = t('الكود متاح ✓'); msg.className = 'code-msg ok'; return true;
}
function modalCodeScan(code) {
  const inp = $('#m-code'); if (!inp) return;
  inp.value = code; const ok = checkModalCode(code);
  beep(ok ? 'success' : 'error');
  if (ok) { Scan.stop(); $('#m-scan-wrap').hidden = true; }
}

/* ================= Student profile ================= */
function studentHistory(st) {
  const rows = [];
  for (const s of DB.data.sessions) {
    const p = s.present.find(x => x.sid === st.id);
    if (p) rows.push({ s, status: 'present', t: p.t, guest: p.guest });
    else if ((s.absent || []).some(x => x.sid === st.id)) rows.push({ s, status: 'absent' });
  }
  rows.sort((a, b) => b.s.startedAt - a.s.startedAt);
  const pays = DB.data.payments.filter(p => p.sid === st.id).sort((a, b) => b.date - a.date);
  const present = rows.filter(r => r.status === 'present').length, absent = rows.length - present;
  return { rows, pays, present, absent, rate: rows.length ? Math.round(present / rows.length * 100) : 0, total: sum(pays) };
}
let profileTab = 'att';
function studentProfile(id) {
  const st = studentById(id); if (!st) return;
  const cls = classById(st.classId), h = studentHistory(st);
  const paidMonths = new Map(); h.pays.forEach(p => paidMonths.set(p.month, (paidMonths.get(p.month) || 0) + Number(p.amount)));
  const cur = monthKey(), months = monthRange();
  const joined = monthKey(new Date(st.createdAt || Date.now()));
  const unpaidPast = months.filter(m => m <= cur && m >= joined && !paidMonths.has(m));
  let streak = 0; for (const r of h.rows) { if (r.status === 'absent') streak++; else break; }
  const teacher = S().teacherName ? t('أ/ {n}', { n: S().teacherName }) : '';
  const contact = (label, num) => num
    ? `<div class="pf-contact"><small>${label}</small><b dir="ltr" class="mono">${esc(num)}</b><div class="pf-c-actions"><a class="icon-btn sm" href="tel:${esc(num)}" title="${t('اتصال')}">${I.phone}</a><a class="icon-btn sm wa-ic" href="${waLink(num)}" target="_blank" rel="noopener" title="${t('واتساب')}">${I.chat}</a></div></div>`
    : `<div class="pf-contact empty"><small>${label}</small><b class="muted">—</b></div>`;
  const attList = h.rows.length
    ? `<div class="pf-list">${h.rows.map(r => `<div class="pf-row ${r.status}"><span class="pf-dot"></span><div class="p-info"><b>${fmtDate(r.s.startedAt)}</b><small>${esc(r.s.className)}${r.status === 'present' ? ` · ${t('حضر {t}', { t: fmtTime(r.t) })}${r.guest ? ' · ' + t('من صف آخر') : ''}` : ''}</small></div><span class="badge ${r.status === 'present' ? 'ok' : 'bad'}">${r.status === 'present' ? t('حاضر') : t('غائب')}</span></div>`).join('')}</div>`
    : `<div class="empty-mini">${I.calendar}<p>${t('لسه مفيش حصص مسجلة للطالب ده')}</p></div>`;
  const payList = h.pays.length
    ? `<div class="pf-list">${h.pays.map(p => `<div class="pf-row paid"><span class="pf-dot"></span><div class="p-info"><b>${t('اشتراك {m}', { m: monthLabel(p.month) })}</b><small>${fmtShortDate(p.date)} · ${fmtTime(p.date)} · ${t('استلم: {b}', { b: esc(p.by || '') })}</small></div><b class="money">${money(p.amount)}</b></div>`).join('')}</div>`
    : `<div class="empty-mini">${I.wallet}<p>${t('لسه مفيش مدفوعات')}</p></div>`;
  openModal({
    title: t('ملف الطالب'), size: 'lg',
    body: `<div class="profile">
      <div class="pf-head">
        ${avatar(st.name, 'lg')}
        <div class="pf-id"><h2>${esc(st.name)}</h2><p>${chip(cls)} ${st.code ? `<span class="code-chip">${esc(st.code)}</span>` : `<span class="badge bad">${t('بدون كود')}</span>`}</p>
          ${st.createdAt ? `<small class="muted">${t('مسجل من {d}', { d: fmtShortDate(st.createdAt) })}</small>` : ''}</div>
        ${st.code ? `<div class="pf-qr">${qrSvg(st.code)}</div>` : ''}
      </div>
      ${streak >= 2 ? `<div class="pf-alert">${I.alert}<span>${t('غايب آخر {n} حصص ورا بعض', { n: streak })}</span>${st.parentPhone ? `<a class="btn sm wa" href="${waLink(st.parentPhone, t('السلام عليكم، نحب نطمن على الطالب/ة {n} لأنه غاب آخر {c} حصص. مع تحيات {t}', { n: st.name, c: streak, t: teacher }))}" target="_blank" rel="noopener">${I.chat}<span>${t('كلّم ولي الأمر')}</span></a>` : ''}</div>` : ''}
      <div class="pf-contacts">${contact(t('واتساب الطالب'), st.whatsapp)}${contact(t('ولي الأمر'), st.parentPhone)}</div>
      <div class="pf-stats">
        <div class="ok"><b>${h.present}</b><small>${t('حصة حضرها')}</small></div>
        <div class="bad"><b>${h.absent}</b><small>${t('حصة غابها')}</small></div>
        <div><b>${h.rate}%</b><small>${t('نسبة الحضور')}</small></div>
        <div class="pf-money"><b>${money(h.total)}</b><small>${t('إجمالي المدفوع')}</small></div>
      </div>
      <div class="pf-months"><small class="muted">${t('الشهور')}</small><div class="month-chips">${months.map(m => `<span class="mchip ${paidMonths.has(m) ? 'paid' : (unpaidPast.includes(m) ? 'due' : '')} ${m === cur ? 'cur' : ''}" title="${paidMonths.has(m) ? money(paidMonths.get(m)) : t('لم يدفع')}">${paidMonths.has(m) ? I.check : ''}${monthName(m)}</span>`).join('')}</div>
        ${unpaidPast.length ? `<small class="bad-text">${t('عليه {n} شهر: {m}', { n: unpaidPast.length, m: unpaidPast.map(monthName).join('، ') })}</small>` : ''}</div>
      <div class="seg pf-tabs"><button class="${profileTab === 'att' ? 'on' : ''}" data-act="pf-tab" data-v="att">${I.calendar}<span>${t('الحضور والغياب')} (${h.rows.length})</span></button><button class="${profileTab === 'pay' ? 'on' : ''}" data-act="pf-tab" data-v="pay">${I.wallet}<span>${t('المدفوعات')} (${h.pays.length})</span></button></div>
      <div class="pf-pane" data-pane="att" ${profileTab === 'att' ? '' : 'hidden'}>${attList}</div>
      <div class="pf-pane" data-pane="pay" ${profileTab === 'pay' ? '' : 'hidden'}>${payList}</div>
    </div>`,
    footer: `<button class="btn ghost" data-act="stu-pdf" data-id="${st.id}">${I.download}<span>${t('تقرير PDF')}</span></button><button class="btn ghost" data-act="stu-pay" data-id="${st.id}">${I.wallet}<span>${t('تسجيل دفع')}</span></button><button class="btn primary" data-act="stu-edit" data-id="${st.id}">${I.edit}<span>${t('تعديل')}</span></button>`
  });
}
function studentPdf(st) {
  const cls = classById(st.classId), h = studentHistory(st);
  return buildReportPdf({
    title: t('ملف الطالب'), subtitle: `${st.name} — ${cls?.name || ''}`,
    meta: [[t('الطالب'), st.name], [t('الصف'), cls?.name || '—'], [t('الكود'), st.code || '—'], [t('واتساب الطالب'), st.whatsapp || '—'], [t('ولي الأمر'), st.parentPhone || '—'], [t('المدرس'), S().teacherName]],
    stats: [[t('حصة حضرها'), h.present, 'ok'], [t('حصة غابها'), h.absent, 'bad'], [t('نسبة الحضور'), h.rate + '%'], [t('إجمالي المدفوع'), money(h.total)]],
    sections: [
      { title: t('سجل الحضور والغياب'), headers: ['#', t('التاريخ'), t('الصف'), t('الحالة'), t('الوقت')], rows: h.rows.map((r, i) => [i + 1, fmtShortDate(r.s.startedAt), r.s.className, r.status === 'present' ? t('حاضر') : t('غائب'), r.status === 'present' ? fmtTime(r.t) : '—']) },
      { title: t('المدفوعات'), headers: ['#', t('عن شهر'), t('المبلغ'), t('تاريخ الدفع'), t('بواسطة')], rows: h.pays.map((p, i) => [i + 1, monthLabel(p.month), money(p.amount), fmtShortDate(p.date), p.by || '']) }
    ]
  }, `${t('ملف')}-${st.name}.pdf`);
}

/* ================= Payments ================= */
VIEWS.payments = () => ({
  title: t('الدفع'), sub: t('امسح كود الطالب لتسجيل اشتراك الشهر'),
  html: `<div class="stats" id="pay-stats"></div>
  <div class="pay-grid">
    <div class="card scanner-card">
      ${scannerBox('pay-reader')}
      <form class="search-pick" data-form="pay-search" autocomplete="off">
        <div class="input-icon">${I.search}<input id="pay-search" data-input="pay-search" placeholder="${t('أو ابحث بالاسم أو الكود...')}"></div>
        <div class="suggest" id="pay-suggest"></div>
      </form>
    </div>
    <div class="card pay-panel" id="pay-panel"></div>
  </div>
  <div class="card" id="pay-today"></div>`,
  mount() { renderPaySummary(); renderPayPanel(); scanHandler = payScan; }
});
function renderPaySummary() {
  const d = DB.data, tk = todayKey(), mk = monthKey();
  const today = d.payments.filter(p => todayKey(new Date(p.date)) === tk).sort((a, b) => b.date - a.date);
  const month = d.payments.filter(p => p.month === mk);
  const paidIds = new Set(month.map(p => p.sid));
  const st = $('#pay-stats'); if (!st) return;
  st.innerHTML = stat('wallet', t('دفعوا اليوم'), new Set(today.map(p => p.sid)).size, money(sum(today)), 'c')
    + stat('calendar', t('دفعوا شهر {m}', { m: monthName(mk) }), paidIds.size, t('من {n} طالب', { n: d.students.length }), 'd')
    + stat('coins', t('محصّل شهر {m}', { m: monthName(mk) }), money(sum(month)), t('{n} عملية دفع', { n: month.length }), 'b');
  $('#pay-today').innerHTML = `<div class="card-head"><h3>${I.history}<span>${t('مدفوعات اليوم')}</span></h3><span class="muted">${money(sum(today))}</span></div>${paymentsTable(today)}`;
}
function paymentsTable(list, showDate = false) {
  if (!list.length) return `<div class="empty-mini">${I.wallet}<p>${t('لا توجد مدفوعات بعد')}</p></div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>${showDate ? t('التاريخ') : t('الوقت')}</th><th>${t('الطالب')}</th><th>${t('الصف')}</th><th>${t('عن شهر')}</th><th>${t('المبلغ')}</th><th>${t('بواسطة')}</th><th></th></tr></thead><tbody>${list.map(p => `<tr>
    <td class="muted">${showDate ? fmtShortDate(p.date) : fmtTime(p.date)}</td><td>${studentById(p.sid) ? `<button class="link-name" data-act="stu-view" data-id="${p.sid}">${esc(p.name)}</button>` : `<b>${esc(p.name)}</b>`}</td><td>${chip(classById(p.classId))}</td>
    <td>${monthLabel(p.month)}</td><td><b class="money">${money(p.amount)}</b></td><td class="muted">${esc(p.by || '')}</td>
    <td class="actions">${isAdmin() ? `<button class="icon-btn sm danger" data-act="pay-del" data-id="${p.id}" title="${t('حذف')}">${I.trash}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderPayPanel() {
  const el = $('#pay-panel'); if (!el) return;
  const st = state.payStudentId && studentById(state.payStudentId);
  if (!st) {
    el.innerHTML = `<div class="pay-empty"><div class="pulse-qr">${I.qr}</div><h3>${t('امسح كود الطالب')}</h3><p class="muted">${t('سيظهر اسم الطالب هنا لتسجيل المبلغ والشهر')}</p></div>`;
    return;
  }
  const cls = classById(st.classId);
  const paidMonths = new Map();
  DB.data.payments.filter(p => p.sid === st.id).forEach(p => paidMonths.set(p.month, (paidMonths.get(p.month) || 0) + Number(p.amount)));
  const months = monthRange(), cur = monthKey();
  const defMonth = !paidMonths.has(cur) ? cur : (months.find(m => m > cur && !paidMonths.has(m)) || cur);
  const last = DB.data.payments.filter(p => p.sid === st.id).sort((a, b) => b.date - a.date)[0];
  const amount = cls?.fee || last?.amount || '';
  el.innerHTML = `<div class="pay-student pop">
      ${avatar(st.name, 'lg')}
      <div class="ps-info"><h2><button class="link-name" data-act="stu-view" data-id="${st.id}">${esc(st.name)}</button></h2><p>${chip(cls)} <span class="code-chip">${esc(st.code || '—')}</span></p></div>
      <button class="icon-btn" data-act="pay-clear" title="${t('إغلاق')}">${I.x}</button>
    </div>
    <div class="month-chips" title="${t('الشهور المدفوعة')}">${months.map(m => `<span class="mchip ${paidMonths.has(m) ? 'paid' : ''} ${m === cur ? 'cur' : ''}" title="${paidMonths.has(m) ? money(paidMonths.get(m)) : t('لم يدفع')}">${paidMonths.has(m) ? I.check : ''}${monthName(m)}</span>`).join('')}</div>
    <form data-form="pay" class="pay-form" autocomplete="off"><input type="hidden" name="sid" value="${st.id}">
      <label class="field"><span>${t('المدفوع')}</span><div class="money-input"><input id="pay-amount" name="amount" type="number" min="1" step="any" inputmode="decimal" value="${esc(amount)}" required><em>${t('ج.م')}</em></div></label>
      <label class="field"><span>${t('عن شهر')}</span><select id="pay-month" name="month">${months.map(m => `<option value="${m}" ${m === defMonth ? 'selected' : ''}>${monthLabel(m)}${paidMonths.has(m) ? ' ✓' : ''}</option>`).join('')}</select></label>
      <button class="btn primary lg block">${I.check}<span>${t('حفظ الدفع')}</span></button>
    </form>`;
  setTimeout(() => $('#pay-amount')?.select(), 60);
}
function payScan(code) {
  const st = studentByCode(code);
  if (!st) { flash('error', t('كود غير مسجل'), code, t('هذا الكود غير مرتبط بأي طالب')); return; }
  state.payStudentId = st.id; beep('success'); renderPayPanel();
}

/* ================= Accounts ================= */
function accountsData(m) {
  const d = DB.data;
  const pays = d.payments.filter(p => m === 'all' || p.month === m);
  const rows = d.classes.map(c => {
    const st = studentsOf(c.id), cp = pays.filter(p => p.classId === c.id);
    const stIds = new Set(st.map(s => s.id));
    const paid = new Set(cp.map(p => p.sid).filter(id => stIds.has(id))).size;
    const fee = feeFor(c.id), collected = sum(cp), ded = fee * cp.length;
    return { c, students: st.length, paid, unpaid: st.length - paid, count: cp.length, collected, fee, ded, net: collected - ded, custom: d.classFees[c.id] !== undefined };
  });
  const orphan = pays.filter(p => !classById(p.classId));
  if (orphan.length) {
    const fee = Number(S().placeFee || 0), collected = sum(orphan);
    rows.push({ c: { id: '_', name: t('صفوف محذوفة'), color: '#8a8fa3' }, students: 0, paid: new Set(orphan.map(p => p.sid)).size, unpaid: 0, count: orphan.length, collected, fee, ded: fee * orphan.length, net: collected - fee * orphan.length, orphan: true });
  }
  const tot = rows.reduce((a, r) => ({ students: a.students + r.students, paid: a.paid + r.paid, unpaid: a.unpaid + r.unpaid, count: a.count + r.count, collected: a.collected + r.collected, ded: a.ded + r.ded, net: a.net + r.net }), { students: 0, paid: 0, unpaid: 0, count: 0, collected: 0, ded: 0, net: 0 });
  return { pays, rows, tot };
}
VIEWS.accounts = () => {
  const d = DB.data, m = state.accMonth;
  const months = [...new Set([monthKey(), ...d.payments.map(p => p.month)])].sort().reverse();
  const { rows, tot } = accountsData(m);
  const max = Math.max(1, ...rows.map(r => r.collected));
  const all = m === 'all';
  return {
    title: t('الحسابات'), sub: all ? t('كل الشهور') : monthLabel(m),
    actions: `<button class="btn glass" data-act="acc-pdf">${I.download}<span>${t('تقرير PDF')}</span></button>`,
    html: `<div class="card acc-bar">
      <label class="field inline"><span>${I.calendar}${t('الفترة')}</span><select id="acc-month" data-change="acc-month"><option value="all" ${all ? 'selected' : ''}>${t('كل الشهور')}</option>${months.map(x => `<option value="${x}" ${x === m ? 'selected' : ''}>${monthLabel(x)}</option>`).join('')}</select></label>
      <form data-form="place-fee" class="fee-form">
        <label class="field inline"><span>${I.home}${t('فلوس المكان عن كل طالب')}</span><div class="money-input"><input id="place-fee" name="fee" type="number" min="0" step="any" value="${Number(S().placeFee || 0)}"><em>${t('ج.م')}</em></div></label>
        <button class="btn primary">${t('حفظ')}</button>
      </form>
    </div>
    <div class="stats">
      ${stat('coins', t('إجمالي المحصّل'), money(tot.collected), t('{n} عملية دفع', { n: tot.count }), 'b')}
      ${stat('home', t('خصم المكان'), money(tot.ded), t('{f} × {n} طالب', { f: money(S().placeFee || 0), n: tot.count }), 'c')}
      ${stat('wallet', t('الصافي'), money(tot.net), t('بعد خصم المكان'), 'a')}
      ${stat('users', t('دفعوا'), tot.paid, all ? t('في كل الشهور') : t('لم يدفع {n} طالب', { n: tot.unpaid }), 'd')}
    </div>
    <div class="card"><div class="card-head"><h3>${I.layers}<span>${t('حسابات الصفوف')}</span></h3><small class="muted">${t('يمكنك تحديد فلوس مكان مختلفة لكل صف')}</small></div>
    ${rows.length ? `<div class="table-wrap"><table class="table acc-table"><thead><tr><th>${t('الصف')}</th><th>${t('الطلاب')}</th><th>${t('دفعوا')}</th><th>${t('لم يدفعوا')}</th><th>${t('المحصّل')}</th><th>${t('المكان / طالب')}</th><th>${t('إجمالي الخصم')}</th><th>${t('الصافي')}</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${chip(r.c)}</td><td class="num">${r.students}</td><td class="num"><b class="ok-text">${r.paid}</b></td><td class="num">${all || r.orphan ? '—' : `<b class="bad-text">${r.unpaid}</b>`}</td><td class="num"><b>${money(r.collected)}</b></td>
        <td>${r.orphan ? money(r.fee) : `<div class="money-input sm ${r.custom ? 'custom' : ''}"><input type="number" min="0" step="any" value="${r.custom ? r.fee : ''}" placeholder="${Number(S().placeFee || 0)}" data-change="class-fee" data-id="${r.c.id}" aria-label="${t('فلوس المكان')}"><em>${t('ج.م')}</em></div>`}</td>
        <td class="num muted">− ${money(r.ded)}</td><td class="num"><b class="money">${money(r.net)}</b></td>
        <td class="actions">${r.orphan ? '' : `<button class="btn ghost sm" data-act="acc-unpaid" data-id="${r.c.id}">${t('غير الدافعين')}</button>`}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>${t('الإجمالي')}</td><td class="num">${tot.students}</td><td class="num">${tot.paid}</td><td class="num">${all ? '—' : tot.unpaid}</td><td class="num">${money(tot.collected)}</td><td></td><td class="num">− ${money(tot.ded)}</td><td class="num">${money(tot.net)}</td><td></td></tr></tfoot></table></div>` : emptyState('layers', t('لا توجد صفوف بعد'))}
    </div>
    ${rows.length ? `<div class="card"><div class="card-head"><h3>${I.chart}<span>${t('توزيع المحصّل على الصفوف')}</span></h3></div><div class="hbars">${rows.map(r => `<div class="hbar" style="--c:${r.c.color}"><span class="hb-name">${esc(r.c.name)}</span><div class="hb-track"><span class="hb-total" style="width:${r.collected / max * 100}%"><span class="hb-net" style="width:${r.collected ? Math.max(0, r.net) / r.collected * 100 : 0}%"></span></span></div><b class="num">${money(r.collected)}</b></div>`).join('')}</div><div class="legend"><span><i class="lg-net"></i>${t('الصافي')}</span><span><i class="lg-ded"></i>${t('خصم المكان')}</span></div></div>` : ''}`
  };
};
function unpaidModal(cid) {
  const c = classById(cid); if (!c) return;
  const m = state.accMonth === 'all' ? monthKey() : state.accMonth;
  const paid = new Set(DB.data.payments.filter(p => p.month === m).map(p => p.sid));
  const list = studentsOf(cid).filter(s => !paid.has(s.id));
  const msg = name => t('السلام عليكم، نذكّر سيادتكم بموعد سداد اشتراك شهر {m} للطالب/ة {n}. مع تحيات {t}', { m: monthLabel(m), n: name, t: S().teacherName ? t('أ/ {n}', { n: S().teacherName }) : '' });
  openModal({
    title: t('لم يدفعوا شهر {m} — {c}', { m: monthLabel(m), c: esc(c.name) }), size: 'md',
    body: list.length ? `<div class="absent-list">${list.map(s => `<div class="ab-item">${avatar(s.name)}<div class="p-info"><b>${esc(s.name)}</b><small dir="ltr">${esc(s.parentPhone || s.whatsapp || '')}</small></div>${(s.parentPhone || s.whatsapp) ? `<a class="btn sm wa" target="_blank" rel="noopener" href="${waLink(s.parentPhone || s.whatsapp, msg(s.name))}">${I.chat}<span>${t('تذكير')}</span></a>` : ''}</div>`).join('')}</div>` : `<p class="full-att">${I.check}<span>${t('كل طلاب الصف دفعوا هذا الشهر')}</span></p>`
  });
}

/* ================= QR Codes ================= */
VIEWS.codes = () => {
  const s = S(), cols = s.qrCols || 4, rows = s.qrRows || 5, batches = DB.data.batches;
  const assigned = new Set(DB.data.students.map(x => x.code).filter(Boolean));
  const stepper = (name, val, max, label) => `<label class="field"><span>${label}</span><div class="stepper"><button type="button" data-act="step" data-f="${name}" data-d="-1" aria-label="-">−</button><input id="gen-${name}" name="${name}" type="number" min="1" max="${max}" value="${val}" data-input="gen-preview"><button type="button" data-act="step" data-f="${name}" data-d="1" aria-label="+">+</button></div></label>`;
  return {
    title: t('الأكواد'), sub: t('توليد وطباعة أكواد QR للصقها على كتب الطلاب'),
    html: `<div class="codes-grid">
      <div class="card gen-card">
        <div class="card-head"><h3>${I.qr}<span>${t('توليد أكواد جديدة')}</span></h3></div>
        <form data-form="gen" id="gen-form" autocomplete="off" class="stack">
          <div class="next-code"><div><small>${t('أول كود في الدفعة الجديدة')}</small><b dir="ltr">${formatCode(s.nextCode)}</b></div><div class="nc-qr">${qrSvg(formatCode(s.nextCode))}</div></div>
          <div class="form-grid three">
            ${stepper('cols', cols, 8, t('أكواد في الصف (عرض)'))}
            ${stepper('rows', rows, 12, t('صفوف في الورقة (طول)'))}
            <label class="field"><span>${t('عدد الأكواد')} <button type="button" class="link sm" data-act="gen-fill">${t('ورقة كاملة')}</button></span><input id="gen-count" name="count" type="number" min="1" max="2000" value="${cols * rows}" data-input="gen-preview" data-auto="1"></label>
          </div>
          <div class="gen-info" id="gen-info"></div>
          <div class="btn-row"><button class="btn primary lg" name="mode" value="pdf">${I.download}<span>${t('توليد وتنزيل PDF')}</span></button><button class="btn glass lg" name="mode" value="print">${I.printer}<span>${t('توليد وطباعة')}</span></button></div>
        </form>
      </div>
      <div class="card preview-card"><div class="card-head"><h3>${I.eye}<span>${t('معاينة ورقة A4')}</span></h3><small class="muted mono" id="a4-cap"></small></div><div class="a4-wrap"><div class="a4" id="a4-preview"></div></div></div>
    </div>
    <div class="card"><div class="card-head"><h3>${I.history}<span>${t('الأكواد السابقة')}</span></h3><span class="muted">${t('{n} دفعة', { n: batches.length })}</span></div>
    ${batches.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>${t('التاريخ')}</th><th>${t('من — إلى')}</th><th>${t('العدد')}</th><th>${t('التخطيط')}</th><th>${t('مربوط بطلاب')}</th><th></th></tr></thead><tbody>${batches.map(b => {
      let used = 0; for (let n = b.from; n <= b.to; n++) if (assigned.has(formatCode(n, b.prefix))) used++;
      return `<tr><td>${fmtShortDate(b.createdAt)}<small class="muted block">${fmtTime(b.createdAt)}</small></td><td><span class="mono" dir="ltr">${formatCode(b.from, b.prefix)} → ${formatCode(b.to, b.prefix)}</span></td><td class="num"><b>${b.count}</b></td><td class="num mono">${b.cols} × ${b.rows}</td><td><div class="mini-bar"><span style="width:${Math.round(used / b.count * 100)}%"></span></div><small class="muted">${used} / ${b.count}</small></td>
      <td class="actions"><button class="icon-btn sm" data-act="batch-view" data-id="${b.id}" title="${t('عرض')}">${I.eye}</button><button class="icon-btn sm" data-act="batch-pdf" data-id="${b.id}" title="${t('تنزيل PDF')}">${I.download}</button><button class="icon-btn sm" data-act="batch-print" data-id="${b.id}" title="${t('طباعة')}">${I.printer}</button>${isAdmin() ? `<button class="icon-btn sm danger" data-act="batch-del" data-id="${b.id}" title="${t('حذف من السجل')}">${I.trash}</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>` : `<div class="empty-mini">${I.qr}<p>${t('لم يتم توليد أكواد بعد')}</p></div>`}</div>`,
    mount() { updateGenPreview(); }
  };
};
function updateGenPreview() {
  const f = $('#gen-form'); if (!f) return;
  const cols = clamp(+f.cols.value || 1, 1, 8), rows = clamp(+f.rows.value || 1, 1, 12), per = cols * rows;
  if (f.count.dataset.auto === '1') f.count.value = per;
  const count = clamp(+f.count.value || 0, 0, 2000);
  const from = S().nextCode, to = from + Math.max(count, 1) - 1;
  $('#gen-info').innerHTML = `<div><small>${t('من')}</small><b dir="ltr" class="mono">${formatCode(from)}</b></div><div><small>${t('إلى')}</small><b dir="ltr" class="mono">${formatCode(to)}</b></div><div><small>${t('أوراق A4')}</small><b>${Math.ceil(count / per) || 0}</b></div><div><small>${t('كود في الورقة')}</small><b>${per}</b></div>`;
  const n = Math.min(per, count), a4 = $('#a4-preview');
  a4.style.setProperty('--cols', cols); a4.style.setProperty('--rows', rows);
  a4.style.setProperty('--fs', Math.max(5, 13 - cols * 1.2) + 'px');
  a4.innerHTML = Array.from({ length: per }, (_, i) => i < n ? `<div class="a4-cell"><div class="a4-qr">${qrSvg(formatCode(from + i))}</div><span dir="ltr">${formatCode(from + i)}</span></div>` : `<div class="a4-cell empty"></div>`).join('');
  $('#a4-cap').textContent = `${cols} × ${rows}`;
}
async function codesPdf(b) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 7, cols = b.cols, rows = b.rows, per = cols * rows;
  const cw = (W - 2 * M) / cols, ch = (H - 2 * M) / rows;
  try { await document.fonts?.ready; } catch (e) { }
  const s = S();
  const label = s.teacherName ? textImage(`${t('أ/ {n}', { n: s.teacherName })}${s.subject ? ' · ' + s.subject : ''}`) : null;
  for (let i = 0; i < b.count; i++) {
    const k = i % per; if (i && k === 0) doc.addPage();
    const x = M + (k % cols) * cw, y = M + Math.floor(k / cols) * ch;
    doc.setDrawColor(200, 200, 210); doc.setLineWidth(0.2); doc.setLineDashPattern([1.2, 1.2], 0); doc.rect(x, y, cw, ch); doc.setLineDashPattern([], 0);
    const code = formatCode(b.from + i, b.prefix);
    const padd = Math.min(cw, ch) * 0.09;
    const showLabel = label && ch >= 26 && cw >= 26;
    const fs = Math.max(6, Math.min(14, cw * 0.3));
    const codeH = fs * 0.3528 * 1.25;
    const labelH = showLabel ? Math.min(4.5, ch * 0.08) : 0;
    const size = Math.max(5, Math.min(cw - padd * 2, ch - padd * 2 - codeH - labelH - 1));
    const by = y + (ch - (size + 1 + codeH + labelH)) / 2;
    doc.setFillColor(16, 19, 31); drawQR(doc, code, x + (cw - size) / 2, by, size);
    doc.setFont('courier', 'bold'); doc.setFontSize(fs); doc.setTextColor(16, 19, 31);
    doc.text(code, x + cw / 2, by + size + 1 + codeH * 0.78, { align: 'center' });
    if (showLabel) {
      let lw = Math.min(cw - padd * 2, labelH * label.ratio), lh = lw / label.ratio;
      doc.addImage(label.url, 'PNG', x + (cw - lw) / 2, by + size + 1 + codeH, lw, lh, 'lbl');
    }
  }
  return doc;
}
function printDoc(doc) {
  const url = URL.createObjectURL(doc.output('blob'));
  const ifr = document.createElement('iframe');
  ifr.className = 'print-frame'; ifr.src = url;
  document.body.appendChild(ifr);
  ifr.onload = () => {
    try { ifr.contentWindow.focus(); ifr.contentWindow.print(); }
    catch (e) { window.open(url, '_blank'); }
    setTimeout(() => { ifr.remove(); URL.revokeObjectURL(url); }, 120000);
  };
}
async function outputBatch(b, mode) {
  if (!window.jspdf || !window.qrcode) { toast(t('مكتبات PDF لم تُحمّل — تأكد من الاتصال بالإنترنت'), 'error'); return; }
  busy(true, t('جاري تجهيز ملف الأكواد...'));
  try {
    const doc = await codesPdf(b);
    if (mode === 'print') printDoc(doc);
    else doc.save(`QR-${b.prefix}-${pad(b.from, 4)}-${pad(b.to, 4)}.pdf`);
  } catch (e) { console.error(e); toast(t('حدث خطأ أثناء إنشاء الملف'), 'error'); }
  busy(false);
}
function batchModal(b) {
  const map = Object.fromEntries(DB.data.students.filter(s => s.code).map(s => [s.code, s]));
  const nums = Array.from({ length: Math.min(b.count, 400) }, (_, i) => b.from + i);
  openModal({
    title: `${t('دفعة أكواد')} <span class="mono" dir="ltr">${formatCode(b.from, b.prefix)} → ${formatCode(b.to, b.prefix)}</span>`, size: 'lg',
    body: `<div class="qr-grid">${nums.map(n => { const c = formatCode(n, b.prefix), s = map[c]; return `<div class="qr-tile ${s ? 'used' : ''}"><div class="qt-qr">${qrSvg(c)}</div><b dir="ltr" class="mono">${c}</b><small>${s ? esc(s.name) : t('غير مستخدم')}</small></div>`; }).join('')}</div>${b.count > 400 ? `<p class="muted center">${t('يتم عرض أول 400 كود فقط')}</p>` : ''}`,
    footer: `<button class="btn ghost" data-act="batch-print" data-id="${b.id}">${I.printer}<span>${t('طباعة')}</span></button><button class="btn primary" data-act="batch-pdf" data-id="${b.id}">${I.download}<span>${t('تنزيل PDF')}</span></button>`
  });
}

/* ================= Settings ================= */
VIEWS.settings = () => {
  const s = S(), admin = isAdmin();
  const sec = (icon, title, body) => `<section class="card set-card"><div class="card-head"><h3>${I[icon]}<span>${title}</span></h3></div>${body}</section>`;
  const appearance = `
    <div class="set-row"><div><b>${t('وضع الألوان')}</b><small>${t('نهاري أو ليلي')}</small></div><div class="seg">${['light', 'dark'].map(m => `<button class="${s.theme === m ? 'on' : ''}" data-act="set-theme" data-v="${m}">${m === 'light' ? I.sun : I.moon}<span>${m === 'light' ? t('نهاري') : t('ليلي')}</span></button>`).join('')}</div></div>
    <div class="set-row"><div><b>${t('لون الواجهة')}</b><small>${t('اختر اللون المميز')}</small></div><div class="accent-pick">${Object.entries(ACCENTS).map(([k, [a]]) => `<button class="acc ${s.accent === k ? 'on' : ''}" style="--a:${a}" data-act="set-accent" data-v="${k}" aria-label="${k}"></button>`).join('')}</div></div>
    <div class="set-row"><div><b>${t('اللغة')}</b><small>${t('لغة الواجهة والتقارير')}</small></div><div class="seg"><button class="${s.lang === 'ar' ? 'on' : ''}" data-act="set-lang" data-v="ar">العربية</button><button class="${s.lang === 'en' ? 'on' : ''}" data-act="set-lang" data-v="en">English</button></div></div>
    <div class="set-row"><div><b>${t('أصوات المسح')}</b><small>${t('صوت عند تسجيل الحضور أو الخطأ')}</small></div><label class="switch"><input id="sound-tg" type="checkbox" data-change="sound" ${s.sound !== false ? 'checked' : ''}><i></i></label></div>`;
  const profile = `<form data-form="profile" class="form-grid">${field('teacherName', t('اسم المدرس'), 'text', { value: s.teacherName, required: true })}${field('subject', t('المادة'), 'text', { value: s.subject })}${field('centerName', t('اسم السنتر / المكان'), 'text', { value: s.centerName, cls: 'span2' })}<div class="span2 end"><button class="btn primary">${I.check}<span>${t('حفظ')}</span></button></div></form>`;
  const users = `<div class="users">${DB.data.users.map(u => `<div class="user-row">${avatar(u.name)}<div class="ur-info"><b>${esc(u.name)}${u.id === currentUser.id ? ` <em class="muted">(${t('أنت')})</em>` : ''}</b><small dir="ltr">@${esc(u.username)}</small></div><span class="badge ${u.role === 'admin' ? 'acc' : 'soft'}">${u.role === 'admin' ? t('مدرس / مدير') : t('مساعد')}</span>${u.role === 'admin' ? '' : `<div class="perm-chips">${PERM_SECTIONS.filter(k => permsOf(u)[k]).map(k => `<span class="pchip">${I[NAV.find(n => n.id === k).icon]}${t(NAV.find(n => n.id === k).label)}</span>`).join('') || `<span class="muted small">${t('مفيش أقسام مفتوحة')}</span>`}</div>`}<div class="actions">${u.id !== currentUser.id ? `<button class="btn sm ghost" data-act="user-perms" data-id="${u.id}">${I.shield}<span>${t('الصلاحيات')}</span></button>` : ''}${Cloud.enabled ? '' : `<button class="icon-btn sm" data-act="user-reset" data-id="${u.id}" title="${t('تغيير كلمة المرور')}">${I.key}</button>`}${u.id !== currentUser.id ? `<button class="icon-btn sm danger" data-act="user-del" data-id="${u.id}" title="${t('حذف')}">${I.trash}</button>` : ''}</div></div>`).join('')}</div>
    <p class="muted small">${t('اضغط «الصلاحيات» جنب أي مساعد عشان تحدد الأقسام اللي تظهرله. المساعد بيضيف بس، والمسح وتعديل المدفوعات للمدير فقط.')}</p>
    <button class="btn glass" data-act="user-add">${I.plus}<span>${t('إضافة مساعد')}</span></button>`;
  const codes = `<form data-form="codeset" class="form-grid">${field('prefix', t('بادئة الكود'), 'text', { value: s.prefix, dir: 'ltr', required: true, attrs: 'maxlength="8" pattern="[A-Za-z0-9]+"' })}${field('nextCode', t('رقم الكود التالي'), 'number', { value: s.nextCode, attrs: 'min="1"' })}<p class="muted small span2">${t('مثال: ASMA-0001. تقليل الرقم التالي قد يكرر أكواداً تمت طباعتها من قبل.')}</p><div class="span2 end"><button class="btn primary">${I.check}<span>${t('حفظ')}</span></button></div></form>`;
  const mine = `<form data-form="my-pass" class="form-grid">${field('old', t('كلمة المرور الحالية'), 'password', { required: true })}${field('pass', t('كلمة المرور الجديدة'), 'password', { required: true, attrs: 'minlength="6"' })}<div class="span2 end"><button class="btn primary">${I.key}<span>${t('تغيير كلمة المرور')}</span></button></div></form>`;
  const backup = `<p class="muted small">${Cloud.enabled ? t('البيانات محفوظة على السحابة وبتتزامن مع كل الأجهزة. تقدر برضه تنزّل نسخة احتياطية، أو ترفع نسخة قديمة من الجهاز للسحابة.') : t('البيانات محفوظة على هذا الجهاز وفي هذا المتصفح فقط. نزّل نسخة احتياطية بشكل دوري لتنقلها لجهاز آخر أو تسترجعها.')}</p>
    ${Cloud.enabled ? `<div class="btn-row"><button class="btn glass" data-act="cloud-backups">${I.history}<span>${t('النسخ اليومية التلقائية')}</span></button><button class="btn glass" data-act="trash">${I.trash}<span>${t('سلة المحذوفات')}</span></button></div>` : ''}
    <div class="btn-row"><button class="btn glass" data-act="export-data">${I.download}<span>${t('تنزيل نسخة احتياطية')}</span></button><label class="btn glass">${I.upload}<span>${t('استرجاع نسخة')}</span><input type="file" accept=".json,application/json" data-change="import" hidden></label><button class="btn danger-ghost" data-act="reset-all">${I.trash}<span>${t('مسح كل البيانات')}</span></button></div>`;
  return {
    title: t('الإعدادات'), sub: t('تخصيص النظام والحسابات'),
    html: `<div class="settings-grid">${admin ? sec('user', t('بيانات المدرس'), profile) : ''}${sec('palette', t('المظهر واللغة'), appearance)}${admin ? sec('shield', t('حسابات المساعدين'), users) : ''}${admin ? sec('qr', t('إعدادات الأكواد'), codes) : ''}${sec('key', t('حسابي'), mine)}${admin ? sec('db', t('النسخ الاحتياطي'), backup) : ''}</div>`
  };
};
function permsFields(u) {
  const p = permsOf(u), admin = u.role === 'admin';
  return `<div class="field"><span>${t('نوع الحساب')}</span><div class="seg role-seg"><label class="${admin ? '' : 'on'}"><input type="radio" name="role" value="assistant" ${admin ? '' : 'checked'} data-change="role-pick">${I.user}<span>${t('مساعد')}</span></label><label class="${admin ? 'on' : ''}"><input type="radio" name="role" value="admin" ${admin ? 'checked' : ''} data-change="role-pick">${I.shield}<span>${t('مدير (كل الصلاحيات)')}</span></label></div></div>
  <div class="perm-list" ${admin ? 'hidden' : ''}><span class="perm-title">${t('الأقسام اللي تظهر للمساعد')}</span>${PERM_SECTIONS.map(k => { const n = NAV.find(x => x.id === k); return `<label class="perm-row"><span class="perm-ic">${I[n.icon]}</span><span class="perm-txt"><b>${t(n.label)}</b><small>${t(PERM_HINTS[k])}</small></span><span class="switch"><input type="checkbox" name="perm_${k}" ${p[k] ? 'checked' : ''}><i></i></span></label>`; }).join('')}</div>`;
}
const PERM_HINTS = {
  dashboard: 'ملخص اليوم وآخر الحصص',
  attendance: 'بدء الحصة ومسح الأكواد وأخذ الغياب',
  students: 'إضافة الطلاب وتعديل بياناتهم',
  payments: 'تسجيل اشتراكات الطلاب',
  accounts: 'المحصّل والصافي وفلوس المكان',
  codes: 'توليد وطباعة أكواد QR'
};
const readPerms = fd => Object.fromEntries(PERM_SECTIONS.map(k => [k, fd.get('perm_' + k) === 'on']));
function permsModal(u) {
  openModal({
    title: t('صلاحيات {n}', { n: esc(u.name) }), size: 'sm',
    body: `<form data-form="perms" id="perms-form" class="stack"><input type="hidden" name="id" value="${u.id}">${permsFields(u)}</form>`,
    footer: `<button class="btn ghost" data-act="close-modal">${t('إلغاء')}</button><button class="btn primary" type="submit" form="perms-form">${I.check}<span>${t('حفظ الصلاحيات')}</span></button>`
  });
}
function userModal(u) {
  openModal({
    title: u ? t('تغيير كلمة مرور {n}', { n: esc(u.name) }) : t('إضافة مساعد'), size: 'sm',
    body: `<form data-form="user" id="user-form" class="stack" autocomplete="off"><input type="hidden" name="id" value="${u?.id || ''}">
      ${u ? '' : field('name', t('اسم المساعد'), 'text', { required: true }) + field('username', t('اسم المستخدم'), 'text', { required: true, dir: 'ltr' })}
      ${field('pass', t('كلمة المرور'), 'password', { required: true, attrs: 'minlength="6" autocomplete="new-password"' })}
      ${u ? '' : permsFields({ role: 'assistant' })}
    </form>`,
    footer: `<button class="btn ghost" data-act="close-modal">${t('إلغاء')}</button><button class="btn primary" type="submit" form="user-form">${I.check}<span>${t('حفظ')}</span></button>`
  });
}

/* ================= PDF reports (HTML → canvas, so Arabic renders correctly) ================= */
async function buildReportPdf({ title, subtitle, meta = [], stats = [], sections = [] }, filename) {
  if (!window.jspdf || !window.html2canvas) { toast(t('مكتبات PDF لم تُحمّل — تأكد من الاتصال بالإنترنت'), 'error'); return; }
  busy(true, t('جاري تجهيز ملف PDF...'));
  try {
    try { await document.fonts?.ready; } catch (e) { }
    const host = document.createElement('div');
    host.className = 'pdf-host'; host.dir = isEn() ? 'ltr' : 'rtl';
    document.body.appendChild(host);
    const pages = [];
    const [acc, onAcc] = ACCENTS[S().accent] || ACCENTS.marigold;
    const logo = `<svg viewBox="0 0 48 48" width="44" height="44"><rect width="48" height="48" rx="13" fill="${acc}"/><path d="m16 24.5 5.5 5.5 10-11" stroke="${onAcc}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const head = full => full ? `<div class="pdf-head"><div class="pdf-brand">${logo}<div><b>${esc(title)}</b><small>${esc(subtitle)}</small></div></div><div class="pdf-date">${t('تاريخ الطباعة')}<br><b>${fmtShortDate(Date.now())}</b></div></div>
      ${meta.length ? `<div class="pdf-meta">${meta.filter(m => m[1] !== '' && m[1] != null).map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
      ${stats.length ? `<div class="pdf-stats">${stats.map(([k, v, tone]) => `<div class="${tone || ''}"><b>${esc(v)}</b><small>${esc(k)}</small></div>`).join('')}</div>` : ''}`
      : `<div class="pdf-head small"><div class="pdf-brand">${logo}<div><b>${esc(title)}</b><small>${esc(subtitle)}</small></div></div></div>`;
    const newPage = full => {
      const p = document.createElement('div'); p.className = 'pdf-page';
      p.innerHTML = `<div class="pdf-inner">${head(full)}</div><div class="pdf-foot"></div>`;
      host.appendChild(p); pages.push(p); return p.querySelector('.pdf-inner');
    };
    let inner = newPage(true);
    const fits = () => inner.scrollHeight <= inner.clientHeight + 1;
    for (const sec of sections) {
      const addTable = cont => {
        const w = document.createElement('div'); w.className = 'pdf-sec ' + (sec.tone || '');
        w.innerHTML = `<div class="pdf-sec-title"><span>${esc(sec.title)}${cont ? ' — ' + t('تابع') : ''}</span><b>${sec.count ?? sec.rows.length}</b></div><table><thead><tr>${sec.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody></tbody></table>`;
        inner.appendChild(w); return w;
      };
      let w = addTable(false);
      if (!fits()) { w.remove(); inner = newPage(false); w = addTable(false); }
      if (!sec.rows.length) w.querySelector('tbody').innerHTML = `<tr><td colspan="${sec.headers.length}" class="pdf-none">${t('لا يوجد')}</td></tr>`;
      for (const row of sec.rows) {
        const tr = document.createElement('tr');
        if (row.total) tr.className = 'total';
        tr.innerHTML = (row.cells || row).map(c => `<td>${esc(c)}</td>`).join('');
        w.querySelector('tbody').appendChild(tr);
        if (!fits()) { tr.remove(); inner = newPage(false); w = addTable(true); w.querySelector('tbody').appendChild(tr); }
      }
    }
    pages.forEach((p, i) => { p.querySelector('.pdf-foot').innerHTML = `<span>${t('حاضر')}${S().teacherName ? ' · ' + esc(t('أ/ {n}', { n: S().teacherName })) : ''}${S().subject ? ' · ' + esc(S().subject) : ''}</span><span>${t('صفحة {a} من {b}', { a: i + 1, b: pages.length })}</span>`; });
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    for (let i = 0; i < pages.length; i++) {
      const c = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', logging: false, scrollX: 0, scrollY: 0 });
      if (i) doc.addPage();
      doc.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
    }
    host.remove();
    doc.save(filename);
    toast(t('تم تنزيل الملف'), 'success');
  } catch (e) { console.error(e); toast(t('حدث خطأ أثناء إنشاء الملف'), 'error'); }
  busy(false);
}
function sessionPdf(ses) {
  const inCls = ses.present.filter(p => !p.guest).length;
  const pct = ses.total ? Math.round(inCls / ses.total * 100) : 0;
  const s = S();
  return buildReportPdf({
    title: t('تقرير الحضور والغياب'), subtitle: `${ses.className} — ${fmtDate(ses.startedAt)}`,
    meta: [[t('المدرس'), s.teacherName], [t('المادة'), s.subject], [t('الصف'), ses.className], [t('بداية الحصة'), fmtTime(ses.startedAt)], [t('نهاية الحصة'), ses.endedAt ? fmtTime(ses.endedAt) : '—'], [t('سجّلها'), ses.by]],
    stats: [[t('عدد طلاب الصف'), ses.total], [t('الحاضرون'), ses.present.length, 'ok'], [t('الغائبون'), ses.absent.length, 'bad'], [t('نسبة الحضور'), pct + '%']],
    sections: [
      { title: t('الطلاب الحاضرون'), tone: 'ok', headers: ['#', t('اسم الطالب'), t('الكود'), t('وقت الحضور'), t('ملاحظات')], rows: ses.present.map((p, i) => [i + 1, p.name, p.code || '—', fmtTime(p.t), p.guest ? t('من صف آخر') : '']) },
      { title: t('الطلاب الغائبون'), tone: 'bad', headers: ['#', t('اسم الطالب'), t('الكود'), t('واتساب'), t('ولي الأمر')], rows: ses.absent.map((a, i) => [i + 1, a.name, a.code || '—', a.whatsapp || '—', a.parent || '—']) }
    ]
  }, `${t('حضور')}-${ses.className}-${todayKey(new Date(ses.startedAt))}.pdf`);
}
function accountsPdf() {
  const m = state.accMonth, { pays, rows, tot } = accountsData(m), s = S();
  const period = m === 'all' ? t('كل الشهور') : monthLabel(m);
  return buildReportPdf({
    title: t('تقرير الحسابات'), subtitle: period,
    meta: [[t('المدرس'), s.teacherName], [t('المادة'), s.subject], [t('المكان'), s.centerName], [t('فلوس المكان عن كل طالب'), money(s.placeFee || 0)]],
    stats: [[t('إجمالي المحصّل'), money(tot.collected), 'ok'], [t('خصم المكان'), money(tot.ded), 'bad'], [t('الصافي'), money(tot.net)], [t('عمليات الدفع'), tot.count]],
    sections: [
      { title: t('ملخص الصفوف'), headers: [t('الصف'), t('الطلاب'), t('دفعوا'), t('المحصّل'), t('خصم المكان'), t('الصافي')], count: rows.length, rows: [...rows.map(r => [r.c.name, r.students, r.paid, money(r.collected), money(r.ded), money(r.net)]), { total: true, cells: [t('الإجمالي'), tot.students, tot.paid, money(tot.collected), money(tot.ded), money(tot.net)] }] },
      { title: t('تفاصيل المدفوعات'), headers: ['#', t('التاريخ'), t('الطالب'), t('الصف'), t('عن شهر'), t('المبلغ')], rows: [...pays].sort((a, b) => a.date - b.date).map((p, i) => [i + 1, fmtShortDate(p.date), p.name, classById(p.classId)?.name || '—', monthLabel(p.month), money(p.amount)]) }
    ]
  }, `${t('حسابات')}-${m}.pdf`);
}

/* ================= Event wiring ================= */
const ACT = {
  'go': el => go(el.dataset.view),
  'close-modal': () => closeModal(),
  'flash-close': () => $('#flash').classList.remove('show'),
  'toggle-theme': () => { S().theme = S().theme === 'dark' ? 'light' : 'dark'; DB.save(); applyPrefs(); rerenderAll(); },
  'toggle-lang': () => { S().lang = isEn() ? 'ar' : 'en'; DB.save(); applyPrefs(); rerenderAll(); },
  'logout': () => { Scan.stop(); if (Cloud.enabled) { currentUser = null; authMode = 'login'; Cloud.logout(); return; } try { localStorage.removeItem('hader-uid'); sessionStorage.removeItem('hader-uid'); } catch (e) { } currentUser = null; boot(); },

  // camera
  'cam-start': el => camStart(el.dataset.target),
  'cam-stop': () => camStop(),
  'cam-flip': () => Scan.flip(),

  // attendance
  'start-session': async () => {
    const cid = $('input[name=cls]:checked')?.value; if (!cid) return;
    DB.data.activeSession = { id: uid(), classId: cid, startedAt: Date.now(), by: currentUser.name, present: [] };
    DB.save(); renderShell(); renderView(); camStart('reader');
  },
  'cancel-session': async () => {
    if (!await confirmBox(t('سيتم إلغاء الحصة الحالية بدون حفظ. متابعة؟'), { danger: true, okText: t('إلغاء الحصة') })) return;
    DB.data.activeSession = null; DB.save(); renderShell(); renderView();
  },
  'end-session': async () => {
    const computeAbsent = s => {
      const ids = new Set(s.present.map(p => p.sid));
      return studentsOf(s.classId).filter(x => !ids.has(x.id)).map(x => ({ sid: x.id, name: x.name, code: x.code || '', whatsapp: x.whatsapp || '', parent: x.parentPhone || '' }));
    };
    if (!DB.data.activeSession) return;
    if (!await confirmBox(t('سيتم إنهاء الحصة وتسجيل {n} طالب غائب. متابعة؟', { n: computeAbsent(DB.data.activeSession).length }), { okText: t('إنهاء الحصة') })) return;
    const a = DB.data.activeSession; if (!a) return;   // re-read: other devices may have scanned meanwhile
    a.present = uniquePresent(a.present);
    const cls = classById(a.classId), absent = computeAbsent(a);
    const ses = { ...a, endedAt: Date.now(), className: cls?.name || '', total: studentsOf(a.classId).length, absent };
    DB.data.sessions.unshift(ses); DB.data.activeSession = null; DB.save();
    renderShell(); renderView(); sessionResult(ses);
  },
  'unmark': el => {
    const a = DB.data.activeSession; if (!a) return;
    const removed = a.present.filter(p => p.sid === el.dataset.sid);
    a.present = a.present.filter(p => p.sid !== el.dataset.sid);
    if (Cloud.enabled) Cloud.removePresent(removed); else DB.save();
    updateLive();
  },
  'auth-mode': () => { authMode = authMode === 'setup' ? 'login' : 'setup'; renderAuth(); },
  'session-pdf': el => { const s = DB.data.sessions.find(x => x.id === el.dataset.id); if (s) sessionPdf(s); },
  'session-view': el => { const s = DB.data.sessions.find(x => x.id === el.dataset.id); if (s) sessionResult(s, t('تفاصيل الحصة')); },
  'session-del': async el => {
    if (!await confirmBox(t('حذف هذه الحصة من السجل؟'), { danger: true, okText: t('حذف') })) return;
    DB.data.sessions = DB.data.sessions.filter(x => x.id !== el.dataset.id); DB.save(); renderView();
  },

  // classes & students
  'class-select': el => { state.classId = el.dataset.id; renderView(); },
  'class-add': () => classModal(null),
  'class-edit': el => classModal(classById(el.dataset.id)),
  'class-del': async el => {
    const c = classById(el.dataset.id); if (!c) return;
    const n = studentsOf(c.id).length;
    if (!await confirmBox(n ? t('سيتم حذف الصف "{c}" و{n} طالب بداخله. لا يمكن التراجع.', { c: c.name, n }) : t('حذف الصف "{c}"؟', { c: c.name }), { danger: true, okText: t('حذف') })) return;
    DB.data.classes = DB.data.classes.filter(x => x.id !== c.id);
    DB.data.students = DB.data.students.filter(s => s.classId !== c.id);
    delete DB.data.classFees[c.id];
    DB.save(); state.classId = null; renderView(); toast(t('تم حذف الصف'), 'success');
  },
  'stu-add': () => { if (!DB.data.classes.length) { classModal(null); return; } studentModal(null); },
  'stu-view': el => studentProfile(el.dataset.id),
  'pf-tab': el => { profileTab = el.dataset.v; $$('.pf-tabs button').forEach(b => b.classList.toggle('on', b === el)); $$('.pf-pane').forEach(p => { p.hidden = p.dataset.pane !== profileTab; }); },
  'stu-pdf': el => { const s = studentById(el.dataset.id); if (s) studentPdf(s); },
  'stu-pay': el => { state.payStudentId = el.dataset.id; closeModal(); go('payments'); },
  'stu-edit': el => studentModal(studentById(el.dataset.id)),
  'stu-del': async el => {
    const s = studentById(el.dataset.id); if (!s) return;
    if (!await confirmBox(t('حذف الطالب "{n}"؟', { n: s.name }), { danger: true, okText: t('حذف') })) return;
    DB.data.students = DB.data.students.filter(x => x.id !== s.id); DB.save(); renderView(); toast(t('تم حذف الطالب'), 'success');
  },
  'm-scan': () => { const w = $('#m-scan-wrap'); w.hidden = !w.hidden; if (!w.hidden) camStart('m-reader'); else Scan.stop(); },
  'use-free-code': el => { $('#m-code').value = el.dataset.code; checkModalCode(el.dataset.code); },

  // payments
  'pay-clear': () => { state.payStudentId = null; renderPayPanel(); },
  'pay-pick': el => { state.payStudentId = el.dataset.id; $('#pay-search').value = ''; $('#pay-suggest').innerHTML = ''; renderPayPanel(); },
  'pay-del': async el => {
    if (!await confirmBox(t('حذف عملية الدفع هذه؟'), { danger: true, okText: t('حذف') })) return;
    DB.data.payments = DB.data.payments.filter(p => p.id !== el.dataset.id); DB.save();
    if (state.view === 'payments') { renderPaySummary(); renderPayPanel(); } else renderView();
  },

  // accounts
  'acc-unpaid': el => unpaidModal(el.dataset.id),
  'acc-pdf': () => { if (can('accounts')) accountsPdf(); },

  // codes
  'step': el => { const inp = $(`#gen-${el.dataset.f}`); const max = +inp.max; inp.value = clamp((+inp.value || 0) + (+el.dataset.d), 1, max); updateGenPreview(); },
  'gen-fill': () => { const c = $('#gen-count'); c.dataset.auto = '1'; updateGenPreview(); },
  'batch-pdf': el => { const b = DB.data.batches.find(x => x.id === el.dataset.id); if (b) outputBatch(b, 'pdf'); },
  'batch-print': el => { const b = DB.data.batches.find(x => x.id === el.dataset.id); if (b) outputBatch(b, 'print'); },
  'batch-view': el => { const b = DB.data.batches.find(x => x.id === el.dataset.id); if (b) batchModal(b); },
  'batch-del': async el => {
    if (!await confirmBox(t('حذف هذه الدفعة من السجل؟ الأكواد المربوطة بالطلاب ستظل تعمل.'), { danger: true, okText: t('حذف') })) return;
    DB.data.batches = DB.data.batches.filter(x => x.id !== el.dataset.id); DB.save(); renderView();
  },

  // settings
  'set-theme': el => { S().theme = el.dataset.v; DB.save(); applyPrefs(); rerenderAll(); },
  'set-accent': el => { S().accent = el.dataset.v; DB.save(); applyPrefs(); $$('.acc').forEach(b => b.classList.toggle('on', b === el)); },
  'set-lang': el => { S().lang = el.dataset.v; DB.save(); applyPrefs(); rerenderAll(); },
  'user-add': () => userModal(null),
  'user-perms': el => { const u = DB.data.users.find(x => x.id === el.dataset.id); if (u) permsModal(u); },
  'user-reset': el => userModal(DB.data.users.find(u => u.id === el.dataset.id)),
  'user-del': async el => {
    const u = DB.data.users.find(x => x.id === el.dataset.id); if (!u) return;
    if (!await confirmBox(t('حذف حساب "{n}"؟', { n: u.name }), { danger: true, okText: t('حذف') })) return;
    if (Cloud.enabled) { try { await Cloud.removeUser(u); toast(t('تم حذف الحساب'), 'success'); } catch (e) { toast(Cloud.errMsg(e), 'error'); } return; }
    DB.data.users = DB.data.users.filter(x => x.id !== u.id); DB.save(); renderView();
  },
  'export-data': () => {
    downloadJson(Cloud.enabled ? Cloud.exportData() : DB.data, `hader-backup-${todayKey()}.json`);
    try { localStorage.setItem('hader-last-export', String(Date.now())); } catch (e) { }
    if (state.view === 'dashboard') renderView();
  },
  'cloud-backups': async () => {
    busy(true, t('جاري التحميل...'));
    let list = [];
    try { list = await Cloud.listBackups(); } catch (e) { toast(Cloud.errMsg(e), 'error'); }
    busy(false);
    openModal({
      title: t('النسخ اليومية التلقائية'), size: 'md',
      body: `<p class="muted small">${t('بتتعمل نسخة كاملة تلقائياً كل يوم أول ما المدرس يفتح الموقع، ويتحفظ آخر 30 يوم.')}</p>
      ${list.length ? `<div class="absent-list">${list.map(b => `<div class="ab-item"><div class="avatar sm" style="--h:210">${I.calendar}</div><div class="p-info"><b>${fmtDate(b.createdAt)}</b><small>${t('{s} طالب · {p} دفعة · {m}', { s: b.students, p: b.payments, m: money(b.total || 0) })}</small></div><button class="icon-btn sm" data-act="backup-download" data-day="${b.day}" title="${t('تنزيل')}">${I.download}</button><button class="btn sm ghost" data-act="backup-restore" data-day="${b.day}">${t('استرجاع')}</button></div>`).join('')}</div>` : `<div class="empty-mini">${I.history}<p>${t('لسه مفيش نسخ — أول نسخة هتتعمل النهارده')}</p></div>`}`
    });
  },
  'backup-download': async el => {
    busy(true, t('جاري التحميل...'));
    try { downloadJson(await Cloud.loadBackup(el.dataset.day), `hader-backup-${el.dataset.day}.json`); } catch (e) { toast(Cloud.errMsg(e), 'error'); }
    busy(false);
  },
  'backup-restore': async el => {
    const day = el.dataset.day;
    if (!await confirmBox(t('هترجع كل البيانات لنسخة يوم {d}. أي تعديل بعدها هيروح لسلة المحذوفات. متابعة؟', { d: day }), { danger: true, okText: t('استرجاع') })) return;
    busy(true, t('جاري الاسترجاع...'));
    try { applyImported(await Cloud.loadBackup(day)); toast(t('تم الاسترجاع'), 'success'); } catch (e) { toast(Cloud.errMsg(e), 'error'); }
    busy(false);
  },
  'trash': async () => {
    busy(true, t('جاري التحميل...'));
    let list = [];
    try { list = await Cloud.listTrash(); } catch (e) { toast(Cloud.errMsg(e), 'error'); }
    busy(false);
    const label = { payments: t('دفعة'), students: t('طالب'), sessions: t('حصة'), classes: t('صف'), batches: t('دفعة أكواد') };
    const desc = it => it.col === 'payments' ? `${it.data.name} · ${money(it.data.amount)} · ${monthLabel(it.data.month)}` : it.col === 'sessions' ? `${it.data.className} · ${fmtShortDate(it.data.startedAt)}` : it.col === 'batches' ? `${formatCode(it.data.from, it.data.prefix)} → ${formatCode(it.data.to, it.data.prefix)}` : (it.data.name || '');
    window.__trash = list;
    openModal({
      title: t('سلة المحذوفات'), size: 'md',
      body: list.length ? `<div class="absent-list">${list.map((it, i) => `<div class="ab-item"><span class="badge soft">${label[it.col] || it.col}</span><div class="p-info"><b>${esc(desc(it))}</b><small>${t('اتمسح {d} بواسطة {b}', { d: fmtShortDate(it.deletedAt) + ' ' + fmtTime(it.deletedAt), b: esc(it.by) })}</small></div><button class="btn sm primary" data-act="trash-restore" data-i="${i}">${t('استرجاع')}</button></div>`).join('')}</div>` : `<div class="empty-mini">${I.trash}<p>${t('السلة فاضية')}</p></div>`
    });
  },
  'trash-restore': async el => {
    const it = window.__trash?.[+el.dataset.i]; if (!it) return;
    try { await Cloud.restoreTrash(it); el.closest('.ab-item').remove(); toast(t('تم الاسترجاع'), 'success'); } catch (e) { toast(Cloud.errMsg(e), 'error'); }
  },
  'reset-all': async () => {
    if (!await confirmBox(t('سيتم مسح كل الطلاب والحصص والمدفوعات والحسابات نهائياً من هذا الجهاز. هل نزّلت نسخة احتياطية؟'), { danger: true, okText: t('مسح كل شيء') })) return;
    if (Cloud.enabled) {
      COLS.forEach(c => { DB.data[c] = []; }); DB.data.activeSession = null; DB.data.classFees = {}; S().nextCode = 1;
      DB.save(); renderShell(); renderView(); toast(t('تم مسح البيانات'), 'success'); return;
    }
    try { localStorage.removeItem(DB.key); localStorage.removeItem('hader-uid'); sessionStorage.removeItem('hader-uid'); } catch (e) { }
    DB.load(); boot();
  }
};

const FORMS = {
  async setup(f, fd) {
    const username = String(fd.get('username')).trim().toLowerCase(), pass = String(fd.get('password'));
    if (pass !== fd.get('password2')) return toast(t('كلمتا المرور غير متطابقتين'), 'error');
    if (pass.length < 6) return toast(t('كلمة المرور يجب أن تكون 6 أحرف على الأقل'), 'error');
    if (!/^[a-z0-9._-]{3,}$/.test(username)) return toast(t('اسم المستخدم بالإنجليزية وبدون مسافات (3 أحرف على الأقل)'), 'error');
    const name = String(fd.get('teacherName')).trim();
    if (Cloud.enabled) {
      busy(true, t('جاري إنشاء الحساب...'));
      try { await Cloud.setup({ name, subject: String(fd.get('subject') || '').trim(), username, pass }); toast(t('أهلاً بك! حسابك جاهز'), 'success'); }
      catch (e) { console.error(e); toast(Cloud.errMsg(e), 'error'); }
      busy(false); return;
    }
    S().teacherName = name; S().subject = String(fd.get('subject') || '').trim();
    const u = { id: uid(), name, username, role: 'admin', pass: await passHash(username, pass), createdAt: Date.now() };
    DB.data.users.push(u); DB.save(); loginAs(u, true);
  },
  async login(f, fd) {
    const username = String(fd.get('username')).trim().toLowerCase();
    if (Cloud.enabled) {
      busy(true, t('جاري تسجيل الدخول...'));
      try { await Cloud.login(username, String(fd.get('password')), !!fd.get('remember')); }
      catch (e) { f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); toast(Cloud.errMsg(e), 'error'); }
      busy(false); return;
    }
    const u = DB.data.users.find(x => x.username === username);
    if (!u || u.pass !== await passHash(u.username, String(fd.get('password')))) {
      f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
      return toast(t('اسم المستخدم أو كلمة المرور غير صحيحة'), 'error');
    }
    loginAs(u, !!fd.get('remember'));
  },
  'att-manual'(f, fd) {
    const q = String(fd.get('q') || '').trim(); if (!q) return;
    const a = DB.data.activeSession;
    const st = resolveStudent(q, a ? studentsOf(a.classId) : []);
    if (!st) flash('error', t('لم يتم العثور على الطالب'), q);
    else attendScan(st.code, st);
    f.reset(); $('#att-q')?.focus();
  },
  class(f, fd) {
    const id = fd.get('id'), name = String(fd.get('name')).trim(); if (!name) return;
    const data = { name, fee: Number(fd.get('fee')) || 0, color: fd.get('color') || CLASS_COLORS[0] };
    if (id) Object.assign(classById(id), data);
    else { const c = { id: uid(), createdAt: Date.now(), ...data }; DB.data.classes.push(c); state.classId = c.id; }
    DB.save(); closeModal(); if (state.view === 'students') renderView(); toast(id ? t('تم تعديل الصف') : t('تمت إضافة الصف'), 'success');
  },
  student(f, fd) {
    const id = fd.get('id'), code = normCode(fd.get('code'));
    if (!checkModalCode(code)) return toast(t('هذا الكود مستخدم لطالب آخر'), 'error');
    const data = { name: String(fd.get('name')).trim(), classId: fd.get('classId'), whatsapp: String(fd.get('whatsapp')).trim(), parentPhone: String(fd.get('parentPhone')).trim(), code };
    if (!data.name) return;
    if (id) Object.assign(studentById(id), data);
    else DB.data.students.push({ id: uid(), createdAt: Date.now(), ...data });
    DB.save(); closeModal(); renderView();
    toast(id ? t('تم حفظ التعديلات') : t('تمت إضافة {n}', { n: data.name }), 'success');
    if (!code) toast(t('تنبيه: لم يتم ربط كود بالطالب بعد'));
  },
  'pay-search'(f) {
    const q = $('#pay-search').value.trim(); if (!q) return;
    const st = resolveStudent(q);
    if (!st) return toast(t('لم يتم العثور على الطالب'), 'error');
    state.payStudentId = st.id; $('#pay-search').value = ''; $('#pay-suggest').innerHTML = ''; renderPayPanel();
  },
  async pay(f, fd) {
    const st = studentById(fd.get('sid')); if (!st) return;
    const amount = Number(fd.get('amount')), month = String(fd.get('month'));
    if (!(amount > 0)) return toast(t('أدخل المبلغ المدفوع'), 'error');
    if (DB.data.payments.some(p => p.sid === st.id && p.month === month)) {
      if (!await confirmBox(t('{n} دفع شهر {m} من قبل. تسجيل دفعة إضافية؟', { n: st.name, m: monthLabel(month) }), { okText: t('تسجيل') })) return;
    }
    DB.data.payments.push({ id: uid(), sid: st.id, classId: st.classId, name: st.name, amount, month, date: Date.now(), by: currentUser.name });
    DB.save();
    flash('success', t('تم تسجيل الدفع'), st.name, `${money(amount)} · ${monthLabel(month)}`);
    state.payStudentId = null; document.activeElement?.blur();
    renderPaySummary(); renderPayPanel();
  },
  'place-fee'(f, fd) { S().placeFee = Math.max(0, Number(fd.get('fee')) || 0); DB.save(); renderView(); toast(t('تم حفظ فلوس المكان'), 'success'); },
  async gen(f, fd, e) {
    const cols = clamp(+fd.get('cols') || 4, 1, 8), rows = clamp(+fd.get('rows') || 5, 1, 12), count = clamp(+fd.get('count') || 0, 0, 2000);
    if (count < 1) return toast(t('أدخل عدد الأكواد'), 'error');
    const s = S();
    const b = { id: uid(), prefix: s.prefix, from: s.nextCode, to: s.nextCode + count - 1, count, cols, rows, createdAt: Date.now(), by: currentUser.name };
    s.nextCode += count; s.qrCols = cols; s.qrRows = rows;
    DB.data.batches.unshift(b); DB.save();
    await outputBatch(b, e.submitter?.value || 'pdf');
    renderView(); toast(t('تم توليد {n} كود جديد', { n: count }), 'success');
  },
  profile(f, fd) {
    Object.assign(S(), { teacherName: String(fd.get('teacherName')).trim(), subject: String(fd.get('subject')).trim(), centerName: String(fd.get('centerName')).trim() });
    DB.save(); rerenderAll(); toast(t('تم الحفظ'), 'success');
  },
  codeset(f, fd) {
    const prefix = String(fd.get('prefix')).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!prefix) return toast(t('أدخل بادئة صحيحة بالأحرف الإنجليزية'), 'error');
    S().prefix = prefix; S().nextCode = Math.max(1, Math.floor(+fd.get('nextCode') || 1));
    DB.save(); toast(t('تم الحفظ'), 'success'); renderView();
  },
  async user(f, fd) {
    const id = fd.get('id'), pass = String(fd.get('pass'));
    if (pass.length < 6) return toast(t('كلمة المرور يجب أن تكون 6 أحرف على الأقل'), 'error');
    if (Cloud.enabled) {
      const username = String(fd.get('username') || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,}$/.test(username)) return toast(t('اسم المستخدم بالإنجليزية وبدون مسافات (3 أحرف على الأقل)'), 'error');
      busy(true, t('جاري إنشاء الحساب...'));
      try { await Cloud.addUser({ name: String(fd.get('name')).trim(), username, pass, role: fd.get('role') || 'assistant', perms: readPerms(fd) }); closeModal(); renderView(); toast(t('تم إنشاء حساب {n}', { n: username }), 'success'); }
      catch (e) { console.error(e); toast(Cloud.errMsg(e), 'error'); }
      busy(false); return;
    }
    if (id) {
      const u = DB.data.users.find(x => x.id === id); u.pass = await passHash(u.username, pass);
    } else {
      const username = String(fd.get('username')).trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,}$/.test(username)) return toast(t('اسم المستخدم بالإنجليزية وبدون مسافات (3 أحرف على الأقل)'), 'error');
      if (DB.data.users.some(u => u.username === username)) return toast(t('اسم المستخدم موجود بالفعل'), 'error');
      DB.data.users.push({ id: uid(), name: String(fd.get('name')).trim(), username, role: fd.get('role') || 'assistant', perms: readPerms(fd), pass: await passHash(username, pass), createdAt: Date.now() });
    }
    DB.save(); closeModal(); renderView(); toast(t('تم الحفظ'), 'success');
  },
  async perms(f, fd) {
    const u = DB.data.users.find(x => x.id === fd.get('id')); if (!u) return;
    const role = fd.get('role') === 'admin' ? 'admin' : 'assistant', perms = readPerms(fd);
    if (u.id === currentUser.id) return toast(t('مينفعش تغيّر صلاحياتك بنفسك'), 'error');
    if (Cloud.enabled) {
      try { await Cloud.setPerms(u.id, role, perms); } catch (e) { return toast(Cloud.errMsg(e), 'error'); }
    } else { u.role = role; u.perms = perms; DB.save(); }
    closeModal(); renderView(); toast(t('تم حفظ صلاحيات {n}', { n: u.name }), 'success');
  },
  async 'my-pass'(f, fd) {
    if (Cloud.enabled) {
      const p = String(fd.get('pass')); if (p.length < 6) return toast(t('كلمة المرور يجب أن تكون 6 أحرف على الأقل'), 'error');
      try { await Cloud.changePassword(String(fd.get('old')), p); f.reset(); toast(t('تم تغيير كلمة المرور'), 'success'); }
      catch (e) { toast(String(e?.code || '').match(/credential|password/) ? t('كلمة المرور الحالية غير صحيحة') : Cloud.errMsg(e), 'error'); }
      return;
    }
    if (currentUser.pass !== await passHash(currentUser.username, String(fd.get('old')))) return toast(t('كلمة المرور الحالية غير صحيحة'), 'error');
    const p = String(fd.get('pass')); if (p.length < 6) return toast(t('كلمة المرور يجب أن تكون 6 أحرف على الأقل'), 'error');
    currentUser.pass = await passHash(currentUser.username, p); DB.save(); f.reset(); toast(t('تم تغيير كلمة المرور'), 'success');
  }
};

const INPUTS = {
  'stu-search': el => { state.stuSearch = el.value; renderStudentTable(); },
  'gen-preview': el => { if (el.name === 'count') el.dataset.auto = '0'; updateGenPreview(); },
  'pay-search': el => {
    const q = el.value.trim().toLowerCase(), box = $('#pay-suggest');
    if (!q) { box.innerHTML = ''; return; }
    const m = DB.data.students.filter(s => s.name.toLowerCase().includes(q) || String(s.code || '').toLowerCase().includes(q)).slice(0, 6);
    box.innerHTML = m.map(s => `<button type="button" class="sg" data-act="pay-pick" data-id="${s.id}">${avatar(s.name, 'xs')}<b>${esc(s.name)}</b><small dir="ltr" class="mono">${esc(s.code || '')}</small></button>`).join('') || `<div class="sg-empty">${t('لا توجد نتائج')}</div>`;
  }
};
const CHANGES = {
  'acc-month': el => { state.accMonth = el.value; renderView(); },
  'class-fee': el => { const v = el.value.trim(); if (v === '') delete DB.data.classFees[el.dataset.id]; else DB.data.classFees[el.dataset.id] = Math.max(0, Number(v) || 0); DB.save(); renderView(); },
  'snap': async el => {
    const file = el.files?.[0]; el.value = ''; if (!file) return;
    busy(true, t('جاري قراءة الكود...'));
    let txt = null;
    try { await Scan.stop(); txt = await decodeImageFile(file); } catch (e) { console.warn(e); }
    busy(false);
    if (txt) SCAN_TARGETS[el.dataset.target]?.(normCode(txt));
    else flash('error', t('لم نتمكن من قراءة الكود'), t('صوّر تاني'), t('قرّب الكاميرا من الكود وخلي الصورة واضحة ومنورة'));
  },
  'role-pick': el => {
    const form = el.closest('form'); if (!form) return;
    form.querySelectorAll('.role-seg label').forEach(l => l.classList.toggle('on', l.contains(el)));
    const list = form.querySelector('.perm-list'); if (list) list.hidden = el.value === 'admin';
  },
  'sound': el => { S().sound = el.checked; DB.save(); if (el.checked) beep('success'); },
  'import': el => {
    const file = el.files?.[0]; if (!file) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || !Array.isArray(d.users) || !d.settings) throw new Error('bad');
        if (!await confirmBox(t('سيتم استبدال كل البيانات الحالية بالنسخة الاحتياطية. متابعة؟'), { danger: true, okText: t('استرجاع') })) return;
        if (Cloud.enabled) { applyImported(d); toast(t('تم رفع النسخة الاحتياطية على السحابة'), 'success'); return; }
        localStorage.setItem(DB.key, JSON.stringify(d)); DB.load(); boot(); toast(t('تم استرجاع النسخة الاحتياطية'), 'success');
      } catch (e) { toast(t('الملف غير صالح'), 'error'); }
    };
    r.readAsText(file); el.value = '';
  }
};

function downloadJson(obj, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
/* يطبّق نسخة احتياطية على السحابة (الحسابات وكلمات المرور لا تُنقل). المحذوف يروح السلة. */
function applyImported(d) {
  COLS.forEach(c => { DB.data[c] = Array.isArray(d[c]) ? d[c] : []; });
  if (d.settings) Object.assign(DB.data.settings, omitPrefs(d.settings));
  DB.data.classFees = d.classFees || {}; DB.data.activeSession = null;
  DB.save(); closeModal(); renderShell(); renderView();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const link = e.target.closest('a[href]'); if (link && !link.dataset.act && el.contains(link)) return;
  const fn = ACT[el.dataset.act]; if (!fn) return;
  e.preventDefault(); fn(el, e);
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault(); FORMS[f.dataset.form]?.(f, new FormData(f), e);
});
document.addEventListener('input', e => { const el = e.target.closest('[data-input]'); if (el) INPUTS[el.dataset.input]?.(el, e); });
document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (el) CHANGES[el.dataset.change]?.(el, e); });

DB.load();
boot();
