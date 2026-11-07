# AGENTS.md — OpenVizPilot Desktop

## Arbeitsweise

- Die konkrete Aufgabe vollständig mit dem kleinsten korrekten Diff lösen. Sicherheit und ausdrückliche User-Anweisungen haben Vorrang; Korrektheit geht vor Token-, Tool-, Agenten- und Kosteneinsparung.
- Fremde Änderungen erhalten und vorhandene Muster verwenden. Keine beiläufigen Refactorings, Umbenennungen, Formatierungen, Features oder Abhängigkeiten.
- Bei Fehlern von Reproduktion, Meldung oder Test ausgehen. Definitionen und Aufrufer lesen und die Ursache belegen, bevor Code geändert wird.
- Mit `rg` gezielt suchen, nur relevante Abschnitte lesen und Abhängigkeiten/Build-Ausgaben überspringen. Nicht unverändert wiederholen, was bereits gelesen oder geprüft wurde.
- Aus dem Auftrag arbeiten. Keine Pflicht-Roadmap, Claim-Commits oder zusätzlichen Planungsdokumente; nur bei tatsächlich fehlender Entscheidung oder Berechtigung fragen. Bereits erteilte Freigaben gelten weiter.

## Projekt und Zuständigkeiten

OpenVizPilot Desktop ist der Tauri-2-Client für macOS und Windows. Die Oberfläche in `ui/` besteht aus HTML/CSS/JavaScript ohne Frontend-Build-Kette. Für gewöhnliche UI-Arbeit kein Framework oder Bundling einführen. Produktname: **OpenVizPilot**, Konfigurations- und Paketnamen aus dem bestehenden Code übernehmen.

| Bereich | Einstieg |
|---|---|
| Verhalten, Anmeldung, IT-Vorgaben, Entwicklung und Releases | [README.md](README.md) |
| Tauri-Kommandos, Fenster, Tray, Tastenkürzel, Credential-Store und Lebenszyklus | `src-tauri/src/main.rs` |
| Browser-Anmeldung, PKCE und Loopback-Callback | `src-tauri/src/auth.rs` |
| Middleware-Anfragen und SSE-Verarbeitung | `src-tauri/src/api.rs` |
| Persönliche und IT-verwaltete Einstellungen, Server-URL | `src-tauri/src/settings.rs` |
| Signierte Updates | `src-tauri/src/update.rs` |
| Schnellleiste, Hauptfenster und Einstellungen | `ui/quick.html`, `ui/panel.html`, `ui/panel.js`, `ui/settings.html`, `ui/settings.js` |
| Gemeinsame Darstellung und Stil | `ui/common.js`, `ui/style.css` |
| App-Konfiguration, erlaubte native Zugriffe und Abhängigkeiten | `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/Cargo.toml`, `package.json` |
| macOS-Paket und CI/Release | `scripts/build-pkg.sh`, [.github/workflows/desktop.yml](.github/workflows/desktop.yml) |

Nur die zur Aufgabe passenden README-Abschnitte und Module lesen. Die Middleware wird in **OpenVizPilotEnterprise** entwickelt; das öffentliche **OpenVizPilot** ist dessen Core-Export. Der [Desktop-Vertrag](https://github.com/bl0rb/OpenVizPilot/blob/main/docs/desktop.md) wird dort gepflegt. Für koordinierte Serveränderungen die Anleitung des Enterprise-Repositories verwenden, nicht den öffentlichen Export direkt bearbeiten.

## Sicherheits- und Architekturgrenzen

- Der Agenten-Loop und Tableau-Tools laufen serverseitig. Der Client sendet Gespräch und Auswahl an die dokumentierten Middleware-Endpunkte; keine Tableau-Service-Accounts, PATs, direkten Tableau-Abfragen oder eigene LLM-/Lizenzlogik ergänzen.
- Datenzugriff bleibt an die persönliche Identität gebunden. Lizenz, Admin-Freigabe, Einwilligung, Site-Grenzen und Budgets prüft die Middleware. Die UI zeigt Ablehnung oder Einwilligungsbedarf, ersetzt aber keine serverseitige Prüfung und erteilt keine Einwilligung automatisch.
- Native Operationen, API-Transport und Credential-Zugriff bleiben auf der Rust-Seite. Tauri-Kommandos, CSP und Capabilities nur gezielt erweitern; Webinhalte erhalten keine pauschalen Systemrechte.
- Browser-SSO mit PKCE S256, zufälligem `state`, passender Callback-Prüfung und zeitlich begrenztem Listener auf `127.0.0.1` erhalten. Der Code wird über `/api/auth/exchange` eingelöst; ein OIDC-Client-Secret gehört nicht in die App.
- ID-Token im OS-Credential-Store serverbezogen speichern und Ablauf beachten. Tokens nie in JavaScript-Speicher, normale Einstellungen, URLs oder Logs legen und nicht an einen anderen Server weiterreichen.
- HTTPS-Vorgabe mit der bestehenden lokalen HTTP-Ausnahme erhalten. Zertifikatsprüfung nicht für einen Verbindungstest abschalten; vorhandenes Proxy-/TLS-Verhalten beachten.
- IT-Vorgaben gehen vor persönlichen Einstellungen. Verwaltete `ServerUrl`, `Hotkey`, `UpdateCheck` und `UpdateUrl` respektieren; keine UI-Abkürzung darf die Sperre umgehen.
- Updates nur nach erfolgreicher Signaturprüfung installieren. Feed, öffentlicher Schlüssel, App-Kennung und Installationspfade nicht beiläufig ändern; fehlerhafte Updates dürfen die vorhandene Installation nicht unbrauchbar machen.
- Ein normales Öffnen, Autostart, Schnellleiste und Hauptfenster haben unterschiedliche Sichtbarkeit. Das Schließen des Hauptfensters beendet nicht die Tray-App. Gemeinsame UI-Änderungen in beiden Ansichten prüfen.
- Laufende HTTP-/Prozessarbeit begrenzen und von der UI fernhalten; Abbruch und Aufräumen erhalten. SSE-Text, Analyse, Einwilligung, Abschluss und Fehler unterscheiden. Ein abgebrochener Stream ist keine fertige Antwort; fremde Inhalte und Fehlermeldungen sicher darstellen.
- Externe Eingaben validieren und verständliche Fehler zurückgeben statt neue Panics einzuführen. Notwendiges plattformspezifisches `unsafe` eng halten und seine Sicherheitsannahmen erklären. Einstellungen und Tauri-/Server-Payloads kompatibel weiterentwickeln, Migrationen ausdrücklich behandeln.

## Implementieren und prüfen

- Bestehende UI-Stile und Begriffe verwenden. Tastatur, Fokus sowie Lade-, Leer-, Fehler- und Anmeldestatus mitprüfen. Kommentare erklären nicht offensichtliche Schutzmechanismen, damit sie nicht versehentlich entfernt werden.
- Tests mit synthetischen Antworten und temporären Dateien isolieren. Keine echten Tableau-Daten, produktiven Freigaben, fremden Accounts oder echten Keychain-/Installationsänderungen als gewöhnliche Testnebenwirkung verwenden.
- Für Verhaltensfehler gezielte Regressionstests ergänzen, die den ursprünglichen Defekt erkennen. Bei Auth, verwalteten Einstellungen, Datenzugriff oder Updates auch Ablehnungs-/Fehlerfälle prüfen. Keine Tests für bloße Textänderungen oder Tests, die nur die Implementierung nacherzählen.
- Erst den relevanten Test, dann bei Bedarf das betroffene Modul prüfen; nicht automatisch beide Installer bauen. Vorhandene Werkzeuge verwenden und keine Pakete nur für einen zusätzlichen Prüfaufruf installieren.

| Änderung | Kleinster sinnvoller Einstieg, vom Repo-Root |
|---|---|
| Rust-Verhalten | `cargo test --locked --manifest-path src-tauri/Cargo.toml <testname_oder_modul>` |
| Breitere Rust-Integration | `cargo test --locked --manifest-path src-tauri/Cargo.toml`, wenn der Umfang es erfordert |
| JavaScript-Syntax | `node --check ui/<geänderte-datei>.js` |
| Sichtbare UI / Fensterverhalten | `npm run dev`; betroffene Ansicht, Bedienung sowie Fehler-/Anmeldestatus prüfen |
| Tauri-/Paket-/Updater-Änderung | Relevante Plattform- und Workflow-Prüfungen; `npm run build` bei Bedarf, `scripts/build-pkg.sh` für den betroffenen macOS-Installer |
| Nur Dokumentation | Pfade, Befehle und Aussagen mit aktuellen Quellen abgleichen; Diff kontrollieren |

- Platzhalter durch ein echtes Testziel ersetzen und für JavaScript-Prüfungen die Node-Version aus der CI verwenden. Das Repository hat keine `npm test`-, Lint- oder Typecheck-Skripte; Syntaxprüfung belegt weder Darstellung noch Tauri-Integration.
- CI-Rezept und Plattformziele stehen in `.github/workflows/desktop.yml`. Ein erfolgreicher Build beweist keine Anmeldung, Einwilligung, Tray-Interaktion oder Installation. Immer benennen, welche Plattform und welcher Ablauf tatsächlich geprüft wurden.
- Reale SSO-, Server-, Installations- oder Update-Prüfungen nur im bereits autorisierten Umfang durchführen. Fehlende Zugangsdaten/Plattformen und fremde Fehler melden; unabhängige Arbeit trotzdem abschließen. Keine unveränderten erfolgreichen Prüfungen wiederholen.

## Zusammenarbeit und Git

- Agenten nur für unabhängige Arbeit mit erkennbarem Zeit- oder Qualitätsgewinn nutzen, nicht für einfache Suchen, Ein-Datei-Fixes oder Testläufe. Das günstigste fähige Modell wählen, stärkere Modelle für schwierige Ursachen oder Sicherheitsfragen.
- Zuständigkeiten und Dateien trennen, Erkenntnisse knapp weitergeben und wiederverwenden. Bei drei Agenten: Scout, Implementierung, Review. Parallele Schreibarbeit bei Bedarf in getrennten Worktrees; gleichzeitige Rust-Builds gegebenenfalls mit getrennten Zielverzeichnissen.
- Vor Git-Aktionen Branch, Index und Diff prüfen. Neue Branches bei Bedarf mit `codex/`, sofern anders nicht vorgegeben. Nur den beauftragten Umfang committen; keine fremden Änderungen verwerfen, Branches umschreiben oder anderen Agenten ins laufende Werk greifen.
- Bei Issue-/PR-Aufgaben relevante Diskussion und bestehende Lösungen prüfen. Kommentare, Push, Tags und Releases folgen dem ausdrücklichen Auftrag, nicht einer pauschalen Workflow-Anweisung. Eine vorhandene Freigabe nicht erneut erfragen.
- CI nur aufgabenbezogen ändern. SHA-gepinnte Actions, minimale Rechte, begrenzte Jobs sowie macOS-/Windows-Abdeckung erhalten. Prüfungen nicht abschalten, um Fehler zu verbergen. Release-Tags sind `vX.Y.Z`; Ablauf und Signierung aus dem README verwenden, keine Weave-Tagkonvention übernehmen.

## Abschluss

- Das bestehende README mitziehen, wenn Verhalten, Einrichtung oder Kompatibilität geändert wird. Keine doppelten Roadmaps, Pflicht-Devlogs oder separaten Kopien der Serververträge anlegen.
- Finalen Diff auf Umfang, Schutzmechanismen und korrekte Aussagen prüfen. In höchstens 5–8 Zeilen melden: Änderung, wichtige Dateien, tatsächlich ausgeführte Prüfungen und verbleibende Probleme. Lokale Tests, CI und Live-Prüfungen unterscheiden.
- Sobald Auftrag und relevante Prüfung abgeschlossen sind, aufhören. Kein optionales Aufräumen und keine zusätzlichen Tests, Dokumente oder Agentenaufgaben.

## Herkunft

Eigenständige Projektregeln auf Basis der vorhandenen OpenVizPilot-Dokumentation und ausgewählter Prinzipien aus [Craft Core](https://github.com/storytold/craft-contrib/blob/main/standards/house-rules-core.md), [Craft Anything](https://github.com/storytold/craft-anything/blob/main/AGENTS.md) und [Craft Launcher](https://github.com/storytold/craft-launcher/blob/main/AGENTS.md). Diese Links dokumentieren die Herkunft; sie erben keine fremden Regeln und sind keine Pflichtlektüre für Aufgaben.
