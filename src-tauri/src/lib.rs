use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

// ── Audio extensions ────────────────────────────────────────────────────────
const AUDIO_EXTENSIONS: &[&str] = &[
    ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma", ".opus", ".webm",
];

fn is_audio_ext(ext: &str) -> bool {
    AUDIO_EXTENSIONS.contains(&ext)
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        ".mp3" => "audio/mpeg",
        ".wav" => "audio/wav",
        ".ogg" => "audio/ogg",
        ".flac" => "audio/flac",
        ".aac" => "audio/aac",
        ".m4a" => "audio/mp4",
        ".wma" => "audio/x-ms-wma",
        ".opus" => "audio/opus",
        ".webm" => "audio/webm",
        _ => "audio/mpeg",
    }
}

// ── Data types ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    #[serde(rename = "isAudio")]
    pub is_audio: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DirResult {
    pub path: String,
    pub entries: Vec<DirEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FileResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>, // base64 encoded
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SkinData {
    pub player: Option<String>,
    pub browser: Option<String>,
    pub playlist: Option<String>,
    pub visualizer: Option<String>,
    pub settings: Option<String>,
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
fn read_dir(path: Option<String>) -> DirResult {
    let resolved = match &path {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")),
    };

    let entries_result = fs::read_dir(&resolved);
    match entries_result {
        Ok(entries) => {
            let mut results: Vec<DirEntry> = Vec::new();

            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden files
                if name.starts_with('.') {
                    continue;
                }

                let full_path = entry.path();
                let is_dir = full_path.is_dir();
                let ext = full_path
                    .extension()
                    .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                    .unwrap_or_default();
                let is_audio = is_audio_ext(&ext);

                if is_dir || is_audio {
                    results.push(DirEntry {
                        name,
                        path: full_path.to_string_lossy().to_string(),
                        is_dir,
                        is_audio,
                    });
                }
            }

            // Sort: directories first, then audio, alphabetical within each
            results.sort_by(|a, b| {
                if a.is_dir && !b.is_dir {
                    std::cmp::Ordering::Less
                } else if !a.is_dir && b.is_dir {
                    std::cmp::Ordering::Greater
                } else {
                    a.name.to_lowercase().cmp(&b.name.to_lowercase())
                }
            });

            DirResult {
                path: resolved.to_string_lossy().to_string(),
                entries: results,
                error: None,
            }
        }
        Err(e) => DirResult {
            path: resolved.to_string_lossy().to_string(),
            entries: Vec::new(),
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
fn read_file(path: String) -> FileResult {
    let file_path = Path::new(&path);
    match fs::read(file_path) {
        Ok(buffer) => {
            let ext = file_path
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                .unwrap_or_default();
            let name = file_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            let encoded = base64::engine::general_purpose::STANDARD.encode(&buffer);
            let data_url = format!("data:{};base64,{}", mime_for_ext(&ext), encoded);

            FileResult {
                name: Some(name),
                mime_type: Some(mime_for_ext(&ext).to_string()),
                data: Some(data_url),
                error: None,
            }
        }
        Err(e) => FileResult {
            name: None,
            mime_type: None,
            data: None,
            error: Some(e.to_string()),
        },
    }
}

fn resolve_skins_dir(app: &AppHandle) -> PathBuf {
    // Try resource dir first (production builds)
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("skins");
        if p.exists() { return p; }
    }
    // Dev mode: skins/ is in project root, one level up from src-tauri
    let dev_path = PathBuf::from("../skins");
    if dev_path.exists() { return dev_path; }
    // Last resort
    PathBuf::from("skins")
}

#[tauri::command]
fn list_skins(app: AppHandle) -> Vec<String> {
    let skins_dir = resolve_skins_dir(&app);

    match fs::read_dir(&skins_dir) {
        Ok(entries) => entries
            .flatten()
            .filter(|e| {
                e.path().is_dir()
                    && e.file_name().to_string_lossy() != "templates"
            })
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect(),
        Err(_) => vec!["default".to_string()],
    }
}

#[tauri::command]
fn load_skin(app: AppHandle, name: String) -> SkinData {
    let skin_dir = resolve_skins_dir(&app).join(&name);

    let load_png = |window_name: &str| -> Option<String> {
        let png_path = skin_dir.join(format!("{}.png", window_name));
        match fs::read(&png_path) {
            Ok(buf) => {
                let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
                Some(format!("data:image/png;base64,{}", encoded))
            }
            Err(_) => None,
        }
    };

    SkinData {
        player: load_png("player"),
        browser: load_png("browser"),
        playlist: load_png("playlist"),
        visualizer: load_png("visualizer"),
        settings: load_png("settings"),
    }
}

#[tauri::command]
fn toggle_window(app: AppHandle, name: String) {
    if let Some(win) = app.get_webview_window(&name) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
        }
        // Notify player of new visibility state
        let visible = win.is_visible().unwrap_or(false);
        let mut payload = serde_json::Map::new();
        payload.insert(name, serde_json::Value::Bool(visible));
        let _ = app.emit_to("player", "gel:windowVisibility", serde_json::Value::Object(payload));
    }
}

#[tauri::command]
fn close_window(app: AppHandle, label: String) {
    if label == "player" {
        // Closing the player quits the app
        app.exit(0);
        return;
    }

    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.hide();
        // Notify player of visibility change
        let mut payload = serde_json::Map::new();
        payload.insert(label, serde_json::Value::Bool(false));
        let _ = app.emit_to("player", "gel:windowVisibility", serde_json::Value::Object(payload));
    }
}

#[tauri::command]
fn force_clear_window(app: AppHandle, label: String) {
    if let Some(win) = app.get_webview_window(&label) {
        // We know from previous testing that the ONLY thing that reliably forces the
        // Linux compositor to drop its transparent buffer is a physical window resize.
        // To avoid the dimension-corruption bug from before (where dynamically querying 
        // the size yielded incorrect pixel ratios), we use the exact hardcoded dimensions.
        let (width, height) = match label.as_str() {
            "browser" => (400.0, 500.0),
            "player" => (380.0, 530.0),
            "playlist" => (350.0, 560.0),
            "settings" => (380.0, 530.0),
            "visualizer" => (440.0, 350.0),
            _ => return,
        };

        // 1. Nudge the window size slightly to break the compositor cache
        let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: width - 1.0,
            height: height,
        }));

        // 2. Snap it back immediately to the exact, correct dimensions
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width,
                height,
            }));
        });
    }
}

#[tauri::command]
fn open_external(url: String) {
    // Open URL in default browser using std::process::Command as fallback
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&url).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd").args(["/c", "start", &url]).spawn();
    }
}

#[tauri::command]
fn window_drag(app: AppHandle, label: String, dx: f64, dy: f64) {
    if let Some(win) = app.get_webview_window(&label) {
        if let Ok(pos) = win.outer_position() {
            let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: pos.x + dx as i32,
                y: pos.y + dy as i32,
            }));
        }
    }
}

#[tauri::command]
fn get_window_label(window: WebviewWindow) -> String {
    window.label().to_string()
}

// ── App builder ─────────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            read_dir,
            read_file,
            list_skins,
            load_skin,
            force_clear_window,
            toggle_window,
            close_window,
            open_external,
            window_drag,
            get_window_label,
        ])
        .setup(|app| {
            // Send initial visibility state to player once it's ready
            let app_handle = app.handle().clone();
            if let Some(player_win) = app_handle.get_webview_window("player") {
                let ah = app_handle.clone();
                player_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(true) = event {
                        // Send current visibility of all windows
                        let mut payload = serde_json::Map::new();
                        for label in &["browser", "playlist", "visualizer"] {
                            if let Some(w) = ah.get_webview_window(label) {
                                payload.insert(
                                    label.to_string(),
                                    serde_json::Value::Bool(w.is_visible().unwrap_or(true)),
                                );
                            }
                        }
                        let _ = ah.emit_to(
                            "player",
                            "gel:windowVisibility",
                            serde_json::Value::Object(payload),
                        );
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running myTunes");
}
