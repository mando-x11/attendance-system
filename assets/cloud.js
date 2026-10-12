'use strict';
/* =========================================================
   المزامنة السحابية عبر Firebase
   كل مدرس له مساحة عمل: orgs/{orgId} يشاركه فيها المساعدون.
   البيانات تُحفظ محلياً (offline) وتتزامن تلقائياً مع كل الأجهزة.
   ========================================================= */
const PREF_KEYS = ['lang', 'theme', 'accent', 'sound'];          // تفضيلات خاصة بكل جهاز
const COLS = ['classes', 'students', 'batches', 'sessions', 'payments'];
const EMAIL_DOMAIN = 'hader.app';                                  // اسم المستخدم يتحول داخلياً لبريد
const pickPrefs = s => Object.fromEntries(PREF_KEYS.filter(k => s && s[k] !== undefined).map(k => [k, s[k]]));
const omitPrefs = s => { const o = { ...s }; PREF_KEYS.forEach(k => delete o[k]); return o; };

const Cloud = {
  enabled: !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && window.firebase),
  on: false, booted: false, creating: false,
  auth: null, db: null, orgId: null, base: {}, unsubs: [], _rt: null,

  email: u => `${String(u).trim().toLowerCase()}@${EMAIL_DOMAIN}`,
  org(path) { return this.db.doc(`orgs/${this.orgId}/${path}`); },
  col(c) { return this.db.collection(`orgs/${this.orgId}/${c}`); },

  init() {
    firebase.initializeApp(FIREBASE_CONFIG);
    this.auth = firebase.auth();
    this.db = firebase.firestore();
    this.db.enablePersistence({ synchronizeTabs: true }).catch(() => { /* متصفح لا يدعم التخزين دون اتصال */ });
    window.addEventListener('online', () => this.status());
    window.addEventListener('offline', () => this.status());
  },

  boot() {
    if (!this.auth) this.init();
    showLoading();
    this.auth.onAuthStateChanged(async user => {
      if (this.creating) return;
      this.detach();
      if (!user) { currentUser = null; renderAuth(); return; }
      try {
        const link = await this.db.doc(`userOrgs/${user.uid}`).get();
        if (!link.exists) { toast(t('هذا الحساب غير مرتبط بأي مدرس'), 'error'); await this.auth.signOut(); return; }
        this.orgId = link.data().orgId;
        await this.attach(user.uid);
      } catch (e) {
        console.error(e); toast(this.errMsg(e), 'error');
        try { await this.auth.signOut(); } catch (_) { }
      }
    });
  },

  settingsJson() { return JSON.stringify({ ...omitPrefs(DB.data.settings), classFees: DB.data.classFees || {} }); },

  attach(uid) {
    return new Promise((resolve, reject) => {
      const prefs = pickPrefs(DB.data.settings);
      DB.data = DB.defaults();
      Object.assign(DB.data.settings, prefs);
      this.base = {}; this.on = true; this.booted = false;
      const pending = new Set([...COLS, 'members', 'settings', 'active']);
      const done = k => {
        if (!pending.delete(k) || pending.size || this.booted) return;
        currentUser = DB.data.users.find(u => u.id === uid) || null;
        if (!currentUser) { toast(t('هذا الحساب غير مرتبط بأي مدرس'), 'error'); this.auth.signOut(); reject(new Error('not-member')); return; }
        this.booted = true;
        applyPrefs(); renderShell(); renderView(); this.status();
        setTimeout(() => this.dailyBackup(), 4000);
        resolve();
      };
      const fail = e => { console.error(e); toast(this.errMsg(e), 'error'); reject(e); };
      const sorters = { sessions: (a, b) => b.startedAt - a.startedAt, batches: (a, b) => b.createdAt - a.createdAt, payments: (a, b) => a.date - b.date, classes: (a, b) => (a.createdAt || 0) - (b.createdAt || 0), students: (a, b) => (a.createdAt || 0) - (b.createdAt || 0) };
      for (const c of COLS) {
        this.unsubs.push(this.col(c).onSnapshot(s => {
          DB.data[c] = s.docs.map(x => x.data()).sort(sorters[c]);
          this.base[c] = new Map(DB.data[c].map(x => [x.id, JSON.stringify(x)]));
          done(c); this.refresh();
        }, fail));
      }
      this.unsubs.push(this.col('members').onSnapshot(s => {
        DB.data.users = s.docs.map(x => x.data());
        if (this.booted && currentUser) {
          const before = JSON.stringify([currentUser.role, permsOf(currentUser)]);
          currentUser = DB.data.users.find(u => u.id === currentUser.id) || null;
          if (!currentUser) { this.auth.signOut(); return; }
          if (JSON.stringify([currentUser.role, permsOf(currentUser)]) !== before) {
            Scan.stop(); renderShell(); renderView(); toast(t('صلاحياتك اتغيرت'));
          }
        }
        done('members'); this.refresh();
      }, fail));
      this.unsubs.push(this.org('meta/settings').onSnapshot(s => {
        const v = s.data() || {}, prefs = pickPrefs(DB.data.settings);
        DB.data.classFees = v.classFees || {};
        const st = { ...v }; delete st.classFees;
        DB.data.settings = Object.assign(DB.defaults().settings, omitPrefs(st), prefs);
        this.base.settings = this.settingsJson();
        done('settings'); this.refresh();
      }, fail));
      this.unsubs.push(this.org('meta/active').onSnapshot(s => {
        DB.data.activeSession = s.data()?.session || null;
        this.base.active = JSON.stringify(DB.data.activeSession);
        done('active'); this.refresh();
      }, fail));
    });
  },

  detach() { this.unsubs.forEach(u => { try { u(); } catch (e) { } }); this.unsubs = []; this.on = false; this.booted = false; },

  /* يرفع أي تغيير حصل في DB.data مقارنة بآخر نسخة من السحابة */
  push() {
    if (!this.on) return;
    const ops = [];
    for (const c of COLS) {
      const prev = this.base[c] || new Map();
      const cur = new Map(DB.data[c].map(x => [x.id, JSON.stringify(x)]));
      for (const [id, js] of cur) if (prev.get(id) !== js) ops.push(['set', this.col(c).doc(id), JSON.parse(js)]);
      for (const id of prev.keys()) if (!cur.has(id)) {
        ops.push(['del', this.col(c).doc(id)]);
        // أي حاجة تتمسح تروح سلة المحذوفات ويمكن استرجاعها
        ops.push(['set', this.col('trash').doc(`${c}_${id}_${Date.now()}`), { col: c, id, data: JSON.parse(prev.get(id)), deletedAt: Date.now(), by: currentUser?.name || '' }]);
      }
      this.base[c] = cur;
    }
    if (isAdmin() || can('codes') || can('accounts')) {
      const sj = this.settingsJson();
      if (sj !== this.base.settings) { ops.push(['set', this.org('meta/settings'), JSON.parse(sj)]); this.base.settings = sj; }
    }
    const aj = JSON.stringify(DB.data.activeSession ?? null);
    if (aj !== this.base.active) { ops.push(['set', this.org('meta/active'), { session: JSON.parse(aj) }]); this.base.active = aj; }
    for (let i = 0; i < ops.length; i += 450) {
      const b = this.db.batch();
      ops.slice(i, i + 450).forEach(([k, ref, data]) => k === 'set' ? b.set(ref, data) : b.delete(ref));
      b.commit().catch(e => { console.error(e); toast(t('تعذر حفظ التغييرات على السحابة'), 'error'); });
    }
  },

  /* تسجيل الحضور بإضافة ذرّية حتى لا يضيع مسح من جهاز آخر في نفس اللحظة */
  addPresent(entry) {
    this.base.active = JSON.stringify(DB.data.activeSession);
    this.org('meta/active').update({ 'session.present': firebase.firestore.FieldValue.arrayUnion(entry) })
      .catch(e => { console.error(e); toast(t('تعذر حفظ التغييرات على السحابة'), 'error'); });
  },
  removePresent(entries) {
    if (!entries.length) return;
    this.base.active = JSON.stringify(DB.data.activeSession);
    this.org('meta/active').update({ 'session.present': firebase.firestore.FieldValue.arrayRemove(...entries) })
      .catch(e => { console.error(e); toast(t('تعذر حفظ التغييرات على السحابة'), 'error'); });
  },

  /* ---------- الحماية من ضياع البيانات ---------- */
  exportData() {
    return { settings: omitPrefs(DB.data.settings), classFees: DB.data.classFees || {}, ...Object.fromEntries(COLS.map(c => [c, DB.data[c]])), exportedAt: Date.now() };
  },
  /* نسخة احتياطية يومية تلقائية على السحابة (آخر 30 يوم) — تتعمل أول ما المدرس يفتح الموقع كل يوم */
  async dailyBackup() {
    if (!isAdmin()) return;
    const day = todayKey(), ref = this.col('backups').doc(day);
    try {
      if ((await ref.get()).exists) return;
      const json = JSON.stringify(this.exportData());
      const size = 300000, parts = Math.max(1, Math.ceil(json.length / size));
      for (let i = 0; i < parts; i++) await ref.collection('parts').doc(String(i)).set({ data: json.slice(i * size, (i + 1) * size) });
      await ref.set({ day, createdAt: Date.now(), by: currentUser.name, parts, students: DB.data.students.length, payments: DB.data.payments.length, total: sum(DB.data.payments) });
      const all = await this.col('backups').orderBy('day', 'desc').get();
      for (const d of all.docs.slice(30)) {
        const ps = await d.ref.collection('parts').get();
        for (const p of ps.docs) await p.ref.delete();
        await d.ref.delete();
      }
    } catch (e) { console.warn('daily backup failed', e); }
  },
  async listBackups() { return (await this.col('backups').orderBy('day', 'desc').get()).docs.map(d => d.data()); },
  async loadBackup(day) {
    const ref = this.col('backups').doc(day), meta = (await ref.get()).data();
    let json = '';
    for (let i = 0; i < meta.parts; i++) json += (await ref.collection('parts').doc(String(i)).get()).data().data;
    return JSON.parse(json);
  },
  async listTrash() { return (await this.col('trash').orderBy('deletedAt', 'desc').limit(150).get()).docs.map(d => ({ key: d.id, ...d.data() })); },
  async restoreTrash(item) {
    if (!DB.data[item.col].some(x => x.id === item.id)) { DB.data[item.col].push(item.data); DB.save(); }
    await this.col('trash').doc(item.key).delete();
  },

  refresh() { if (!this.booted) return; clearTimeout(this._rt); this._rt = setTimeout(cloudRefreshUI, 120); },

  status() {
    const el = $('#sync'); if (!el) return;
    const on = navigator.onLine;
    el.className = 'sync ' + (on ? 'on' : 'off');
    el.innerHTML = `<i></i><span>${on ? t('متزامن') : t('بدون إنترنت — هيتزامن لما النت يرجع')}</span>`;
  },

  async setup({ name, subject, username, pass }) {
    this.creating = true;
    try {
      const cred = await this.auth.createUserWithEmailAndPassword(this.email(username), pass);
      const uid = cred.user.uid;
      this.orgId = uid;
      await this.db.doc(`orgs/${uid}/members/${uid}`).set({ id: uid, name, username, role: 'admin', createdAt: Date.now() });
      await this.db.doc(`userOrgs/${uid}`).set({ orgId: uid });
      await this.org('meta/settings').set({ ...omitPrefs({ ...DB.defaults().settings, teacherName: name, subject }), classFees: {} });
      await this.attach(uid);
    } finally { this.creating = false; }
  },
  async login(username, pass, remember) {
    const P = firebase.auth.Auth.Persistence;
    await this.auth.setPersistence(remember ? P.LOCAL : P.SESSION);
    await this.auth.signInWithEmailAndPassword(this.email(username), pass);
  },
  logout() { this.detach(); return this.auth.signOut(); },
  async addUser({ name, username, pass, role, perms }) {
    const sec = firebase.apps.find(a => a.name === 'secondary') || firebase.initializeApp(FIREBASE_CONFIG, 'secondary');
    const cred = await sec.auth().createUserWithEmailAndPassword(this.email(username), pass);
    const uid = cred.user.uid;
    await sec.auth().signOut();
    await this.col('members').doc(uid).set({ id: uid, name, username, role, perms: perms || {}, createdAt: Date.now() });
    await this.db.doc(`userOrgs/${uid}`).set({ orgId: this.orgId });
  },
  async setPerms(id, role, perms) { await this.col('members').doc(id).update({ role, perms }); },
  async removeUser(u) {
    await this.col('members').doc(u.id).delete();
    await this.db.doc(`userOrgs/${u.id}`).delete();
  },
  async changePassword(oldPass, newPass) {
    const user = this.auth.currentUser;
    await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, oldPass));
    await user.updatePassword(newPass);
  },

  errMsg(e) {
    const c = e?.code || '';
    if (c.includes('email-already-in-use')) return t('اسم المستخدم موجود بالفعل');
    if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-login')) return t('اسم المستخدم أو كلمة المرور غير صحيحة');
    if (c.includes('weak-password')) return t('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
    if (c.includes('too-many-requests')) return t('محاولات كثيرة — استنى شوية وجرب تاني');
    if (c.includes('network-request-failed') || c.includes('unavailable')) return t('مفيش اتصال بالإنترنت');
    if (c.includes('operation-not-allowed')) return t('فعّل تسجيل الدخول بالبريد وكلمة المرور من إعدادات Firebase');
    if (c.includes('permission-denied')) return t('ليس لديك صلاحية الوصول لهذه البيانات');
    if (c.includes('invalid-email')) return t('اسم المستخدم بالإنجليزية وبدون مسافات (3 أحرف على الأقل)');
    return t('حدث خطأ — حاول مرة أخرى');
  }
};

/* تحديث الواجهة عند وصول تغييرات من جهاز آخر بدون مقاطعة المستخدم */
function cloudRefreshUI() {
  if (!currentUser || !$('#view')) return;
  const pill = $('.live-pill'); if (pill) pill.hidden = !DB.data.activeSession;
  if ($('#modals .modal-wrap')) return;
  const ae = document.activeElement;
  const typing = ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) && $('#view').contains(ae);
  if (state.view === 'attendance') {
    const live = !!$('#live-ring');
    if (live && DB.data.activeSession) { updateLive(); return; }
    if (!typing) renderView();
    return;
  }
  if (state.view === 'payments') { renderPaySummary(); return; }
  if (Scan.inst || typing) return;
  renderView();
}
function showLoading() {
  $('#root').innerHTML = `<div class="paper-bg"></div><div class="boot-load"><div class="logo">${LOGO}</div><span class="spinner"></span><p>${t('جاري الاتصال...')}</p></div>`;
}
