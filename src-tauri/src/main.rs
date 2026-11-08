#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::Manager;
fn library_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let path = fs::read_to_string(config.join("library-path.txt"))
        .map_err(|_| "Choose a library folder first".to_string())?;
    Ok(PathBuf::from(path))
}
#[tauri::command]
fn get_library(app: tauri::AppHandle) -> Result<String, String> {
    Ok(library_path(&app)?.to_string_lossy().to_string())
}
#[tauri::command]
fn set_library(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let root = Path::new(&path);
    let index = root.join("library.json");
    if index.exists() {
        let content = fs::read_to_string(&index).map_err(|e| e.to_string())?;
        let value: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("Library index is invalid: {e}"))?;
        if !value.is_array() {
            return Err("Library index must be an array".into());
        }
    }
    fs::create_dir_all(root.join("assets")).map_err(|e| e.to_string())?;
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&config).map_err(|e| e.to_string())?;
    fs::write(config.join("library-path.txt"), path).map_err(|e| e.to_string())
}
#[tauri::command]
fn load_library(app: tauri::AppHandle) -> Result<String, String> {
    let p = library_path(&app)?.join("library.json");
    if !p.exists() {
        return Ok("[]".into());
    }
    fs::read_to_string(p).map_err(|e| e.to_string())
}
#[tauri::command]
fn save_library(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    if !value.is_array() {
        return Err("Library index must be an array".into());
    }
    let root = library_path(&app)?;
    let tmp = root.join("library.tmp");
    let index = root.join("library.json");
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(data.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    if index.exists() {
        let backup_tmp = root.join("library.backup.tmp");
        fs::copy(&index, &backup_tmp).map_err(|e| e.to_string())?;
        fs::rename(backup_tmp, root.join("library.backup.json")).map_err(|e| e.to_string())?;
    }
    fs::rename(tmp, index).map_err(|e| e.to_string())
}
fn import_asset_impl(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let root = library_path(&app)?;
    let source = Path::new(&path);
    let ext = source
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let id = uuid::Uuid::new_v4().to_string();
    let is_image = ["png", "jpg", "jpeg", "webp", "bmp"].contains(&ext.as_str());
    let is_video = ["mp4", "mov", "webm", "mkv"].contains(&ext.as_str());
    let out_ext = if is_image {
        "webp"
    } else if is_video {
        "mp4"
    } else {
        ext.as_str()
    };
    let name = format!("{}.{}", id, out_ext);
    let dest = root.join("assets").join(&name);
    if is_image || is_video {
        let mut cmd = Command::new("ffmpeg");
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        cmd.args(["-v", "error", "-y", "-i", &path]);
        if is_image {
            cmd.args(["-frames:v", "1", "-c:v", "libwebp", "-quality", "88"]);
        } else {
            cmd.args([
                "-c:v",
                "libx264",
                "-crf",
                "23",
                "-preset",
                "fast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
            ]);
        }
        let status = cmd.arg(&dest).status();
        if !status.map(|s| s.success()).unwrap_or(false) {
            let _ = fs::remove_file(&dest);
            return Err("Compression failed. Install FFmpeg and ensure it is on PATH; the original file was not modified.".into());
        }
        if !(is_video && (ext == "mov" || ext == "mkv"))
            && fs::metadata(&dest).map_err(|e| e.to_string())?.len()
                >= fs::metadata(source).map_err(|e| e.to_string())?.len()
        {
            let _ = fs::remove_file(&dest);
            let original = format!("{}.{}", id, ext);
            fs::copy(source, root.join("assets").join(&original)).map_err(|e| e.to_string())?;
            return Ok(original);
        }
    } else {
        fs::copy(source, &dest).map_err(|e| e.to_string())?;
    }
    Ok(name)
}
#[tauri::command]
async fn import_asset(app: tauri::AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || import_asset_impl(app, path))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(target_os = "windows")]
#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteW(
        window: isize,
        operation: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show: i32,
    ) -> isize;
}
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid URL")?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only HTTP and HTTPS links can be opened".into());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = std::ffi::OsStr::new(&url)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        if unsafe {
            ShellExecuteW(
                0,
                std::ptr::null(),
                wide.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        } <= 32
        {
            return Err("Could not open the link".into());
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let program = if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        Command::new(program)
            .arg(&url)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}
#[cfg(target_os = "windows")]
#[link(name = "gdi32")]
extern "system" {
    fn AddFontResourceExW(name: *const u16, flags: u32, reserved: *mut std::ffi::c_void) -> i32;
}
#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn SendNotifyMessageW(window: isize, message: u32, wparam: usize, lparam: isize) -> i32;
}
#[tauri::command]
fn install_font(app: tauri::AppHandle, file: String, name: String) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, file, name);
        Err("Font installation is currently supported on Windows only".into())
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        let path = Path::new(&file);
        if path.file_name().and_then(|v| v.to_str()) != Some(file.as_str()) {
            return Err("Invalid font file".into());
        }
        let ext = path
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext != "ttf" && ext != "otf" {
            return Err("Windows installation requires a TTF or OTF file. This web font can still be previewed.".into());
        }
        let source = library_path(&app)?.join("assets").join(&file);
        if !source.is_file() {
            return Err("Font file not found".into());
        }
        let dir = PathBuf::from(
            std::env::var_os("LOCALAPPDATA").ok_or("Local application data folder unavailable")?,
        )
        .join("Microsoft")
        .join("Windows")
        .join("Fonts");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest = dir.join(&file);
        if dest.exists() {
            return Ok("This font is already installed for your Windows account.".into());
        }
        fs::copy(&source, &dest).map_err(|e| e.to_string())?;
        let registry_name = format!(
            "{} [{}] (TrueType)",
            name.chars().take(80).collect::<String>(),
            path.file_stem().unwrap_or_default().to_string_lossy()
        );
        let mut reg = Command::new("reg.exe");
        reg.creation_flags(0x08000000);
        let status = reg
            .args([
                "add",
                r"HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts",
                "/v",
                &registry_name,
                "/t",
                "REG_SZ",
                "/d",
            ])
            .arg(&dest)
            .args(["/f"])
            .status()
            .map_err(|e| e.to_string());
        if !matches!(status,Ok(v) if v.success()) {
            let _ = fs::remove_file(&dest);
            return Err("Could not register font for this Windows account".into());
        }
        let wide: Vec<u16> = dest
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let loaded = unsafe { AddFontResourceExW(wide.as_ptr(), 0, std::ptr::null_mut()) };
        if loaded == 0 {
            let mut remove = Command::new("reg.exe");
            remove.creation_flags(0x08000000);
            let _ = remove
                .args([
                    "delete",
                    r"HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts",
                    "/v",
                    &registry_name,
                    "/f",
                ])
                .status();
            let _ = fs::remove_file(&dest);
            return Err("Windows could not load this font file".into());
        }
        unsafe {
            SendNotifyMessageW(0xffff, 0x001d, 0, 0);
        }
        Ok("Font installed for your Windows account.".into())
    }
}
#[derive(serde::Serialize)]
struct PreviewInfo {
    thumbnail: Option<String>,
    palette: Vec<String>,
}
fn preview_impl(app: tauri::AppHandle, file: String) -> Result<PreviewInfo, String> {
    let path = Path::new(&file);
    if path.file_name().and_then(|n| n.to_str()) != Some(file.as_str()) {
        return Err("Invalid asset path".into());
    }
    let root = library_path(&app)?;
    let source = root.join("assets").join(&file);
    if !source.is_file() {
        return Err("Asset not found".into());
    }
    let dir = root.join("thumbnails");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!(
        "{}.jpg",
        path.file_stem()
            .and_then(|s| s.to_str())
            .ok_or("Invalid file name")?
    );
    let output = dir.join(&name);
    let mut thumb = Command::new("ffmpeg");
    #[cfg(target_os = "windows")]
    thumb.creation_flags(0x08000000);
    let result = thumb
        .args(["-v", "error", "-y", "-i"])
        .arg(&source)
        .args([
            "-frames:v",
            "1",
            "-vf",
            "scale=400:-2:force_original_aspect_ratio=decrease",
            "-q:v",
            "5",
        ])
        .arg(&output)
        .status();
    let thumbnail = if result.map(|v| v.success()).unwrap_or(false) {
        Some(name)
    } else {
        let _ = fs::remove_file(&output);
        None
    };
    let mut color = Command::new("ffmpeg");
    #[cfg(target_os = "windows")]
    color.creation_flags(0x08000000);
    let mut counts = std::collections::HashMap::<(u8, u8, u8), usize>::new();
    if let Ok(pixels) = color
        .args(["-v", "error", "-i"])
        .arg(&source)
        .args([
            "-frames:v",
            "1",
            "-vf",
            "scale=32:32",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ])
        .output()
    {
        if pixels.status.success() {
            for pixel in pixels.stdout.chunks_exact(3) {
                *counts
                    .entry((pixel[0] / 32, pixel[1] / 32, pixel[2] / 32))
                    .or_default() += 1;
            }
        }
    }
    let mut bins: Vec<_> = counts.into_iter().collect();
    bins.sort_by(|a, b| b.1.cmp(&a.1));
    let palette = bins
        .into_iter()
        .take(6)
        .map(|((r, g, b), _)| format!("#{:02x}{:02x}{:02x}", r * 32 + 16, g * 32 + 16, b * 32 + 16))
        .collect();
    Ok(PreviewInfo { thumbnail, palette })
}
#[tauri::command]
async fn prepare_preview(app: tauri::AppHandle, file: String) -> Result<PreviewInfo, String> {
    tauri::async_runtime::spawn_blocking(move || preview_impl(app, file))
        .await
        .map_err(|e| e.to_string())?
}
#[derive(serde::Serialize, serde::Deserialize)]
struct Capture {
    id: String,
    file: String,
    title: String,
    url: String,
    kind: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    category: String,
}
fn inbox(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().download_dir().map_err(|e| e.to_string())?.join("Sightline").join("inbox");
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&config).map_err(|e| e.to_string())?;
    fs::write(config.join("capture-inbox.txt"), dir.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    Ok(dir)
}
fn valid_capture(c: &Capture) -> bool {
    let extensions = match c.kind.as_str() {
        "image" => &["png"][..],
        "video" => &["webm", "mp4"][..],
        "font" => &["woff", "woff2", "ttf", "otf"][..],
        _ => return false,
    };
    uuid::Uuid::parse_str(&c.id).is_ok()
        && extensions
            .iter()
            .any(|ext| c.file == format!("{}.{}", c.id, ext))
}
#[tauri::command]
fn pending_captures(app: tauri::AppHandle) -> Result<Vec<Capture>, String> {
    let dir = inbox(&app)?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut captures = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(c) = serde_json::from_str::<Capture>(&data) {
                if valid_capture(&c)
                    && path.file_name().and_then(|s| s.to_str())
                        == Some(format!("{}.json", c.id).as_str())
                    && dir.join(&c.file).is_file()
                {
                    captures.push(c)
                }
            }
        }
    }
    Ok(captures)
}
#[tauri::command]
async fn import_capture(app: tauri::AppHandle, capture: Capture) -> Result<String, String> {
    if !valid_capture(&capture) {
        return Err("Invalid capture".into());
    }
    let path = inbox(&app)?
        .join(&capture.file)
        .to_string_lossy()
        .to_string();
    tauri::async_runtime::spawn_blocking(move || {
        if capture.kind == "video" && capture.file.ends_with(".mp4") {
            // The bridge already rendered this clip; preserve it without a second encode.
            let name = format!("{}.mp4", uuid::Uuid::new_v4());
            let dest = library_path(&app)?.join("assets").join(&name);
            fs::copy(&path, dest).map_err(|e| e.to_string())?;
            Ok(name)
        } else {
            import_asset_impl(app, path)
        }
    })
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn acknowledge_capture(app: tauri::AppHandle, capture: Capture) -> Result<(), String> {
    if !valid_capture(&capture) {
        return Err("Invalid capture".into());
    }
    let dir = inbox(&app)?;
    // Remove the manifest first: once the library index contains this id it is safe to retry cleanup.
    let manifest = dir.join(format!("{}.json", capture.id));
    if manifest.exists() {
        fs::remove_file(manifest).map_err(|e| e.to_string())?;
    }
    let media = dir.join(capture.file);
    if media.exists() {
        fs::remove_file(media).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_library,
            set_library,
            load_library,
            save_library,
            open_url,
            import_asset,
            install_font,
            prepare_preview,
            pending_captures,
            import_capture,
            acknowledge_capture
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Sightline");
}

#[cfg(test)]
mod capture_tests {
    use super::*;
    #[test]
    fn rendered_mp4_is_accepted_but_untrusted_paths_are_not() {
        let id = uuid::Uuid::new_v4().to_string();
        let mut c = Capture { id: id.clone(), file: format!("{id}.mp4"), title: "Example".into(), url: String::new(), kind: "video".into(), name: String::new(), tags: vec![], category: String::new() };
        assert!(valid_capture(&c));
        c.file = format!("../{id}.mp4");
        assert!(!valid_capture(&c));
        c.file = format!("{id}.exe");
        assert!(!valid_capture(&c));
    }
}
