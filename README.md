# OpenVizPilot Desktop

<img src="ui/logo.svg" width="96" alt="OpenVizPilot logo">

Tray-App für macOS (Menüleiste) und Windows (Infobereich), die Fragen an die
Tableau-Umgebung stellt — ohne geöffnetes Dashboard. Open Source (MIT); der
Server-Teil ist die [OpenVizPilot](https://github.com/bl0rb/OpenVizPilot)-Middleware
in der Enterprise Edition (Single Sign-On per OIDC, aktive Tableau-Server-Integration; für
Daten statt nur Metadaten zusätzlich Lizenz `serverData`, die Freigabe „Serverdaten“ je Person
und deren Einwilligung). Serverseite: [docs/desktop.md](https://github.com/bl0rb/OpenVizPilot/blob/main/docs/desktop.md).

Zwei Ansichten:

- **Schnellleiste** – Klick auf das Symbol oder `Cmd/Ctrl+Shift+Space`: eine schwebende
  Eingabeleiste in der Bildschirmmitte, auch über Vollbild-Apps; die Antwort klappt darunter auf.
  Am Griff links verschiebbar (Doppelklick: zurück zur Mitte).
- **App-Fenster** – beim Start der App oder über „OpenVizPilot öffnen“ im Tray-Menü: Modus
  (Fragen | Untersuchen), Modellwahl, Verlauf. Schließen lässt die App im Tray weiterlaufen.

Der Agenten-Loop läuft **serverseitig** (`POST /api/desktop/chat`): Die App sendet nur den
Gesprächstext, die Middleware ruft die Tableau-Server-Tools in der persönlichen Identität der
angemeldeten Person auf und streamt Antwort, Analyse-Schritte und Anschlussfragen zurück. Jede
Tool-Runde ist in der App unter „Analyse“ aufklappbar. Was die Person in Tableau nicht sehen
darf, sieht sie auch hier nicht.

Gebaut mit Tauri 2 wie [Weave Desktop](https://github.com/bl0rb/Weave) und
[KeyZapper](https://github.com/bl0rb/ClaudeKeyZapper); keine Build-Kette für die Oberfläche
(`ui/` ist reines HTML/JS).

## Anmeldung (SSO)

Die App meldet sich wie eine native App nach RFC 8252 an — mit denselben SSO-Einstellungen
wie die Dashboard-Extension, ohne Änderung am Identity-Provider:

1. Sie liest `GET /api/auth/config` und öffnet im Browser die Anmeldung des IdP mit
   PKCE-`code_challenge` und `redirect_uri` = `<Public URL>/auth/callback` (die registrierte
   Callback-URL der Middleware). Der `state` trägt den Loopback-Port: `desktop-<port>-<zufall>`.
2. `/auth/callback` erkennt diesen `state` und leitet Code und `state` an
   `http://127.0.0.1:<port>/callback` weiter — nur an die Loopback-Adresse.
3. Die App tauscht Code + `code_verifier` über `POST /api/auth/exchange` (BFF, Client-Secret
   bleibt auf dem Server) gegen das ID-Token und legt es im Schlüsselbund bzw. in der
   Windows-Anmeldeinformationsverwaltung ab. Läuft es ab, bittet die App um eine neue Anmeldung.

## Vorgaben durch die IT (Intune/MDM)

| Name | Wirkung |
|---|---|
| `ServerUrl` | Adresse der Middleware, nicht änderbar |
| `Hotkey` | Tastenkürzel, nicht änderbar (leer = aus) |
| `UpdateCheck` | `false` schaltet die Update-Prüfung ab (wenn die IT Updates selbst verteilt) |
| `UpdateUrl` | eigener Update-Feed statt GitHub (Format `latest.json` von Tauri) |

macOS: Konfigurationsprofil für die Domain `de.werkworks.openvizpilot.desktop`.
Windows: Werte unter `HKLM\SOFTWARE\Policies\OpenVizPilot\Desktop` (oder HKCU); `UpdateCheck`
als DWORD (0/1) oder Zeichenfolge.

## Updates

Das Tray-Menü zeigt die Version und „Nach Updates suchen …“; ist ein Update da, wird daraus
„Update auf X installieren …“. Dasselbe steht unter *Einstellungen › Über OpenVizPilot*, und
das Fragefenster zeigt einen Hinweis. Die App prüft 20 Sekunden nach dem Start und dann alle
12 Stunden.

Feed ist `latest.json` am Release `desktop-latest`; jedes Release (ohne Vorabversionen) schreibt
ihn neu. Pakete sind mit dem Schlüssel signiert, dessen öffentlicher Teil in
`src-tauri/tauri.conf.json` steht – ein Download, der nicht passt, wird nicht installiert.

## Entwickeln

```bash
npm install
npm run dev
```

Tests der Rust-Seite: `cargo test` in `src-tauri/`. Paket bauen: `npm run build`
(macOS `.app`/`.dmg`, Windows `.msi`; Windows braucht die WebView2-Runtime).

Gegen eine lokale Middleware genügt `http://localhost:3000` als Adresse — `http://` ist nur für
localhost erlaubt, sonst `https://`.

## Builds und Releases

`.github/workflows/desktop.yml` testet und baut bei jedem Pull Request beide Installer:
`OpenVizPilot-<version>.dmg` (macOS, universal) und `OpenVizPilot-<version>.msi` (Windows).
Sie liegen als Artefakte am Lauf.

Ein Tag `vX.Y.Z` veröffentlicht beide als GitHub-Release (`vX.Y.Z-rc.1` als Vorabversion):

```bash
git tag v0.1.0
```

```bash
git push origin v0.1.0
```

Signieren ist optional und schaltet sich mit den Repository-Secrets ein. Ohne sie ist die
macOS-App nur ad hoc signiert (Gatekeeper warnt beim ersten Start) und das MSI unsigniert
(SmartScreen warnt) – gut zum Testen, nicht für den Rollout.

| Secret | Inhalt |
|---|---|
| `APPLE_CERTIFICATE` | „Developer ID Application“-Zertifikat als `.p12`, base64 |
| `APPLE_CERTIFICATE_PASSWORD` | Passwort der `.p12` |
| `APPLE_SIGNING_IDENTITY` | z. B. `Developer ID Application: Firma (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Notarisierung: Apple-ID, app-spezifisches Passwort, Team-ID |
| `WINDOWS_CERTIFICATE` | Code-Signing-Zertifikat als `.pfx`, base64 |
| `WINDOWS_CERTIFICATE_PASSWORD` | Passwort der `.pfx` |
| `TAURI_SIGNING_PRIVATE_KEY` | Update-Signaturschlüssel (Inhalt der Datei aus `tauri signer generate`); ohne ihn kein Update-Feed |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Passwort dazu (leer, falls ohne Passwort erzeugt) |
