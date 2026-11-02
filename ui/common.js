// Shared UI helpers for the app window, the quick overlay and the settings window. No framework, no build step.
export const { invoke, Channel } = window.__TAURI__.core;
export const { listen } = window.__TAURI__.event;

export const english = !navigator.language.toLowerCase().startsWith('de');

const EN = {
  'OpenVizPilot einrichten': 'Set up OpenVizPilot',
  'Tragen Sie die Adresse Ihrer OpenVizPilot-Middleware ein.': 'Enter the address of your OpenVizPilot middleware.',
  'Einstellungen öffnen': 'Open settings',
  'Bei OpenVizPilot anmelden': 'Sign in to OpenVizPilot',
  'Die Anmeldung läuft über das SSO Ihrer Organisation im Browser.': "You sign in through your organisation's SSO in the browser.",
  'Anmelden': 'Sign in',
  'Anmeldung im Browser läuft …': 'Signing in in the browser …',
  'Abbrechen': 'Cancel',
  'Fragen': 'Ask',
  'Untersuchen': 'Investigate',
  'Verlauf leeren': 'Clear history',
  'Einstellungen': 'Settings',
  'Frage an Tableau …': 'Ask Tableau …',
  'Was soll untersucht werden?': 'What should be investigated?',
  'Senden': 'Send',
  'Stopp': 'Stop',
  'Standard-Modell': 'Default model',
  'Was möchten Sie wissen?': 'What would you like to know?',
  'Modus': 'Mode',
  'Ziehen zum Verschieben · Doppelklick: zurück zur Mitte': 'Drag to move · Double-click: back to the centre',
  'Quellen': 'Sources',
  'Analyse': 'Analysis',
  'Abgebrochen.': 'Stopped.',
  'OpenVizPilot denkt nach …': 'OpenVizPilot is thinking …',
  'Sitzung abgelaufen – bitte neu anmelden.': 'Session expired – please sign in again.',
  'Server': 'Server',
  'Middleware-Adresse': 'Middleware address',
  'Öffentliche Adresse der OpenVizPilot-Middleware – dieselbe, die die Extension und die Admin-UI verwenden (ohne /api).': 'Public address of the OpenVizPilot middleware – the one the extension and the admin UI use (without /api).',
  'Verbindung testen': 'Test connection',
  'Erreichbar': 'Reachable',
  'Von der IT vorgegeben': 'Managed by IT',
  'Konto': 'Account',
  'Angemeldet als %@': 'Signed in as %@',
  'Angemeldet': 'Signed in',
  'Nicht angemeldet': 'Not signed in',
  'Abmelden': 'Sign out',
  'Bedienung': 'Usage',
  'Tastenkürzel': 'Hotkey',
  'Öffnet das Fragefenster von überall, z. B. CmdOrCtrl+Shift+Space. Leer = aus.': 'Opens the ask window from anywhere, e.g. CmdOrCtrl+Shift+Space. Empty = off.',
  'Vorgabe des Servers': "Server's default",
  'Nach der Anmeldung wählbar': 'Available after sign-in',
  'Beim Anmelden am Computer starten': 'Start when I log in to this computer',
  'Speichern': 'Save',
  'Gespeichert': 'Saved',
  'Über OpenVizPilot': 'About OpenVizPilot',
  'Version': 'Version',
  'Einwilligung erforderlich': 'Consent required',
  'Zustimmen': 'Agree',
  'Später': 'Not now',
  'Zugestimmt – bitte die Frage erneut stellen.': 'Agreed – please ask the question again.',
  'Tableau-Integration nicht verfügbar': 'Tableau integration unavailable',
  'Freigaben: KI %@ · Tableau-API %@ · Serverdaten %@': 'Grants: AI %@ · Tableau API %@ · server data %@',
  'ja': 'yes',
  'nein': 'no',
  'Ein Analyse-Assistent für die Tableau-Umgebung: findet Workbooks, Views und Datenquellen, erklärt Kennzahlen und liest – mit Freigabe und Einwilligung – Daten serverseitig in Ihrem Namen. Jede Zahl mit Quelle.': 'An analysis assistant for your Tableau estate: finds workbooks, views and data sources, explains metrics and – with grant and consent – reads data server-side on your behalf. Every number with its source.',
  'Fragen: eine Antwort mit wenigen Tool-Schritten. Untersuchen: ein Analyseplan, mehr Schritte, am Ende Hauptursache, Belege und Quellen.': 'Ask: one answer with a few tool steps. Investigate: an analysis plan, more steps, closing with main cause, evidence and sources.',
  'Rundenbudget erreicht — die Antwort fasst den bisherigen Stand zusammen.': 'Tool budget reached — the answer sums up what was found so far.',
  'Schritte': 'steps',
  'Schritt': 'step',
  'Erneut versuchen': 'Try again',
  'Nach Updates suchen': 'Check for updates',
  'Suche nach Updates …': 'Checking for updates …',
  'OpenVizPilot ist aktuell.': 'OpenVizPilot is up to date.',
  'Version %@ ist verfügbar.': 'Version %@ is available.',
  'Jetzt installieren': 'Install now',
  'Update wird installiert – OpenVizPilot startet danach neu …': 'Installing the update – OpenVizPilot restarts afterwards …',
  'Updates verteilt Ihre IT.': 'Your IT distributes updates.',
};

/** Translates a German source string and fills its `%@` placeholders in order. */
export function t(key, ...args) {
  const text = english ? EN[key] ?? key : key;
  let i = 0;
  return text.replace(/%@/g, () => (i < args.length ? String(args[i++]) : '%@'));
}

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'required', 'open']);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (PROPS.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ICONS = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  external: '<path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  warning: '<path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17h.01"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9z"/><path d="M19.7 11.3 21 10l-3-3 1.3-1.3"/>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return span.firstChild;
}

export const spinner = () => h('span', { class: 'spinner', role: 'status' });

/** The app mark; `busy` makes it pulse while an answer streams. */
export function logo(extraClass = '', busy = false) {
  return h('img', { src: 'logo.svg', alt: '', class: ['logo', busy && 'logo--busy', extraClass].filter(Boolean).join(' ') });
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a data-href="$2">$1</a>');
}

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isTableDivider = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

/** A small, safe Markdown subset: paragraphs, headings, lists, tables, code, bold, italics, http(s) links. */
export function markdown(source) {
  const out = [];
  let list = null;
  let code = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (code !== null) {
      if (line.startsWith('```')) { out.push(`<pre>${escapeHtml(code.join('\n'))}</pre>`); code = null; }
      else code.push(line);
      continue;
    }
    if (line.startsWith('```')) { closeList(); code = []; continue; }
    // Pipe table: header row, divider, body rows — the shape every answer table has.
    if (isTableRow(line) && isTableDivider(lines[i + 1] ?? '')) {
      closeList();
      const head = splitRow(line);
      let j = i + 2;
      const body = [];
      while (j < lines.length && isTableRow(lines[j])) { body.push(splitRow(lines[j])); j++; }
      out.push('<table><thead><tr>', ...head.map((cell) => `<th>${inline(cell)}</th>`), '</tr></thead><tbody>',
        ...body.map((row) => `<tr>${head.map((_, k) => `<td>${inline(row[k] ?? '')}</td>`).join('')}</tr>`), '</tbody></table>');
      i = j - 1;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (heading) { closeList(); out.push(`<h4>${inline(heading[2])}</h4>`); }
    else if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((bullet ?? numbered)[1])}</li>`);
    } else if (!line.trim()) closeList();
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  if (code !== null) out.push(`<pre>${escapeHtml(code.join('\n'))}</pre>`);
  closeList();
  return out.join('');
}

/** Opens `data-href` links inside `root` in the default browser. */
export function wireLinks(root) {
  root.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-href]');
    if (link) { event.preventDefault(); invoke('open_url', { url: link.dataset.href }); }
  });
}
