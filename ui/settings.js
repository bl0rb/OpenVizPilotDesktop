// Settings window: server, account, hotkey, default model, autostart.
import { invoke, listen, t, h, icon, spinner, logo } from './common.js';

let state = null;
let models = null; // { models: [{id,label}], defaultModel } after sign-in
let form = null;
let check = null; // { checking } | { ok } | { error }
let accountError = null;
let signInCheck = null; // { checking } | { ok } | { error }
let saveResult = null; // { ok } | { error }
let saveTimer = null;
let update = null;

async function refresh() {
  state = await invoke('get_state');
  update = await invoke('get_update_state');
  if (!form) form = { server_url: state.server_url, hotkey: state.hotkey, default_model: state.default_model };
  if (state.server_managed) form.server_url = state.server_url;
  if (state.hotkey_managed) form.hotkey = state.hotkey;
  if (state.signed_in && models === null) {
    models = await invoke('list_models').catch((error) => {
      if (String(error) === 'unauthorized') accountError = t('Sitzung abgelaufen – bitte neu anmelden.');
      return { models: [] };
    });
  }
  if (!state.signed_in) { models = null; signInCheck = null; }
  render();
}

async function testConnection() {
  check = { checking: true };
  render();
  try { await invoke('test_connection', { serverUrl: form.server_url }); check = { ok: true }; }
  catch (error) { check = { error: String(error) }; }
  render();
}

async function testSignIn() {
  signInCheck = { checking: true };
  render();
  try { await invoke('test_sign_in'); signInCheck = { ok: true }; }
  catch (error) { signInCheck = { error: String(error) }; }
  refresh();
}

function persist() {
  return invoke('save_settings', { serverUrl: form.server_url, hotkey: form.hotkey, defaultModel: form.default_model });
}

async function save() {
  clearTimeout(saveTimer);
  try {
    await persist();
    saveResult = { ok: true };
    saveTimer = setTimeout(() => { saveResult = null; render(); }, 3000);
  } catch (error) {
    saveResult = { error: String(error) };
  }
  refresh();
}

async function signIn() {
  accountError = null;
  try {
    // Sign in to the address shown in the field, not to an older saved one.
    if (form.server_url !== state.server_url) await persist();
    await invoke('sign_in');
  } catch (error) { accountError = String(error); }
  refresh();
}

/** A result next to a button: same icon, colour and fade-in everywhere. */
function result(entry, okText) {
  if (!entry) return null;
  if (entry.checking) return h('span', { class: 'result busy' }, spinner());
  if (entry.ok) return h('span', { class: 'result ok' }, icon('check'), h('span', null, okText));
  return h('span', { class: 'result error' }, icon('warning'), h('span', null, entry.error));
}

function edited() {
  saveResult = null;
}

function managedBadge(managed) {
  return managed && h('span', { class: 'badge managed' }, t('Von der IT vorgegeben'));
}

function field(label, control, note) {
  return [h('div', { class: 'field' }, h('label', null, label), control), note && h('div', { class: 'field-note muted' }, note)];
}

function render() {
  document.getElementById('toolbar').replaceChildren(
    logo('toolbar-logo'),
    h('h1', null, 'OpenVizPilot'),
    h('span', { class: 'spacer' }));

  const server = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t('Server'), managedBadge(state.server_managed))),
    field(t('Middleware-Adresse'),
      h('input', { type: 'text', class: 'mono', value: form.server_url, disabled: state.server_managed, placeholder: 'https://openvizpilot.example.com', spellcheck: 'false',
        oninput: (e) => { form.server_url = e.target.value; check = null; edited(); } }),
      t('Öffentliche Adresse der OpenVizPilot-Middleware – dieselbe, die die Extension und die Admin-UI verwenden (ohne /api).')),
    h('div', { class: 'actions' },
      h('button', { onclick: testConnection, disabled: check?.checking || !form.server_url.trim() }, t('Verbindung testen')),
      result(check, t('Server erreichbar'))));

  const account = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t('Konto'))),
    state.signed_in
      ? h('div', { class: 'actions' },
        h('span', { class: 'chip ok' }, icon('user'), h('span', null, state.username ? t('Angemeldet als %@', state.username) : t('Angemeldet'))),
        h('span', { class: 'spacer' }),
        h('button', { onclick: testSignIn, disabled: signInCheck?.checking }, t('Anmeldung testen')),
        h('button', { class: 'danger', onclick: () => invoke('sign_out') }, t('Abmelden')))
      : h('div', { class: 'actions' },
        h('span', { class: 'chip missing' }, icon('warning'), h('span', null, t('Nicht angemeldet'))),
        h('span', { class: 'spacer' }),
        state.login_pending
          ? [h('span', { class: 'result busy' }, spinner(), h('span', null, t('Anmeldung im Browser läuft …'))),
            h('button', { onclick: () => invoke('cancel_sign_in') }, t('Abbrechen'))]
          : h('button', { class: 'primary', onclick: signIn, disabled: !form.server_url.trim() }, t('Anmelden'))),
    (signInCheck || accountError) && h('div', { class: 'actions' },
      result(signInCheck, t('Anmeldung gültig')),
      result(accountError && { error: accountError })));

  const modelOptions = models?.models?.length
    ? [h('option', { value: '' }, t('Vorgabe des Servers')), models.models.map((m) => h('option', { value: m.id, selected: m.id === form.default_model }, m.label ?? m.id))]
    : h('option', { value: form.default_model }, t('Nach der Anmeldung wählbar'));
  const usage = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t('Bedienung'), managedBadge(state.hotkey_managed))),
    field(t('Tastenkürzel'),
      h('input', { type: 'text', class: 'mono', value: form.hotkey, disabled: state.hotkey_managed, spellcheck: 'false', oninput: (e) => { form.hotkey = e.target.value; edited(); } }),
      t('Öffnet das Fragefenster von überall, z. B. CmdOrCtrl+Shift+Space. Leer = aus.')),
    field(t('Standard-Modell'),
      h('select', { disabled: !models?.models?.length, onchange: (e) => { form.default_model = e.target.value; edited(); render(); } }, modelOptions)),
    h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked: state.autostart, onchange: (e) => invoke('set_autostart', { enabled: e.target.checked }) }),
      t('Beim Anmelden am Computer starten')));

  const actions = h('div', { class: 'actions' },
    h('span', { class: 'spacer' }),
    result(saveResult, t('Gespeichert')),
    h('button', { class: 'primary', onclick: save }, t('Speichern')));

  let status;
  if (!update.enabled) status = h('span', { class: 'muted' }, t('Updates verteilt Ihre IT.'));
  else if (update.installing) status = h('span', { class: 'result busy' }, spinner(), h('span', null, t('Update wird installiert – OpenVizPilot startet danach neu …')));
  else if (update.checking) status = h('span', { class: 'result busy' }, spinner(), h('span', null, t('Suche nach Updates …')));
  else if (update.available) status = [h('span', { class: 'accent' }, t('Version %@ ist verfügbar.', update.available)),
    h('button', { class: 'primary', onclick: () => invoke('install_update').catch(() => {}) }, t('Jetzt installieren'))];
  else if (update.checked && !update.error) status = result({ ok: true }, t('OpenVizPilot ist aktuell.'));
  const about = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t('Über OpenVizPilot'), managedBadge(!update.enabled))),
    field(t('Version'), h('span', { class: 'mono selectable' }, state.version)),
    h('div', { class: 'actions' },
      update.enabled && h('button', { disabled: update.checking || update.installing, onclick: () => invoke('check_for_updates') }, t('Nach Updates suchen')),
      status),
    update.notes && update.available && h('div', { class: 'section-note selectable' }, update.notes),
    update.error && h('div', { class: 'actions' }, result({ error: update.error })));

  document.getElementById('main').replaceChildren(server, account, usage, actions, about);
}

listen('state-changed', () => refresh());
listen('update-changed', () => refresh());
listen('login-result', (event) => { accountError = event.payload ?? null; refresh(); });
refresh();
