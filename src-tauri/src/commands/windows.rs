use std::sync::atomic::Ordering;

use tauri::{
    webview::Color, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_store::StoreExt;

use crate::state::AppState;
use crate::window_registry::{WindowMeta, WindowRole};

/// Every ToolBox window (bubble, quick-menu, notes bar, tool panels, note
/// editor) is created with `.transparent(true)` + this fully-transparent
/// native background, so the loading gap before any HTML/CSS has painted
/// never flashes an opaque native color. The CSS side (`.panel` and its
/// `html, body` fallback) immediately paints over it with the real themed
/// color — which supports per-field opacity, letting the desktop show
/// through translucent panels once the WebView2 control's own bounds are
/// transparent at the OS level.
const TRANSPARENT_BG: Color = Color(0, 0, 0, 0);

const BUBBLE_SIZE: f64 = 44.0;
// Must stay in sync with .quick-menu-item / .quick-menu-strip in App.css —
// the window is sized to exactly fit its icons (see
// `quick_menu_content_size`), not a fixed rectangle with spare room.
const QUICK_MENU_ICON_SIZE: f64 = 48.0;
const QUICK_MENU_ICON_GAP: f64 = 8.0;
const QUICK_MENU_PADDING: f64 = 8.0;

fn default_bubble_position(tool_id: &str) -> (f64, f64) {
    match tool_id {
        "launcher" => (60.0, 160.0),
        _ => (60.0, 260.0),
    }
}

fn tool_default_size(tool_id: &str) -> (f64, f64) {
    match tool_id {
        "calculator" => (340.0, 640.0),
        "settings" => (360.0, 460.0),
        "ocr" => (420.0, 620.0),
        "color-picker" => (340.0, 640.0),
        "converter" => (360.0, 420.0),
        "clipboard" => (360.0, 480.0),
        "devtools" => (420.0, 560.0),
        "compressor" => (420.0, 560.0),
        "translator" => (400.0, 480.0),
        "transcribe" => (420.0, 580.0),
        "reminders" => (360.0, 460.0),
        "file-search" => (460.0, 560.0),
        _ => (400.0, 520.0),
    }
}

fn tool_min_size(tool_id: &str) -> (f64, f64) {
    match tool_id {
        "calculator" => (280.0, 420.0),
        "settings" => (300.0, 320.0),
        "ocr" => (320.0, 420.0),
        "color-picker" => (300.0, 480.0),
        "converter" => (300.0, 340.0),
        "clipboard" => (300.0, 360.0),
        "devtools" => (340.0, 420.0),
        "compressor" => (340.0, 420.0),
        "translator" => (320.0, 380.0),
        "transcribe" => (340.0, 440.0),
        "reminders" => (300.0, 380.0),
        "file-search" => (360.0, 420.0),
        _ => (300.0, 320.0),
    }
}

fn get_stored_pos(app: &AppHandle, key: &str, default: (f64, f64)) -> (f64, f64) {
    let store = match app.store("store.json") {
        Ok(store) => store,
        Err(_) => return default,
    };
    match store.get(key) {
        Some(value) => {
            let arr = match value.as_array() {
                Some(arr) if arr.len() == 2 => arr,
                _ => return default,
            };
            let x = arr[0].as_f64().unwrap_or(default.0);
            let y = arr[1].as_f64().unwrap_or(default.1);
            (x, y)
        }
        None => default,
    }
}

/// Same store/key convention as `get_stored_pos` and the frontend's
/// `bubbleStore.setPosition`, but from the Rust side — used to persist a
/// window drag detected via a native `Moved` event instead of the frontend's
/// `onMoved` listener.
fn store_position(app: &AppHandle, key: &str, x: f64, y: f64) {
    if let Ok(store) = app.store("store.json") {
        store.set(key, serde_json::json!([x, y]));
        let _ = store.save();
    }
}

/// Settings are managed entirely from the frontend (direct `@tauri-apps/plugin-store`
/// access, same store.json) except for these few fields, which the Rust side
/// also needs at window-creation time (before the frontend has a chance to
/// apply them via CSS/JS).
fn get_settings_value(app: &AppHandle) -> Option<serde_json::Value> {
    let store = app.store("store.json").ok()?;
    store.get("settings")
}

fn get_bubble_size_pref(app: &AppHandle) -> f64 {
    get_settings_value(app)
        .and_then(|v| v.get("bubbleSize").cloned())
        .and_then(|v| v.as_f64())
        .unwrap_or(BUBBLE_SIZE)
}

/// The "Tam. da UI" setting (`theme.fontScale`) is applied as a CSS `zoom`
/// on `.panel` (see main.tsx's `--ui-zoom`), which scales every pixel
/// dimension of the rendered icons right along with it. Content-size
/// calculations that don't account for this end up sized for a 100% zoom
/// UI no matter what the user actually has it set to.
fn get_ui_zoom_pref(app: &AppHandle) -> f64 {
    get_settings_value(app)
        .and_then(|v| v.get("theme").cloned())
        .and_then(|v| v.get("fontScale").cloned())
        .and_then(|v| v.as_f64())
        .filter(|z| *z > 0.0)
        .unwrap_or(1.0)
}

/// Counts how many icons the quick-menu bar will actually render: enabled
/// quick-menu items plus the always-present settings gear — mirrors
/// QuickMenu.tsx's own item filtering so the window is sized to fit
/// exactly what gets drawn.
fn quick_menu_item_count(app: &AppHandle) -> usize {
    let enabled_items = get_settings_value(app)
        .and_then(|v| v.get("quickMenuItems").cloned())
        .and_then(|v| v.as_array().cloned())
        .map(|items| {
            items
                .iter()
                .filter(|i| i.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true))
                .count()
        })
        .unwrap_or(0);
    enabled_items + 1
}

/// The bar's exact content size — no rectangle beyond what the icons
/// themselves need, generated fresh from however many are enabled right
/// now (adding/removing quick-menu items in Settings resizes it next open)
/// and scaled for the user's "Tam. da UI" setting (see `get_ui_zoom_pref`)
/// so the window always matches how big the icons actually render instead
/// of assuming 100% zoom — a mismatch here is what forced a scrollbar to
/// appear in the icon strip.
fn quick_menu_content_size(app: &AppHandle) -> (f64, f64) {
    let count = quick_menu_item_count(app).max(1) as f64;
    let zoom = get_ui_zoom_pref(app);
    let width = (count * QUICK_MENU_ICON_SIZE
        + (count - 1.0).max(0.0) * QUICK_MENU_ICON_GAP
        + QUICK_MENU_PADDING * 2.0)
        * zoom;
    let height = (QUICK_MENU_ICON_SIZE + QUICK_MENU_PADDING * 2.0) * zoom;
    (width, height)
}

fn create_bubble_window(
    app: &AppHandle,
    label: &str,
    tool_id: &str,
) -> tauri::Result<tauri::WebviewWindow> {
    let default_pos = default_bubble_position(tool_id);
    let (x, y) = get_stored_pos(app, &format!("bubble.{tool_id}.pos"), default_pos);
    // Only the launcher bubble is user-resizable — see Bubble.tsx. Reading the
    // persisted size here avoids a visible resize jump right after creation
    // (the frontend would otherwise resize it post-mount to match settings).
    let size = if tool_id == "launcher" {
        get_bubble_size_pref(app)
    } else {
        BUBBLE_SIZE
    };

    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("ToolBox")
        .inner_size(size, size)
        // REVERTED to resizable(true) 2026-09-22: tried resizable(false)
        // (to remove the invisible edge resize-hit-zone Windows keeps even
        // with decorations(false)) but it broke WebView2's initial
        // controller/navigation setup for this window specifically — the
        // launcher bubble, created at app startup, got stuck showing a
        // native loading spinner and never rendered at all. Confirmed live
        // by the user; reverting takes priority over the cosmetic
        // resize-cursor issue, since a stuck launcher makes the whole app
        // unusable. Kept resizable (with tight min/max bounds) rather than
        // fixed: a `resizable(false)` window's programmatic setSize() call
        // — used to live-apply the "bolinha" size slider — also went
        // through a resize path that clipped the WebView2 content at the
        // window's original creation size once grown near the top of the
        // slider's range; `resizable(true)` uses the same resize/repaint
        // path already proven fine for the calculator/notes/note windows.
        .resizable(true)
        .min_inner_size(30.0, 30.0)
        .max_inner_size(120.0, 120.0)
        .position(x, y)
        .decorations(false)
        // Windows treats any resizable window as eligible for Snap Assist,
        // so dragging the ball near a screen edge would trigger it to snap
        // into a half/quarter-screen layout instead of just being dropped
        // wherever it was released. Snap eligibility is tied to the
        // maximize-box window style, so disabling it here (there's no
        // visible maximize button anyway, given decorations(false)) opts
        // the bubble out while keeping it otherwise freely resizable.
        .maximizable(false)
        .transparent(true)
        .background_color(TRANSPARENT_BG)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
}

/// Resizes the launcher bubble window in response to the "Aparência da
/// bolinha" size slider. A plain `set_size()` call from the frontend left
/// WebView2's rendered surface clipped to the window's *previous* bounds on
/// Windows — the ball's CSS grows to the right size, but the surrounding
/// window (what actually gets painted) doesn't, so the ball shows cut off
/// top and bottom once it grows past the old size. Routing this through an
/// async command + `run_on_main_thread` (same pattern as window creation —
/// see the blank-window fix) and nudging to an intermediate size first
/// forces a real `WM_SIZE` round trip so WebView2 actually catches up.
#[tauri::command]
pub async fn set_bubble_size(app: AppHandle, size: f64) -> Result<(), String> {
    app.clone()
        .run_on_main_thread(move || {
            let Some(win) = app.get_webview_window("bubble-launcher") else {
                return;
            };
            let _ = win.set_size(tauri::LogicalSize::new(size + 1.0, size + 1.0));
            let _ = win.set_size(tauri::LogicalSize::new(size, size));
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_bubble(app: AppHandle, tool_id: String) -> Result<(), String> {
    let label = format!("bubble-{tool_id}");

    if let Some(win) = app.get_webview_window(&label) {
        // Re-syncs position before showing: the bubble stays alive (just
        // hidden) while the quick menu is open, and dragging the quick menu
        // around updates this same stored key (see QuickMenu.tsx), so the
        // bubble must snap to it here rather than reappearing wherever it
        // physically was left.
        let default_pos = default_bubble_position(&tool_id);
        let (x, y) = get_stored_pos(&app, &format!("bubble.{tool_id}.pos"), default_pos);
        win.set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        win.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Dispatched from an async command (which runs off the main thread), so this
    // genuinely hops back to the main thread instead of running inline. Building
    // the window synchronously inside the command handler's own callstack was
    // starving WebView2's controller-ready callback, which never got a chance to
    // fire the initial navigation — the window appeared but stayed on about:blank.
    app.clone().run_on_main_thread(move || {
        let win = match create_bubble_window(&app, &label, &tool_id) {
            Ok(win) => win,
            Err(e) => {
                eprintln!("failed to create bubble window '{label}': {e}");
                return;
            }
        };

        app.state::<AppState>().registry.register(
            &label,
            WindowMeta {
                role: WindowRole::Bubble,
                tool_id: tool_id.clone(),
            },
        );

        let app_handle = app.clone();
        let label_for_event = label.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::Destroyed = event {
                app_handle
                    .state::<AppState>()
                    .registry
                    .unregister(&label_for_event);
            }
        });
    })
    .map_err(|e| e.to_string())
}

/// Shows the launcher bubble (creating it if it was somehow destroyed) and
/// brings it to front. Used by the tray icon as a guaranteed way back into
/// the app if every window has been closed/minimized away.
pub fn show_launcher(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = open_bubble(app.clone(), "launcher".to_string()).await;
        if let Some(win) = app.get_webview_window("bubble-launcher") {
            win.set_focus().ok();
        }
    });
}

/// Quick menu: a row of icon buttons — no panel/rectangle behind them (see
/// App.css) — anchored next to the launcher bubble every time it opens, not
/// just on first open, so dragging the bubble around and then opening the
/// quick menu always finds it right there. Opening it hides the launcher
/// bubble; clicking outside the bar brings the bubble back (see
/// `collapse_quick_menu`, wired to the window's Focused(false) event).
/// Always picks whichever side (left/right) has more room automatically,
/// and is always clamped to the launcher's monitor so it can never open
/// partly (or fully) off-screen — using the bar's exact dynamic content
/// size (`quick_menu_content_size`, not a fixed rectangle) is what makes
/// both of those stay correct regardless of how many icons are enabled.
/// Returns `(x, y, place_right)` — the frontend uses `place_right` (via the
/// `quick-menu-opened` event) to animate icons popping in starting from
/// whichever edge is nearest the bubble.
fn quick_menu_position(app: &AppHandle) -> (f64, f64, bool) {
    let default_pos = default_bubble_position("launcher");
    let fallback = (default_pos.0 + BUBBLE_SIZE + 8.0, default_pos.1, true);

    let Some(bubble) = app.get_webview_window("bubble-launcher") else {
        return fallback;
    };
    let Ok(scale) = bubble.scale_factor() else {
        return fallback;
    };
    let Ok(pos) = bubble.outer_position() else {
        return fallback;
    };
    let bubble_x = pos.x as f64 / scale;
    let bubble_y = pos.y as f64 / scale;
    let bubble_size = bubble
        .outer_size()
        .map(|s| s.width as f64 / scale)
        .unwrap_or(BUBBLE_SIZE);

    let (menu_w, menu_h) = quick_menu_content_size(app);

    let (mon_x, mon_y, mon_w, mon_h) = bubble
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let p = *m.position();
            let s = *m.size();
            (
                p.x as f64 / scale,
                p.y as f64 / scale,
                s.width as f64 / scale,
                s.height as f64 / scale,
            )
        })
        .unwrap_or((0.0, 0.0, 1920.0, 1080.0));

    let fits_right = bubble_x + bubble_size + 8.0 + menu_w <= mon_x + mon_w;
    let fits_left = bubble_x - 8.0 - menu_w >= mon_x;
    let place_right = fits_right || !fits_left;

    let x = if place_right {
        bubble_x + bubble_size + 8.0
    } else {
        bubble_x - 8.0 - menu_w
    };
    let x = x.max(mon_x).min((mon_x + mon_w - menu_w).max(mon_x));
    let y = bubble_y.max(mon_y).min((mon_y + mon_h - menu_h).max(mon_y));

    (x, y, place_right)
}

/// Records the launcher bubble's position at the moment the quick-menu bar
/// gets (re)anchored next to it (every `open_quick_menu` call) — see
/// `AppState.quick_menu_anchor` for why `on_quick_menu_moved` needs this.
fn record_quick_menu_anchor(app: &AppHandle, bar_x: f64, bar_y: f64) {
    let Some(bubble) = app.get_webview_window("bubble-launcher") else {
        return;
    };
    let Ok(scale) = bubble.scale_factor() else {
        return;
    };
    let Ok(pos) = bubble.outer_position() else {
        return;
    };
    let bubble_x = pos.x as f64 / scale;
    let bubble_y = pos.y as f64 / scale;
    *app.state::<AppState>().quick_menu_anchor.lock().unwrap() =
        Some((bar_x, bar_y, bubble_x, bubble_y));
}

/// Hides the quick-menu bar and brings the launcher bubble back — the only
/// way back to the bubble once the bar is open, per its minimize/close
/// buttons.
///
/// The hide itself is deferred a few frames: a hidden WebView2 keeps its
/// last painted frame and flashes it on the next `show()`, before the
/// `quick-menu-opened` event can restart the pop-in animation. So the
/// frontend is told to blank the icon row first (`quick-menu-closing`), and
/// the window only hides once that empty frame has been painted — the next
/// open then starts from nothing instead of "all icons, blink, animate".
#[tauri::command]
pub fn collapse_quick_menu(app: AppHandle) -> Result<(), String> {
    let generation = app
        .state::<AppState>()
        .quick_menu_visibility_gen
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let _ = app.emit_to("quick-menu", "quick-menu-closing", ());
    show_launcher(&app);

    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(QUICK_MENU_HIDE_DELAY_MS));
        let app_for_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            // Reopened in the meantime — don't hide the fresh bar.
            let state = app_for_main.state::<AppState>();
            if state.quick_menu_visibility_gen.load(Ordering::SeqCst) != generation {
                return;
            }
            if let Some(win) = app_for_main.get_webview_window("quick-menu") {
                let _ = win.hide();
            }
        });
    });
    Ok(())
}

/// Long enough for the `quick-menu-closing` event to reach the webview and
/// a couple of frames to paint the emptied row. The bar is fully
/// transparent once its icons are gone, so this lag is invisible.
const QUICK_MENU_HIDE_DELAY_MS: u64 = 80;

#[tauri::command]
pub async fn open_quick_menu(app: AppHandle) -> Result<(), String> {
    if let Some(bubble) = app.get_webview_window("bubble-launcher") {
        bubble.hide().map_err(|e| e.to_string())?;
    }

    if let Some(win) = app.get_webview_window("quick-menu") {
        // Cancels a pending deferred hide from collapse_quick_menu.
        app.state::<AppState>()
            .quick_menu_visibility_gen
            .fetch_add(1, Ordering::SeqCst);
        let (x, y, place_right) = quick_menu_position(&app);
        let (w, h) = quick_menu_content_size(&app);
        record_quick_menu_anchor(&app, x, y);
        app.state::<AppState>()
            .quick_menu_self_move
            .store(true, Ordering::SeqCst);

        // Only actually resizes if the icon count changed since last open
        // (Settings item list) — skipping a same-size set_size() call
        // avoids the visible flicker a resize round trip causes even when
        // it's a no-op, which was happening on every single open before.
        let current_size = match (win.inner_size(), win.scale_factor()) {
            (Ok(size), Ok(scale)) => Some((size.width as f64 / scale, size.height as f64 / scale)),
            _ => None,
        };
        let needs_resize = match current_size {
            Some((cw, ch)) => (cw - w).abs() > 0.5 || (ch - h).abs() > 0.5,
            None => true,
        };
        if needs_resize {
            // Nudges to an intermediate size first — same reasoning as
            // `set_bubble_size`: a plain single set_size() on a
            // resizable(false) window can leave WebView2's rendered
            // surface clipped to its previous bounds without a real
            // two-step WM_SIZE round trip.
            let _ = win.set_size(tauri::LogicalSize::new(w + 1.0, h + 1.0));
            win.set_size(tauri::LogicalSize::new(w, h))
                .map_err(|e| e.to_string())?;
        }
        win.set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().ok();
        let _ = app.emit("quick-menu-opened", place_right);
        return Ok(());
    }

    let (x, y, place_right) = quick_menu_position(&app);
    let (w, h) = quick_menu_content_size(&app);
    record_quick_menu_anchor(&app, x, y);
    app.state::<AppState>()
        .quick_menu_self_move
        .store(true, Ordering::SeqCst);

    app.clone().run_on_main_thread(move || {
        let win = match WebviewWindowBuilder::new(&app, "quick-menu", WebviewUrl::App("index.html".into()))
            .title("ToolBox")
            .inner_size(w, h)
            .position(x, y)
            // Not user-resizable: the bar's size is always generated from
            // its icon count (see quick_menu_content_size), not something
            // to drag wider/taller.
            .resizable(false)
            // See create_bubble_window: opts this floating bar out of
            // Windows' Snap Assist so dragging it near a screen edge doesn't
            // snap it into a half/quarter-screen layout.
            .maximizable(false)
            .decorations(false)
            .transparent(true)
            .background_color(TRANSPARENT_BG)
            // false, not true: Windows draws a native drop-shadow *and* a
            // thin edge/border around undecorated windows when this is on,
            // which — now that the window is sized tightly around the
            // icons instead of a padded rectangle — showed up as a visible
            // square outline hugging the icon row. See create_bubble_window,
            // which already uses false for the same reason.
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .build()
        {
            Ok(win) => win,
            Err(e) => {
                eprintln!("failed to create quick-menu window: {e}");
                return;
            }
        };

        app.state::<AppState>().registry.register(
            "quick-menu",
            WindowMeta {
                role: WindowRole::Bubble,
                tool_id: "quick-menu".into(),
            },
        );

        let app_handle = app.clone();
        win.on_window_event(move |event| match event {
            WindowEvent::Destroyed => {
                app_handle
                    .state::<AppState>()
                    .registry
                    .unregister("quick-menu");
            }
            WindowEvent::Moved(position) => {
                on_quick_menu_moved(&app_handle, *position);
            }
            // Clicking anywhere outside the bar (another window, the
            // desktop, or opening a tool from it) takes native OS focus
            // away from it — treated the same as pressing its old
            // minimize button: hide the bar, bring the bubble back.
            WindowEvent::Focused(false) => {
                let _ = collapse_quick_menu(app_handle.clone());
            }
            _ => {}
        });

        let _ = app.emit("quick-menu-opened", place_right);
    })
    .map_err(|e| e.to_string())
}

/// Handles the quick-menu window's native `Moved` event: skips it if it was
/// `open_quick_menu` itself re-anchoring the window next to the bubble (see
/// `quick_menu_self_move`). Otherwise treats it as the user dragging the bar
/// and — after a debounce, so a whole drag's stream of Moved events doesn't
/// hit disk on every pixel — (1) snaps the bar itself back on-screen if the
/// drag left it partly or fully off its monitor, and (2) moves the launcher
/// bubble by the same delta the bar moved by since it was last anchored (see
/// `quick_menu_anchor`), clamped to the monitor too, instead of snapping the
/// bubble straight to the bar's own (offset) corner. (The bar isn't
/// user-resizable — see `open_quick_menu` — so unlike position, its size
/// never needs disambiguating from this event.)
fn on_quick_menu_moved(app: &AppHandle, position: tauri::PhysicalPosition<i32>) {
    let state = app.state::<AppState>();
    if state.quick_menu_self_move.swap(false, Ordering::SeqCst) {
        return;
    }

    let generation = state.quick_menu_move_gen.fetch_add(1, Ordering::SeqCst) + 1;

    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        let app_for_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            let state = app_for_main.state::<AppState>();
            if state.quick_menu_move_gen.load(Ordering::SeqCst) != generation {
                return;
            }
            let Some(win) = app_for_main.get_webview_window("quick-menu") else {
                return;
            };
            let Ok(scale) = win.scale_factor() else {
                return;
            };
            let bar_x = position.x as f64 / scale;
            let bar_y = position.y as f64 / scale;

            let (bar_w, bar_h) = win
                .outer_size()
                .map(|s| (s.width as f64 / scale, s.height as f64 / scale))
                .unwrap_or_else(|_| quick_menu_content_size(&app_for_main));
            let (mon_x, mon_y, mon_w, mon_h) = win
                .current_monitor()
                .ok()
                .flatten()
                .map(|m| {
                    let p = *m.position();
                    let s = *m.size();
                    (
                        p.x as f64 / scale,
                        p.y as f64 / scale,
                        s.width as f64 / scale,
                        s.height as f64 / scale,
                    )
                })
                .unwrap_or((0.0, 0.0, 1920.0, 1080.0));

            // Clamp the bar itself back on-screen if the drag left it
            // partly or fully off its monitor.
            let clamped_bar_x = bar_x.max(mon_x).min((mon_x + mon_w - bar_w).max(mon_x));
            let clamped_bar_y = bar_y.max(mon_y).min((mon_y + mon_h - bar_h).max(mon_y));
            if (clamped_bar_x, clamped_bar_y) != (bar_x, bar_y) {
                state.quick_menu_self_move.store(true, Ordering::SeqCst);
                let _ = win.set_position(tauri::LogicalPosition::new(clamped_bar_x, clamped_bar_y));
            }

            // Moves the bubble by the same delta the bar moved by since the
            // anchor was recorded, instead of snapping it to the bar's own
            // (offset) corner — a position the bubble was never actually at.
            let anchor = *state.quick_menu_anchor.lock().unwrap();
            let (bubble_x, bubble_y) = match anchor {
                Some((anchor_bar_x, anchor_bar_y, anchor_bubble_x, anchor_bubble_y)) => (
                    anchor_bubble_x + (clamped_bar_x - anchor_bar_x),
                    anchor_bubble_y + (clamped_bar_y - anchor_bar_y),
                ),
                None => (clamped_bar_x, clamped_bar_y),
            };
            let bubble_size = get_bubble_size_pref(&app_for_main);
            let clamped_bubble_x = bubble_x.max(mon_x).min((mon_x + mon_w - bubble_size).max(mon_x));
            let clamped_bubble_y = bubble_y.max(mon_y).min((mon_y + mon_h - bubble_size).max(mon_y));
            store_position(&app_for_main, "bubble.launcher.pos", clamped_bubble_x, clamped_bubble_y);
        });
    });
}

fn collapse_tool_internal(app: &AppHandle, tool_id: &str) -> Result<(), String> {
    let tool_label = format!("tool-{tool_id}");
    if let Some(win) = app.get_webview_window(&tool_label) {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn expand_tool(app: AppHandle, tool_id: String) -> Result<(), String> {
    let tool_label = format!("tool-{tool_id}");
    if let Some(win) = app.get_webview_window(&tool_label) {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().ok();
        return Ok(());
    }

    app.clone().run_on_main_thread(move || {
        let (w, h) = tool_default_size(&tool_id);
        let (min_w, min_h) = tool_min_size(&tool_id);
        let win = match WebviewWindowBuilder::new(&app, &tool_label, WebviewUrl::App("index.html".into()))
            .title("ToolBox")
            .inner_size(w, h)
            .min_inner_size(min_w, min_h)
            .resizable(true)
            .decorations(false)
            .transparent(true)
            .background_color(TRANSPARENT_BG)
            .shadow(true)
            // Like the bubble/quick-menu/notes bar: these are floating
            // accessory tools, not regular app windows, so they should stay
            // on top through alt-tab too instead of getting buried behind
            // whatever else the user switches to — closing/minimizing them
            // is the only intended way to put them away.
            .always_on_top(true)
            .skip_taskbar(true)
            // Required on Windows for the HTML5 drag-and-drop APIs (used by the
            // calculator's variable list and the settings quick-menu item list)
            // to fire at all — WebView2's native drag-drop handler otherwise
            // intercepts the events before the frontend ever sees them.
            .disable_drag_drop_handler()
            .build()
        {
            Ok(win) => win,
            Err(e) => {
                eprintln!("failed to create tool window '{tool_label}': {e}");
                return;
            }
        };

        app.state::<AppState>().registry.register(
            &tool_label,
            WindowMeta {
                role: WindowRole::ToolCalculator,
                tool_id: tool_id.clone(),
            },
        );

        let app_handle = app.clone();
        let label_for_event = tool_label.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::Destroyed = event {
                app_handle
                    .state::<AppState>()
                    .registry
                    .unregister(&label_for_event);
            }
        });
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn collapse_tool(app: AppHandle, tool_id: String) -> Result<(), String> {
    collapse_tool_internal(&app, &tool_id)
}

fn collapse_notes_bar_internal(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("notes-bar") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_notes_bar(app: AppHandle) -> Result<(), String> {
    let label = "notes-bar";
    if let Some(win) = app.get_webview_window(label) {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().ok();
        return Ok(());
    }

    let (x, y) = get_stored_pos(&app, "notes-bar.pos", (60.0, 260.0));
    app.clone().run_on_main_thread(move || {
        let win = match WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
            .title("ToolBox Notes")
            .inner_size(640.0, 96.0)
            .min_inner_size(280.0, 90.0)
            .position(x, y)
            // See create_bubble_window: opts this floating bar out of
            // Windows' Snap Assist so dragging it near a screen edge doesn't
            // snap it into a half/quarter-screen layout.
            .maximizable(false)
            .decorations(false)
            .transparent(true)
            .background_color(TRANSPARENT_BG)
            .shadow(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(true)
            .build()
        {
            Ok(win) => win,
            Err(e) => {
                eprintln!("failed to create notes-bar window: {e}");
                return;
            }
        };

        app.state::<AppState>().registry.register(
            label,
            WindowMeta {
                role: WindowRole::NotesBar,
                tool_id: "notes".into(),
            },
        );

        let app_handle = app.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::Destroyed = event {
                app_handle.state::<AppState>().registry.unregister(label);
            }
        });
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn collapse_notes_bar(app: AppHandle) -> Result<(), String> {
    collapse_notes_bar_internal(&app)
}

fn collapse_note_internal(app: &AppHandle, note_id: &str) -> Result<(), String> {
    let label = format!("note-{note_id}");
    if let Some(win) = app.get_webview_window(&label) {
        win.hide().map_err(|e| e.to_string())?;
    }

    if let Some(bar) = app.get_webview_window("notes-bar") {
        bar.show().map_err(|e| e.to_string())?;
        bar.set_focus().ok();
    } else {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = open_notes_bar(app).await;
        });
    }

    Ok(())
}

#[tauri::command]
pub fn collapse_note(app: AppHandle, note_id: String) -> Result<(), String> {
    collapse_note_internal(&app, &note_id)
}

#[tauri::command]
pub async fn open_note(app: AppHandle, note_id: String) -> Result<(), String> {
    // Notes bar stays open and multiple notes can be open at once — opening
    // one is independent of the bar's (or any other note's) visibility.
    let label = format!("note-{note_id}");
    if let Some(win) = app.get_webview_window(&label) {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().ok();
        return Ok(());
    }

    app.clone().run_on_main_thread(move || {
        let win = match WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
            .title("Nota")
            .inner_size(420.0, 560.0)
            .min_inner_size(280.0, 320.0)
            .resizable(true)
            .decorations(false)
            .transparent(true)
            .background_color(TRANSPARENT_BG)
            .shadow(true)
            // See expand_tool: stays on top through alt-tab like the rest of
            // the floating accessory windows.
            .always_on_top(true)
            .skip_taskbar(true)
            .build()
        {
            Ok(win) => win,
            Err(e) => {
                eprintln!("failed to create note window '{label}': {e}");
                return;
            }
        };

        app.state::<AppState>().registry.register(
            &label,
            WindowMeta {
                role: WindowRole::NoteEditor,
                tool_id: note_id.clone(),
            },
        );

        let app_handle = app.clone();
        let label_for_event = label.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = open_notes_bar(app_handle).await;
                });
            }
            if let WindowEvent::Destroyed = event {
                app_handle
                    .state::<AppState>()
                    .registry
                    .unregister(&label_for_event);
            }
        });
    })
    .map_err(|e| e.to_string())
}
