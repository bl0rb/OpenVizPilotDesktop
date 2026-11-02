// OpenVizPilot desktop: a tray / menu-bar app that asks the Tableau estate
// through the OpenVizPilot middleware. Click the icon (or press the hotkey)
// and ask; the middleware runs the agent loop server-side. Sign-in through
// the organisation's SSO; the ID token stays in the OS credential store.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod auth;
mod settings;
mod update;

use api::{Middleware, UNAUTHORIZED};
use serde::Serialize;
use serde_json::{json, Value};
use settings::{Managed, Settings};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::async_runtime::JoinHandle;
use tauri::image::Image;
use tauri::ipc::Channel;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use update::{UpdateView, Updates};

const KEYRING_SERVICE: &str = "OpenVizPilot Desktop";
/// Passed by the login item: start quietly in the tray, without the app window.
const AUTOSTART_ARG: &str = "--autostart";
/// First automatic update check after start, then this often.
const UPDATE_FIRST_CHECK: Duration = Duration::from_secs(20);
const UPDATE_INTERVAL: Duration = Duration::from_secs(12 * 60 * 60);
/// Logical width of the quick overlay window.
const QUICK_WIDTH: f64 = 780.0;

#[derive(Clone)]
struct Session {
    server: String,
    /// The verified OIDC ID token -- the middleware's bearer credential.
    token: String,
    /// Epoch milliseconds; after this the middleware answers 401 and the app asks to sign in again.
    expires_at: Option<i64>,
    username: Option<String>,
}

impl Session {
    fn expired(&self) -> bool {
        self.expires_at.is_some_and(|at| at <= now_ms())
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

struct AppState {
    settings_path: PathBuf,
    settings: Mutex<Settings>,
    managed: Managed,
    session: Mutex<Option<Session>>,
    login_task: Mutex<Option<JoinHandle<()>>>,
    chat_abort: Mutex<Option<tokio::task::AbortHandle>>,
    quick_hidden_at: Mutex<Option<Instant>>,
    /// Where `show_quick` last put the overlay -- a `Moved` event there is
    /// ours, not a drag by the user.
    quick_placed_at: Mutex<Option<PhysicalPosition<i32>>>,
    /// The user dragged the overlay since the position was last saved.
    quick_moved: AtomicBool,
    updates: Updates,
    update_menu_item: Mutex<Option<MenuItem<Wry>>>,
}

impl AppState {
    fn effective(&self) -> Settings {
        self.settings.lock().unwrap().effective(&self.managed)
    }

    fn updates_enabled(&self) -> bool {
        self.managed.update_check != Some(false)
    }

    fn middleware(&self) -> Result<Middleware, String> {
        let session = self.session.lock().unwrap().clone().filter(|s| !s.expired()).ok_or(UNAUTHORIZED)?;
        Ok(Middleware::new(&session.server, &session.token))
    }
}

#[derive(Serialize)]
struct StateView {
    server_url: String,
    server_managed: bool,
    hotkey: String,
    hotkey_managed: bool,
    default_model: String,
    autostart: bool,
    signed_in: bool,
    username: Option<String>,
    login_pending: bool,
    version: String,
}

/// The keyring entry holds `<expires_at>:<token>` so an expired token is
/// dropped at start instead of producing a 401 first.
fn keyring_entry(server: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, server).ok()
}

fn store_session(session: &Session) {
    if let Some(entry) = keyring_entry(&session.server) {
        let _ = entry.set_password(&format!("{}:{}", session.expires_at.unwrap_or(0), session.token));
    }
}

fn load_session(server: &str) -> Option<Session> {
    if server.is_empty() {
        return None;
    }
    let stored = keyring_entry(server)?.get_password().ok()?;
    let (expires, token) = stored.split_once(':')?;
    let session = Session {
        server: server.to_string(),
        token: token.to_string(),
        expires_at: expires.parse::<i64>().ok().filter(|at| *at > 0),
        username: None,
    };
    (!session.expired()).then_some(session)
}

fn notify_state(app: &AppHandle) {
    emit_to_visible(app, "state-changed");
}

/// Tells the open windows that something changed. A window waiting hidden in
/// the tray is left alone: after an event, WebKit keeps a hidden window on the
/// display link for good (~1.5 % CPU while idle). It catches up anyway when
/// shown (`panel-shown` refreshes everything).
fn emit_to_visible(app: &AppHandle, event: &str) {
    for (label, window) in app.webview_windows() {
        if window.is_visible().unwrap_or(false) {
            let _ = app.emit_to(label.as_str(), event, ());
        }
    }
}

/// Drops the session after the middleware rejected it, so the UI offers sign-in.
fn on_result<T>(app: &AppHandle, result: Result<T, String>) -> Result<T, String> {
    if matches!(&result, Err(e) if e == UNAUTHORIZED) {
        let state = app.state::<AppState>();
        if let Some(session) = state.session.lock().unwrap().take() {
            if let Some(entry) = keyring_entry(&session.server) {
                let _ = entry.delete_credential();
            }
        }
        notify_state(app);
    }
    result
}

// MARK: Commands

#[tauri::command]
fn get_state(app: AppHandle, state: State<'_, AppState>) -> Result<StateView, String> {
    // An expired token counts as signed out; forget it like a 401 would.
    let expired = state.session.lock().unwrap().as_ref().is_some_and(Session::expired);
    if expired {
        let _ = on_result(&app, Err::<(), String>(UNAUTHORIZED.into()));
    }
    let effective = state.effective();
    let session = state.session.lock().unwrap().clone();
    Ok(StateView {
        server_url: effective.server_url,
        server_managed: state.managed.server_url.is_some(),
        hotkey: effective.hotkey,
        hotkey_managed: state.managed.hotkey.is_some(),
        default_model: effective.default_model,
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        signed_in: session.is_some(),
        username: session.and_then(|s| s.username),
        login_pending: state.login_task.lock().unwrap().as_ref().is_some_and(|t| !t.inner().is_finished()),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    server_url: String,
    hotkey: String,
    default_model: String,
) -> Result<(), String> {
    let server_url = settings::normalize_server_url(&server_url);
    if !server_url.is_empty() && !settings::is_secure_server_url(&server_url) {
        return Err("Die Adresse muss mit https:// beginnen (http:// nur für localhost).".into());
    }
    let old = state.effective();
    {
        let mut current = state.settings.lock().unwrap();
        current.server_url = server_url;
        current.hotkey = hotkey;
        current.default_model = default_model;
        current.save(&state.settings_path)?;
    }
    let new = state.effective();
    if new.server_url != old.server_url {
        *state.session.lock().unwrap() = load_session(&new.server_url);
    }
    if new.hotkey != old.hotkey {
        register_hotkey(&app, &new.hotkey)?;
    }
    notify_state(&app);
    Ok(())
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    result.map_err(|e| e.to_string())?;
    notify_state(&app);
    Ok(())
}

#[tauri::command]
async fn test_connection(server_url: String) -> Result<(), String> {
    let server_url = settings::normalize_server_url(&server_url);
    if !settings::is_secure_server_url(&server_url) {
        return Err("Die Adresse muss mit https:// beginnen (http:// nur für localhost).".into());
    }
    let response = reqwest::Client::new()
        .get(format!("{server_url}/healthz"))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| api::describe(&e))?;
    if !response.status().is_success() {
        return Err(format!("Der Server antwortet mit HTTP {}.", response.status().as_u16()));
    }
    // The desktop app needs SSO: say so right here instead of at the first sign-in.
    auth::login_config(&server_url).await.map(|_| ())
}

#[tauri::command]
fn sign_in(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let server = state.effective().server_url;
    if server.is_empty() {
        return Err("Bitte zuerst die Adresse der OpenVizPilot-Middleware eintragen.".into());
    }
    if let Some(previous) = state.login_task.lock().unwrap().take() {
        previous.abort();
    }
    let handle = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let result = run_sign_in(&handle, &server).await;
        let _ = handle.emit("login-result", result.err());
        notify_state(&handle);
    });
    *state.login_task.lock().unwrap() = Some(task);
    notify_state(&app);
    Ok(())
}

async fn run_sign_in(app: &AppHandle, server: &str) -> Result<(), String> {
    let config = auth::login_config(server).await?;
    let pkce = auth::pkce();
    let (listener, port) = auth::listen().await?;
    let state = auth::desktop_state(port);
    let url = auth::authorization_url(&config, &state, &pkce.challenge)?;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())?;
    let code = auth::wait_for_code(listener, &state).await?;

    // The middleware (BFF) exchanges the code -- the client secret never reaches the app.
    let response = reqwest::Client::new()
        .post(format!("{server}/api/auth/exchange"))
        .json(&json!({ "code": code, "codeVerifier": pkce.verifier, "redirectUri": config.redirect_uri }))
        .send()
        .await
        .map_err(|e| api::describe(&e))?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let detail = body.get("error").and_then(Value::as_str).unwrap_or("Die Anmeldung wurde abgelehnt.");
        return Err(detail.to_string());
    }
    let token = body.get("token").and_then(Value::as_str).ok_or("Ungültige Antwort der Middleware")?;
    let session = Session {
        server: server.to_string(),
        token: token.to_string(),
        expires_at: body.get("expiresAt").and_then(Value::as_i64),
        username: body
            .get("user")
            .and_then(|u| u.get("name").or_else(|| u.get("email")))
            .and_then(Value::as_str)
            .map(str::to_string),
    };
    store_session(&session);
    *app.state::<AppState>().session.lock().unwrap() = Some(session);
    if !panel(app).is_some_and(|p| p.is_visible().unwrap_or(false)) {
        show_quick(app);
    }
    Ok(())
}

#[tauri::command]
fn cancel_sign_in(app: AppHandle, state: State<'_, AppState>) {
    if let Some(task) = state.login_task.lock().unwrap().take() {
        task.abort();
    }
    notify_state(&app);
}

#[tauri::command]
async fn sign_out(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let session = state.session.lock().unwrap().take();
    if let Some(session) = session {
        Middleware::new(&session.server, &session.token).logout().await;
        if let Some(entry) = keyring_entry(&session.server) {
            let _ = entry.delete_credential();
        }
    }
    notify_state(&app);
    Ok(())
}

/// `GET /api/desktop/session`: identity, grants, agent availability, consent.
/// Also fills in the user name shown in the settings window.
#[tauri::command]
async fn get_session(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let middleware = on_result(&app, state.middleware())?;
    let session = on_result(&app, middleware.session().await)?;
    let name = session
        .get("user")
        .and_then(|u| u.get("name").or_else(|| u.get("email")))
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(current) = state.session.lock().unwrap().as_mut() {
        if name.is_some() {
            current.username = name;
        }
    }
    Ok(session)
}

#[tauri::command]
async fn list_models(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let middleware = on_result(&app, state.middleware())?;
    on_result(&app, middleware.models().await)
}

/// The person accepted the consent card (`views` or `datasource`, the latter covers both).
#[tauri::command]
async fn accept_consent(app: AppHandle, state: State<'_, AppState>, scope: String) -> Result<(), String> {
    let middleware = on_result(&app, state.middleware())?;
    on_result(&app, middleware.consent(&scope).await)
}

#[tauri::command]
async fn ask(
    app: AppHandle,
    state: State<'_, AppState>,
    messages: Vec<Value>,
    mode: String,
    model: Option<String>,
    retry: Option<bool>,
    on_event: Channel<Value>,
) -> Result<(), String> {
    let middleware = on_result(&app, state.middleware())?;
    let mut body = json!({ "messages": messages, "mode": mode });
    if retry == Some(true) {
        body["retry"] = json!(true);
    }
    if let Some(model) = model.filter(|m| !m.is_empty()) {
        body["model"] = json!(model);
    }
    let task = tauri::async_runtime::spawn(async move { middleware.chat_stream(&body, &on_event).await });
    if let Some(previous) = state.chat_abort.lock().unwrap().replace(task.inner().abort_handle()) {
        previous.abort();
    }
    match task.await {
        Ok(result) => on_result(&app, result),
        Err(_) => Ok(()), // stopped by `stop_answer` or replaced by a newer question
    }
}

#[tauri::command]
fn stop_answer(state: State<'_, AppState>) {
    if let Some(task) = state.chat_abort.lock().unwrap().take() {
        task.abort();
    }
}

#[tauri::command]
fn get_update_state(state: State<'_, AppState>) -> UpdateView {
    state.updates.view(state.updates_enabled())
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) {
    run_update_check(&app).await;
}

#[tauri::command]
async fn install_update(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    emit_to_visible(&app, "update-changed");
    let result = state.updates.install(&app).await;
    emit_to_visible(&app, "update-changed");
    result
}

async fn run_update_check(app: &AppHandle) {
    let state = app.state::<AppState>();
    if !state.updates_enabled() {
        return;
    }
    let notify = |app: &AppHandle| emit_to_visible(app, "update-changed");
    let feed = state.managed.update_url.clone();
    let task = state.updates.check(app, feed.as_deref());
    notify(app);
    if task.await {
        refresh_update_menu(app);
        notify(app);
    }
}

/// The tray entry offers the install once a newer version is known.
fn refresh_update_menu(app: &AppHandle) {
    let state = app.state::<AppState>();
    let text = match state.updates.available_version() {
        Some(version) => format!("Update auf {version} installieren …"),
        None => "Nach Updates suchen …".to_string(),
    };
    let item = state.update_menu_item.lock().unwrap().clone();
    if let Some(item) = item {
        let _ = item.set_text(text);
    }
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Nur http(s)-Links".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_settings(app: AppHandle) -> Result<(), String> {
    show_settings(&app).map_err(|e| e.to_string())
}

/// Hides whichever window called it (app window or quick overlay).
#[tauri::command]
fn hide_panel(window: WebviewWindow) {
    let _ = window.hide();
}

/// The quick overlay grows with its content; its top edge stays put.
#[tauri::command]
fn fit_quick(app: AppHandle, height: f64) {
    if let Some(quick) = app.get_webview_window("quick") {
        let _ = quick.set_size(LogicalSize::new(QUICK_WIDTH, height.clamp(56.0, 640.0)));
        refresh_shadow(&quick);
    }
}

/// macOS derives a transparent window's shadow from its content once; after
/// the card changes size, the shadow has to be recomputed or it keeps the old
/// outline.
fn refresh_shadow(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let window = window.clone();
        let _ = window.clone().run_on_main_thread(move || {
            if let Ok(pointer) = window.ns_window() {
                // SAFETY: on the main thread; the pointer is the live NSWindow.
                let ns_window = unsafe { &*(pointer as *const objc2_app_kit::NSWindow) };
                ns_window.invalidateShadow();
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

// MARK: Windows, tray, hotkey
//
// Two faces: the quick overlay (a slim bar, opened by a click on the tray
// icon or the hotkey) and the app window `panel` with everything (opened
// when the app itself is launched or via "OpenVizPilot öffnen" in the tray menu).

fn panel(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("panel")
}

/// Shows the app window and brings the app to the front.
fn show_main(app: &AppHandle) {
    let Some(panel) = panel(app) else { return };
    if let Some(quick) = app.get_webview_window("quick") {
        let _ = quick.hide();
    }
    let _ = panel.unminimize();
    let _ = panel.show();
    update_dock(app);
    let _ = panel.set_focus();
    let _ = panel.emit_to("panel", "panel-shown", ());
}

/// macOS: a menu-bar app; it shows in the Dock and Cmd+Tab only while its
/// app window or the settings are open.
fn update_dock(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let visible = ["panel", "settings"]
            .iter()
            .filter_map(|label| app.get_webview_window(label))
            .any(|window| window.is_visible().unwrap_or(false));
        let policy = if visible { tauri::ActivationPolicy::Regular } else { tauri::ActivationPolicy::Accessory };
        let _ = app.set_activation_policy(policy);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Opens the quick overlay where the user last dragged it, else centred on
/// the screen with the mouse pointer, a little above the middle.
fn show_quick(app: &AppHandle) {
    let Some(quick) = app.get_webview_window("quick") else { return };
    place_quick(app, &quick);
    show_without_activating(&quick);
    refresh_shadow(&quick);
    let _ = quick.emit_to("quick", "panel-shown", ());
}

fn place_quick(app: &AppHandle, quick: &WebviewWindow) {
    let state = app.state::<AppState>();
    let saved = state.settings.lock().unwrap().quick_position;
    let position = saved
        .map(|[x, y]| PhysicalPosition::new(x, y))
        // A screen that is gone (laptop undocked) must not strand the bar off-screen.
        .filter(|p| grip_on_screen(quick, *p))
        .or_else(|| {
            let monitor = app
                .cursor_position()
                .ok()
                .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
                .or_else(|| quick.primary_monitor().ok().flatten())?;
            let (origin, size) = (monitor.position(), monitor.size());
            let width = (QUICK_WIDTH * monitor.scale_factor()) as i32;
            let x = origin.x + (size.width as i32 - width) / 2;
            let y = origin.y + (size.height as f64 * 0.22) as i32;
            Some(PhysicalPosition::new(x, y))
        });
    if let Some(position) = position {
        *state.quick_placed_at.lock().unwrap() = Some(position);
        let _ = quick.set_position(position);
    }
}

/// True if the overlay's top-left corner (its drag grip) lies on a screen.
fn grip_on_screen(quick: &WebviewWindow, p: PhysicalPosition<i32>) -> bool {
    let (x, y) = (p.x + 20, p.y + 20);
    quick.available_monitors().unwrap_or_default().iter().any(|m| {
        let (origin, size) = (m.position(), m.size());
        x >= origin.x && y >= origin.y && x < origin.x + size.width as i32 && y < origin.y + size.height as i32
    })
}

/// The user dragged the overlay: remember the spot (written to disk when the
/// overlay hides, not on every step of the drag).
fn quick_moved(app: &AppHandle, position: PhysicalPosition<i32>) {
    let state = app.state::<AppState>();
    let ours = state
        .quick_placed_at
        .lock()
        .unwrap()
        .is_some_and(|at| (at.x - position.x).abs() <= 2 && (at.y - position.y).abs() <= 2);
    if ours {
        return;
    }
    state.settings.lock().unwrap().quick_position = Some([position.x, position.y]);
    state.quick_moved.store(true, Ordering::Relaxed);
}

fn save_quick_position(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.quick_moved.swap(false, Ordering::Relaxed) {
        let settings = state.settings.lock().unwrap();
        if let Err(error) = settings.save(&state.settings_path) {
            eprintln!("quick position not saved: {error}");
        }
    }
}

/// Double-click on the grip: forget the dragged position, back to the centre.
#[tauri::command]
fn reset_quick_position(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.quick_moved.store(false, Ordering::Relaxed);
    {
        let mut settings = state.settings.lock().unwrap();
        settings.quick_position = None;
        settings.save(&state.settings_path)?;
    }
    if let Some(quick) = app.get_webview_window("quick") {
        place_quick(&app, &quick);
    }
    Ok(())
}

fn toggle_quick(app: &AppHandle) {
    let Some(quick) = app.get_webview_window("quick") else { return };
    // A click on the tray icon first blurs (and so hides) the open overlay;
    // that click must not re-open it right away.
    let just_hidden = app
        .state::<AppState>()
        .quick_hidden_at
        .lock()
        .unwrap()
        .is_some_and(|at| at.elapsed() < Duration::from_millis(300));
    if quick.is_visible().unwrap_or(false) {
        let _ = quick.hide();
    } else if !just_hidden {
        show_quick(app);
    }
}

/// macOS: show the window on every Space and above full-screen apps, like a
/// menu-bar popover or Spotlight. Only a non-activating panel can do that:
/// activating the app would switch to the Space of its own windows instead.
/// So the overlay's NSWindow becomes an NSPanel subclass that takes key focus
/// (typing) without activating the app.
#[cfg(target_os = "macos")]
fn float_over_full_screen(window: &WebviewWindow) {
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use objc2::{sel, ClassType};
    use objc2_app_kit::{NSPanel, NSStatusWindowLevel, NSWindowCollectionBehavior, NSWindowStyleMask};
    use std::sync::OnceLock;

    extern "C-unwind" fn yes(_: &AnyObject, _: Sel) -> Bool {
        Bool::YES
    }
    extern "C-unwind" fn no(_: &AnyObject, _: Sel) -> Bool {
        Bool::NO
    }
    static PANEL_CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    let class = PANEL_CLASS.get_or_init(|| {
        let mut builder = ClassBuilder::new(c"OpenVizPilotQuickPanel", NSPanel::class()).expect("OpenVizPilotQuickPanel registered twice");
        // Same layout as tao's TaoWindow (NSWindow + `focusable`), so the
        // class swap keeps the object's size and tao's ivar stays readable.
        builder.add_ivar::<Bool>(c"focusable");
        // SAFETY: the signatures match the overridden NSWindow getters.
        unsafe {
            builder.add_method(sel!(canBecomeKeyWindow), yes as extern "C-unwind" fn(_, _) -> _);
            builder.add_method(sel!(canBecomeMainWindow), no as extern "C-unwind" fn(_, _) -> _);
        }
        builder.register()
    });
    let Ok(pointer) = window.ns_window() else { return };
    // SAFETY: called on the main thread (setup); the pointer is the live
    // NSWindow behind this Tauri window. NSPanel adds no state the window
    // lacks, and the class carries tao's one ivar at the same offset.
    let ns_window = unsafe {
        AnyObject::set_class(&*(pointer as *const AnyObject), class);
        &*(pointer as *const NSPanel)
    };
    ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    ns_window.setFloatingPanel(true);
    ns_window.setHidesOnDeactivate(false);
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    ns_window.setLevel(NSStatusWindowLevel);
}

#[cfg(not(target_os = "macos"))]
fn float_over_full_screen(_window: &WebviewWindow) {}

/// Shows the overlay with keyboard focus. macOS: without activating the app
/// (`set_focus` would), so a full-screen app stays where it is.
fn show_without_activating(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let target = window.clone();
        let _ = window.run_on_main_thread(move || {
            if let Ok(pointer) = target.ns_window() {
                // SAFETY: on the main thread; the pointer is the live NSWindow.
                let ns_window = unsafe { &*(pointer as *const objc2_app_kit::NSWindow) };
                ns_window.makeKeyAndOrderFront(None);
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_settings(app: &AppHandle) -> tauri::Result<()> {
    if let Some(quick) = app.get_webview_window("quick") {
        let _ = quick.hide();
    }
    let window = match app.get_webview_window("settings") {
        Some(window) => window,
        None => WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
            .title("OpenVizPilot – Einstellungen")
            .inner_size(620.0, 620.0)
            .min_inner_size(520.0, 420.0)
            .center()
            .build()?,
    };
    window.show()?;
    update_dock(app);
    window.set_focus()
}

fn register_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(|e| e.to_string())?;
    if hotkey.trim().is_empty() {
        return Ok(());
    }
    shortcuts
        .register(hotkey)
        .map_err(|e| format!("Tastenkürzel „{hotkey}“ lässt sich nicht verwenden: {e}"))
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let version = MenuItem::with_id(app, "version", format!("OpenVizPilot {}", app.package_info().version), false, None::<&str>)?;
    let update_item = MenuItem::with_id(app, "update", "Nach Updates suchen …", state.updates_enabled(), None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "ask", "OpenVizPilot fragen …", true, None::<&str>)?,
            &MenuItem::with_id(app, "open", "OpenVizPilot öffnen", true, None::<&str>)?,
            &MenuItem::with_id(app, "settings", "Einstellungen …", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &version,
            &update_item,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "OpenVizPilot beenden", true, None::<&str>)?,
        ],
    )?;
    *state.update_menu_item.lock().unwrap() = Some(update_item);
    // macOS: a monochrome template glyph, 36 px = the menu bar's 18 pt @2x,
    // tinted by the system. Windows has no template icons; a black glyph would
    // vanish on a dark taskbar, so it gets the coloured app icon.
    #[cfg(target_os = "macos")]
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    #[cfg(not(target_os = "macos"))]
    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    TrayIconBuilder::with_id("openvizpilot")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("OpenVizPilot")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "ask" => show_quick(app),
            "open" => show_main(app),
            "settings" => {
                let _ = show_settings(app);
            }
            "update" => {
                // With a known update: install it. Otherwise check, and show
                // the result in the settings window's "About" section.
                let app = app.clone();
                if app.state::<AppState>().updates.available_version().is_some() {
                    tauri::async_runtime::spawn(async move {
                        emit_to_visible(&app, "update-changed");
                        let _ = app.state::<AppState>().updates.install(&app).await;
                        emit_to_visible(&app, "update-changed");
                    });
                } else {
                    let _ = show_settings(&app);
                    tauri::async_runtime::spawn(async move { run_update_check(&app).await });
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_quick(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // Launching the app again (Start menu, Finder) opens the app window of
        // the running instance instead of a second tray icon.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![AUTOSTART_ARG])))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_quick(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let settings_path = app.path().app_config_dir()?.join("settings.json");
            let settings = Settings::load(&settings_path);
            let managed = Managed::load();
            let effective = settings.effective(&managed);
            app.manage(AppState {
                settings_path,
                settings: Mutex::new(settings),
                managed,
                session: Mutex::new(load_session(&effective.server_url)),
                login_task: Mutex::new(None),
                chat_abort: Mutex::new(None),
                quick_hidden_at: Mutex::new(None),
                quick_placed_at: Mutex::new(None),
                quick_moved: AtomicBool::new(false),
                updates: Updates::default(),
                update_menu_item: Mutex::new(None),
            });

            let handle = app.handle().clone();
            if let Some(quick) = handle.get_webview_window("quick") {
                float_over_full_screen(&quick);
            }
            build_tray(&handle)?;
            if let Err(error) = register_hotkey(&handle, &effective.hotkey) {
                eprintln!("{error}");
            }
            if effective.server_url.is_empty() {
                show_settings(&handle)?;
            } else if !std::env::args().any(|arg| arg == AUTOSTART_ARG) {
                show_main(&handle);
            }
            let updater = handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(UPDATE_FIRST_CHECK).await;
                loop {
                    run_update_check(&updater).await;
                    tokio::time::sleep(UPDATE_INTERVAL).await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            ("quick", WindowEvent::Focused(false)) => {
                *window.app_handle().state::<AppState>().quick_hidden_at.lock().unwrap() = Some(Instant::now());
                let _ = window.hide();
                save_quick_position(window.app_handle());
            }
            ("quick", WindowEvent::Moved(position)) => quick_moved(window.app_handle(), *position),
            // Closing the app window keeps the app in the tray.
            ("quick" | "panel", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
                update_dock(window.app_handle());
            }
            ("settings", WindowEvent::Destroyed) => update_dock(window.app_handle()),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            save_settings,
            set_autostart,
            test_connection,
            sign_in,
            cancel_sign_in,
            sign_out,
            get_session,
            list_models,
            accept_consent,
            ask,
            stop_answer,
            open_url,
            open_settings,
            hide_panel,
            fit_quick,
            reset_quick_position,
            get_update_state,
            check_for_updates,
            install_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building OpenVizPilot")
        .run(|app, event| {
            // macOS: clicking the app in the Dock, Finder or Launchpad while it runs.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
