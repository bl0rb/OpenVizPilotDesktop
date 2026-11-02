// Settings window: server, account, hotkey, default model, autostart.
import { invoke, listen, t, h, icon, spinner, logo } from './common.js';

let state = null;
let models = null; // { models: [{id,label}], defaultModel } after sign-in
let form = null;
let check = null; // { checking } | { ok } | { error }
let accountError = null;
let saveResult = null; // { ok } | { error }
let update = null;

async function refresh() {
  state = await invoke('get_state');
  update = await invoke('get_update_state');
  if (!form) form = { server_url: state.server_url, hotkey: state.hotkey, default_model: state.default_model };
  if (state.server_managed) form.server_url = state.server_url;
  if (state.hotkey_managed) form.hotkey = state.hotkey;
  if (state.signed_in && models === null) models = await invoke('list_models').catch(() => ({ models: [] }));
  if (!state.signed_in) models = null;
  render();
}

async function testConnection() {
  check = { checking: true };
  render();
  try { await invoke('test_connection', { serverUrl: form.server_url }); check = { ok: true }; }
  catch (error) { check = { error: String(error) }; }
  render();
}

async function save() {
  try {
    await invoke('save_settings', { serverUrl: form.server_url, hotkey: form.hotkey, defaultModel: form.default_model });
    saveResult = { ok: true };
  } catch (error) {
    saveResult = { error: String(error) };
  }
  refresh();
}

async function signIn() {
  accountError = null;
  try { await invoke('sign_in'); } catch (error) { accountError = String(error); }
  refresh();
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
        oninput: (e) => { form.server_url = e.target.value; check = null; } }),
      t('Öffentliche Adresse der OpenVizPilot-Middleware – dieselbe, die die Extension und die Admin-UI verwenden (ohne /api).')),
    h('div', { class: 'actions' },
      h('button', { onclick: testConnection, disabled: check?.checking }, t('Verbindung testen')),
      check?.checking && spinner(),
      check?.ok && h('span', { class: 'green' }, icon('check'), ' ', t('Erreichbar')),
      check?.error && h('span', { class: 'error-text' }, check.error)));

  const account = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t('Konto'))),
    state.signed_in
      ? h('div', { class: 'actions' },
        h('span', { class: 'chip ok' }, icon('user'), h('span', null, state.username ? t('Angemeldet als %@', state.username) : t('Angemeldet'))),
        h('span', { class: 'spacer' }),
        h('button', { class: 'danger', onclick: () => invoke('sign_out') }, t('Abmelden')))
      : h('div', { class: 'actions' },
        h('span', { class: 'chip missing' }, icon('warning'), h('span', null, t('Nicht angemeldet'))),
        h('span', { class: 'spacer' }),
        state.login_pending
          ? [spinner(), t('Anmeldung im Browser läuft …'), h('button', { onclick: () => invoke('cancel_sign_in') }, t('Abbrechen'))]
          : h('button', { class: 'primary', onclick: signIn, disabled: !state.server_url }, t('Anmelden'))),
    accountError && h('div', { class: 'error-text' }, accountError));

  const modelOptions = models?.models?.length
    ? [h('option', { value: '' }, t('Vorgabe des Servers')), models.models.map((m) => h('option', { value: m.id, selected: m.id === form.default_model }, m.label ?? m.id))]
    : h('option', { value: form.default_model }, t('Nach der Anmeldung wählbar'));
  const usage = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t('Bedienung'), managedBadge(state.hotkey_managed))),
    field(t('Tastenkürzel'),
      h('input', { type: 'text', class: 'mono', value: form.hotkey, disabled: state.hotkey_managed, spellcheck: 'false', oninput: (e) => { form.hotkey = e.target.value; } }),
      t('Öffnet das Fragefenster von überall, z. B. CmdOrCtrl+Shift+Space. Leer = aus.')),
    field(t('Standard-Modell'),
      h('select', { disabled: !models?.models?.length, onchange: (e) => { form.default_model = e.target.value; } }, modelOptions)),
    h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked: state.autostart, onchange: (e) => invoke('set_autostart', { enabled: e.target.checked }) }),
      t('Beim Anmelden am Computer starten')));

  const actions = h('div', { class: 'actions' },
    h('span', { class: 'spacer' }),
    saveResult?.ok && h('span', { class: 'green' }, t('Gespeichert')),
    saveResult?.error && h('span', { class: 'error-text' }, saveResult.error),
    h('button', { class: 'primary', onclick: save }, t('Speichern')));

  let status;
  if (!update.enabled) status = h('span', { class: 'muted' }, t('Updates verteilt Ihre IT.'));
  else if (update.installing) status = [spinner(), t('Update wird installiert – OpenVizPilot startet danach neu …')];
  else if (update.checking) status = [spinner(), t('Suche nach Updates …')];
  else if (update.available) status = [h('span', { class: 'accent' }, t('Version %@ ist verfügbar.', update.available)),
    h('button', { class: 'primary', onclick: () => invoke('install_update').catch(() => {}) }, t('Jetzt installieren'))];
  else if (update.checked && !update.error) status = h('span', { class: 'green' }, icon('check'), ' ', t('OpenVizPilot ist aktuell.'));
  const about = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t('Über OpenVizPilot'), managedBadge(!update.enabled))),
    field(t('Version'), h('span', { class: 'mono selectable' }, state.version)),
    h('div', { class: 'actions' },
      update.enabled && h('button', { disabled: update.checking || update.installing, onclick: () => invoke('check_for_updates') }, t('Nach Updates suchen')),
      status),
    update.notes && update.available && h('div', { class: 'section-note selectable' }, update.notes),
    update.error && h('div', { class: 'error-text' }, update.error));

  document.getElementById('main').replaceChildren(server, account, usage, actions, about);
}

listen('state-changed', () => refresh());
listen('update-changed', () => refresh());
listen('login-result', (event) => { accountError = event.payload ?? null; refresh(); });
refresh();
