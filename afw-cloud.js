/* ============================================================
   AFW TOOLS — MAGIC-LINK ACCOUNTS + CLOUD SAVE
   ============================================================
   One shared file. Every page includes it. It provides:

     · Passwordless sign-in. A member types their email, gets a
       link, clicks it, and is signed in. No passwords, ever.
     · Per-member cloud saving of any tool's work.
     · Two drop-in UI pieces (an account bar and a tool
       save/open bar) so each tool page needs ~3 lines of edit.

   HOW A PAGE USES IT
     <script src="./afw-config.js"></script>
     <script src="./afw-cloud.js"></script>
     <div id="afw-account"></div>
     <script>AFWCloud.mountAccountBar("#afw-account");</script>

   AND, on a tool page that has work worth saving:
     AFWCloud.mountToolBar("#afw-toolbar", {
       tool:        "food-cost",              // stable key, never rename
       label:       "cost card",              // used in button text
       serialize:   () => ({...S}),           // current work -> plain object
       deserialize: (data) => applyLoaded(data), // object -> restore the page
       suggestTitle:() => S.productName        // default name when saving
     });

   GRACEFUL BEFORE SETUP
   If afw-config.js has no keys yet, nothing here throws. The
   account bar shows a quiet note and every tool keeps working
   with its existing download/upload .json flow.

   THE SESSION IS SHARED ACROSS TOOLS
   Signing in on the hub signs you in on every tool page too,
   because they are all served from the same site. That is why
   the sign-in box lives on the dashboard.
   ============================================================ */

window.AFWCloud = (function () {
  "use strict";

  var CFG    = window.AFW_CONFIG || {};
  var SDK    = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.js";
  var TABLE  = "afw_saves";

  var sb = null;                 // supabase client, once loaded
  var user = null;               // current signed-in user, or null
  var status = "loading";        // loading | unconfigured | out | in | error
  var lastError = "";
  var listeners = [];            // fns called whenever status/user changes
  var savedListeners = [];       // fns called whenever saved work changes
  var readyResolve;
  var readyPromise = new Promise(function (r) { readyResolve = r; });

  var configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY);

  /* ---------- tiny helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function el(sel) {
    return typeof sel === "string" ? document.querySelector(sel) : sel;
  }
  function emit() { listeners.forEach(function (fn) { try { fn(user, status); } catch (e) {} }); }
  function emitSaved() { savedListeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function when(fn) { listeners.push(fn); if (status !== "loading") fn(user, status); }

  function niceDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var today = new Date();
    var sameDay = d.toDateString() === today.toDateString();
    if (sameDay) return "today " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  /* ---------- styles ---------- */
  function injectCSS() {
    if (document.getElementById("afw-cloud-css")) return;
    var s = document.createElement("style");
    s.id = "afw-cloud-css";
    s.textContent = [
      ".afwc{font-family:'Hanken Grotesk',system-ui,sans-serif;color:#23372B}",
      ".afwc-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;",
        "background:#FFFDF8;border:1px solid #E2D9C6;border-radius:14px;",
        "padding:12px 16px;box-shadow:0 10px 24px -20px rgba(30,58,45,.5)}",
      ".afwc-bar p{margin:0;font-size:.92rem;line-height:1.45}",
      ".afwc-grow{flex:1 1 220px;min-width:0}",
      ".afwc-lab{font-weight:600;font-size:.95rem}",
      ".afwc-sub{color:#7C897F;font-size:.85rem}",
      ".afwc-in{font:inherit;font-size:.95rem;padding:9px 12px;border:1px solid #E2D9C6;",
        "border-radius:9px;background:#fff;color:#23372B;min-width:0;flex:1 1 200px}",
      ".afwc-in:focus{outline:2px solid #C8612E;outline-offset:1px;border-color:#C8612E}",
      ".afwc-btn{font:inherit;font-size:.92rem;font-weight:600;cursor:pointer;white-space:nowrap;",
        "padding:9px 16px;border-radius:9px;border:1px solid transparent;",
        "background:#2C5440;color:#FBF6EC}",
      ".afwc-btn:hover{background:#1E3A2D}",
      ".afwc-btn[disabled]{opacity:.55;cursor:default}",
      ".afwc-btn.ghost{background:transparent;color:#2C5440;border-color:#CFC4AC}",
      ".afwc-btn.ghost:hover{background:#F2EADA}",
      ".afwc-btn.danger{background:transparent;color:#A33B1E;border-color:#E3C3B5}",
      ".afwc-btn.danger:hover{background:#FBEEE8}",
      ".afwc-dot{width:9px;height:9px;border-radius:50%;background:#2C5440;flex:0 0 auto}",
      ".afwc-note{font-size:.86rem;padding:9px 12px;border-radius:9px;margin:0}",
      ".afwc-note.ok{background:#EDF4EE;color:#1E3A2D;border:1px solid #CBE0D0}",
      ".afwc-note.bad{background:#FBEEE8;color:#8A3117;border:1px solid #E9CFC2}",
      ".afwc-note.mut{background:#F4EFE3;color:#6B7A6F;border:1px solid #E2D9C6}",
      /* modal */
      ".afwc-ov{position:fixed;inset:0;background:rgba(30,58,45,.45);z-index:9998;",
        "display:flex;align-items:center;justify-content:center;padding:20px}",
      ".afwc-mod{background:#FFFDF8;border-radius:16px;max-width:560px;width:100%;",
        "max-height:80vh;display:flex;flex-direction:column;overflow:hidden;",
        "box-shadow:0 30px 70px -30px rgba(30,58,45,.7)}",
      ".afwc-mh{padding:18px 22px;border-bottom:1px solid #E2D9C6;display:flex;",
        "align-items:center;gap:12px}",
      ".afwc-mh h3{margin:0;font-family:'Fraunces',Georgia,serif;font-size:1.25rem;flex:1}",
      ".afwc-mb{padding:8px 22px 18px;overflow:auto}",
      ".afwc-row{display:flex;align-items:center;gap:12px;padding:12px 0;",
        "border-bottom:1px solid #EFE7D6}",
      ".afwc-row:last-child{border-bottom:0}",
      ".afwc-rt{flex:1;min-width:0}",
      ".afwc-rt b{display:block;font-size:.98rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".afwc-rt span{font-size:.83rem;color:#7C897F}",
      ".afwc-x{background:none;border:0;font-size:1.5rem;line-height:1;cursor:pointer;color:#7C897F;padding:0 4px}",
      ".afwc-x:hover{color:#23372B}",
      "@media print{.afwc,.afwc-ov{display:none !important}}"
    ].join("");
    document.head.appendChild(s);
  }

  /* ---------- boot ---------- */
  function loadSDK() {
    return new Promise(function (res, rej) {
      if (window.supabase && window.supabase.createClient) return res();
      var t = document.createElement("script");
      t.src = SDK;
      t.onload = res;
      t.onerror = function () { rej(new Error("Could not load the sign-in library.")); };
      document.head.appendChild(t);
    });
  }

  function boot() {
    injectCSS();
    if (!configured) {
      status = "unconfigured";
      readyResolve();
      emit();
      return;
    }
    loadSDK().then(function () {
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      return sb.auth.getSession();
    }).then(function (r) {
      user = (r && r.data && r.data.session && r.data.session.user) || null;
      status = user ? "in" : "out";
      sb.auth.onAuthStateChange(function (_evt, session) {
        user = (session && session.user) || null;
        status = user ? "in" : "out";
        emit();
      });
      // A magic link lands with tokens in the URL hash. Once the
      // client has consumed them, tidy the address bar so nobody
      // copies a link with credentials in it.
      if (location.hash && location.hash.indexOf("access_token") > -1) {
        history.replaceState(null, "", location.pathname + location.search);
      }
      readyResolve();
      emit();
    }).catch(function (e) {
      status = "error";
      lastError = e && e.message ? e.message : String(e);
      readyResolve();
      emit();
    });
  }

  /* ---------- auth ---------- */
  function signIn(email) {
    if (!sb) return Promise.reject(new Error("Cloud saving is not set up yet."));
    return sb.auth.signInWithOtp({
      email: String(email || "").trim(),
      options: { emailRedirectTo: CFG.REDIRECT_TO || location.href }
    }).then(function (r) {
      if (r.error) throw r.error;
      return true;
    });
  }
  function signOut() {
    if (!sb) return Promise.resolve();
    return sb.auth.signOut();
  }

  /* ---------- saved work ---------- */
  function requireIn() {
    if (!sb) throw new Error("Cloud saving is not set up yet.");
    if (!user) throw new Error("Sign in first to save to your account.");
  }
  function list(tool) {
    try { requireIn(); } catch (e) { return Promise.reject(e); }
    var q = sb.from(TABLE).select("id,tool,title,updated_at").eq("user_id", user.id);
    if (tool) q = q.eq("tool", tool);
    return q.order("updated_at", { ascending: false }).then(function (r) {
      if (r.error) throw r.error;
      return r.data || [];
    });
  }
  function get(id) {
    try { requireIn(); } catch (e) { return Promise.reject(e); }
    return sb.from(TABLE).select("*").eq("id", id).single().then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }
  function save(rec) {
    try { requireIn(); } catch (e) { return Promise.reject(e); }
    var row = {
      user_id: user.id,
      tool: rec.tool,
      title: (rec.title || "Untitled").slice(0, 120),
      data: rec.data,
      updated_at: new Date().toISOString()
    };
    var q = rec.id
      ? sb.from(TABLE).update(row).eq("id", rec.id).select().single()
      : sb.from(TABLE).insert(row).select().single();
    return q.then(function (r) {
      if (r.error) throw r.error;
      emitSaved();
      return r.data;
    });
  }
  function remove(id) {
    try { requireIn(); } catch (e) { return Promise.reject(e); }
    return sb.from(TABLE).delete().eq("id", id).then(function (r) {
      if (r.error) throw r.error;
      emitSaved();
      return true;
    });
  }

  /* ---------- account bar (the dashboard's sign-in box) ---------- */
  function mountAccountBar(target, opts) {
    injectCSS();
    var host = el(target);
    if (!host) return;
    opts = opts || {};
    host.classList.add("afwc");

    function render() {
      if (status === "loading") {
        host.innerHTML = '<div class="afwc-bar"><p class="afwc-sub">Checking your account…</p></div>';
        return;
      }
      if (status === "unconfigured") {
        host.innerHTML = '<div class="afwc-bar"><div class="afwc-grow">' +
          '<p class="afwc-lab">Saving to an account isn’t switched on yet</p>' +
          '<p class="afwc-sub">Every tool still works — save your work with the ' +
          'download button inside each one.</p></div></div>';
        return;
      }
      if (status === "error") {
        host.innerHTML = '<div class="afwc-bar"><div class="afwc-grow">' +
          '<p class="afwc-lab">Accounts are having a problem right now</p>' +
          '<p class="afwc-sub">' + esc(lastError) + ' Your tools still work — use the ' +
          'download button inside each one.</p></div></div>';
        return;
      }
      if (status === "in") {
        host.innerHTML = '<div class="afwc-bar">' +
          '<span class="afwc-dot"></span>' +
          '<div class="afwc-grow"><p class="afwc-lab">Signed in as ' + esc(user.email) + '</p>' +
          '<p class="afwc-sub">Your saved work follows you into every tool on this page.</p></div>' +
          '<button class="afwc-btn ghost" data-afw="out">Sign out</button></div>';
        host.querySelector('[data-afw="out"]').onclick = function () { signOut(); };
        return;
      }
      // signed out
      host.innerHTML = '<div class="afwc-bar">' +
        '<div class="afwc-grow"><p class="afwc-lab">Save your work to come back to it</p>' +
        '<p class="afwc-sub">Enter your email and we’ll send a sign-in link. ' +
        'No password to remember.</p></div>' +
        '<input class="afwc-in" type="email" autocomplete="email" ' +
        'placeholder="you@yourbusiness.com" data-afw="email">' +
        '<button class="afwc-btn" data-afw="send">Email me a link</button></div>' +
        '<p class="afwc-note mut" data-afw="msg" hidden></p>';

      var input = host.querySelector('[data-afw="email"]');
      var btn   = host.querySelector('[data-afw="send"]');
      var msg   = host.querySelector('[data-afw="msg"]');

      function show(kind, text) {
        msg.className = "afwc-note " + kind;
        msg.textContent = text;
        msg.hidden = false;
      }
      function go() {
        var v = input.value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
          show("bad", "That doesn’t look like an email address yet.");
          input.focus();
          return;
        }
        btn.disabled = true;
        btn.textContent = "Sending…";
        signIn(v).then(function () {
          show("ok", "Check " + v + " for a link from Akron Food Works. It signs you " +
                     "in for 30 days on this device. The link works once, and it can " +
                     "take a minute to arrive.");
          btn.textContent = "Link sent";
        }).catch(function (e) {
          show("bad", (e && e.message) || "We couldn’t send that link. Try again in a moment.");
          btn.disabled = false;
          btn.textContent = "Email me a link";
        });
      }
      btn.onclick = go;
      input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } };
    }

    when(render);
  }

  /* ---------- modal ---------- */
  function modal(title, bodyHTML) {
    var ov = document.createElement("div");
    ov.className = "afwc-ov afwc";
    ov.innerHTML = '<div class="afwc-mod" role="dialog" aria-modal="true">' +
      '<div class="afwc-mh"><h3>' + esc(title) + '</h3>' +
      '<button class="afwc-x" aria-label="Close">×</button></div>' +
      '<div class="afwc-mb"></div></div>';
    ov.querySelector(".afwc-mb").innerHTML = bodyHTML;
    var onClose = null;
    function close() {
      ov.remove();
      document.removeEventListener("keydown", onKey);
      var cb = onClose; onClose = null;      // fire once, then forget
      if (cb) cb();
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    ov.querySelector(".afwc-x").onclick = close;
    ov.onclick = function (e) { if (e.target === ov) close(); };
    document.addEventListener("keydown", onKey);
    document.body.appendChild(ov);
    return {
      root: ov,
      body: ov.querySelector(".afwc-mb"),
      close: close,
      whenClosed: function (fn) { onClose = fn; }
    };
  }

  /* Ask for a name in our own dialog. window.prompt() is blocked in
     some embedded browsers and looks nothing like the rest of the
     site, so we use the same modal shell as everything else.
     Resolves with the name, or null if the member backs out. */
  function askName(heading, help, initial) {
    return new Promise(function (resolve) {
      var m = modal(heading,
        '<p class="afwc-sub" style="margin:2px 0 12px">' + esc(help) + '</p>' +
        '<input class="afwc-in" data-afw="name" style="width:100%;flex:none" ' +
        'maxlength="120" value="' + esc(initial || "") + '">' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">' +
        '<button class="afwc-btn ghost" data-afw="cancel">Cancel</button>' +
        '<button class="afwc-btn" data-afw="ok">Save</button></div>');

      var input = m.body.querySelector('[data-afw="name"]');
      var done = false;
      function finish(v) { if (done) return; done = true; m.close(); resolve(v); }
      // note: m.close() triggers whenClosed -> finish(null), but `done`
      // is already true by then, so the first answer always wins.

      m.body.querySelector('[data-afw="ok"]').onclick = function () {
        finish(input.value.trim() || (initial || "Untitled"));
      };
      m.body.querySelector('[data-afw="cancel"]').onclick = function () { finish(null); };
      input.onkeydown = function (e) {
        if (e.key === "Enter") { e.preventDefault(); finish(input.value.trim() || (initial || "Untitled")); }
      };
      // Backing out any other way (Escape, the X, clicking the backdrop)
      // resolves as a cancel. finish() is idempotent, so the Save path
      // that closes the modal itself won't be overridden here.
      m.whenClosed(function () { finish(null); });
      input.focus();
      input.select();
    });
  }

  /* ---------- tool bar (save / open, on a tool page) ---------- */
  function mountToolBar(target, cfg) {
    injectCSS();
    var host = el(target);
    if (!host || !cfg || typeof cfg.serialize !== "function") return;
    host.classList.add("afwc");

    var currentId = null;        // the saved row this page is editing, if any
    var currentTitle = "";
    var label = cfg.label || "work";

    function flash(kind, text) {
      var n = host.querySelector('[data-afw="tmsg"]');
      if (!n) return;
      n.className = "afwc-note " + kind;
      n.textContent = text;
      n.hidden = false;
      clearTimeout(flash._t);
      flash._t = setTimeout(function () { n.hidden = true; }, 6000);
    }

    function doSave(forceNew) {
      var suggested = (cfg.suggestTitle && cfg.suggestTitle()) || currentTitle || "";
      var needsName = forceNew || !currentId;
      var ask = needsName
        ? askName("Name this " + label,
                  "Give it a name you’ll recognize later — the dish, the batch, the season.",
                  suggested)
        : Promise.resolve(currentTitle);

      ask.then(function (title) {
        if (title === null) return;          // backed out
        title = String(title).trim() || suggested || "Untitled";
        commit(title, forceNew);
      });
    }

    function commit(title, forceNew) {
      var payload;
      try { payload = cfg.serialize(); }
      catch (e) { flash("bad", "Couldn’t read this page’s work to save it."); return; }

      save({ id: forceNew ? null : currentId, tool: cfg.tool, title: title, data: payload })
        .then(function (row) {
          currentId = row.id;
          currentTitle = row.title;
          render();
          flash("ok", "Saved “" + row.title + "” to your account.");
        })
        .catch(function (e) { flash("bad", (e && e.message) || "That didn’t save."); });
    }

    function doOpen() {
      var m = modal("Your saved " + label + "s", '<p class="afwc-sub">Loading…</p>');
      list(cfg.tool).then(function (rows) {
        if (!rows.length) {
          m.body.innerHTML = '<p class="afwc-sub" style="padding:14px 0">You haven’t saved ' +
            'any ' + esc(label) + 's yet. Build one, then choose “Save to my account”.</p>';
          return;
        }
        m.body.innerHTML = rows.map(function (r) {
          return '<div class="afwc-row"><div class="afwc-rt"><b>' + esc(r.title) + '</b>' +
            '<span>Last saved ' + esc(niceDate(r.updated_at)) + '</span></div>' +
            '<button class="afwc-btn" data-open="' + esc(r.id) + '">Open</button>' +
            '<button class="afwc-btn danger" data-del="' + esc(r.id) + '">Delete</button></div>';
        }).join("");

        m.body.querySelectorAll("[data-open]").forEach(function (b) {
          b.onclick = function () {
            get(b.getAttribute("data-open")).then(function (row) {
              try { cfg.deserialize(row.data); }
              catch (e) { flash("bad", "That saved " + label + " couldn’t be opened."); return; }
              currentId = row.id;
              currentTitle = row.title;
              m.close();
              render();
              flash("ok", "Opened “" + row.title + "”.");
            }).catch(function (e) { flash("bad", (e && e.message) || "Couldn’t open that."); });
          };
        });
        m.body.querySelectorAll("[data-del]").forEach(function (b) {
          b.onclick = function () {
            var id = b.getAttribute("data-del");
            if (!window.confirm("Delete this saved " + label + "? This can’t be undone.")) return;
            remove(id).then(function () {
              if (currentId === id) { currentId = null; currentTitle = ""; render(); }
              b.closest(".afwc-row").remove();
              if (!m.body.querySelector(".afwc-row")) {
                m.body.innerHTML = '<p class="afwc-sub" style="padding:14px 0">Nothing saved here now.</p>';
              }
            }).catch(function (e) { flash("bad", (e && e.message) || "Couldn’t delete that."); });
          };
        });
      }).catch(function (e) {
        m.body.innerHTML = '<p class="afwc-note bad">' + esc((e && e.message) || "Couldn’t load your saved work.") + '</p>';
      });
    }

    // A "?open=<id>" link from the hub drops the member straight
    // into the saved item they clicked. Only ever runs once.
    var autoOpened = false;
    function maybeAutoOpen() {
      if (autoOpened || status !== "in") return;
      var want = new URLSearchParams(location.search).get("open");
      if (!want) return;
      autoOpened = true;
      get(want).then(function (row) {
        if (row.tool !== cfg.tool) return;
        cfg.deserialize(row.data);
        currentId = row.id;
        currentTitle = row.title;
        render();
        flash("ok", "Opened \u201c" + row.title + "\u201d from your saved work.");
      }).catch(function () {
        flash("bad", "That saved " + label + " couldn\u2019t be opened. It may have been deleted.");
      });
    }

    function render() {
      if (status === "loading") { host.innerHTML = ""; return; }

      if (status === "unconfigured" || status === "error") { host.innerHTML = ""; return; }

      if (status === "out") {
        var hub = cfg.hubHref || "./index.html";
        host.innerHTML = '<div class="afwc-bar"><div class="afwc-grow">' +
          '<p class="afwc-lab">Want this ' + esc(label) + ' waiting for you next time?</p>' +
          '<p class="afwc-sub">Sign in on the tool hub with just your email, then come ' +
          'back — saving turns on here automatically.</p></div>' +
          '<a class="afwc-btn ghost" href="' + esc(hub) + '">Go to the hub</a></div>';
        return;
      }

      host.innerHTML = '<div class="afwc-bar">' +
        '<span class="afwc-dot"></span>' +
        '<div class="afwc-grow">' +
        '<p class="afwc-lab">' + (currentTitle
            ? 'Editing “' + esc(currentTitle) + '”'
            : 'Signed in as ' + esc(user.email)) + '</p>' +
        '<p class="afwc-sub">' + (currentTitle
            ? 'Save again to update it, or save a copy under a new name.'
            : 'Save this ' + esc(label) + ' to your account and pick it up on any device.') +
        '</p></div>' +
        '<button class="afwc-btn" data-afw="save">' +
          (currentId ? "Save changes" : "Save to my account") + '</button>' +
        (currentId ? '<button class="afwc-btn ghost" data-afw="saveas">Save a copy</button>' : '') +
        '<button class="afwc-btn ghost" data-afw="open">My saved ' + esc(label) + 's</button>' +
        '</div><p class="afwc-note mut" data-afw="tmsg" hidden></p>';

      host.querySelector('[data-afw="save"]').onclick = function () { doSave(false); };
      var sa = host.querySelector('[data-afw="saveas"]');
      if (sa) sa.onclick = function () { doSave(true); };
      host.querySelector('[data-afw="open"]').onclick = doOpen;
      maybeAutoOpen();
    }

    when(render);
  }

  /* ---------- saved-work list (hub only) ----------
     Shows everything a member has saved, across every tool, and
     links each item back into the tool that made it. TOOLS maps a
     tool key to how it should be described and where it lives. */
  function mountSavedWork(target, toolMap) {
    injectCSS();
    var host = el(target);
    if (!host) return;
    host.classList.add("afwc");
    toolMap = toolMap || {};

    function render() {
      if (status !== "in") { host.innerHTML = ""; return; }
      host.innerHTML = '<div class="afwc-bar"><p class="afwc-sub">Loading your saved work…</p></div>';
      list(null).then(function (rows) {
        if (!rows.length) {
          host.innerHTML = '<div class="afwc-bar"><div class="afwc-grow">' +
            '<p class="afwc-lab">Nothing saved yet</p>' +
            '<p class="afwc-sub">Open any tool below and choose “Save to my account”. ' +
            'What you save shows up here, on every device you sign in on.</p></div></div>';
          return;
        }
        host.innerHTML = '<div class="afwc-bar" style="display:block">' +
          '<p class="afwc-lab" style="margin-bottom:2px">Your saved work</p>' +
          '<p class="afwc-sub" style="margin-bottom:6px">Pick up anything right where you left it.</p>' +
          rows.map(function (r) {
            var t = toolMap[r.tool] || {};
            var href = t.href ? t.href + "?open=" + encodeURIComponent(r.id) : null;
            return '<div class="afwc-row"><div class="afwc-rt"><b>' + esc(r.title) + '</b>' +
              '<span>' + esc(t.name || r.tool) + ' · saved ' + esc(niceDate(r.updated_at)) + '</span></div>' +
              (href ? '<a class="afwc-btn" href="' + esc(href) + '">Open</a>' : '') +
              '</div>';
          }).join("") + '</div>';
      }).catch(function (e) {
        host.innerHTML = '<div class="afwc-bar"><p class="afwc-note bad">' +
          esc((e && e.message) || "Couldn’t load your saved work.") + '</p></div>';
      });
    }
    when(render);
    savedListeners.push(function () { if (status === "in") render(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }

  return {
    ready: function () { return readyPromise; },
    onChange: when,
    user: function () { return user; },
    status: function () { return status; },
    isConfigured: function () { return configured; },
    signIn: signIn, signOut: signOut,
    list: list, get: get, save: save, remove: remove,
    mountAccountBar: mountAccountBar,
    mountToolBar: mountToolBar,
    mountSavedWork: mountSavedWork
  };
})();
