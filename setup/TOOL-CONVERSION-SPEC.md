# AFW Cloud — Tool Conversion Spec

**Purpose:** paste this document into any chat alongside an existing AFW tool
HTML file to convert it to the shared cloud-save system, consistently and
without touching the tool's core logic. Written to be self-contained — the
reader (human or Claude) needs no other context.

---

## System overview (context for the converter)

AFW tools are self-contained single HTML files hosted on GitHub Pages at one
domain. A shared module, `afw-cloud.js`, provides optional passwordless
sign-in (Supabase magic link) and per-tool cloud save. Two shared script
files exist at the site root: `afw-config.js` (Supabase URL + anon key) and
`afw-cloud.js` (the module). **Login is always optional — every tool must
remain fully functional signed-out, and the existing JSON export/import
stays as the offline fallback.**

The module's public API:

```js
AFWCloud.mountToolBar('#afw-toolbar', {
  tool:         'permanent-unique-id',  // NEVER change once live
  label:        'cost card',            // used in the button text, e.g. "My saved cost cards"
  serialize:    () => stateObject,      // the tool's full state as a plain object
  deserialize:  (data) => applyState(data),  // applies a loaded state
  suggestTitle: () => 'My cost card'    // default name in the Save dialog
});

AFWCloud.mountAccountBar('#afw-account');  // hub only — sign-in on its own
AFWCloud.mountSavedWork('#afw-saved', {}); // hub only — everything they've saved
AFWCloud.status();                         // 'loading' | 'unconfigured' | 'out' | 'in' | 'error'
```

**One bar does everything.** `mountToolBar` renders whichever of these the
member needs right now: signed out, it shows the *same email sign-in form the
hub shows*, so an account can be started from any tool — nobody is sent to the
hub to sign in and then told to come back. Signed in, it becomes Save / Save a
copy / My saved work. The emailed link returns them to the page they were on.

There is no `AFWCloud.init()` and no `AFWCloud.scheduleSave()`. An earlier
draft of this spec described that autosave pair; it was replaced by the
explicit save bar above. Saving is always a button press, never a background
write.

## The conversion — exactly five changes

1. **Scripts.** Before the tool's own inline script if `mountToolBar` is
   called inside it (the module has to exist by then); otherwise immediately
   before `</body>`:
   ```html
   <script src="afw-config.js"></script>
   <script src="afw-cloud.js"></script>
   ```

2. **Tool bar mount.** Add `<div id="afw-toolbar"></div>` where the bar should
   appear — near the top, above the tool's first input (placement guidance per
   tool below). On a tool that prints, give it `class="no-print"`.

3. **Palette bridge.** The account bar styles itself with `--afw-cream`,
   `--afw-forest`, `--afw-amber` variables (with generic fallbacks). AFW
   tools define `--cream`, `--green`, `--amber`, `--ink` instead. Add this
   to the tool's `:root` so the bar inherits the tool's exact palette:
   ```css
   :root{
     --afw-cream: var(--cream);
     --afw-forest: var(--green-deep, var(--green));
     --afw-amber: var(--amber);
   }
   ```

4. **State wiring.** Reuse the tool's existing JSON export/import functions.
   Every AFW tool already has (a) a function that collects full state to an
   object for export and (b) a function that applies an imported object.
   Pass those as `getData` and `onData`. In `onData`, if the on-screen state
   is non-empty, `confirm()` before replacing it (don't silently clobber
   work in progress). After applying, trigger the tool's recalculation.

5. **Autosave hook.** Call `AFWCloud.scheduleSave()` wherever state changes —
   almost always the same central place the tool already listens for input
   to recalculate or re-render. One line in one place is the goal; don't
   scatter calls.

## Hard constraints

- **Do not modify** calculation logic, input IDs, element structure, or any
  existing feature. This is additive only. (For Hours-That-Pay V2
  specifically: the Movement 1 "everything is included" reveal section and
  the calculator engine must remain byte-identical in behavior.)
- **Do not** introduce any external library, CDN script, or localStorage use
  for tool data. `afw-cloud.js` handles everything via plain fetch.
- **Do not** gate any feature behind sign-in.
- If `window.AFW_CONFIG` is missing (file opened standalone, off the site),
  the module logs a warning and does nothing — the tool must still work.
  Test this case.

## Per-tool details

| toolId (permanent) | Tool | Bar placement & notes |
|---|---|---|
| `hours-that-pay` | Hours-That-Pay V2 | **Public tool.** Keep the bar low-key: place it *after* the results section, framed as save-your-scenario, not near the hero — first-time visitors from an info session should hit the reveal and calculator with zero friction. State = all calculator inputs (product, price, cost, space selection, hours, plan tier, food-truck toggle). |
| `food-cost-builder` | Food Cost & Pricing Builder | Bar near the top. State = the existing JSON save/reload blob, unchanged. |
| `sop-builder` | SOP & Recipe Card Builder | Bar near the top. State = the existing binder JSON (source of truth), unchanged. |
| `readiness-inventory` | Founder Readiness Self-Assessment | Bar near the top. State = all statement ratings + baseline fields. |
| `cloud-save-demo` | Demo/reference tool | Already integrated; use as the pattern example. |

## Validation checklist (run before delivering)

1. Node syntax check on every inline script block:
   `html.split('<script>')` slices, wrap each in `new Function()`.
2. Regex/string presence: `AFWCloud.init`, the correct permanent `toolId`,
   `afw-config.js`, `afw-cloud.js`, `afw-account-bar`, `scheduleSave`.
3. Confirm the diff against the original touches **only** the five additions —
   no changes inside existing functions, styles (other than the palette
   bridge), or markup.
4. Confirm the tool renders and computes with `AFW_CONFIG` absent.
