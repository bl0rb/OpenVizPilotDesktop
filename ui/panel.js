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
/** [{ role: 'user', text } | { role: 'answer', mode, text, status, steps, followups, notice, consent, error, done, trailOpen? }] */
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
    h('button', { 'aria-pressed': String(mode === value), 'data-focus': `mode-${value}`, onclick: () => setMode(value) }, label)));
wireLinks(panel);

/** Status changes for screen readers (a finished answer, an error, a consent request) -- never each streamed token.
    Lives outside #panel, so full renders do not re-announce it. */
const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
document.body.append(live);
function announce(text) {
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = text; });
}

/** One question field for the window's lifetime. Renders rebuild the rest of the window; recreating the field
    would drop the caret, its grown height or an IME composition in progress (draft text alone is not enough). */
let composer = null;
let composing = false;
let renderAfterComposition = false;
function composerInput() {
  if (!composer) {
    composer = h('textarea', {
      rows: 1,
      'data-focus': 'composer',
      oninput: (e) => { draft = e.target.value; autosize(); },
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitDraft(); }
      },
      oncompositionstart: () => { composing = true; },
      oncompositionend: () => {
        composing = false;
        if (renderAfterComposition) { renderAfterComposition = false; render(); }
      },
    });
  }
  composer.disabled = !ready();
  composer.placeholder = placeholder();
  composer.setAttribute('aria-label', placeholder());
  if (composer.value !== draft) composer.value = draft;
  return composer;
}

function autosize() {
  if (!composer?.isConnected) return;
  composer.style.height = 'auto';
  composer.style.height = `${composer.scrollHeight}px`;
  if (QUICK) fitWindow();
}

const submitDraft = () => submit(composer?.value ?? draft, { clearDraft: true });

/** Puts focus back where it was before a full render (same control by `data-focus`), else into the question field. */
function restoreFocus(previous) {
  const target = previous?.key && panel.querySelector(`[data-focus="${previous.key}"]`);
  if (target && !target.disabled) target.focus();
  else composer?.focus();
  if (previous?.selection && document.activeElement === composer) composer.setSelectionRange(...previous.selection);
}

function rememberFocus() {
  const active = document.activeElement;
  if (!active || !panel.contains(active)) return null;
  return { key: active.dataset.focus ?? null, selection: active === composer ? [composer.selectionStart, composer.selectionEnd] : null };
}

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
  if (streaming) stop();
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

/** `retry`: the same question again after an error -- the middleware then does not count it as a new turn.
    `clearDraft`: the text came from the question field. A follow-up or retry leaves a half-written draft alone. */
async function submit(text, { retry = false, clearDraft = false } = {}) {
  text = text.trim();
  if (!text || streaming || !session?.agent?.available) return;
  if (clearDraft) draft = '';
  messages.push({ role: 'user', text, fresh: true });
  pinQuestion = true;
  lastActive = Date.now();
  const answer = { role: 'answer', mode, text: '', status: t('OpenVizPilot denkt nach …'), notes: [], steps: [], followups: [], fresh: true };
  let markCompleted;
  const completed = new Promise((resolve) => { markCompleted = resolve; });
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
      case 'consent_required': answer.consent = { scope: event.scope, text: event.text }; announce(t('Einwilligung erforderlich')); break;
      case 'notice': answer.notice = event.text; break;
      case 'final': answer.text = event.content ?? answer.text; answer.followups = event.followups ?? []; answer.completed = true; markCompleted(); break;
      case 'done': answer.completed = true; markCompleted(); break;
      case 'error': answer.error = event.message ?? t('Fehler'); break;
      default: break;
    }
    if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; renderMessages(); }); }
  };
  try {
    await invoke('ask', { messages: history(), mode, model: model || null, retry, onEvent: channel });
  } catch (error) {
    answer.error = error === 'unauthorized' ? t('Sitzung abgelaufen – bitte neu anmelden.') : String(error);
  }
  // Large channel messages (the `final` with the whole answer) can reach the page after `ask` has returned
  // (Tauri fetches them separately), so a stream that was not stopped gets a moment for `final`/`done`.
  if (!answer.completed && !answer.error && !answer.stopRequested) {
    await Promise.race([completed, new Promise((resolve) => { setTimeout(resolve, 1500); })]);
  }
  if (!answer.text && !answer.error) answer.error = t('Abgebrochen.');
  // Stopped (`stop_answer` ends the call without an error) or cut off before the middleware finished:
  // the streamed text stays visible but is marked as incomplete -- never shown as a finished answer.
  else if (!answer.error && !answer.completed) answer.stopped = true;
  answer.status = null;
  answer.done = true;
  streaming = false;
  lastActive = Date.now();
  announce(answer.error ?? (answer.stopped ? t('Abgebrochen.') : t('Antwort fertig.')));
  render();
}

function stop() {
  const answer = messages.at(-1);
  if (streaming && answer?.role === 'answer') answer.stopRequested = true;
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

/** Tool rounds as they really happened. A step still `running` when the stream ended was cut off -- it is shown as
    stopped, never as done. "Untersuchen" answers open the trail by default, "Fragen" keeps it folded; the reader's own
    toggle survives the re-renders while the answer streams. */
function renderSteps(message) {
  const steps = message.steps;
  if (!steps.length) return null;
  const stopped = message.done && (Boolean(message.error) || message.stopped || steps.some((s) => s.status === 'running'));
  const running = !message.done && steps.some((s) => s.status === 'running');
  const count = steps.length === 1 ? t('Schritt') : t('Schritte');
  const state = running || !message.done ? h('span', { class: 'trail-state' }, t('läuft …'))
    : stopped ? h('span', { class: 'trail-state stopped' }, t('abgebrochen'))
      : h('span', { class: 'trail-state done' }, t('abgeschlossen'));
  return h('details', {
    class: 'trail',
    open: message.trailOpen ?? message.mode === 'investigate',
    ontoggle: (e) => { if (e.target.isConnected) message.trailOpen = e.target.open; },
  },
  h('summary', null, running ? spinner() : icon('tool'),
    h('span', { class: 'trail-summary-text' }, h('strong', null, t('Analyse')), ` · ${steps.length} ${count} · `), state),
  h('ol', { class: 'trail-steps' }, steps.map((s, index) => {
    const cut = s.status === 'running' && message.done;
    const marker = s.status === 'running' && !message.done ? h('span', { class: 'step-marker' }, spinner())
      : cut ? h('span', { class: 'step-marker stopped' }, icon('pause'))
        : h('span', { class: 'step-marker done' }, String(index + 1));
    return h('li', { class: 'trail-step' },
      h('div', { class: 'trail-head' }, marker, h('code', null, s.name)),
      s.arguments && h('div', { class: 'trail-args mono' }, s.arguments),
      s.preview && h('pre', { class: 'trail-preview' }, s.preview));
  })));
}

let consentIds = 0;
/** The decision stays with the person: only "Zustimmen" grants it (server-side), "Später" just folds the card. */
function renderConsent(answer) {
  const consent = answer.consent;
  if (!consent) return null;
  consent.id ??= `consent-${++consentIds}`;
  return h('section', { class: 'consent', role: 'group', 'aria-labelledby': consent.id },
    h('div', { class: 'consent-head' }, icon('shield'), h('strong', { id: consent.id }, t('Einwilligung erforderlich'))),
    h('p', null, consent.text),
    consent.accepted
      ? h('span', { class: 'result ok' }, icon('check'), h('span', null, t('Zugestimmt – bitte die Frage erneut stellen.')))
      : h('div', { class: 'actions' },
        h('button', { class: 'primary', 'data-focus': `${consent.id}-accept`, onclick: () => acceptConsent(answer) }, t('Zustimmen')),
        h('button', { onclick: () => { answer.consent = null; render(); } }, t('Später'))),
    consent.error && h('span', { class: 'result error' }, icon('warning'), h('span', null, consent.error)));
}

function renderAnswer(message) {
  const text = h('div', { class: 'answer-text' });
  text.innerHTML = markdown(message.text);
  return h('div', { class: 'msg-answer' },
    h('div', { class: 'answer-mark' }, logo(), 'OpenVizPilot', message.mode === 'investigate' && h('span', { class: 'pill accent' }, t('Untersuchen'))),
    message.status && h('div', { class: 'status-line' }, h('span', { class: 'shimmer-text' }, message.status)),
    message.notes.map((note) => { const el = h('div', { class: 'answer-text answer-note' }); el.innerHTML = markdown(note); return el; }),
    renderSteps(message),
    message.text && text,
    message.notice && h('div', { class: 'callout note' }, icon('info'), h('div', { class: 'callout-text' }, t(message.notice))),
    message.stopped && h('div', { class: 'callout note' }, icon('pause'), h('div', { class: 'callout-text' }, t('Abgebrochen.'))),
    renderConsent(message),
    // Follow-ups only for a finished answer -- never for a stopped or failed stream.
    message.followups.length > 0 && message.done && !message.error && !message.stopped && h('div', { class: 'options' },
      message.followups.map((q) => h('button', { onclick: () => submit(q) }, icon('followup'), q))),
    message.error && h('div', { class: 'callout error' }, icon('warning'),
      h('div', { class: 'callout-text' }, message.error,
        message.done && !streaming && h('button', { class: 'link', onclick: () => retryAnswer(message) }, t('Erneut versuchen')))),
  );
}

/** Drops the failed answer and its question, then asks the same question again as a retry. */
function retryAnswer(answer) {
  const index = messages.indexOf(answer);
  const question = messages[index - 1];
  if (index < 1 || question?.role !== 'user') return;
  messages.splice(index - 1, 2);
  submit(question.text, { retry: true });
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

/** Why the agent is unavailable, by the session's structured `reason` (not by its message text). */
function unavailableTitle() {
  // Any failure to load the session -- the middleware may have answered (e.g. 403 without the "KI" grant), so no
  // claim about connectivity; its own message follows below the title.
  if (sessionError) return t('Sitzung konnte nicht geladen werden');
  switch (session?.agent?.reason) {
    case 'approval_required': return t('Freigabe „Tableau-API“ fehlt');
    case 'oidc_required': return t('Persönliche SSO-Anmeldung erforderlich');
    default: return t('Tableau-Integration nicht verfügbar');
  }
}

function renderEmpty() {
  if (!session?.agent?.available) {
    return h('div', { class: 'empty compact' },
      h('span', { class: 'empty-icon' }, icon('warning')),
      h('h2', null, unavailableTitle()),
      h('p', null, sessionError ?? session?.agent?.error ?? ''),
      !sessionError && h('p', { class: 'grants' }, grantsLine()),
      h('div', { class: 'actions' },
        h('button', { 'data-focus': 'session-retry', onclick: () => refresh(true) }, t('Erneut versuchen')),
        h('button', { 'data-focus': 'session-settings', onclick: () => invoke('open_settings') }, t('Einstellungen'))));
  }
  return h('div', { class: 'empty compact' },
    logo('logo--large'),
    h('h1', null, t('Was möchten Sie wissen?')),
    h('p', { class: 'muted' }, t(ABOUT)),
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

const clearButton = () => h('button', { class: 'icon-only plain', title: t('Verlauf leeren'), 'aria-label': t('Verlauf leeren'), 'data-focus': 'clear', onclick: newConversation }, icon('trash'));

/** Only the models the server offers; with one (or none) there is nothing to choose. */
const modelSelect = () => models?.models?.length > 1 && h('select', { class: 'model-select', 'aria-label': t('Standard-Modell'), 'data-focus': 'model', onchange: (e) => setModel(e.target.value) },
  models.models.map((m) => h('option', { value: m.id, selected: m.id === (model || models.defaultModel) }, m.label ?? m.id)));

/** Send, or -- while an answer streams -- a labelled stop. */
const sendOrStop = (extraClass = '') => (streaming
  ? h('button', { class: 'stop-button', 'data-focus': 'stop', onclick: stop, title: t('Stopp') }, icon('stop'), t('Stopp'))
  : h('button', { class: `primary send-button ${extraClass}`, 'data-focus': 'send', title: t('Senden'), 'aria-label': t('Senden'), disabled: !ready(), onclick: submitDraft }, icon('arrowUp')));

function renderSignedOut() {
  if (!state.server_url) {
    return h('div', { class: 'empty compact' },
      logo('logo--large'),
      h('h1', null, t('OpenVizPilot einrichten')),
      h('p', null, t('Tragen Sie die Adresse Ihrer OpenVizPilot-Middleware ein.')),
      h('button', { class: 'primary', onclick: () => invoke('open_settings') }, t('Einstellungen öffnen')));
  }
  return h('div', { class: 'empty compact' },
    logo('logo--large'),
    h('h1', null, t('Bei OpenVizPilot anmelden')),
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
/** fit_quick (main.rs) caps the overlay at this height. */
const QUICK_MAX_HEIGHT = 640;
const QUICK_CONTENT_MAX = 420;
/** The overlay window follows its content's height. The answer area gives way to a grown question field or a
    note, so its end (follow-ups, consent) never sits below the capped window edge. */
function fitWindow() {
  if (!QUICK || fitPending) return;
  fitPending = true;
  requestAnimationFrame(() => {
    fitPending = false;
    const content = document.getElementById('content');
    if (content?.isConnected) {
      const others = panel.getBoundingClientRect().height - content.getBoundingClientRect().height;
      const limit = `${Math.max(120, Math.min(QUICK_CONTENT_MAX, Math.floor(QUICK_MAX_HEIGHT - others)))}px`;
      if (content.style.maxHeight !== limit) content.style.maxHeight = limit;
    }
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
  const focus = rememberFocus();
  const input = composerInput();
  // Row 1: drag the bar by its grip (or any empty spot); a double-click on the grip puts it back in the middle (main.rs).
  const bar = h('div', { class: 'quick-bar', 'data-tauri-drag-region': true },
    h('span', {
      class: 'grip',
      'data-tauri-drag-region': true,
      title: t('Ziehen zum Verschieben · Doppelklick: zurück zur Mitte'),
      ondblclick: () => invoke('reset_quick_position').catch(() => {}),
    }, icon('grip')),
    logo('', streaming),
    input,
    sendOrStop('quick-send'));
  // Row 2, quieter: mode, the server's real model choice, clear.
  const controls = ready() && h('div', { class: 'quick-controls', 'data-tauri-drag-region': true },
    modeSwitch(),
    modelSelect(),
    h('span', { class: 'spacer', 'data-tauri-drag-region': true }),
    messages.length > 0 && clearButton());

  const parts = [bar, controls];
  if (!state.signed_in) {
    parts.push(!state.server_url
      ? quickNote(t('OpenVizPilot einrichten'), t('Tragen Sie die Adresse Ihrer OpenVizPilot-Middleware ein.'),
        h('button', { onclick: () => invoke('open_settings') }, t('Einstellungen öffnen')))
      : quickNote(t('Bei OpenVizPilot anmelden'), loginError ?? t('Die Anmeldung läuft über das SSO Ihrer Organisation im Browser.'),
        state.login_pending
          ? [spinner(), h('button', { onclick: () => invoke('cancel_sign_in') }, t('Abbrechen'))]
          : [h('button', { class: 'primary', onclick: signIn }, t('Anmelden')), h('button', { onclick: () => invoke('open_settings') }, t('Einstellungen'))]));
  } else if (!session?.agent?.available) {
    parts.push(quickNote(unavailableTitle(), sessionError ?? session?.agent?.error ?? grantsLine(),
      h('button', { 'data-focus': 'session-retry', onclick: () => refresh(true) }, t('Erneut versuchen')),
      h('button', { 'data-focus': 'session-settings', onclick: () => invoke('open_settings') }, t('Einstellungen'))));
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
  panel.replaceChildren(...parts.filter(Boolean));
  if (content.isConnected) renderMessages(previousScrollTop);
  autosize();
  fitWindow();
  restoreFocus(focus);
}

function render() {
  if (!state) return;
  // Rebuilding the window mid-composition would end the IME input; finish it first (see composerInput).
  if (composing) { renderAfterComposition = true; return; }
  if (QUICK) return renderQuick();
  const focus = rememberFocus();
  const settingsButton = h('button', { class: 'icon-only plain', title: t('Einstellungen'), 'aria-label': t('Einstellungen'), 'data-focus': 'settings', onclick: () => invoke('open_settings') }, icon('gear'));
  const brand = h('div', { class: 'brand' }, h('strong', null, 'OpenVizPilot'), h('span', null, t('Tableau-Assistent')));
  if (!state.signed_in) {
    panel.replaceChildren(
      h('header', { class: 'panel-head' }, logo(), brand, h('span', { class: 'spacer' }), settingsButton),
      renderSignedOut());
    restoreFocus(focus);
    return;
  }

  const head = h('header', { class: 'panel-head' },
    logo('', streaming),
    brand,
    h('span', { class: 'spacer' }),
    messages.length > 0 && clearButton(),
    settingsButton);

  const tools = h('div', { class: 'panel-tools' },
    modeSwitch(),
    h('span', { class: 'spacer' }),
    modelSelect());

  const content = h('section', { class: 'content', id: 'content', onwheel: () => { pinQuestion = false; } });
  const previousScrollTop = document.getElementById('content')?.scrollTop;
  const updateBanner = update?.available && h('div', { class: 'update-banner' },
    update.installing ? [spinner(), t('Update wird installiert – OpenVizPilot startet danach neu …')]
      : [h('span', null, t('Version %@ ist verfügbar.', update.available)),
        h('button', { class: 'link', onclick: () => invoke('install_update').catch(() => {}) }, t('Jetzt installieren'))]);
  const input = composerInput();

  panel.replaceChildren(head, updateBanner || '', tools, content,
    h('footer', { class: 'composer' }, h('div', { class: 'composer-box' },
      input,
      h('div', { class: 'composer-row' },
        h('span', { class: 'composer-hint', 'aria-hidden': 'true' }, t('↵ Senden · ⇧ ↵ Zeilenumbruch')),
        sendOrStop()))));
  renderMessages(previousScrollTop);
  autosize();
  restoreFocus(focus);
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
  // Opened by hotkey or tray: type right away, whatever control had focus when it was hidden.
  refresh(true).then(() => { if (ready()) composer?.focus(); });
});
refresh();
