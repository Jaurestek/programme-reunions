// Base de données en ligne (Firebase), plusieurs assemblées cloisonnées.
//
// Organisation des données :
//   assemblees/{aid}                       nom de l'assemblée
//   assemblees/{aid}/membres/{email}       { role, email }  (admin = responsable, editeur, lecteur)
//   assemblees/{aid}/people|speakers|midweek|weekend|config/...   les données de l'assemblée
//   acces/{email}/assemblees/{aid}         { role, nom }  pour que chaque frère retrouve SES assemblées
//
// L'administrateur général (FIREBASE_OWNER) crée les assemblées et nomme leurs responsables.
// La sécurité est assurée par les règles Firestore (firestore.rules), pas seulement par l'affichage.

const VERSION = '10.12.2';
const resolveReady = window.__resolveFirebase || (() => {});
const cfg = window.FIREBASE_CONFIG;
const ADMIN = String(window.FIREBASE_OWNER || '').toLowerCase();
const ROLES = { admin: 'Responsable de l’assemblée', editeur: 'Peut modifier le programme', lecteur: 'Consultation seule' };
const DONNEES = ['people', 'speakers', 'midweek', 'weekend', 'config'];
const CLE_AID = 'vcm-assemblee';

let F = null, auth = null, fs = null, me = null;

if (!cfg || !cfg.apiKey) resolveReady(null);
else start().catch(e => { console.error(e); showGate('error', 'Impossible de charger la base de données. Vérifiez la connexion internet puis rouvrez l’application.'); });

async function start(){
  const base = `https://www.gstatic.com/firebasejs/${VERSION}/`;
  const [appM, authM, fsM] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
  F = { ...appM, ...authM, ...fsM };
  const app = F.initializeApp(cfg);
  auth = F.getAuth(app);
  fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  F.getRedirectResult(auth).catch(e => showGate('error', messageErreur(e)));

  let pret = false;
  F.onAuthStateChanged(auth, async u => {
    if (!u) { if (pret) location.reload(); else showGate('login'); return; }
    const email = (u.email || '').toLowerCase(), general = email === ADMIN;
    const liste = await mesAssemblees(email, general);
    me = { email, general, liste };
    if (!liste.length) { showGate(general ? 'premiere' : 'denied', email); return; }
    let cur = liste.find(x => x.id === lsGet(CLE_AID));
    if (!cur) { if (liste.length === 1) cur = liste[0]; else { me = { email, general, liste }; showGate('choix', liste); return; } }
    lsSet(CLE_AID, cur.id);
    me = { email, general, liste, aid: cur.id, nom: cur.nom, role: general ? 'admin' : cur.role };
    hideGate();
    window.onSettingsOpen = renderSettings;
    if (!pret) { pret = true; resolveReady(adapter(`assemblees/${cur.id}/`, me.role)); }
  });
}

const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const parNom = (a, b) => String(a.nom).localeCompare(String(b.nom), 'fr');

/* Les assemblées auxquelles ce compte a accès */
async function mesAssemblees(email, general){
  const cle = 'vcm-assemblees-' + email;
  try {
    const m = new Map();
    const s = await F.getDocs(F.collection(fs, 'acces', email, 'assemblees'));
    s.docs.forEach(d => { const x = d.data(); if (ROLES[x.role]) m.set(d.id, { id: d.id, role: x.role, nom: x.nom || d.id }); });
    if (general) (await F.getDocs(F.collection(fs, 'assemblees'))).docs.forEach(d => m.set(d.id, { id: d.id, role: 'admin', nom: d.data().nom || d.id }));
    const liste = [...m.values()].sort(parNom);
    lsSet(cle, JSON.stringify(liste));
    return liste;
  } catch (e) {
    try { return JSON.parse(lsGet(cle)) || []; } catch { return []; } // hors ligne : dernière liste connue
  }
}

/* Interface attendue par l'application, limitée à l'assemblée choisie */
function adapter(prefixe, role){
  const erreurEcriture = e => { if (typeof window.writeError === 'function') window.writeError({ code: e && e.code === 'permission-denied' ? 'invalid_argument' : 'unavailable' }); };
  const meta = s => ({ fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites });
  const erreurLecture = err => e => err && err({ code: e && e.code === 'permission-denied' ? 'revoked' : 'unavailable', message: String(e && e.message) });
  return {
    canWrite: role !== 'lecteur',
    doc(p){
      const r = F.doc(fs, prefixe + p);
      return {
        set: d => { F.setDoc(r, d).catch(erreurEcriture); return Promise.resolve(); },
        delete: () => { F.deleteDoc(r).catch(erreurEcriture); return Promise.resolve(); },
        get: async () => { const s = await F.getDoc(r); return { id: s.id, exists: s.exists(), data: () => s.data(), metadata: meta(s) }; },
        onSnapshot: (next, err) => F.onSnapshot(r, { includeMetadataChanges: true },
          s => next({ id: s.id, exists: s.exists(), data: () => s.data(), metadata: meta(s) }), erreurLecture(err))
      };
    },
    collection(p){
      return {
        onSnapshot: (next, err) => F.onSnapshot(F.collection(fs, prefixe + p), { includeMetadataChanges: true },
          s => next({ docs: s.docs.map(d => ({ id: d.id, exists: true, data: () => d.data() })), size: s.size, empty: s.empty, metadata: meta(s) }), erreurLecture(err))
      };
    }
  };
}

/* Gestion des accès : deux écritures liées, faites ensemble */
async function donnerAcces(aid, nom, email, role){
  const b = F.writeBatch(fs);
  b.set(F.doc(fs, 'assemblees', aid, 'membres', email), { role, email, ajoutePar: me.email });
  b.set(F.doc(fs, 'acces', email, 'assemblees', aid), { role, nom });
  await b.commit();
}
async function retirerAcces(aid, email){
  const b = F.writeBatch(fs);
  b.delete(F.doc(fs, 'assemblees', aid, 'membres', email));
  b.delete(F.doc(fs, 'acces', email, 'assemblees', aid));
  await b.commit();
}
async function creerAssemblee(nom){
  const id = (nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'assemblee') + '-' + Math.random().toString(36).slice(2, 6);
  const b = F.writeBatch(fs);
  b.set(F.doc(fs, 'assemblees', id), { nom, creeLe: new Date().toISOString(), creePar: me.email });
  b.set(F.doc(fs, 'assemblees', id, 'config', 'main'), { congregation: nom, midweekDay: 4, midweekTime: '18:30', weekendDay: 0, weekendTime: '09:00', aux: false });
  await b.commit();
  return id;
}

/* Écrans plein page : connexion, refus, choix de l'assemblée, première assemblée */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOGO = document.querySelector('.logo') ? document.querySelector('.logo').innerHTML : '';
const style = document.createElement('style');
style.textContent = `
#gate{position:fixed;inset:0;z-index:80;background:var(--paper);display:grid;place-items:center;overflow:auto;
  padding:calc(24px + env(safe-area-inset-top,0px)) max(20px,env(safe-area-inset-right,0px)) calc(24px + env(safe-area-inset-bottom,0px)) max(20px,env(safe-area-inset-left,0px))}
#gate .box{width:min(420px,100%);display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px}
#gate .glogo svg{width:92px;height:92px;display:block;filter:drop-shadow(0 10px 24px rgba(20,40,36,.22))}
#gate h1{font-family:var(--f-display);font-size:26px;margin:6px 0 0}
#gate p{margin:0;color:var(--muted);max-width:38ch}
#gate .gbtn{display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:14px 18px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-weight:700;font-size:16px;cursor:pointer;box-shadow:0 2px 8px rgba(20,40,36,.08);text-align:left}
#gate .gbtn svg{width:20px;height:20px;flex:none}
#gate .gbtn.prim{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
#gate .gbtn.alt{background:transparent;box-shadow:none;border-color:transparent;color:var(--muted);font-size:14px;padding:8px}
#gate .gbtn small{display:block;font-weight:400;color:var(--muted);font-size:12.5px}
#gate .gerr{color:var(--bad);font-size:14px}
#gate .gmail{font-weight:700;color:var(--ink)}
#gate input{width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-size:16px}
#gate .glist{display:flex;flex-direction:column;gap:10px;width:100%}
.acc-list{list-style:none;margin:6px 0 10px;padding:0;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.acc-list li{display:flex;gap:8px;align-items:center;padding:8px 10px;border-top:1px solid var(--line);flex-wrap:wrap}
.acc-list li:first-child{border-top:0}
.acc-list .m{flex:1;min-width:150px;overflow:hidden;text-overflow:ellipsis;font-size:14px}
.acc-list select{width:auto;max-width:100%}
.acc-add{display:grid;grid-template-columns:1fr auto auto;gap:8px}
.acc-add.two{grid-template-columns:1fr auto}
.adm-card{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:8px}
.adm-card h4{margin:0 0 6px;font-size:15px;display:flex;gap:8px;align-items:center}
.adm-card h4 .chip{margin-left:auto}
@media (max-width:520px){.acc-add,.acc-add.two{grid-template-columns:1fr}}`;
document.head.appendChild(style);

const G = '<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>';

function showGate(kind, info){
  let g = document.getElementById('gate');
  if (!g) { g = document.createElement('div'); g.id = 'gate'; document.body.appendChild(g); }
  const tete = `<div class="glogo">${LOGO}</div><h1>Programme des réunions</h1>`;
  const sortir = `<button class="gbtn alt" id="g-out">Utiliser un autre compte</button>`;
  if (kind === 'login') g.innerHTML = `<div class="box">${tete}
    <p>Connectez-vous avec votre compte Google pour retrouver le programme de votre assemblée.</p>
    <button class="gbtn" id="g-login" style="justify-content:center">${G}Se connecter avec Google</button>
    <p style="font-size:13px">Seuls les frères ajoutés par le responsable de leur assemblée ont accès. Chaque assemblée ne voit que ses propres données.</p><p class="gerr" id="g-err"></p></div>`;
  else if (kind === 'denied') g.innerHTML = `<div class="box">${tete}
    <p>Le compte <span class="gmail">${esc(info)}</span> n’a encore accès à aucune assemblée.</p>
    <p>Demandez au responsable de votre assemblée de vous ajouter dans <b>Paramètres → Accès des frères</b>, puis touchez « Réessayer ».</p>
    <button class="gbtn prim" id="g-retry" style="justify-content:center">Réessayer</button>${sortir}</div>`;
  else if (kind === 'choix') g.innerHTML = `<div class="box">${tete}<p>Choisissez l’assemblée à ouvrir.</p>
    <div class="glist">${info.map(a => `<button class="gbtn" data-aid="${esc(a.id)}"><span>${esc(a.nom)}<small>${esc(me.general ? 'Administrateur général' : ROLES[a.role])}</small></span></button>`).join('')}</div>${sortir}</div>`;
  else if (kind === 'premiere') g.innerHTML = `<div class="box">${tete}
    <p>Bienvenue, administrateur. Créez la première assemblée. Vous pourrez ensuite en ajouter d’autres et nommer leurs responsables dans <b>Paramètres → Administration</b>.</p>
    <input id="g-nom" placeholder="Nom de l’assemblée (ex. Abidjan Cocody Est)" autocomplete="off">
    <button class="gbtn prim" id="g-creer" style="justify-content:center">Créer l’assemblée</button><p class="gerr" id="g-err"></p>${sortir}</div>`;
  else g.innerHTML = `<div class="box">${tete}<p class="gerr">${esc(info)}</p><button class="gbtn prim" id="g-retry" style="justify-content:center">Réessayer</button></div>`;
  const b = id => document.getElementById(id);
  if (b('g-login')) b('g-login').onclick = connexion;
  if (b('g-retry')) b('g-retry').onclick = () => location.reload();
  if (b('g-out')) b('g-out').onclick = () => { lsSet(CLE_AID, null); F.signOut(auth).then(() => location.reload()); };
  g.querySelectorAll('[data-aid]').forEach(x => x.onclick = () => { lsSet(CLE_AID, x.dataset.aid); location.reload(); });
  if (b('g-creer')) b('g-creer').onclick = async () => {
    const nom = b('g-nom').value.trim(); if (nom.length < 3) { b('g-err').textContent = 'Indiquez le nom de l’assemblée.'; return; }
    b('g-creer').disabled = true;
    try { const id = await creerAssemblee(nom); lsSet(CLE_AID, id); location.reload(); }
    catch (e) { console.error(e); b('g-creer').disabled = false; b('g-err').textContent = e && e.code === 'permission-denied' ? 'Refusé par les règles de sécurité (permission-denied).' : `Création impossible (${(e && (e.code || e.message)) || 'erreur inconnue'}).`; }
  };
}
function hideGate(){ const g = document.getElementById('gate'); if (g) g.remove(); }

function messageErreur(e){
  const c = e && e.code || '';
  if (c === 'auth/unauthorized-domain') return 'Ce site n’est pas autorisé dans Firebase (Authentication → Paramètres → Domaines autorisés).';
  if (c === 'auth/network-request-failed') return 'Pas de connexion internet. La première connexion demande internet.';
  if (c === 'auth/operation-not-allowed') return 'La connexion Google n’est pas activée dans Firebase.';
  return 'La connexion n’a pas abouti. Réessayez.';
}
async function connexion(){
  const p = new F.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
  const err = document.getElementById('g-err'); if (err) err.textContent = '';
  try { await F.signInWithPopup(auth, p); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(e.code)) { await F.signInWithRedirect(auth, p); return; }
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request' && err) err.textContent = messageErreur(e);
  }
}

/* Paramètres : compte, assemblée, accès des frères, administration générale */
const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const optionsRoles = sel => Object.entries(ROLES).map(([k, l]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${l}</option>`).join('');
const mailOk = m => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m);

async function renderSettings(el){
  const resp = me.role === 'admin';
  el.innerHTML = `
    <fieldset><legend>Compte</legend><div class="row"><span style="flex:1;min-width:0"><b>${esc(me.email)}</b><br>
      <span class="muted" style="font-size:13px">${me.general ? 'Administrateur général' : esc(ROLES[me.role])} · ${esc(me.nom)}</span></span>
      <button type="button" class="btn sm" id="acc-out">Se déconnecter</button></div>
      <p class="muted" style="margin:6px 0 0;font-size:12.5px">Connexion sécurisée par Google. Pour plus de sécurité, activez la <a href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noopener">validation en deux étapes</a> sur votre compte Google.</p></fieldset>
    ${me.liste.length > 1 ? `<fieldset style="margin-top:14px"><legend>Assemblée ouverte</legend><select id="acc-switch">${me.liste.map(a => `<option value="${esc(a.id)}"${a.id === me.aid ? ' selected' : ''}>${esc(a.nom)}</option>`).join('')}</select></fieldset>` : ''}
    ${resp ? `<fieldset style="margin-top:14px"><legend>Accès des frères · ${esc(me.nom)}</legend>
      <p class="muted" style="margin:0;font-size:13px">Les frères ajoutés ici voient uniquement cette assemblée.</p>
      <ul class="acc-list" id="acc-list"><li class="muted">Chargement…</li></ul>
      <div class="acc-add"><input type="email" id="acc-mail" placeholder="adresse@gmail.com" autocomplete="off"><select id="acc-role">${optionsRoles('editeur')}</select>
        <button type="button" class="btn sm primary" id="acc-add">Ajouter</button></div><p class="muted" id="acc-msg" style="margin:6px 0 0;font-size:13px"></p></fieldset>` : ''}
    ${me.general ? `<fieldset style="margin-top:14px"><legend>Administration · toutes les assemblées</legend><div id="adm"><p class="muted">Chargement…</p></div></fieldset>` : ''}`;
  el.querySelector('#acc-out').onclick = () => { lsSet(CLE_AID, null); F.signOut(auth); };
  const sw = el.querySelector('#acc-switch'); if (sw) sw.onchange = () => { lsSet(CLE_AID, sw.value); location.reload(); };
  if (resp) membresAssemblee(el);
  if (me.general) administration(el.querySelector('#adm'));
}

async function membresAssemblee(el){
  const list = el.querySelector('#acc-list'), msg = el.querySelector('#acc-msg');
  const charger = async () => {
    let rows = [];
    try { rows = (await F.getDocs(F.collection(fs, 'assemblees', me.aid, 'membres'))).docs.map(d => ({ email: d.id, role: d.data().role })); }
    catch { list.innerHTML = '<li class="muted">Liste indisponible hors connexion.</li>'; return; }
    rows.sort((a, b) => a.email.localeCompare(b.email));
    list.innerHTML = rows.length ? rows.map(r => `<li data-m="${esc(r.email)}"><span class="m">${esc(r.email)}${r.email === me.email ? ' <span class="muted">(vous)</span>' : ''}</span>
      <select data-r>${optionsRoles(r.role)}</select><button type="button" class="icon-btn" data-del aria-label="Retirer l’accès">${X}</button></li>`).join('')
      : '<li class="muted">Aucun frère pour l’instant.</li>';
    list.querySelectorAll('li[data-m]').forEach(li => {
      const m = li.dataset.m;
      li.querySelector('[data-r]').onchange = e => donnerAcces(me.aid, me.nom, m, e.target.value).then(() => msg.textContent = `Niveau de ${m} modifié.`).catch(() => msg.textContent = 'Modification impossible.');
      li.querySelector('[data-del]').onclick = () => retirerAcces(me.aid, m).then(() => { msg.textContent = `Accès de ${m} retiré.`; charger(); }).catch(() => msg.textContent = 'Suppression impossible.');
    });
  };
  el.querySelector('#acc-add').onclick = async () => {
    const m = el.querySelector('#acc-mail').value.trim().toLowerCase(), r = el.querySelector('#acc-role').value;
    if (!mailOk(m)) { msg.textContent = 'Adresse e-mail invalide.'; return; }
    try { await donnerAcces(me.aid, me.nom, m, r); msg.textContent = `${m} a maintenant accès à ${me.nom}. Envoyez-lui le lien de l’application.`; el.querySelector('#acc-mail').value = ''; charger(); }
    catch (e) { msg.textContent = `Ajout impossible (${(e && (e.code || e.message)) || 'erreur inconnue'}).`; }
  };
  charger();
}

async function administration(box){
  let ass = [];
  try { ass = (await F.getDocs(F.collection(fs, 'assemblees'))).docs.map(d => ({ id: d.id, nom: d.data().nom || d.id })).sort(parNom); }
  catch { box.innerHTML = '<p class="muted">Indisponible hors connexion.</p>'; return; }
  const resp = {};
  await Promise.all(ass.map(async a => {
    try { resp[a.id] = (await F.getDocs(F.collection(fs, 'assemblees', a.id, 'membres'))).docs.filter(d => d.data().role === 'admin').map(d => d.id); } catch { resp[a.id] = []; }
  }));
  box.innerHTML = `<p class="muted" style="margin:0;font-size:13px">Chaque assemblée est cloisonnée : ses frères ne voient qu’elle. Nommez au moins un responsable par assemblée ; il ajoutera lui-même ses frères.</p>
    ${ass.map(a => `<div class="adm-card" data-a="${esc(a.id)}"><h4>${esc(a.nom)}${a.id === me.aid ? '<span class="chip acc">ouverte</span>' : `<button type="button" class="btn sm" data-open>Ouvrir</button>`}</h4>
      <div class="muted" style="font-size:13px">Responsables : ${resp[a.id].length ? resp[a.id].map(esc).join(', ') : '<span style="color:var(--warn)">aucun</span>'}</div>
      <div class="acc-add two" style="margin-top:8px"><input type="email" placeholder="Gmail du responsable" data-mail autocomplete="off"><button type="button" class="btn sm" data-resp>Nommer responsable</button></div></div>`).join('')}
    <div class="adm-card"><h4>Nouvelle assemblée</h4><div class="acc-add two"><input id="adm-nom" placeholder="Nom de l’assemblée" autocomplete="off"><button type="button" class="btn sm primary" id="adm-creer">Créer</button></div></div>
    <p class="muted" id="adm-msg" style="margin:8px 0 0;font-size:13px"></p><div id="adm-ancien"></div>`;
  const msg = box.querySelector('#adm-msg');
  box.querySelectorAll('.adm-card[data-a]').forEach(c => {
    const a = ass.find(x => x.id === c.dataset.a);
    const o = c.querySelector('[data-open]'); if (o) o.onclick = () => { lsSet(CLE_AID, a.id); location.reload(); };
    c.querySelector('[data-resp]').onclick = async () => {
      const m = c.querySelector('[data-mail]').value.trim().toLowerCase();
      if (!mailOk(m)) { msg.textContent = 'Adresse e-mail invalide.'; return; }
      try { await donnerAcces(a.id, a.nom, m, 'admin'); msg.textContent = `${m} est maintenant responsable de ${a.nom}.`; administration(box); }
      catch (e) { msg.textContent = `Nomination impossible (${(e && (e.code || e.message)) || 'erreur inconnue'}).`; }
    };
  });
  box.querySelector('#adm-creer').onclick = async () => {
    const nom = box.querySelector('#adm-nom').value.trim(); if (nom.length < 3) { msg.textContent = 'Indiquez le nom de l’assemblée.'; return; }
    try { await creerAssemblee(nom); msg.textContent = `Assemblée « ${nom} » créée. Nommez maintenant son responsable.`; administration(box); }
    catch (e) { msg.textContent = `Création impossible (${(e && (e.code || e.message)) || 'erreur inconnue'}).`; }
  };
  ancienneVersion(box.querySelector('#adm-ancien'), ass);
}

/* Données saisies avec la première version (avant les assemblées) : les ranger dans une assemblée */
async function ancienneVersion(box, ass){
  let docs = [];
  try { for (const c of [...DONNEES, 'membres']) (await F.getDocs(F.collection(fs, c))).docs.forEach(d => docs.push({ c, id: d.id, data: d.data() })); }
  catch { return; }
  if (!docs.length || !ass.length) return;
  box.innerHTML = `<div class="adm-card"><h4>Données de la première version</h4>
    <p class="muted" style="margin:0 0 8px;font-size:13px">${docs.length} élément(s) saisis avant la création des assemblées. Choisissez l’assemblée qui doit les recevoir.</p>
    <div class="acc-add two"><select id="anc-a">${ass.map(a => `<option value="${esc(a.id)}">${esc(a.nom)}</option>`).join('')}</select><button type="button" class="btn sm primary" id="anc-go">Importer</button></div></div>`;
  box.querySelector('#anc-go').onclick = async () => {
    const a = ass.find(x => x.id === box.querySelector('#anc-a').value);
    try {
      for (const d of docs) {
        if (d.c === 'membres') { if (ROLES[d.data.role]) await donnerAcces(a.id, a.nom, d.id, d.data.role); }
        else await F.setDoc(F.doc(fs, 'assemblees', a.id, d.c, d.id), d.c === 'config' ? { ...d.data, congregation: a.nom } : d.data);
        await F.deleteDoc(F.doc(fs, d.c, d.id));
      }
      box.innerHTML = `<p class="muted" style="font-size:13px">Import terminé dans « ${esc(a.nom)} ».</p>`;
    } catch { box.querySelector('#anc-go').textContent = 'Réessayer'; }
  };
}
