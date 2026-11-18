//! macOS: turns the quick overlay into a non-activating NSPanel, so it can
//! show above full-screen apps and take typing without activating the app
//! (activating would switch to the Space of the app's own windows).
//!
//! tao creates every window as its own NSWindow subclass `TaoWindow`, and
//! AppKit cannot turn an existing window into a panel. So the object's class
//! is swapped for an NSPanel subclass with the same memory layout. That is
//! only sound while tao's class looks exactly as audited (tao 0.37.1): only
//! NSWindow as superclass, one ivar `focusable` (tao reads and writes it by
//! name, e.g. in `set_focusable`), and no overrides beyond `TAO_METHODS`.
//!
//! By the time the app sets up, WebKit and AppKit already observe the window
//! by key-value observing, so its class is really `NSKVONotifying_TaoWindow`,
//! a runtime subclass that re-implements observed setters to post change
//! notifications. The swap drops those setter overrides (the observers stay
//! registered and still get notifications AppKit posts itself). Measured on
//! macOS 27: that subclass only overrides `setContentView:`, and the overlay's
//! content view is never replaced, so nothing is lost; any other override
//! (`KVO_METHODS`) means a key we have not checked, and the swap is skipped.
//! Observers registered before the swap can no longer be removed (Foundation
//! looks them up by the current class and throws). So the overlay must never
//! be closed or destroyed and its web view never leave the window: closing
//! only hides it, and quitting exits without tearing windows down.
//!
//! AppKit sets the window server's "prevents activation" flag only when an
//! NSPanel is created as non-activating; adding the style afterwards does
//! not. Without it, a click into the panel activates the app (macOS 27, cf.
//! tauri-nspanel PR #139), so `make_panel` sets it through the private
//! `_setPreventsActivation:` where AppKit has that method.
//!
//! `check_swap` verifies all of this against the live classes before the swap; on
//! any difference the overlay stays an ordinary window, which still works but
//! activates the app when shown. `tao_version_is_the_audited_one` (tests)
//! fails when tao changes, so the next tao update gets audited on purpose.

use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::{msg_send, sel, ClassType};
use objc2_app_kit::{NSPanel, NSWindow, NSWindowStyleMask};
use std::ffi::{c_void, CStr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

/// tao version whose `TaoWindow` (src/platform_impl/macos/window.rs) was checked.
#[cfg(test)]
const AUDITED_TAO_VERSION: &str = "0.37.1";
const TAO_WINDOW_CLASS: &CStr = c"TaoWindow";
const FOCUSABLE: &CStr = c"focusable";
/// tao's overrides on `TaoWindow`. The panel class answers the first two
/// itself; `sendEvent:` is dropped -- tao only uses it to start a drag on
/// windows movable by their background, and `make_panel` refuses those.
const TAO_METHODS: [&str; 3] = ["canBecomeMainWindow", "canBecomeKeyWindow", "sendEvent:"];
/// What the key-value-observing subclass may override: its own bookkeeping
/// and the setter of the one observed key whose notification is safe to lose.
const KVO_METHODS: [&str; 4] = ["class", "dealloc", "_isKVOA", "setContentView:"];

/// The overlay's class was swapped; only then can it take key focus without
/// activating the app.
static IS_PANEL: AtomicBool = AtomicBool::new(false);

extern "C-unwind" fn yes(_: &AnyObject, _: Sel) -> Bool {
    Bool::YES
}

extern "C-unwind" fn no(_: &AnyObject, _: Sel) -> Bool {
    Bool::NO
}

/// NSPanel subclass carrying tao's `focusable` ivar; it becomes the key
/// window (typing) but never the main window.
fn panel_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        let mut builder =
            ClassBuilder::new(c"OpenVizPilotQuickPanel", NSPanel::class()).expect("OpenVizPilotQuickPanel registered twice");
        builder.add_ivar::<Bool>(FOCUSABLE);
        // SAFETY: the signatures match the overridden NSWindow getters.
        unsafe {
            builder.add_method(sel!(canBecomeKeyWindow), yes as extern "C-unwind" fn(_, _) -> _);
            builder.add_method(sel!(canBecomeMainWindow), no as extern "C-unwind" fn(_, _) -> _);
        }
        builder.register()
    })
}

fn method_names(class: &AnyClass) -> Vec<String> {
    class.instance_methods().iter().map(|method| method.name().name().to_string_lossy().into_owned()).collect()
}

/// Whether an object of class `current` may be re-classed as `panel`:
/// `current` is `expected` or its key-value-observing subclass (see
/// `check_kvo`); `expected` derives directly from NSWindow, adds nothing but
/// `focusable` and the known overrides, and has the same size and ivar
/// offset as the panel class.
fn check_swap(current: &AnyClass, expected: &CStr, panel: &AnyClass) -> Result<(), String> {
    let current = if current.name() == expected { current } else { check_kvo(current, expected)? };
    if !current.superclass().is_some_and(|superclass| std::ptr::eq(superclass, NSWindow::class())) {
        return Err(format!("{expected:?} no longer derives directly from NSWindow"));
    }
    let ivars: Vec<&CStr> = current.instance_variables().iter().map(|ivar| ivar.name()).collect();
    if ivars != [FOCUSABLE] {
        return Err(format!("{expected:?} has the ivars {ivars:?}, expected only \"focusable\""));
    }
    if let Some(method) = method_names(current).into_iter().find(|method| !TAO_METHODS.contains(&method.as_str())) {
        return Err(format!("{expected:?} overrides {method}, which the panel would drop"));
    }
    match (current.instance_variable(FOCUSABLE), panel.instance_variable(FOCUSABLE)) {
        (Some(theirs), Some(ours)) if theirs.offset() == ours.offset() && theirs.type_encoding() == ours.type_encoding() => {}
        _ => return Err("the \"focusable\" ivar differs in offset or type".into()),
    }
    if current.instance_size() != panel.instance_size() {
        return Err(format!("instance size {} differs from the panel's {}", current.instance_size(), panel.instance_size()));
    }
    Ok(())
}

/// `current` is the key-value-observing subclass of `expected`: named by the
/// Foundation convention, directly below it, no state of its own, and no
/// overrides beyond `KVO_METHODS`. Returns `expected`'s class.
fn check_kvo<'a>(current: &'a AnyClass, expected: &CStr) -> Result<&'a AnyClass, String> {
    let refused = || format!("window class is {:?}, expected {expected:?}", current.name());
    let name = format!("NSKVONotifying_{}", expected.to_string_lossy());
    let tao = current.superclass().filter(|superclass| superclass.name() == expected).ok_or_else(refused)?;
    if current.name().to_bytes() != name.as_bytes() {
        return Err(refused());
    }
    if !current.instance_variables().is_empty() || current.instance_size() != tao.instance_size() {
        return Err(format!("{name} adds state of its own"));
    }
    if let Some(method) = method_names(current).into_iter().find(|method| !KVO_METHODS.contains(&method.as_str())) {
        return Err(format!("{name} overrides {method}: an observed key whose notifications the panel would drop"));
    }
    Ok(tao)
}

/// Makes the window a non-activating panel on every Space, above full-screen
/// apps. Returns why not if tao's window class is not as audited; the window
/// is then left untouched.
///
/// # Safety
/// On the main thread; `pointer` is the live NSWindow behind a tao window.
pub unsafe fn make_panel(pointer: *mut c_void) -> Result<(), String> {
    let object = &*(pointer as *const AnyObject);
    let panel = panel_class();
    if !std::ptr::eq(object.class(), panel) {
        check_swap(object.class(), TAO_WINDOW_CLASS, panel)?;
        if (*(pointer as *const NSWindow)).isMovableByWindowBackground() {
            return Err("the window is movable by its background, which needs tao's sendEvent:".into());
        }
        // SAFETY: check_swap proved both classes have the same size and the
        // only extra ivar at the same offset, and that no override of tao's or
        // of key-value observing other than the known ones is lost.
        AnyObject::set_class(object, panel);
    }
    let ns_window = &*(pointer as *const NSPanel);
    ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    if object.class().responds_to(sel!(_setPreventsActivation:)) {
        // SAFETY: AppKit's private setter takes one BOOL and returns nothing;
        // only called where the window implements it.
        let _: () = msg_send![ns_window, _setPreventsActivation: Bool::YES];
    }
    ns_window.setFloatingPanel(true);
    ns_window.setHidesOnDeactivate(false);
    IS_PANEL.store(true, Ordering::Relaxed);
    Ok(())
}

/// Whether `make_panel` succeeded for the overlay.
pub fn is_panel() -> bool {
    IS_PANEL.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::runtime::AnyObject;

    extern "C-unwind" fn send_event(_: &AnyObject, _: Sel, _: *mut AnyObject) {}

    /// A class shaped like tao's `TaoWindow`, with optional deviations.
    fn tao_like(name: &CStr, superclass: &AnyClass, deviate: impl FnOnce(&mut ClassBuilder)) -> &'static AnyClass {
        let mut builder = ClassBuilder::new(name, superclass).unwrap();
        // SAFETY: the signatures match the overridden NSWindow methods.
        unsafe {
            builder.add_method(sel!(canBecomeMainWindow), yes as extern "C-unwind" fn(_, _) -> _);
            builder.add_method(sel!(canBecomeKeyWindow), yes as extern "C-unwind" fn(_, _) -> _);
            builder.add_method(sel!(sendEvent:), send_event as extern "C-unwind" fn(_, _, _));
        }
        deviate(&mut builder);
        builder.register()
    }

    fn with_focusable(builder: &mut ClassBuilder) {
        builder.add_ivar::<Bool>(FOCUSABLE);
    }

    extern "C-unwind" fn nothing(_: &AnyObject, _: Sel) {}

    /// A class shaped like the key-value-observing subclass of `tao`.
    fn kvo_like(tao: &AnyClass, setter: Sel, deviate: impl FnOnce(&mut ClassBuilder)) -> &'static AnyClass {
        let name = std::ffi::CString::new(format!("NSKVONotifying_{}", tao.name().to_string_lossy())).unwrap();
        let mut builder = ClassBuilder::new(&name, tao).unwrap();
        // SAFETY: the signatures match -[NSObject class], -[NSObject dealloc],
        // the private -_isKVOA getter and a one-object setter.
        unsafe {
            builder.add_method(sel!(class), tao_class as extern "C-unwind" fn(_, _) -> _);
            builder.add_method(sel!(dealloc), nothing as extern "C-unwind" fn(_, _));
            builder.add_method(sel!(_isKVOA), yes as extern "C-unwind" fn(_, _) -> _);
            builder.add_method(setter, send_event as extern "C-unwind" fn(_, _, _));
        }
        deviate(&mut builder);
        builder.register()
    }

    extern "C-unwind" fn tao_class(_: &AnyObject, _: Sel) -> *const AnyClass {
        std::ptr::null()
    }

    #[test]
    fn accepts_the_key_value_observing_subclass_seen_at_runtime() {
        let tao = tao_like(c"TestTaoWindowObserved", NSWindow::class(), with_focusable);
        let kvo = kvo_like(tao, sel!(setContentView:), |_| {});
        assert_eq!(check_swap(kvo, c"TestTaoWindowObserved", panel_class()), Ok(()));
    }

    #[test]
    fn refuses_a_key_value_observing_subclass_with_another_observed_setter() {
        let tao = tao_like(c"TestTaoWindowObservedTitle", NSWindow::class(), with_focusable);
        let kvo = kvo_like(tao, sel!(setTitle:), |_| {});
        let error = check_swap(kvo, c"TestTaoWindowObservedTitle", panel_class()).unwrap_err();
        assert!(error.contains("setTitle:"), "{error}");
    }

    #[test]
    fn refuses_a_key_value_observing_subclass_with_state_of_its_own() {
        let tao = tao_like(c"TestTaoWindowObservedState", NSWindow::class(), with_focusable);
        let kvo = kvo_like(tao, sel!(setContentView:), |builder| {
            builder.add_ivar::<usize>(c"observed");
        });
        let error = check_swap(kvo, c"TestTaoWindowObservedState", panel_class()).unwrap_err();
        assert!(error.contains("adds state of its own"), "{error}");
    }

    #[test]
    fn refuses_a_subclass_that_is_not_key_value_observing() {
        let tao = tao_like(c"TestTaoWindowSubclassed", NSWindow::class(), with_focusable);
        let other = ClassBuilder::new(c"OtherTestTaoWindowSubclassed", tao).unwrap().register();
        assert!(check_swap(other, c"TestTaoWindowSubclassed", panel_class()).is_err());
    }

    #[test]
    fn refuses_a_key_value_observing_subclass_of_a_deviating_tao_class() {
        let tao = tao_like(c"TestTaoWindowObservedNoIvar", NSWindow::class(), |_| {});
        let kvo = kvo_like(tao, sel!(setContentView:), |_| {});
        assert!(check_swap(kvo, c"TestTaoWindowObservedNoIvar", panel_class()).is_err());
    }

    #[test]
    fn accepts_the_audited_tao_layout() {
        let class = tao_like(c"TestTaoWindowAudited", NSWindow::class(), with_focusable);
        assert_eq!(check_swap(class, c"TestTaoWindowAudited", panel_class()), Ok(()));
    }

    #[test]
    fn refuses_another_class_name() {
        let class = tao_like(c"TestTaoWindowRenamed", NSWindow::class(), with_focusable);
        assert!(check_swap(class, c"TaoWindow", panel_class()).is_err());
    }

    #[test]
    fn refuses_another_superclass() {
        let class = tao_like(c"TestTaoWindowPanelBased", NSPanel::class(), with_focusable);
        assert!(check_swap(class, c"TestTaoWindowPanelBased", panel_class()).is_err());
    }

    #[test]
    fn refuses_an_extra_ivar() {
        let class = tao_like(c"TestTaoWindowExtraIvar", NSWindow::class(), |builder| {
            builder.add_ivar::<Bool>(FOCUSABLE);
            builder.add_ivar::<usize>(c"progress");
        });
        assert!(check_swap(class, c"TestTaoWindowExtraIvar", panel_class()).is_err());
    }

    #[test]
    fn refuses_a_missing_ivar() {
        let class = tao_like(c"TestTaoWindowNoIvar", NSWindow::class(), |_| {});
        assert!(check_swap(class, c"TestTaoWindowNoIvar", panel_class()).is_err());
    }

    #[test]
    fn refuses_another_ivar_type() {
        let class = tao_like(c"TestTaoWindowIvarType", NSWindow::class(), |builder| {
            builder.add_ivar::<u8>(FOCUSABLE);
        });
        assert!(check_swap(class, c"TestTaoWindowIvarType", panel_class()).is_err());
    }

    #[test]
    fn refuses_an_unknown_override_the_swap_would_drop() {
        let class = tao_like(c"TestTaoWindowExtraMethod", NSWindow::class(), |builder| {
            builder.add_ivar::<Bool>(FOCUSABLE);
            // SAFETY: matches -[NSResponder keyDown:].
            unsafe { builder.add_method(sel!(keyDown:), send_event as extern "C-unwind" fn(_, _, _)) };
        });
        assert!(check_swap(class, c"TestTaoWindowExtraMethod", panel_class()).is_err());
    }

    /// Fails on a tao update: re-check `TaoWindow` in tao's
    /// src/platform_impl/macos/window.rs against the module comment, then
    /// raise `AUDITED_TAO_VERSION`.
    #[test]
    fn tao_version_is_the_audited_one() {
        let lock = include_str!("../Cargo.lock");
        let version = lock
            .split("[[package]]")
            .find(|package| package.contains("\nname = \"tao\"\n"))
            .and_then(|package| package.lines().find_map(|line| line.strip_prefix("version = \"")))
            .map(|version| version.trim_end_matches('"'));
        assert_eq!(version, Some(AUDITED_TAO_VERSION), "tao changed; audit TaoWindow before raising AUDITED_TAO_VERSION");
    }
}
