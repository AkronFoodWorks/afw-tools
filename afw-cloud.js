/* =====================================================================
   AFW Cloud — shared login + save layer for Akron Food Works tools
   ---------------------------------------------------------------------
   - Passwordless email sign-in (magic link) via Supabase Auth
   - Per-tool save/load of one JSON blob per member via Supabase REST
   - No external libraries. Plain fetch. ~Zero maintenance.
   - Login is ALWAYS optional: every tool keeps working anonymously,
     and the existing JSON export/import remains the offline fallback.

   USAGE (inside any tool):
     <script src="afw-config.js"></script>   // sets window.AFW_CONFIG
     <script src="afw-cloud.js"></script>
     <script>
       AFWCloud.init({
         toolId: 'food-cost-builder',        // unique per tool
         mount:  '#afw-account-bar',         // where the account bar renders
         getData: () => collectToolState(),  // tool provides its JSON blob
         onData:  (data) => applyToolState(data), // tool applies a loaded blob
       });
       // Whenever the tool's state changes:
       AFWCloud.scheduleSave();              // debounced autosave (no-op if signed out)
     </script>
   ===================================================================== */

const AFWCloud = (() => {
  'use strict';

  const LS_KEY = 'afw_session_v1';
  const SAVE_DEBOUNCE_MS = 1500;

  let cfg = {
    url: null,          // Supabase project URL
    anonKey: null,      // Supabase anon (public) key — safe in browser; RLS protects data
    toolId: null,
    mount: null,
    getData: null,      // fn -> object (the tool's full state as JSON)
    onData: null,       // fn(object, meta) called when cloud data is loaded
    onStatus: null,     // optional fn(statusString) for custom UI
  };

  let session = null;   // { access_token, refresh_token, expires_at, user: {id, email} }
  let saveTimer = null;
  let ui = null;        // account bar elements
  let lastStatus = 'signed-out';

  /* ------------------------------------------------------------------
     Session persistence (localStorage holds ONLY the auth session,
     never tool data — tool data lives in Supabase + JSON exports)
  ------------------------------------------------------------------ */
  function readStoredSession() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)); }
    catch (e) { return null; }
  }
  function storeSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(LS_KEY, JSON.stringify(s));
      else localStorage.removeItem(LS_KEY);
    } catch (e) { /* private-mode etc. — session just won't persist */ }
  }

  /* ------------------------------------------------------------------
     Auth: magic link (implicit flow — tokens arrive in the URL hash)
  ------------------------------------------------------------------ */
  function parseHashTokens() {
    const h = window.location.hash;
    if (!h || h.length < 2) return null;
    const p = new URLSearchParams(h.slice(1));

    if (p.get('error_description')) {
      setStatus('error', decodeURIComponent(p.get('error_description').replace(/\+/g, ' ')));
      clearHash();
      return null;
    }
    const access = p.get('access_token');
    if (!access) return null;

    const s = {
      access_token: access,
      refresh_token: p.get('refresh_token') || null,
      expires_at: Math.floor(Date.now() / 1000) + parseInt(p.get('expires_in') || '3600', 10),
      user: null,
    };
    clearHash();
    return s;
  }
  function clearHash() {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  async function requestMagicLink(email) {
    const redirectTo = window.location.origin + window.location.pathname;
    const r = await fetch(
      cfg.url + '/auth/v1/otp?redirect_to=' + encodeURIComponent(redirectTo),
      {
        method: 'POST',
        headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, create_user: true }),
      }
    );
    if (!r.ok) {
      let msg = 'Could not send the sign-in link.';
      try { const d = await r.json(); if (d.msg || d.error_description) msg = d.msg || d.error_description; } catch (e) {}
      throw new Error(msg);
    }
  }

  async function fetchUser(token) {
    const r = await fetch(cfg.url + '/auth/v1/user', {
      headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + token },
    });
    if (!r.ok) throw new Error('Could not confirm sign-in.');
    const u = await r.json();
    return { id: u.id, email: u.email };
  }

  async function refreshSession() {
    if (!session || !session.refresh_token) return false;
    try {
      const r = await fetch(cfg.url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!r.ok) { storeSession(null); return false; }
      const d = await r.json();
      storeSession({
        access_token: d.access_token,
        refresh_token: d.refresh_token || session.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
        user: d.user ? { id: d.user.id, email: d.user.email } : session.user,
      });
      return true;
    } catch (e) { return false; }
  }

  /** Make sure the access token is valid (refresh if within 60s of expiry). */
  async function ensureFreshSession() {
    if (!session) return false;
    if (session.expires_at - 60 > Date.now() / 1000) return true;
    return refreshSession();
  }

  function signOut() {
    if (session) {
      // Best-effort server-side sign-out; ignore failures.
      fetch(cfg.url + '/auth/v1/logout', {
        method: 'POST',
        headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + session.access_token },
      }).catch(() => {});
    }
    storeSession(null);
    setStatus('signed-out');
    renderBar();
  }

  /* ------------------------------------------------------------------
     Data: one row per (member, tool) in public.tool_data
  ------------------------------------------------------------------ */
  function authHeaders() {
    return {
      apikey: cfg.anonKey,
      Authorization: 'Bearer ' + session.access_token,
    };
  }

  async function loadCloudData() {
    if (!(await ensureFreshSession())) return null;
    const url = cfg.url + '/rest/v1/tool_data'
      + '?tool_id=eq.' + encodeURIComponent(cfg.toolId)
      + '&select=data,updated_at';
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows.length ? rows[0] : null; // { data, updated_at } or null
  }

  async function saveCloudData(data) {
    if (!(await ensureFreshSession())) return false;
    const r = await fetch(cfg.url + '/rest/v1/tool_data', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates', // upsert on (user_id, tool_id)
      }),
      body: JSON.stringify({
        user_id: session.user.id,
        tool_id: cfg.toolId,
        data: data,
        updated_at: new Date().toISOString(),
      }),
    });
    return r.ok;
  }

  /* ------------------------------------------------------------------
     Autosave (debounced). Safe to call constantly; no-op when signed out.
  ------------------------------------------------------------------ */
  function scheduleSave() {
    if (!session) return;
    clearTimeout(saveTimer);
    setStatus('saving');
    saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  }

  async function saveNow() {
    if (!session) return false;
    clearTimeout(saveTimer);
    if (typeof cfg.getData !== 'function') return false;
    setStatus('saving');
    let ok = false;
    try { ok = await saveCloudData(cfg.getData()); }
    catch (e) { ok = false; }
    setStatus(ok ? 'saved' : 'error', ok ? null : 'Could not save — use Export as a backup.');
    return ok;
  }

  /* ------------------------------------------------------------------
     Account bar UI (inherits the tool's AFW brand variables when present)
  ------------------------------------------------------------------ */
  const BAR_CSS = `
    .afwc-bar { font-family: 'Hanken Grotesk', system-ui, sans-serif; font-size: 14px;
      display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
      padding: 10px 14px; border-radius: 10px;
      background: var(--afw-cream, #FAF5EA); border: 1px solid var(--afw-forest, #1F3D2B);
      color: var(--afw-forest, #1F3D2B); }
    .afwc-bar strong { font-weight: 700; }
    .afwc-bar input[type=email] { flex: 1 1 180px; min-width: 160px; padding: 7px 10px;
      border: 1px solid var(--afw-forest, #1F3D2B); border-radius: 8px;
      font: inherit; background: #fff; color: inherit; }
    .afwc-bar button { padding: 7px 14px; border: none; border-radius: 8px; cursor: pointer;
      font: inherit; font-weight: 600;
      background: var(--afw-forest, #1F3D2B); color: var(--afw-cream, #FAF5EA); }
    .afwc-bar button.afwc-secondary { background: transparent; color: var(--afw-forest, #1F3D2B);
      text-decoration: underline; padding: 7px 4px; }
    .afwc-status { margin-left: auto; font-weight: 600; }
    .afwc-status[data-s=saved]  { color: var(--afw-forest, #1F3D2B); }
    .afwc-status[data-s=saving] { color: var(--afw-amber, #B7791F); }
    .afwc-status[data-s=error]  { color: #A33A2A; }
    .afwc-note { flex-basis: 100%; font-size: 13px; opacity: .85; }
  `;

  function setStatus(s, note) {
    lastStatus = s;
    if (typeof cfg.onStatus === 'function') cfg.onStatus(s, note || null);
    if (!ui) return;
    const el = ui.querySelector('.afwc-status');
    if (el) {
      el.dataset.s = s;
      el.textContent = ({
        'signed-out': '', 'link-sent': '', 'saving': 'Saving…',
        'saved': 'Saved ✓', 'signed-in': 'Cloud save on',
        'error': 'Save issue',
      })[s] || '';
    }
    const noteEl = ui.querySelector('.afwc-note');
    if (noteEl) noteEl.textContent = note || '';
  }

  function renderBar() {
    if (!ui) return;
    if (session && session.user) {
      ui.innerHTML =
        '<span>Signed in as <strong></strong></span>' +
        '<button type="button" class="afwc-secondary" data-act="signout">Sign out</button>' +
        '<span class="afwc-status" data-s="signed-in">Cloud save on</span>' +
        '<span class="afwc-note"></span>';
      ui.querySelector('strong').textContent = session.user.email;
      ui.querySelector('[data-act=signout]').addEventListener('click', signOut);
    } else {
      ui.innerHTML =
        '<span><strong>Save your work</strong> across visits and devices — no password needed.</span>' +
        '<input type="email" placeholder="you@email.com" autocomplete="email">' +
        '<button type="button" data-act="link">Email me a sign-in link</button>' +
        '<span class="afwc-status"></span>' +
        '<span class="afwc-note"></span>';
      const input = ui.querySelector('input');
      const go = async () => {
        const email = input.value.trim();
        if (!email || !email.includes('@')) { setStatus('error', 'Enter a valid email address.'); return; }
        try {
          await requestMagicLink(email);
          ui.innerHTML = '<span><strong>Check your email.</strong> Open the sign-in link on this device to turn on cloud save.</span>' +
                         '<span class="afwc-status"></span><span class="afwc-note"></span>';
          setStatus('link-sent');
        } catch (e) { setStatus('error', e.message); }
      };
      ui.querySelector('[data-act=link]').addEventListener('click', go);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    }
  }

  function mountBar() {
    if (!cfg.mount) return;
    const host = typeof cfg.mount === 'string' ? document.querySelector(cfg.mount) : cfg.mount;
    if (!host) return;
    if (!document.getElementById('afwc-style')) {
      const st = document.createElement('style');
      st.id = 'afwc-style';
      st.textContent = BAR_CSS;
      document.head.appendChild(st);
    }
    ui = document.createElement('div');
    ui.className = 'afwc-bar';
    host.appendChild(ui);
    renderBar();
  }

  /* ------------------------------------------------------------------
     Init
  ------------------------------------------------------------------ */
  async function init(options) {
    const g = window.AFW_CONFIG || {};
    cfg = Object.assign({}, cfg, { url: g.supabaseUrl, anonKey: g.supabaseAnonKey }, options);
    if (cfg.url) cfg.url = cfg.url.replace(/\/+$/, '');

    if (!cfg.url || !cfg.anonKey) {
      console.warn('AFWCloud: missing Supabase config — running in offline mode (JSON export only).');
      return;
    }

    // 1) Returning from a magic link?
    const fromLink = parseHashTokens();
    if (fromLink) {
      try {
        fromLink.user = await fetchUser(fromLink.access_token);
        storeSession(fromLink);
      } catch (e) { storeSession(null); }
    } else {
      // 2) Existing stored session?
      session = readStoredSession();
      if (session) await ensureFreshSession();
    }

    mountBar();

    // 3) Signed in → pull cloud data and hand it to the tool.
    if (session && session.user) {
      setStatus('signed-in');
      try {
        const row = await loadCloudData();
        if (row && typeof cfg.onData === 'function') {
          cfg.onData(row.data, { updatedAt: row.updated_at });
        }
      } catch (e) { /* tool keeps whatever state it has */ }
    }
  }

  return {
    init: init,
    scheduleSave: scheduleSave,
    saveNow: saveNow,
    signOut: signOut,
    isSignedIn: () => !!(session && session.user),
    userEmail: () => (session && session.user ? session.user.email : null),
  };
})();
