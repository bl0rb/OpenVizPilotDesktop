// App window (panel.html) and quick overlay (quick.html; tray click or hotkey): ask the Tableau estate.
import { invoke, Channel, listen, t, h, icon, spinner, markdown, wireLinks, logo } from './common.js';

let state = null;
/** `GET /api/desktop/session`: { user, access, agent: { available, reason?, error?, serverData? }, consent } */
let session = null;
let sessionError = null;
let loginError = null;
let models = null;
let mode = localStorage.getItem('mode') === 'investigate' ? 'investigate' : 'ask';
let model = localStorage.getItem('model') ?? '';
/** [{ role: 'user', text } | { role: 'answer', text, status, steps, followups, notice, consent, error, done }] */
let messages = [];
let streaming = false;
let draft = '';
let update = null;
/** Set by submit(): renders scroll the new question up to the top, then the answer streams in below it untouched. */
let pinQuestion = false;
/** When the window was last shown or used -- after IDLE_RESET_MS away it opens on a fresh conversation. */
let lastActive = Date.now();
const IDLE_RESET_MS = 30 * 60 * 1000;
/** Only this many past turns travel with a question (the middleware caps the message count anyway). */
const MAX_HISTORY_MESSAGES = 40;

const panel = document.getElementById('panel');
document.documentElement.classList.add(navigator.userAgent.includes('Windows') ? 'os-windows' : 'os-mac');
/** The Spotlight-like overlay: one bar, answers expand below it. */
const QUICK = document.body.classList.contains('quick');
const ABOUT = 'Ein Analyse-Assistent für die Tableau-Umgebung: findet Workbooks, Views und Datenquellen, erklärt Kennzahlen und liest – mit Freigabe und Einwilligung – Daten serverseitig in Ihrem Namen. Jede Zahl mit Quelle.';
const MODES = 'Fragen: eine Antwort mit wenigen Tool-Schritten. Untersuchen: ein Analyseplan, mehr Schritte, am Ende Hauptursache, Belege und Quellen.';
const setMode = (value) => { if (mode !== value) { mode = value; localStorage.setItem('mode', value); render(); } };
const modeSwitch = () => h('div', { class: 'segmented', role: 'group', 'aria-label': t('Modus'), title: t(MODES) },
  [['ask', t('Fragen')], ['investigate', t('Untersuchen')]].map(([value, label]) =>
    h('button', { 'aria-pressed': String(mode === value), onclick: () => setMode(value) }, label)));
wireLinks(panel);

async function refresh(reloadSession = false) {
  state = await invoke('get_state');
  update = await invoke('get_update_state');
  if (!state.signed_in) { session = null; models = null; }
  else if (session === null || reloadSession) await loadSession();
  render();
}

async function loadSession() {
  sessionError = null;
  try {
    [session, models] = await Promise.all([invoke('get_session'), invoke('list_models').catch(() => null)]);
    const ids = models?.models?.map((m) => m.id) ?? [];
    if (model && !ids.includes(model)) model = '';
    if (!model && ids.includes(state.default_model)) model = state.default_model;
  } catch (error) {
    session = null;
    if (error !== 'unauthorized') sessionError = String(error);
  }
}

function setModel(id) {
  model = id;
  localStorage.setItem('model', id);
}

function newConversation() {
  if (streaming) invoke('stop_answer');
  messages = [];
  render();
}

// MARK: Actions

/** The conversation as the middleware takes it: finished user/assistant turns only. */
function history() {
  const turns = [];
  for (const m of messages) {
    if (m.role === 'user') turns.push({ role: 'user', content: m.text });
    else if (m.done && m.text && !m.error) turns.push({ role: 'assistant', content: m.text });
  }
  return turns.slice(-MAX_HISTORY_MESSAGES);
}

/** `retry`: the same question again after an error -- the middleware then does not count it as a new turn. */
async function submit(text, retry = false) {
  text = text.trim();
  if (!text || streaming || !session?.agent?.available) return;
  draft = '';
  messages.push({ role: 'user', text, fresh: true });
  pinQuestion = true;
  lastActive = Date.now();
  const answer = { role: 'answer', text: '', status: t('OpenVizPilot denkt nach …'), notes: [], steps: [], followups: [], fresh: true };
  messages.push(answer);
  streaming = true;
  render();

  const channel = new Channel();
  let pending = false;
  channel.onmessage = (event) => {
    switch (event.type) {
      case 'delta': answer.text += event.content ?? ''; answer.status = null; break;
      case 'tool': {
        const step = answer.steps.find((s) => s.id === event.id);
        if (step) Object.assign(step, event); else answer.steps.push({ ...event });
        answer.status = event.status === 'running' ? `${event.name} …` : null;
        // Text written before a tool round (the plan, an interim remark) stays visible as a note; the final answer replaces the stream.
        if (event.status === 'running' && answer.text.trim()) { answer.notes.push(answer.text.trim()); answer.text = ''; }
        break;
      }
      case 'consent_required': answer.consent = { scope: event.scope, text: event.text }; break;
      case 'notice': answer.notice = event.text; break;
      case 'final': answer.text = event.content ?? answer.text; answer.followups = event.followups ?? []; break;
      case 'error': answer.error = event.message ?? 'Fehler'; break;
      default: break;
    }
    if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; renderMessages(); }); }
  };
  try {
    await invoke('ask', { messages: history(), mode, model: model || null, retry, onEvent: channel });
  } catch (error) {
    answer.error = error === 'unauthorized' ? t('Sitzung abgelaufen – bitte neu anmelden.') : String(error);
  }
  if (!answer.text && !answer.error) answer.error = t('Abgebrochen.');
  answer.status = null;
  answer.done = true;
  streaming = false;
  lastActive = Date.now();
  render();
}

function stop() {
  invoke('stop_answer');
}

async function acceptConsent(answer) {
  try {
    await invoke('accept_consent', { scope: answer.consent.scope });
    answer.consent = { ...answer.consent, accepted: true };
    await loadSession();
  } catch (error) {
    answer.consent = { ...answer.consent, error: error === 'unauthorized' ? t('Sitzung abgelaufen – bitte neu anmelden.') : String(error) };
  }
  render();
}

// MARK: Rendering

function renderSteps(steps) {
  if (!steps.length) return null;
  const running = steps.some((s) => s.status === 'running');
  const count = steps.length === 1 ? t('Schritt') : t('Schritte');
  return h('details', { class: 'trail' },
    h('summary', null, running ? spinner() : icon('tool'), ` ${t('Analyse')} · ${steps.length} ${count}`),
    steps.map((s) => h('div', { class: 'trail-step' },
      h('div', { class: 'trail-head' }, h('code', null, s.name), s.status === 'running' && spinner()),
      h('div', { class: 'trail-args mono' }, s.arguments),
      s.preview && h('pre', { class: 'trail-preview' }, s.preview))));
}

function renderConsent(answer) {
  const consent = answer.consent;
  if (!consent) return null;
  return h('div', { class: 'consent' },
    h('strong', null, t('Einwilligung erforderlich')),
    h('p', null, consent.text),
    consent.accepted
      ? h('span', { class: 'green' }, icon('check'), ' ', t('Zugestimmt – bitte die Frage erneut stellen.'))
      : h('div', { class: 'actions' },
        h('button', { class: 'primary', onclick: () => acceptConsent(answer) }, t('Zustimmen')),
        h('button', { onclick: () => { answer.consent = null; render(); } }, t('Später'))),
    consent.error && h('div', { class: 'error-text' }, consent.error));
}

function renderAnswer(message) {
  const text = h('div', { class: 'answer-text' });
  text.innerHTML = markdown(message.text);
  return h('div', { class: 'msg-answer' },
    message.status && h('div', { class: 'status-line' }, h('span', { class: 'shimmer-text' }, message.status)),
    message.notes.map((note) => { const el = h('div', { class: 'answer-text answer-note' }); el.innerHTML = markdown(note); return el; }),
    renderSteps(message.steps),
    message.text && text,
    message.notice && h('div', { class: 'muted small' }, t(message.notice)),
    renderConsent(message),
    message.followups.length > 0 && message.done && h('div', { class: 'options' },
      message.followups.map((q) => h('button', { onclick: () => submit(q) }, q))),
    message.error && h('div', { class: 'error-text' }, message.error),
    message.error && message.done && !streaming && h('button', { class: 'link', onclick: () => retryAnswer(message) }, t('Erneut versuchen')),
  );
}

/** Drops the failed answer and its question, then asks the same question again as a retry. */
function retryAnswer(answer) {
  const index = messages.indexOf(answer);
  const question = messages[index - 1];
  if (index < 1 || question?.role !== 'user') return;
  messages.splice(index - 1, 2);
  submit(question.text, true);
}

/** A message fades in once, when it first appears -- not on every streamed delta. */
function renderMessage(m) {
  const el = m.role === 'user' ? h('div', { class: 'msg-user' }, m.text) : renderAnswer(m);
  if (m.fresh) { el.classList.add('appear'); m.fresh = false; }
  return el;
}

function grantsLine() {
  const yes = t('ja');
  const no = t('nein');
  const a = session?.access ?? {};
  return t('Freigaben: KI %@ · Tableau-API %@ · Serverdaten %@', a.ai ? yes : no, a.tableauApi ? yes : no, a.serverData ? yes : no);
}

function renderEmpty() {
  if (!session?.agent?.available) {
    return h('div', { class: 'empty compact' },
      icon('warning'),
      h('h2', null, t('Tableau-Integration nicht verfügbar')),
      h('p', null, sessionError ?? session?.agent?.error ?? ''),
      h('p', { class: 'small' }, grantsLine()));
  }
  return h('div', { class: 'empty compact' },
    logo('logo--large'),
    h('h2', null, t('Was möchten Sie wissen?')),
    h('p', null, t(ABOUT)),
    h('p', { class: 'small' }, t(MODES)));
}

/** `previousScrollTop`: where the #content that a full render just replaced was scrolled to. */
function renderMessages(previousScrollTop) {
  const content = document.getElementById('content');
  if (!content) return;
  const scrollTop = previousScrollTop ?? content.scrollTop;
  content.replaceChildren(...(messages.length || QUICK ? messages.map(renderMessage) : [renderEmpty()]));
  content.scrollTop = scrollTop;
  // A new question moves up to the top (as far as the answer below it allows),
  // then the answer streams in without dragging the view along to its end.
  const question = pinQuestion && [...content.querySelectorAll('.msg-user')].pop();
  if (question) {
    const target = content.scrollTop + question.getBoundingClientRect().top - content.getBoundingClientRect().top - 8;
    content.scrollTop = target;
    if (content.scrollTop >= target - 1 || !streaming) pinQuestion = false;
  }
  if (QUICK) fitWindow();
}

const clearButton = () => h('button', { class: 'icon-only plain', title: t('Verlauf leeren'), 'aria-label': t('Verlauf leeren'), onclick: newConversation }, icon('trash'));

const modelSelect = (extra = {}) => models?.models?.length > 1 && h('select', { 'aria-label': t('Standard-Modell'), onchange: (e) => setModel(e.target.value), ...extra },
  models.models.map((m) => h('option', { value: m.id, selected: m.id === (model || models.defaultModel) }, m.label ?? m.id)));

function renderSignedOut() {
  if (!state.server_url) {
    return h('div', { class: 'empty compact' },
      logo('logo--large'),
      h('h2', null, t('OpenVizPilot einrichten')),
      h('p', null, t('Tragen Sie die Adresse Ihrer OpenVizPilot-Middleware ein.')),
      h('button', { class: 'primary', onclick: () => invoke('open_settings') }, t('Einstellungen öffnen')));
  }
  return h('div', { class: 'empty compact' },
    logo('logo--large'),
    h('h2', null, t('Bei OpenVizPilot anmelden')),
    h('p', null, t('Die Anmeldung läuft über das SSO Ihrer Organisation im Browser.')),
    state.login_pending
      ? h('div', { class: 'line' }, spinner(), t('Anmeldung im Browser läuft …'), h('button', { onclick: () => invoke('cancel_sign_in') }, t('Abbrechen')))
      : h('button', { class: 'primary', onclick: signIn }, t('Anmelden')),
    loginError && h('div', { class: 'error-text' }, loginError),
    h('button', { class: 'link', onclick: () => invoke('open_settings') }, t('Einstellungen')));
}

async function signIn() {
  loginError = null;
  try { await invoke('sign_in'); } catch (error) { loginError = String(error); }
  refresh();
}

let fitPending = false;
/** The overlay window follows its content's height. */
function fitWindow() {
  if (!QUICK || fitPending) return;
  fitPending = true;
  requestAnimationFrame(() => {
    fitPending = false;
    invoke('fit_quick', { height: Math.ceil(panel.getBoundingClientRect().height) });
  });
}

function quickNote(title, detail, ...buttons) {
  return h('div', { class: 'quick-note' },
    h('div', { class: 'text' }, h('strong', null, title), detail && h('span', { class: 'muted small' }, detail)),
    buttons);
}

const placeholder = () => (mode === 'ask' ? t('Frage an Tableau …') : t('Was soll untersucht werden?'));
const ready = () => Boolean(state.signed_in && session?.agent?.available);

function renderQuick() {
  const input = h('textarea', {
    rows: 1,
    disabled: !ready(),
    placeholder: placeholder(),
    value: draft,
    oninput: (e) => { draft = e.target.value; e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; fitWindow(); },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(e.target.value); }
    },
  });
  // Drag the bar by its grip (or any empty spot); a double-click on the grip puts it back in the middle (main.rs).
  const bar = h('div', { class: 'quick-bar', 'data-tauri-drag-region': true },
    h('span', {
      class: 'grip',
      'data-tauri-drag-region': true,
      title: t('Ziehen zum Verschieben · Doppelklick: zurück zur Mitte'),
      ondblclick: () => invoke('reset_quick_position').catch(() => {}),
    }, icon('grip')),
    logo('', streaming),
    input,
    ready() && modelSelect(),
    ready() && modeSwitch(),
    ready() && messages.length > 0 && clearButton(),
    streaming
      ? h('button', { class: 'quick-send', onclick: stop, title: t('Stopp') }, icon('stop'))
      : h('button', { class: 'primary quick-send', title: t('Senden'), disabled: !ready(), onclick: () => submit(input.value) }, icon('arrowUp')));

  const parts = [bar];
  if (!state.signed_in) {
    parts.push(!state.server_url
      ? quickNote(t('OpenVizPilot einrichten'), t('Tragen Sie die Adresse Ihrer OpenVizPilot-Middleware ein.'),
        h('button', { onclick: () => invoke('open_settings') }, t('Einstellungen öffnen')))
      : quickNote(t('Bei OpenVizPilot anmelden'), loginError ?? t('Die Anmeldung läuft über das SSO Ihrer Organisation im Browser.'),
        state.login_pending
          ? [spinner(), h('button', { onclick: () => invoke('cancel_sign_in') }, t('Abbrechen'))]
          : [h('button', { class: 'primary', onclick: signIn }, t('Anmelden')), h('button', { onclick: () => invoke('open_settings') }, t('Einstellungen'))]));
  } else if (!session?.agent?.available) {
    parts.push(quickNote(t('Tableau-Integration nicht verfügbar'), sessionError ?? session?.agent?.error ?? grantsLine(),
      h('button', { onclick: () => invoke('open_settings') }, t('Einstellungen'))));
  } else if (update?.available) {
    parts.push(quickNote(t('Version %@ ist verfügbar.', update.available), update.installing ? t('Update wird installiert – OpenVizPilot startet danach neu …') : null,
      !update.installing && h('button', { onclick: () => invoke('install_update').catch(() => {}) }, t('Jetzt installieren'))));
  } else if (!messages.length) {
    parts.push(h('div', { class: 'mode-hint' },
      h('strong', null, mode === 'ask' ? t('Fragen') : t('Untersuchen')), ' – ', t(MODES)));
  }
  const content = h('section', { class: 'quick-content', id: 'content', onwheel: () => { pinQuestion = false; } });
  const previousScrollTop = document.getElementById('content')?.scrollTop;
  if (ready() && messages.length) parts.push(content);
  panel.replaceChildren(...parts);
  if (content.isConnected) renderMessages(previousScrollTop);
  fitWindow();
  input.focus();
}

function render() {
  if (!state) return;
  if (QUICK) return renderQuick();
  const settingsButton = h('button', { class: 'icon-only plain', title: t('Einstellungen'), 'aria-label': t('Einstellungen'), onclick: () => invoke('open_settings') }, icon('gear'));
  if (!state.signed_in) {
    panel.replaceChildren(
      h('header', { class: 'panel-head' }, logo(), h('strong', null, 'OpenVizPilot'), h('span', { class: 'spacer' }), settingsButton),
      renderSignedOut());
    return;
  }

  const head = h('header', { class: 'panel-head' },
    logo('', streaming),
    h('strong', null, 'OpenVizPilot'),
    h('span', { class: 'spacer' }),
    messages.length > 0 && clearButton(),
    settingsButton);

  const tools = h('div', { class: 'panel-tools' },
    modeSwitch(),
    h('span', { class: 'spacer' }),
    modelSelect({ class: 'model-select' }));

  const content = h('section', { class: 'content', id: 'content', onwheel: () => { pinQuestion = false; } });
  const previousScrollTop = document.getElementById('content')?.scrollTop;
  const updateBanner = update?.available && h('div', { class: 'update-banner' },
    update.installing ? [spinner(), t('Update wird installiert – OpenVizPilot startet danach neu …')]
      : [h('span', null, t('Version %@ ist verfügbar.', update.available)),
        h('button', { class: 'link', onclick: () => invoke('install_update').catch(() => {}) }, t('Jetzt installieren'))]);
  const input = h('textarea', {
    rows: 1,
    disabled: !ready(),
    placeholder: placeholder(),
    value: draft,
    oninput: (e) => { draft = e.target.value; e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(e.target.value); }
    },
  });
  const sendButton = streaming
    ? h('button', { onclick: stop, title: t('Stopp') }, icon('stop'))
    : h('button', { class: 'primary', title: t('Senden'), disabled: !ready(), onclick: () => submit(input.value) }, icon('arrowUp'));

  panel.replaceChildren(head, updateBanner || '', tools, content,
    h('footer', { class: 'composer' }, h('div', { class: 'composer-box' }, input, sendButton)));
  renderMessages(previousScrollTop);
  input.focus();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (streaming) stop(); else if (QUICK) invoke('hide_panel'); }
  if (QUICK && (e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); invoke('open_settings'); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newConversation(); }
});

listen('state-changed', () => refresh());
listen('update-changed', () => refresh());
listen('login-result', (event) => { loginError = event.payload ?? null; if (!loginError) session = null; refresh(); });
// Shown again (tray icon, hotkey): re-read grants and consent, and start fresh after a long time away.
listen('panel-shown', () => {
  if (!streaming && Date.now() - lastActive > IDLE_RESET_MS) messages = [];
  lastActive = Date.now();
  refresh(true);
});
refresh();
