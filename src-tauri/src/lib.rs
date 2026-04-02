use base64::Engine;
use lofty::file::TaggedFileExt;
use lofty::picture::PictureType;
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

// ── Shared state for cover art path ──────────────────────────────────────────
struct CoverArtState(Mutex<Option<String>>);
struct MinimizedSet(Mutex<Vec<String>>);

// ── Audio extensions ────────────────────────────────────────────────────────
const AUDIO_EXTENSIONS: &[&str] = &[
    ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma", ".opus", ".webm",
];

// ── Cover art filenames (checked in order) ──────────────────────────────────
const COVER_ART_NAMES: &[&str] = &[
    "cover", "folder", "album", "front", "art", "artwork", "thumb",
];
const IMAGE_EXTENSIONS: &[&str] = &[".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".avif"];

fn is_audio_ext(ext: &str) -> bool {
    AUDIO_EXTENSIONS.contains(&ext)
}

fn image_mime_for_ext(ext: &str) -> &'static str {
    match ext {
        ".jpg" | ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        ".gif" => "image/gif",
        ".tif" | ".tiff" => "image/tiff",
        ".avif" => "image/avif",
        _ => "image/jpeg",
    }
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
    #[serde(rename = "coverTopLeft")]
    pub cover_top_left: Option<String>,
    #[serde(rename = "coverTopRight")]
    pub cover_top_right: Option<String>,
    #[serde(rename = "coverBottomLeft")]
    pub cover_bottom_left: Option<String>,
    #[serde(rename = "coverBottomRight")]
    pub cover_bottom_right: Option<String>,
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
fn read_dir(path: Option<String>) -> DirResult {
    let resolved = match &path {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")),
    };

    // Windows: if path is empty or "drives", list all drive letters
    #[cfg(target_os = "windows")]
    if path.as_deref() == Some("drives") {
        let mut drives = Vec::new();
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            if Path::new(&drive).exists() {
                drives.push(DirEntry {
                    name: format!("{}: Drive", letter as char),
                    path: drive,
                    is_dir: true,
                    is_audio: false,
                });
            }
        }
        return DirResult {
            path: "drives".to_string(),
            entries: drives,
            error: None,
        };
    }

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

#[tauri::command]
fn get_cover_art(path: String) -> Option<String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return None;
    }
    // Look for common cover art filenames
    if let Ok(entries) = fs::read_dir(dir) {
        let files: Vec<_> = entries
            .flatten()
            .filter(|e| e.path().is_file())
            .collect();

        // Check known cover art names first (in priority order)
        for cover_name in COVER_ART_NAMES {
            for ext in IMAGE_EXTENSIONS {
                let target = format!("{}{}", cover_name, ext);
                if let Some(entry) = files.iter().find(|e| {
                    e.file_name().to_string_lossy().to_lowercase() == target
                }) {
                    if let Ok(buf) = fs::read(entry.path()) {
                        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
                        let mime = image_mime_for_ext(ext);
                        return Some(format!("data:{};base64,{}", mime, encoded));
                    }
                }
            }
        }

        // Fallback: any image file in the directory
        for entry in &files {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if IMAGE_EXTENSIONS.iter().any(|ext| name.ends_with(ext)) {
                if let Ok(buf) = fs::read(entry.path()) {
                    let ext = entry.path()
                        .extension()
                        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                        .unwrap_or_default();
                    let mime = image_mime_for_ext(&ext);
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
                    return Some(format!("data:{};base64,{}", mime, encoded));
                }
            }
        }

        // Fallback: extract embedded cover art from the first audio file
        for entry in &files {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            let ext = entry.path()
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                .unwrap_or_default();
            if !is_audio_ext(&ext) {
                continue;
            }
            if let Ok(tagged_file) = lofty::read_from_path(entry.path()) {
                // Check all tags for pictures (ID3, Vorbis, MP4, etc.)
                for tag in tagged_file.tags() {
                    let pictures = tag.pictures();
                    // Prefer front cover, but take any picture
                    let pic = pictures
                        .iter()
                        .find(|p| p.pic_type() == PictureType::CoverFront)
                        .or_else(|| pictures.first());
                    if let Some(picture) = pic {
                        let mime_str = match picture.mime_type() {
                            Some(mime) => mime.as_str(),
                            None => "image/jpeg",
                        };
                        let encoded = base64::engine::general_purpose::STANDARD.encode(picture.data());
                        return Some(format!("data:{};base64,{}", mime_str, encoded));
                    }
                }
            }
        }
    }
    None
}

fn resolve_skins_dir(app: &AppHandle) -> PathBuf {
    // Try resource dir first (production builds)
    if let Ok(res) = app.path().resource_dir() {
        // Tauri bundles "../skins/**/*" as "_up_/skins/"
        let p = res.join("_up_").join("skins");
        if p.exists() { return p; }
        // Fallback: directly under resource dir
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
        cover_top_left: load_png("cover-top-left"),
        cover_top_right: load_png("cover-top-right"),
        cover_bottom_left: load_png("cover-bottom-left"),
        cover_bottom_right: load_png("cover-bottom-right"),
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
fn minimize_all(app: AppHandle) {
    let mut visible = Vec::new();
    for label in &["player", "browser", "playlist", "visualizer", "settings", "coverviewer"] {
        if let Some(win) = app.get_webview_window(label) {
            if win.is_visible().unwrap_or(false) {
                visible.push(label.to_string());
                let _ = win.minimize();
            }
        }
    }
    if let Some(state) = app.try_state::<MinimizedSet>() {
        *state.0.lock().unwrap() = visible;
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

// force_clear_window removed — the resize hack caused ghosting rather than fixing it.
// Proper CSS compositor hints (backface-visibility, transform: translateZ(0)) replace it.

#[tauri::command]
fn show_cover_art(app: AppHandle, dir_path: String) {
    // Store the directory path so the coverviewer can pull it after loading
    if let Some(state) = app.try_state::<CoverArtState>() {
        *state.0.lock().unwrap() = Some(dir_path);
    }
    if let Some(win) = app.get_webview_window("coverviewer") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn get_pending_cover_path(app: AppHandle) -> Option<String> {
    app.try_state::<CoverArtState>()
        .and_then(|state| state.0.lock().unwrap().clone())
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
fn drag_all(app: AppHandle, dx: f64, dy: f64) {
    for label in &["player", "browser", "playlist", "visualizer", "settings", "coverviewer"] {
        if let Some(win) = app.get_webview_window(label) {
            if win.is_visible().unwrap_or(false) {
                if let Ok(pos) = win.outer_position() {
                    let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                        x: pos.x + dx as i32,
                        y: pos.y + dy as i32,
                    }));
                }
            }
        }
    }
}

#[tauri::command]
fn get_window_label(window: WebviewWindow) -> String {
    window.label().to_string()
}

// ── App builder ─────────────────────────────────────────────────────────────

pub fn run() {
    // Ensure WebKitGTK renders with RGBA support for transparent windows on Linux
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            read_dir,
            read_file,
            get_cover_art,
            list_skins,
            load_skin,
            toggle_window,
            minimize_all,
            close_window,
            show_cover_art,
            get_pending_cover_path,
            open_external,
            window_drag,
            drag_all,
            get_window_label,
        ])
        .manage(CoverArtState(Mutex::new(None)))
        .manage(MinimizedSet(Mutex::new(Vec::new())))
        .register_uri_scheme_protocol("audiofile", |_app, request| {
            // Custom protocol: audiofile://localhost/<encoded-path>
            // Serves audio files directly to <audio> elements, avoiding base64 IPC.
            let uri = request.uri().to_string();
            // WebKitGTK may omit "localhost" or vary the authority in custom schemes.
            let path_part = uri
                .strip_prefix("audiofile://localhost/")
                .or_else(|| uri.strip_prefix("audiofile://localhost"))
                .or_else(|| uri.strip_prefix("audiofile:///"))
                .or_else(|| uri.strip_prefix("audiofile://"))
                .unwrap_or("");
            let decoded = percent_decode_str(path_part)
                .decode_utf8_lossy()
                .to_string();
            // On Linux the path must be absolute
            let file_path_str = if decoded.starts_with('/') {
                decoded.clone()
            } else {
                format!("/{}", decoded)
            };
            let file_path = Path::new(&file_path_str);

            let ext = file_path
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                .unwrap_or_default();
            let mime = mime_for_ext(&ext);

            // Read file
            let data = match fs::read(file_path) {
                Ok(d) => d,
                Err(_) => {
                    return tauri::http::Response::builder()
                        .status(404)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(Vec::new())
                        .unwrap();
                }
            };

            let total_len = data.len();

            // Check for Range header (needed for <audio> seeking)
            let range_header = request
                .headers()
                .get("range")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");

            if range_header.starts_with("bytes=") {
                let range_spec = &range_header[6..];
                let parts: Vec<&str> = range_spec.split('-').collect();
                let start: usize = parts[0].parse().unwrap_or(0);
                let end: usize = if parts.len() > 1 && !parts[1].is_empty() {
                    parts[1].parse().unwrap_or(total_len - 1)
                } else {
                    total_len - 1
                };
                let end = end.min(total_len - 1);
                let slice = data[start..=end].to_vec();

                tauri::http::Response::builder()
                    .status(206)
                    .header("Content-Type", mime)
                    .header("Content-Length", slice.len().to_string())
                    .header(
                        "Content-Range",
                        format!("bytes {}-{}/{}", start, end, total_len),
                    )
                    .header("Accept-Ranges", "bytes")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(slice)
                    .unwrap()
            } else {
                tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    .header("Content-Length", total_len.to_string())
                    .header("Accept-Ranges", "bytes")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(data)
                    .unwrap()
            }
        })
        .setup(|app| {
            // Send initial visibility state to player once it's ready
            let app_handle = app.handle().clone();
            if let Some(player_win) = app_handle.get_webview_window("player") {
                let ah = app_handle.clone();
                let ah_minimize = app_handle.clone();
                let ah_restore = app_handle.clone();
                player_win.on_window_event(move |event| {
                    // When player is minimized (e.g. taskbar click), minimize all others
                    if let tauri::WindowEvent::Resized(_) = event {
                        if let Some(player) = ah_minimize.get_webview_window("player") {
                            if player.is_minimized().unwrap_or(false) {
                                if let Some(state) = ah_minimize.try_state::<MinimizedSet>() {
                                    let mut guard = state.0.lock().unwrap();
                                    if guard.is_empty() {
                                        let mut visible = vec!["player".to_string()];
                                        for label in &["browser", "playlist", "visualizer", "settings", "coverviewer"] {
                                            if let Some(w) = ah_minimize.get_webview_window(label) {
                                                if w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(true) {
                                                    visible.push(label.to_string());
                                                    let _ = w.minimize();
                                                }
                                            }
                                        }
                                        *guard = visible;
                                    }
                                }
                            }
                        }
                    }
                    if let tauri::WindowEvent::Focused(true) = event {
                        // Restore all windows that were visible before minimize
                        if let Some(state) = ah_restore.try_state::<MinimizedSet>() {
                            let labels: Vec<String> = {
                                let mut guard = state.0.lock().unwrap();
                                std::mem::take(&mut *guard)
                            };
                            for label in &labels {
                                if label == "player" { continue; }
                                if let Some(w) = ah_restore.get_webview_window(label) {
                                    let _ = w.unminimize();
                                }
                            }
                        }
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
