# Claude-Auftrag: Studio-Design für OpenVizPilotDesktop

Stand: 7. November 2026 · Umsetzungsvorgabe für dieses Repository

## Auftrag und Umfang

Setze die Desktop-Oberfläche dieses Repositories nach der gemeinsamen Designrichtung **Studio – modern & markant** um. Ziel ist eine hochwertige Produktfamilie aus Weave, OpenVizPilot, KeyZapper, OpenReleasePilot und OpenSitePilot: gleiche gestalterische Regeln, aber aufgabengerechte Ansichten pro App. Arbeite ausschließlich im unten genannten Repository und erhalte dessen vollständigen aktuellen Funktionsumfang.

Dies ist ein konkreter UI-Implementierungsauftrag, keine Aufforderung zu einem weiteren Konzeptpapier. Lies zuerst die geltenden Repository-Anweisungen, prüfe Branch und Arbeitsbaum und erhalte fremde Änderungen. Verwende das vorhandene Tauri-2-/HTML-/CSS-/JavaScript-System. Kein Frameworkwechsel, keine neue Build-Kette, kein gemeinsames Monorepo und kein neues UI-Paket. Gemeinsame Regeln werden lokal umgesetzt; keine Imports aus Geschwister-Repositories. Backend- oder native Änderungen nur, soweit sie für die konkrete Darstellung/Fenstergröße erforderlich sind.

Die Aufgabe endet mit lokal geprüfter Umsetzung und einem knappen Ergebnisbericht. Commit, Push, PR-Veröffentlichung, Release, Installation oder produktive externe Aktionen sind durch diese Anleitung nicht zusätzlich beauftragt. Bereits separat erteilte Freigaben gelten weiter.

## Visuelle Referenz und ihre Grenzen

Zusätzliche lokale Referenz: [Klickbarer Studio-Entwurf](/Users/matze/.codex/visualizations/2026/11/07/01a1b59c-f00f-78b2-99cc-17498d931bc5/desktop-studio.html). Darin die unten genannte App auswählen und beide Erscheinungsbilder sowie die passenden Ansichten ansehen. Die Datei ist ein HTML-Fragment für die Chat-Vorschau, keine startfertige Anwendung. Die Spezifikation in dieser Markdown-Datei ist auch ohne Zugriff auf die Vorschau vollständig genug zur Umsetzung.

**Übernimm die Gestaltung, nicht die Demo-Implementierung.** Insbesondere:

- Die obere App-Auswahl, „Desktop Studio“, „Designkonzept“, Beschreibungen außerhalb des Fensters und der Vorschau-Schalter Hell/Dunkel gehören nicht in die App. Keine neue App-übergreifende Navigation bauen.
- Gezeichnete macOS-Fensterknöpfe sind Vorschau-Chrome. In der App native Titelleiste/Buttons und vorhandene Drag-Regionen respektieren; keine zweite Titelleiste oder nachgebauten Traffic Lights hinzufügen.
- Beispielnamen, Fragen, Antworten, Versionen, Budgetwerte, URLs, Konten, Statuswerte, Quellen und Freigaben dürfen nicht fest in Produktansichten übernommen werden. Echte Daten und bestehende Zustandsmodelle verwenden.
- Die kleinen Mockup-Dialoge vereinfachen den Funktionsumfang. Aktuelle Felder, Optionen, Validierungen, Aktionen, Plattformunterschiede und verwaltete Vorgaben vollständig erhalten, auch wenn sie in der Vorschau fehlen.
- Keine Simulation, Timer-Erfolgsmeldung, optimistische „fertig“-Markierung oder lokale Demo-Zustandsmaschine anstelle realer Rückmeldungen übernehmen. Kein externes Icon-CDN, keine Vorschau-Hilfen wie `Tweak`/`window.openai`, keine Aufweichung von CSP/Capabilities.
- Der aktuelle Produktcode und dokumentierte Verträge bestimmen Funktionen und Berechtigungen. Die Referenz bestimmt Hierarchie, Abstände, Flächen, Typografie und Gewichtung. Bei einem Konflikt die Gestaltung an den echten Funktionsumfang anpassen.

## Gemeinsame Designvorgaben

### Flächen und Farben

Semantische CSS-Variablen verwenden und vorhandene Tokens weiterentwickeln. Die Namen unten sind Rollen, keine Pflicht zum Umbenennen bestehender Variablen. Systemdarstellung bzw. vorhandene Theme-Einstellung beibehalten; beide Themes gleichwertig gestalten. Keine zusätzliche Theme-Einstellung nur deshalb einführen, weil die Vorschau einen Umschalter enthält.

| Rolle | Hell | Dunkel |
|---|---|---|
| Hauptfläche | `#fcfcfe` | `#17191f` |
| Sidebar / zurückgesetzte Fläche | `#f3f4f8` | `#111319` |
| Karten / Eingaben / Dialoge | `#ffffff` | `#20232c` |
| Primärer Text | `#1b2032` | `#f0f2f9` |
| Sekundärer Text | `#656b7c` | `#a3aabc` |
| Trennlinien | `#e3e6ee` | `#303440` |
| Hover / neutrale Hervorhebung | `#eceef5` | `#292d39` |
| Erfolg | `#18785b` | `#6bd4a7` |
| Hinweis / Aufmerksamkeit | `#9c5d05` | `#edbf6b` |
| Fehler | `#b53b47` | `#f09096` |

App-Akzent siehe unten. Aktive Navigation und dezente Hervorhebungen erhalten etwa 10 % Akzent auf der jeweiligen Fläche. Primärbuttons nutzen den vollen Akzent, mit weißer Beschriftung im hellen Theme und sehr dunkler Beschriftung auf dem helleren Dunkelmodus-Akzent; Kontrast am tatsächlichen Hintergrund prüfen. Farben ergänzen Text und Symbole, ersetzen sie nicht. Keine großflächigen dekorativen Verläufe oder neue Markenlogos; vorhandene Produktassets weiterverwenden.

### Typografie und Geometrie

- Systemschrift: `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `system-ui`, `sans-serif`; keine Webfont-Abhängigkeit.
- Fließtext 14 px, längere Antworten 14–15 px mit etwa 1,65 Zeilenhöhe. Sekundärtext 12 px; 11 px nur für wenig wichtige Metadaten, nicht für zentrale Aktionen oder Fehlermeldungen.
- Seitentitel 26–29 px, Gewicht etwa 650–700, dezentes negatives Letterspacing; Abschnittstitel 18 px, Elementüberschriften 14 px/600–650. Keine große Marketingüberschrift zulasten von Inhalt; Seitentitel bleiben fachlich verständlich.
- Abstandsraster 4/8/12/16/24/32 px. Inhaltsränder meist 24–28 px, auf schmalen Fenstern 16 px. Verwandte Elemente enger gruppieren als unabhängige Abschnitte.
- Buttons und Eingaben Radius 8 px; Karten 12 px; Composer und Dialoge 12–16 px. Fensterrahmen bleiben nativ. Schatten sparsam für schwebende Flächen und Dialoge, keine Schattenkachel um jeden Inhalt.
- Reguläre Controls ungefähr 36 px hoch; verständliche Beschriftungen, ausreichende Klickflächen und sichtbarer Tastaturfokus. Wichtige Aktionen nicht ausschließlich als unbeschriftete Icons anbieten.
- Eine dominante Primäraktion pro Ansicht. Nebenaktionen als neutrale Buttons oder beschriftetes Menü; destruktive Aktionen eindeutig unterscheiden. Kontextaktionen beim betroffenen Objekt halten.
- Tabellen mit ruhigen horizontalen Trennlinien und klaren Zeilen; keine unnötigen Dashboard-Kennzahlen. Lange Namen und Pfade dürfen Aktionen nicht verdrängen.

### Verhalten, Zugänglichkeit und Qualität

Alle bestehenden Zustände gestalten: Einrichtung, Anmeldung/Abmeldung, leer, lädt, erfolgreich, fehlgeschlagen, abgebrochen, gesperrt/verwaltet und veraltete/unbekannte Daten. Bei deaktivierten wichtigen Aktionen den Grund zugänglich erklären. Wesentliche Information nicht in reine Hover-Tooltips verschieben.

Native Controls, sinnvolle Labels, Fokusreihenfolge, Escape und Fokus-Rückgabe bei Dialogen erhalten. Statuswechsel angemessen ankündigen; nicht jedes gestreamte Token vorlesen. Reduzierte Bewegung respektieren. Bestehende Sprachen und Übersetzungsmechanismen vollständig mitziehen.

Inhalt bleibt bei Fensteränderungen stabil: keine verlorene Eingabe, springende Textauswahl, gestohlener Fokus, neu startende Animation oder verlorene Scrollposition durch unnötigen DOM-Neuaufbau. Gestreamte Antworten und Logausgaben dürfen die Oberfläche nicht blockieren. Desktop-Fenster bei Standard- und Mindestgröße sowie vergrößerter Schrift prüfen; nicht das Vorschau-Layout starr skalieren.

## OpenVizPilotDesktop: konkrete Umsetzung

**Zielrepo:** `OpenVizPilotDesktop`. Nicht die Tableau-Extension, das öffentliche Core-Exportrepo `OpenVizPilot` oder die Middleware in `OpenVizPilotEnterprise` umgestalten. **Referenzansichten:** OpenVizPilot → Hauptfenster/Untersuchen, Schnellleiste, Einstellungen. **Akzent:** hell `#275ce6`, dunkel `#87a9ff`. Vorhandenes Logo `ui/logo.svg` erhalten.

### Einstieg und betroffene Dateien

| Zuständigkeit | Datei |
|---|---|
| Aktuelle Produktregeln / Entwicklung | [README](../../README.md), [AGENTS](../../AGENTS.md) |
| Gespräch, Analyse, Einwilligung, Haupt-/Schnellfenster | [panel.js](../../ui/panel.js), [panel.html](../../ui/panel.html), [quick.html](../../ui/quick.html) |
| Design, gemeinsame Darstellung / Übersetzung | [style.css](../../ui/style.css), [common.js](../../ui/common.js) |
| Server, Konto, Bedienung, Updates | [settings.js](../../ui/settings.js), [settings.html](../../ui/settings.html) |
| Fenstermaße / native Integration | [tauri.conf.json](../../src-tauri/tauri.conf.json), [main.rs](../../src-tauri/src/main.rs) |

1. **Hauptfenster:** klare Produktkopfzeile und die vorhandenen Aktionen. „Fragen | Untersuchen“ als kompakte Moduswahl, Modellwahl nur entsprechend dem echten Modellangebot. Keine erfundene Dashboard-, Workbook- oder Gesprächsarchiv-Sidebar. Eine Lesespalte von maximal etwa 680–720 px bei großen Fenstern; bei kleinen Fenstern flexible Breite. Native Mindestmaße nicht als Lösung für Layoutprobleme erhöhen.
2. **Antwort / Analyse:** Quellen, belegte Aussagen und Prozesszustand klar gewichten. „Untersuchen“ macht echte Analysephasen und deren Zustand aufklappbar sichtbar; „Fragen“ bleibt kompakt. Keine vier Schritte fest voraussetzen und keine erfundenen Kennzahlen/Charts anzeigen. Links zu Workbooks/Views und echte Follow-ups weiterverwenden. Ein „mit Quellen belegt“-Badge nur dann, wenn die vorhandenen strukturierten Daten diese Aussage tragen; reine Ausgabe ist kein Qualitätsnachweis.
3. **Composer:** gut erreichbares Eingabefeld, eindeutiges Senden/Stopp, vorhandene Modell-/Modusauswahl. Vom Server gelieferte Modelle und Vorgaben erhalten, kein hart codiertes Ersatzmodell. Auswahlwechsel, Streaming, Retry, Folgefrage, Zeilenumbruch und IME-Eingabe dürfen keine Eingabe verlieren.
4. **Einwilligung / Zugriff:** Einwilligung als lesbare, fokussierbare Entscheidung im Kontext der Antwort gestalten. Bestehende „Zustimmen“-/„Später“-Aktionen und erneutes Stellen nach erteilter Zustimmung erhalten. Lizenz-, Admin-, Site-, Budget- und Zugriffsablehnungen verständlich und unterscheidbar darstellen. Keine Zustimmung durch bloßes Öffnen, Senden oder Umschalten eines Modus.
5. **Schnellleiste:** Logo/Eingabe/Senden in der ersten Zeile, Modus und tatsächliche Modellwahl in einer ruhigeren zweiten Zeile. Antwort und Analyse wachsen darunter. Vorhandene Aktionen erhalten; keine im Mockup nur angedeutete fensterübergreifende Gesprächssynchronisation neu erfinden. Drag-Griff, gespeicherte Position, Fokus, Vollbild und Schatten unverändert funktionsfähig halten. Start-/Inhaltshöhe und native Größenanpassung zusammen prüfen, damit die zweite Zeile nicht abgeschnitten wird.
6. **Einstellungen:** Server, Konto, Bedienung, Über/Updates konsistent neu gestalten. Alle aktuellen Felder und Zustände erhalten, ausdrücklich auch Verbindung-/Anmeldungstest, Standardmodell, Autostart, Hotkey, verwaltete Werte und Update-Policy. Fehlende Modelle nicht als erfolgreiche leere Auswahl kaschieren.

### Unverhandelbare Funktionsgrenzen

- Desktop ist ein persönlicher Tableau-Assistent. Agenten-Loop, Tableau-Tools, Lizenz-/Budgetregeln und Zugriffsentscheidungen bleiben in der Middleware. Keine direkten Tableau-Abfragen, PATs oder Service-Accounts ergänzen.
- Rust behält API-Transport, native Aktionen und Credential-Zugriff. Serverbezogene Tokens, PKCE S256, zufälliger OAuth-State, begrenzter Loopback-Callback, HTTPS/Proxy/TLS und signierte Updates erhalten.
- Einwilligung, persönliche Identität und Site-/Admin-Freigaben serverseitig durchsetzen lassen; UI ersetzt diese Prüfungen nicht.
- SSE-Analyse, Text, Hinweise, Einwilligung, Fehler, Abbruch und Abschluss getrennt behandeln. Ein abgebrochener Stream bleibt abgebrochen; keine Erfolgsbadges oder Follow-up-Freigaben aufgrund bloßer Textmenge.
- Keine persistente History-Funktion aus dem Mockup ableiten. Bestehendes Gespräch im Arbeitsspeicher, Inaktivitätsregel und Aktualisierung beim erneuten Öffnen erhalten.
- Hauptfenster schließen beendet die Tray-App nicht. Autostart, normaler Start, Hauptfenster und Schnellleiste haben unterschiedliche Sichtbarkeit. Gemeinsame Änderungen in beiden Fenstern prüfen.

### Prüfen und abnehmen

Vom Repository-Root die tatsächlich geänderten Dateien prüfen, beispielsweise:

```sh
node --input-type=module --check < ui/panel.js
node --input-type=module --check < ui/common.js
node --input-type=module --check < ui/settings.js
```

Vorhandenes Setup mit `npm run dev` verwenden. Bei Rust-Verhaltensänderungen passende bestehende Tests mit `cargo test --locked --manifest-path src-tauri/Cargo.toml <testname>` ausführen. Keine neuen Test-/Build-Abhängigkeiten und keine pauschalen Installer-Builds für Layoutänderungen. Das Repo hat keine `npm test`-, Lint- oder Typecheck-Skripte.

Abnahme: Hell/Dunkel, Haupt-/Schnellfenster, Standard- und Mindestgröße (aktuell 400 × 480 für das Hauptfenster), lange Antworten/Analyseschritte, Fragen/Untersuchen, echte Modelloptionen, Follow-ups, Streamabbruch/-fehler, Einwilligung erforderlich/erteilt/fehlgeschlagen, verweigerter Zugriff, SSO-Zustände, verwaltete Einstellungen, Tastatur und Fokus. Auth-/Tableau-Zustände mit synthetischen kontrollierten Antworten prüfen; keine produktiven Einwilligungen oder Datenzugriffe als normale Testnebenwirkung. macOS und Windows sind Zielplattformen; fehlende native Prüfungen benennen.

## Arbeitsfolge und Fertigkriterien

1. Aktuellen UI-Zustand und native Fenstergrenzen anhand der genannten Dateien erfassen. Die Referenz mit realen Funktionen abgleichen; keine erneute Vollrepo-Analyse oder Roadmap anlegen.
2. Lokale Designtokens und bestehende Controls anpassen, dann die spezifischen Hauptansichten, Nebenansichten und vollständigen Dialoge. Bestehende Daten-/Command-Schnittstellen verwenden. Falls nur die Darstellung betroffen ist, Rust unverändert lassen.
3. Relevante Zustände, Interaktionen und beide Themes prüfen. Für tatsächliche Verhaltensänderungen fokussierte Regressionstests hinzufügen; keine Tests, die nur CSS-Werte oder diese Anleitung nacherzählen. Syntaxprüfung und Mockup-Screenshots sind kein Nachweis nativer Funktion.
4. Den finalen Diff auf unbeabsichtigte Funktionsverluste und abgeschwächte Guards prüfen. Nur wenn die Umsetzung dokumentiertes Verhalten verändert, bestehende passende Dokumentation aktualisieren.
5. Knapp berichten: umgesetzte Ansichten, wichtige Dateien, tatsächlich geprüfte Plattformen/Interaktionen, relevante Screenshots und verbleibende Blocker. Ungeprüfte native Integration ausdrücklich von geprüftem Browser-Rendering unterscheiden. Keine Umsetzung als fertig melden, wenn wichtige vorhandene Dialoge oder Zustände nur Platzhalter sind.

**Fertig ist die Aufgabe, wenn** die betroffenen vollständigen Oberflächen erkennbar der Studio-Familie entsprechen, alle bisherigen Funktionen und Schutzmechanismen erhalten sind, zentrale Abläufe und Fehlerzustände geprüft wurden und die Umsetzung mit einem fokussierten Diff reviewbar ist. Danach stoppen; kein anschließendes Refactoring oder weiterer Produktumfang.
