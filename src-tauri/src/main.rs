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
mod drive_backup;
fn library_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let path = fs::read_to_string(config.join("library-path.txt"))
        .map_err(|_| "Choose a library folder first".to_string())?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Choose a library folder first".to_string());
    }
    Ok(PathBuf::from(trimmed))
}
fn ffmpeg_program() -> PathBuf {
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let exe = dir.join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
            if exe.is_file() {
                return exe;
            }
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let packages = PathBuf::from(local).join("Microsoft").join("WinGet").join("Packages");
        if let Ok(entries) = fs::read_dir(packages) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with("Gyan.FFmpeg_") {
                    if let Ok(builds) = fs::read_dir(entry.path()) {
                        for build in builds.flatten() {
                            let exe = build.path().join("bin").join("ffmpeg.exe");
                            if exe.is_file() {
                                return exe;
                            }
                        }
                    }
                }
            }
        }
    }
    PathBuf::from("ffmpeg")
}
#[tauri::command]
async fn fetch_favicon(app: tauri::AppHandle, source_id: String, source_url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        uuid::Uuid::parse_str(&source_id).map_err(|_| "Invalid source ID")?;
        let url = url::Url::parse(&source_url).map_err(|_| "Invalid source URL")?;
        if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() { return Err("Unsupported URL".to_string()); }
        let dir = library_path(&app)?.join("favicons"); fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let temp = dir.join(format!("{}.part", uuid::Uuid::new_v4()));
        let mut cmd = Command::new("python");
        #[cfg(target_os = "windows")] cmd.creation_flags(0x08000000);
        let output = cmd.args(["-c", include_str!("../../scripts/fetch-favicon.py"), url.as_str()]).arg(&temp).output();
        let result = (|| {
            let output = output.map_err(|e| e.to_string())?;
            if !output.status.success() { return Err("Favicon unavailable".to_string()); }
            let bytes = fs::read(&temp).map_err(|e| e.to_string())?;
            if bytes.len()>1048576 { return Err("Favicon too large".to_string()); }
            let ext=if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {"png"} else if bytes.starts_with(b"\0\0\x01\0") {"ico"} else if bytes.starts_with(b"\xff\xd8\xff") {"jpg"} else if bytes.starts_with(b"GIF8") {"gif"} else if bytes.starts_with(b"RIFF") && bytes.get(8..12)==Some(b"WEBP") {"webp"} else {return Err("Unsupported favicon".to_string())};
            let name=format!("{}.{ext}", uuid::Uuid::new_v4()); fs::rename(&temp,dir.join(&name)).map_err(|e|e.to_string())?; Ok(name)
        })(); let _=fs::remove_file(temp); result
    }).await.map_err(|e| e.to_string())?
}
fn catalog_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("discover-sites.json"))
}
fn cache_discover_images(path: &Path) -> Result<(), String> {
    let mut cmd = Command::new("python");
    #[cfg(target_os = "windows")] cmd.creation_flags(0x08000000);
    let output = cmd.args(["-c", include_str!("../../scripts/cache-discover-images.py")]).arg(path).output().map_err(|e| e.to_string())?;
    if output.status.success() { Ok(()) } else { Err(format!("Could not cache Discover previews: {}", String::from_utf8_lossy(&output.stderr))) }
}
#[tauri::command]
fn discover_images_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = catalog_path(&app)?.with_file_name("discover-images");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}
#[tauri::command]
fn load_discover_catalog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = catalog_path(&app)?;
    if !path.exists() { return Ok(None); }
    cache_discover_images(&path)?;
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&data).map_err(|e| format!("Discover catalog is invalid: {e}"))?;
    if !value.is_array() { return Err("Discover catalog must be an array".into()); }
    Ok(Some(data))
}
#[tauri::command]
fn load_discover_palettes(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = catalog_path(&app)?.parent().ok_or("Discover directory unavailable")?.to_path_buf();
    let mut combined = Vec::new();
    for name in ["discover-live-colors.json", "discover-restored-colors.json"] {
        let path = dir.join(name);
        if !path.exists() { continue; }
        let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let value: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        combined.extend(value.as_array().ok_or("Discover colors must be an array")?.iter().cloned());
    }
    if combined.is_empty() { Ok(None) } else { serde_json::to_string(&combined).map(Some).map_err(|e| e.to_string()) }
}
#[tauri::command]
fn initialize_discover_catalog(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = catalog_path(&app)?;
    if path.exists() { return Ok(()); }
    let value: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    if !value.is_array() { return Err("Discover catalog must be an array".into()); }
    let temp = path.with_file_name(format!("discover-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e| e.to_string())?;
        file.write_all(data.as_bytes()).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
        match fs::hard_link(&temp, &path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })();
    let _ = fs::remove_file(temp);
    result?;
    cache_discover_images(&path)
}
fn run_discover_refresh(path: &Path) -> Result<String, String> {
    if !path.exists() { return Err("Open Discover once before refreshing".into()); }
    let mut cmd = Command::new("python");
    #[cfg(target_os = "windows")] cmd.creation_flags(0x08000000);
    let output = cmd.args(["-c", include_str!("../../scripts/refresh-discover.py")]).arg(path).env("SIGHTLINE_CSS_COLLECTOR", include_str!("../../scripts/discover-css-awards.py")).output()
        .map_err(|e| format!("Could not start Python: {e}"))?;
    if !output.status.success() { return Err(format!("Refresh failed: {}", String::from_utf8_lossy(&output.stderr))); }
    cache_discover_images(path)?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
#[tauri::command]
async fn setup_discover_schedule() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let executable = std::env::current_exe().map_err(|e| e.to_string())?;
            let command = format!("\"{}\" --discover-refresh", executable.display());
            let name = "Sightline Discover hourly";
            let mut query = Command::new("schtasks.exe"); query.creation_flags(0x08000000);
            if !query.args(["/Query", "/TN", name]).output().map_err(|e| e.to_string())?.status.success() {
                let mut create = Command::new("schtasks.exe"); create.creation_flags(0x08000000);
                let output = create.args(["/Create", "/TN", name, "/SC", "HOURLY", "/TR", &command]).output().map_err(|e| e.to_string())?;
                if !output.status.success() { return Err(format!("Could not schedule Discover updates: {}", String::from_utf8_lossy(&output.stderr))); }
                let mut ps = Command::new("powershell.exe"); ps.creation_flags(0x08000000);
                let script = "$s=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable; Set-ScheduledTask -TaskName 'Sightline Discover hourly' -Settings $s | Out-Null";
                let output = ps.args(["-NoProfile", "-NonInteractive", "-Command", script]).output().map_err(|e| e.to_string())?;
                if !output.status.success() { return Err(format!("Could not configure Discover scheduling: {}", String::from_utf8_lossy(&output.stderr))); }
            }
            let online_name = "Sightline Discover online";
            let mut query = Command::new("schtasks.exe"); query.creation_flags(0x08000000);
            if !query.args(["/Query", "/TN", online_name]).output().map_err(|e| e.to_string())?.status.success() {
                let mut create = Command::new("schtasks.exe"); create.creation_flags(0x08000000);
                let output = create.args(["/Create", "/TN", online_name, "/SC", "ONEVENT", "/EC", "Microsoft-Windows-NetworkProfile/Operational", "/MO", "*[System[(EventID=10000)]]", "/TR", &command]).output().map_err(|e| e.to_string())?;
                if !output.status.success() { return Err(format!("Could not schedule network reconnect updates: {}", String::from_utf8_lossy(&output.stderr))); }
                let script = "$s=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable; Set-ScheduledTask -TaskName 'Sightline Discover online' -Settings $s | Out-Null";
                let mut ps = Command::new("powershell.exe"); ps.creation_flags(0x08000000);
                let output = ps.args(["-NoProfile", "-NonInteractive", "-Command", script]).output().map_err(|e| e.to_string())?;
                if !output.status.success() { return Err(format!("Could not configure reconnect updates: {}", String::from_utf8_lossy(&output.stderr))); }
            }
            let startup = PathBuf::from(std::env::var_os("APPDATA").ok_or("APPDATA unavailable")?)
                .join("Microsoft/Windows/Start Menu/Programs/Startup/Sightline Discover.lnk");
            if !startup.exists() {
                let script = "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($env:SIGHTLINE_SCHEDULE_SHORTCUT); $s.TargetPath=$env:SIGHTLINE_SCHEDULE_EXECUTABLE; $s.Arguments='--discover-refresh'; $s.WindowStyle=7; $s.Save()";
                let mut ps = Command::new("powershell.exe"); ps.creation_flags(0x08000000);
                let output = ps.args(["-NoProfile", "-NonInteractive", "-Command", script])
                    .env("SIGHTLINE_SCHEDULE_SHORTCUT", &startup).env("SIGHTLINE_SCHEDULE_EXECUTABLE", &executable).output().map_err(|e| e.to_string())?;
                if !output.status.success() { return Err(format!("Could not set up login refresh: {}", String::from_utf8_lossy(&output.stderr))); }
            }
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn refresh_discover_catalog(app: tauri::AppHandle) -> Result<String, String> {
    static RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) { return Err("A refresh is already running".into()); }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let path = catalog_path(&app)?;
        run_discover_refresh(&path)
    }).await.map_err(|e| e.to_string()).and_then(|r| r);
    RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
    result
}
fn lock_discover(app: &tauri::AppHandle) -> Result<fs::File, String> {
    let path = catalog_path(app)?.with_extension("lock");
    let file = fs::OpenOptions::new().read(true).write(true).create(true).open(path).map_err(|e| e.to_string())?;
    file.try_lock().map_err(|_| "Discover is updating; try the backup or restore again shortly".to_string())?;
    Ok(file)
}
#[tauri::command]
fn add_discover_site(app: tauri::AppHandle, title: String, url: String, image: String, tags: Vec<String>) -> Result<(), String> {
    let _lock = lock_discover(&app)?;
    let path = catalog_path(&app)?;
    add_discover_site_at(&path, title, url, image, tags)?;
    cache_discover_images(&path)
}
fn add_discover_site_at(path: &Path, title: String, url: String, image: String, tags: Vec<String>) -> Result<(), String> {
    let title = title.trim();
    let parsed = url::Url::parse(url.trim()).map_err(|_| "Enter a valid website URL")?;
    if title.is_empty() || !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() || !parsed.username().is_empty() || parsed.password().is_some() { return Err("Enter a title and a valid HTTP(S) website URL".into()); }
    let image = image.trim();
    if !image.is_empty() {
        let parsed_image = url::Url::parse(image).map_err(|_| "Enter a valid image URL")?;
        if !matches!(parsed_image.scheme(), "http" | "https") || parsed_image.host_str().is_none() || !parsed_image.username().is_empty() || parsed_image.password().is_some() { return Err("Enter a valid HTTP(S) image URL".into()); }
    }
    let mut rows: Vec<serde_json::Value> = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let normalized = parsed.as_str().trim_end_matches('/');
    if rows.iter().any(|row| row["url"].as_str().and_then(|u| url::Url::parse(u).ok()).map(|u| u.as_str().trim_end_matches('/') == normalized).unwrap_or(false)) { return Err("This website is already in Discover".into()); }
    rows.push(serde_json::json!({"title":title,"url":parsed.as_str(),"image":image,"tags":tags.into_iter().map(|t|t.trim().to_owned()).filter(|t|!t.is_empty()).collect::<Vec<_>>(),"sources":[{"name":"Manual","url":parsed.as_str(),"date":null}]}));
    let temp = path.with_file_name(format!("discover-{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temp, serde_json::to_vec(&rows).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    if let Err(e)=fs::rename(&temp,path) { let _=fs::remove_file(temp); return Err(e.to_string()); }
    Ok(())
}
#[cfg(test)]
mod discover_add_tests {
    use super::*;
    #[test]
    fn adds_once_and_preserves_catalog_on_invalid_input() {
        let path = std::env::temp_dir().join(format!("sightline-discover-test-{}.json", uuid::Uuid::new_v4()));
        fs::write(&path, "[]").unwrap();
        let add = |url: &str| add_discover_site_at(&path, "Example".into(), url.into(), String::new(), vec![" design ".into()]);
        add("https://example.com").unwrap();
        let saved = fs::read_to_string(&path).unwrap();
        assert!(add("https://example.com/").is_err());
        assert!(add("file:///test").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), saved);
        let entries: Vec<serde_json::Value> = serde_json::from_str(&saved).unwrap();
        assert_eq!(entries[0]["tags"][0], "design");
        fs::remove_file(path).unwrap();
    }
}
#[tauri::command]
async fn backup_to_drive(app: tauri::AppHandle, folder: String, ui_state: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state: serde_json::Value = serde_json::from_str(&ui_state).map_err(|e| e.to_string())?;
        if !state.is_object() || ui_state.len()>10_000_000 { return Err("Invalid backup state".into()); }
        let library = library_path(&app)?;
        let index = library.join("library.json");
        if !index.exists() {
            match fs::OpenOptions::new().write(true).create_new(true).open(index) {
                Ok(mut file) => file.write_all(b"[]").map_err(|e| e.to_string())?,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {},
                Err(e) => return Err(e.to_string()),
            }
        }
        let _lock = lock_discover(&app)?;
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let temp = dir.join(format!("backup-state-{}.json", uuid::Uuid::new_v4()));
        fs::write(&temp, ui_state).map_err(|e| e.to_string())?;
        let result = (|| {
            let mut sources = vec![drive_backup::BackupSource::new("library", library), drive_backup::BackupSource::new("ui-state.json", &temp)];
            for name in ["discover-sites.json", "discover-live-colors.json", "discover-restored-colors.json", "instagram-sync-state.json", "instagram-sync-config.json"] {
                let path = dir.join(name);
                if path.exists() { sources.push(drive_backup::BackupSource::new(name, path)); }
            }
            drive_backup::create_snapshot(Path::new(&folder), &sources).map(|p| p.to_string_lossy().to_string())
        })();
        let _ = fs::remove_file(temp);
        result
    }).await.map_err(|e| e.to_string())?
}
fn replace_restored_file(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    let dest = dir.join(name);
    if dest.exists() { fs::copy(&dest, dir.join(format!("{name}.before-restore-{}",uuid::Uuid::new_v4()))).map_err(|e| e.to_string())?; }
    let temp = dir.join(format!("restore-{}.tmp",uuid::Uuid::new_v4()));
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    if let Err(e) = fs::rename(&temp, &dest) { let _ = fs::remove_file(temp); return Err(e.to_string()); }
    Ok(())
}
#[derive(serde::Serialize)]
#[serde(rename_all="camelCase")]
struct RestoreResult { library_path: String, ui_state: String }
#[tauri::command]
async fn restore_drive_backup(app: tauri::AppHandle, snapshot: String, target: String) -> Result<RestoreResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = lock_discover(&app)?;
        let instagram_dir=app.path().app_data_dir().map_err(|e|e.to_string())?;
        let _instagram_lock=lock_instagram(&instagram_dir)?;
        let target = PathBuf::from(target);
        drive_backup::restore_snapshot(Path::new(&snapshot), &target)?;
        let library = target.join("library");
        let data = fs::read_to_string(library.join("library.json")).map_err(|e| format!("Restored backup has no valid library index: {e}"))?;
        if !serde_json::from_str::<serde_json::Value>(&data).map_err(|e| e.to_string())?.is_array() { return Err("Restored library index is invalid".into()); }
        let state = fs::read_to_string(target.join("ui-state.json")).map_err(|e| e.to_string())?;
        if !serde_json::from_str::<serde_json::Value>(&state).map_err(|e| e.to_string())?.is_object() { return Err("Restored UI state is invalid".into()); }
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let mut restored_palettes = Vec::new();
        for name in ["discover-sites.json", "discover-live-colors.json", "discover-restored-colors.json", "instagram-sync-state.json", "instagram-sync-config.json"] {
            let source = target.join(name);
            if !source.exists() { continue; }
            let bytes = fs::read(&source).map_err(|e| e.to_string())?;
            let parsed: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            if name == "instagram-sync-state.json" || name == "instagram-sync-config.json" {
                if (name == "instagram-sync-state.json" && !parsed.is_object()) || (name == "instagram-sync-config.json" && !parsed.is_array()) { return Err(format!("Invalid restored {name}")); }
                replace_restored_file(&dir, name, &bytes)?; continue;
            }
            let entries = parsed.as_array().ok_or_else(|| format!("Invalid restored {name}"))?;
            if name != "discover-sites.json" { restored_palettes.extend(entries.iter().cloned()); continue; }
            replace_restored_file(&dir, name, &bytes)?;
        }
        // A live batch may be writing its own file; restore into a separate file
        // and let the UI combine them, so neither set of results is lost.
        if !restored_palettes.is_empty() {
            replace_restored_file(&dir, "discover-restored-colors.json", &serde_json::to_vec(&restored_palettes).map_err(|e| e.to_string())?)?;
        }
        set_library(app, library.to_string_lossy().to_string())?;
        Ok(RestoreResult { library_path: library.to_string_lossy().to_string(), ui_state: state })
    }).await.map_err(|e| e.to_string())?
}
#[derive(Clone, serde::Deserialize, serde::Serialize)]
struct InstagramCollection { name: String, category: String, url: String }
fn lock_instagram(dir: &Path) -> Result<fs::File, String> {
    let file=fs::OpenOptions::new().read(true).write(true).create(true).open(dir.join("instagram-sync-state.lock")).map_err(|e|e.to_string())?;
    file.try_lock().map_err(|_| "Instagram sync is already running".to_string())?; Ok(file)
}
fn scan_instagram_at(dir: &Path, collections: &[InstagramCollection], save_config: bool) -> Result<serde_json::Value, String> {
    if collections.is_empty() || collections.len()>2 { return Err("Choose at least one collection".into()); }
    fs::create_dir_all(dir).map_err(|e|e.to_string())?;
    let path=dir.join("instagram-sync-state.json");
    let mut cmd=Command::new("python");
    #[cfg(target_os="windows")] cmd.creation_flags(0x08000000);
    cmd.args(["-c",include_str!("../../scripts/sightline-instagram-sync.py"),"--state"]).arg(&path).args(["--browser","brave","--retries","0"]);
    for collection in collections {
        if ![("post-ideas","Post Ideas"),("web-design","Web design")].contains(&(collection.name.as_str(),collection.category.as_str())) {return Err("Invalid collection mapping".into());}
        let url=url::Url::parse(&collection.url).map_err(|_| "Invalid Instagram collection URL")?;
        if url.scheme()!="https" || url.host_str()!=Some("www.instagram.com") || !url.username().is_empty() || url.password().is_some() || !url.path().contains("/saved/") {return Err("Use an Instagram saved collection URL".into());}
        cmd.arg("--collection").arg(format!("{}={}={}",collection.name,collection.category,url));
    }
    if save_config {
        let config=serde_json::to_vec(collections).map_err(|e|e.to_string())?;
        let temp=dir.join(format!("instagram-config-{}.tmp",uuid::Uuid::new_v4()));
        fs::write(&temp,config).map_err(|e|e.to_string())?;
        if let Err(e)=fs::rename(&temp,dir.join("instagram-sync-config.json")){let _=fs::remove_file(temp);return Err(e.to_string())}
    }
    let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let _=fs::write(dir.join("instagram-scan-attempt.txt"),now.to_string());
    let output=cmd.output().map_err(|_| "Install Python and gallery-dl to sync Instagram.".to_string())?;
    if !output.status.success(){return Err("Instagram scan could not start. Check your gallery-dl installation or retry if another sync is running.".into());}
    let bytes=fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len()>20_000_000 {return Err("Instagram queue is too large".into());}
    let state:serde_json::Value=serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let complete=collections.iter().all(|c|state["collections"][&c.name]["status"]=="complete");
    if complete {
        let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
        let _=fs::write(dir.join("instagram-scan-success.txt"),now.to_string());
    }
    Ok(state)
}
#[tauri::command]
async fn scan_instagram_collections(app: tauri::AppHandle, collections: Vec<InstagramCollection>) -> Result<serde_json::Value, String> {
    static RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) { return Err("Instagram sync is already running".into()); }
    let result=tauri::async_runtime::spawn_blocking(move || {
        let dir=app.path().app_data_dir().map_err(|e|e.to_string())?;
        scan_instagram_at(&dir,&collections,true)
    }).await.map_err(|e|e.to_string()).and_then(|x|x);
    RUNNING.store(false,std::sync::atomic::Ordering::SeqCst);result
}
#[tauri::command]
fn load_instagram_queue(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path=app.path().app_data_dir().map_err(|e|e.to_string())?.join("instagram-sync-state.json");
    if !path.exists(){return Ok(None)}
    let bytes=fs::read(path).map_err(|e|e.to_string())?;
    if bytes.len()>20_000_000{return Err("Instagram queue is too large".into())}
    serde_json::from_slice(&bytes).map(Some).map_err(|e|e.to_string())
}
#[tauri::command]
fn acknowledge_instagram_posts(app: tauri::AppHandle, keys: Vec<String>) -> Result<(), String> {
    let dir=app.path().app_data_dir().map_err(|e|e.to_string())?;let _lock=lock_instagram(&dir)?;let path=dir.join("instagram-sync-state.json");
    let mut state:serde_json::Value=serde_json::from_slice(&fs::read(&path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let posts=state.get_mut("posts").and_then(|p|p.as_object_mut()).ok_or("Invalid Instagram queue")?;
    for key in keys {if let Some(post)=posts.get_mut(&key) {post["status"]=serde_json::Value::String("imported".into());}}
    let temp=dir.join(format!("instagram-{}.tmp",uuid::Uuid::new_v4()));
    fs::write(&temp,serde_json::to_vec(&state).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    if let Err(e)=fs::rename(&temp,&path){let _=fs::remove_file(temp);return Err(e.to_string())} Ok(())
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
fn sanitize_folder_name(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut prev_space = false;
    for ch in raw.chars() {
        let bad = ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        let c = if bad { ' ' } else { ch };
        if c.is_whitespace() {
            if !prev_space && !out.is_empty() {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(c);
            prev_space = false;
        }
    }
    let trimmed = out.trim_matches(|c: char| c == ' ' || c == '.');
    let mut name: String = trimmed.chars().take(60).collect();
    name = name.trim_matches(|c: char| c == ' ' || c == '.').to_string();
    if name.is_empty() {
        name = "Untitled".to_string();
    }
    let upper = name.to_ascii_uppercase();
    let stem = upper.split('.').next().unwrap_or(&upper);
    if matches!(
        stem,
        "CON" | "PRN" | "AUX" | "NUL"
            | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9"
            | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9"
    ) {
        name.push_str(" source");
    }
    name
}
fn asset_folder_prefix(file: &str) -> Option<String> {
    let clean = file.replace('\\', "/");
    let (folder, rest) = clean.split_once('/')?;
    let folder = folder.trim();
    if folder.is_empty() || folder == "." || folder == ".." || rest.is_empty() || rest.contains('/') {
        return None;
    }
    Some(folder.to_string())
}
fn safe_asset_path(root: &Path, rel: &str) -> Result<(PathBuf, String), String> {
    if rel.is_empty() {
        return Err("Invalid asset path".into());
    }
    let normalized = rel.replace('\\', "/");
    let rel_path = Path::new(&normalized);
    let mut parts = Vec::new();
    for comp in rel_path.components() {
        match comp {
            std::path::Component::Normal(seg) => {
                let s = seg.to_str().ok_or_else(|| "Invalid asset path".to_string())?;
                if s.is_empty() || s == "." || s == ".." {
                    return Err("Invalid asset path".into());
                }
                parts.push(s);
            }
            _ => return Err("Invalid asset path".into()),
        }
    }
    if parts.is_empty() || parts.len() > 2 {
        return Err("Invalid asset path".into());
    }
    let full = if parts.len() == 2 {
        root.join("assets").join(parts[0]).join(parts[1])
    } else {
        root.join("assets").join(parts[0])
    };
    Ok((full, parts.join("/")))
}
fn clean_url_host(raw: &str) -> String {
    url::Url::parse(raw)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string()))
        .unwrap_or_default()
}
fn unique_folder_name(
    title: &str,
    url: &str,
    id: &str,
    used_lower: &std::collections::HashSet<String>,
) -> String {
    let raw_base = if !title.trim().is_empty() {
        title.trim().to_string()
    } else {
        let host = clean_url_host(url);
        if !host.is_empty() { host } else { "Untitled".to_string() }
    };
    let base = sanitize_folder_name(&raw_base);
    if !used_lower.contains(&base.to_ascii_lowercase()) {
        return base;
    }
    let short_id: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(6)
        .collect();
    let short_id = if short_id.is_empty() { "src".to_string() } else { short_id };
    let truncated: String = base.chars().take(48).collect();
    let tagged = format!("{} ({})", sanitize_folder_name(&truncated), short_id);
    if !used_lower.contains(&tagged.to_ascii_lowercase()) {
        return tagged;
    }
    let mut n = 2usize;
    loop {
        let candidate = format!("{tagged} {n}");
        if !used_lower.contains(&candidate.to_ascii_lowercase()) {
            return candidate;
        }
        n += 1;
    }
}
fn write_library_index_at(root: &Path, data: &str) -> Result<(), String> {
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
fn organize_library_assets_at(root: &Path) -> Result<(), String> {
    let index = root.join("library.json");
    if !index.exists() {
        return Ok(());
    }
    let raw = fs::read_to_string(&index).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let Some(sources) = value.as_array_mut() else {
        return Ok(());
    };
    let assets_dir = root.join("assets");
    fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
    let mut used_lower = std::collections::HashSet::<String>::new();
    for source in sources.iter() {
        if let Some(f) = source["folder"].as_str().filter(|f| !f.trim().is_empty()) {
            used_lower.insert(sanitize_folder_name(f).to_ascii_lowercase());
        } else if let Some(assets) = source["assets"].as_array() {
            for asset in assets {
                if let Some(prefix) = asset["file"].as_str().and_then(asset_folder_prefix) {
                    used_lower.insert(prefix.to_ascii_lowercase());
                    break;
                }
            }
        }
    }
    let mut changed = false;
    let mut assigned_folders = Vec::with_capacity(sources.len());
    for source in sources.iter_mut() {
        let existing_folder = source["folder"]
            .as_str()
            .filter(|f| !f.trim().is_empty())
            .map(sanitize_folder_name)
            .or_else(|| {
                source["assets"]
                    .as_array()
                    .and_then(|arr| arr.iter().find_map(|a| a["file"].as_str().and_then(asset_folder_prefix)))
            });
        let folder = match existing_folder {
            Some(f) => f,
            None => {
                let title = source["title"].as_str().unwrap_or("");
                let url = source["url"].as_str().unwrap_or("");
                let id = source["id"].as_str().unwrap_or("");
                unique_folder_name(title, url, id, &used_lower)
            }
        };
        used_lower.insert(folder.to_ascii_lowercase());
        if source["folder"].as_str() != Some(folder.as_str()) {
            source["folder"] = serde_json::Value::String(folder.clone());
            changed = true;
        }
        assigned_folders.push(folder);
    }
    let mut moved_map = std::collections::HashMap::<String, String>::new();
    for (source, folder) in sources.iter().zip(assigned_folders.iter()) {
        let Some(assets) = source["assets"].as_array() else { continue; };
        for asset in assets {
            let Some(file) = asset["file"].as_str() else { continue; };
            let norm = file.replace('\\', "/");
            if norm.contains('/') || moved_map.contains_key(&norm) {
                continue;
            }
            let src_path = assets_dir.join(&norm);
            if !src_path.is_file() {
                continue;
            }
            let dest_dir = assets_dir.join(folder);
            if fs::create_dir_all(&dest_dir).is_err() {
                continue;
            }
            let dest_path = dest_dir.join(&norm);
            let moved_ok = if dest_path.is_file() {
                true
            } else if fs::rename(&src_path, &dest_path).is_ok() {
                true
            } else if fs::copy(&src_path, &dest_path).is_ok() {
                let _ = fs::remove_file(&src_path);
                true
            } else {
                false
            };
            if moved_ok {
                moved_map.insert(norm, format!("{folder}/{file}"));
            }
        }
    }
    for source in sources.iter_mut() {
        let Some(assets) = source["assets"].as_array_mut() else { continue; };
        for asset in assets.iter_mut() {
            let Some(file) = asset["file"].as_str() else { continue; };
            let norm = file.replace('\\', "/");
            let updated = if let Some(new_rel) = moved_map.get(&norm) {
                new_rel.clone()
            } else if norm != file {
                norm
            } else {
                continue;
            };
            asset["file"] = serde_json::Value::String(updated);
            changed = true;
        }
    }
    if changed {
        let formatted = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        write_library_index_at(root, &formatted)?;
    }
    Ok(())
}
#[tauri::command]
fn rename_source_folder(
    app: tauri::AppHandle,
    old_folder: String,
    new_title: String,
    url: String,
    source_id: String,
    used_folders: Vec<String>,
) -> Result<String, String> {
    let root = library_path(&app)?;
    let assets_dir = root.join("assets");
    let clean_old = sanitize_folder_name(&old_folder);
    let used_lower: std::collections::HashSet<String> = used_folders
        .into_iter()
        .map(|f| sanitize_folder_name(&f).to_ascii_lowercase())
        .collect();
    let new_folder = unique_folder_name(&new_title, &url, &source_id, &used_lower);
    if clean_old == new_folder {
        return Ok(new_folder);
    }
    let old_path = assets_dir.join(&clean_old);
    if !old_path.exists() {
        return Ok(new_folder);
    }
    let new_path = assets_dir.join(&new_folder);
    if new_path.exists() && !clean_old.eq_ignore_ascii_case(&new_folder) {
        return Err("Target source folder already exists".into());
    }
    fs::rename(&old_path, &new_path).map_err(|e| format!("Could not rename source folder: {e}"))?;
    Ok(new_folder)
}
#[tauri::command]
fn load_library(app: tauri::AppHandle) -> Result<String, String> {
    let root = library_path(&app)?;
    let _ = organize_library_assets_at(&root);
    let p = root.join("library.json");
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
    write_library_index_at(&root, &data)
}
fn import_asset_impl(app: tauri::AppHandle, path: String, folder: Option<String>) -> Result<String, String> {
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
    let clean_folder = folder
        .as_deref()
        .map(str::trim)
        .filter(|f| !f.is_empty())
        .map(sanitize_folder_name);
    let target_dir = match clean_folder {
        Some(ref f) => root.join("assets").join(f),
        None => root.join("assets"),
    };
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let rel = |file: String| match clean_folder {
        Some(ref f) => format!("{f}/{file}"),
        None => file,
    };
    let name = format!("{}.{}", id, out_ext);
    let dest = target_dir.join(&name);
    if is_image || is_video {
        let mut cmd = Command::new(ffmpeg_program());
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
            fs::copy(source, target_dir.join(&original)).map_err(|e| e.to_string())?;
            return Ok(rel(original));
        }
    } else {
        fs::copy(source, &dest).map_err(|e| e.to_string())?;
    }
    Ok(rel(name))
}
#[tauri::command]
async fn import_asset(app: tauri::AppHandle, path: String, folder: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || import_asset_impl(app, path, folder))
        .await
        .map_err(|e| e.to_string())?
}
const FONT_EXTENSIONS: &[&str] = &[
    "ttf", "otf", "woff", "woff2", "eot", "ttc", "otc", "dfont", "pfb", "pfm", "afm", "bdf",
    "pcf", "snf", "fon", "fnt", "sfd",
];

fn is_font_ext(ext: &str) -> bool {
    FONT_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
}

#[tauri::command]
async fn import_asset_bytes(app: tauri::AppHandle, name: String, bytes: Vec<u8>, folder: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ext = Path::new(&name).extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        if !["png", "jpg", "jpeg", "webp", "gif", "svg", "mp4", "webm", "mov", "mkv"].contains(&ext.as_str()) && !is_font_ext(&ext) { return Err("Unsupported file type".into()); }
        let path = std::env::temp_dir().join(format!("sightline-{}.{}", uuid::Uuid::new_v4(), ext));
        fs::write(&path, bytes).map_err(|e| e.to_string())?;
        let result = import_asset_impl(app, path.to_string_lossy().into_owned(), folder);
        let _ = fs::remove_file(path);
        result
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn download_post_media(app: tauri::AppHandle, source_url: String, use_brave: Option<bool>, folder: Option<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let url = url::Url::parse(&source_url).map_err(|_| "Invalid post link")?;
        let host = url.host_str().unwrap_or("").trim_start_matches("www.");
        if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || !["instagram.com", "pinterest.com", "pin.it", "x.com", "twitter.com"].contains(&host) { return Err("Use an Instagram, Pinterest or X post link.".to_string()); }
        let temp = std::env::temp_dir().join(format!("sightline-post-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp).map_err(|e|e.to_string())?;
        let result = (|| {
            let mut cmd = Command::new("python");
            #[cfg(target_os = "windows")] cmd.creation_flags(0x08000000);
            cmd.args(["-m", "gallery_dl", "--range", "1-20", "--destination"]).arg(&temp);
            if use_brave.unwrap_or(false) && host=="instagram.com" { cmd.args(["--cookies-from-browser", "brave/instagram.com"]); }
            let output = cmd.arg("--").arg(url.as_str()).output().map_err(|_| "Install Python and gallery-dl to download post media.".to_string())?;
            if !output.status.success() { return Err(if host=="instagram.com" {"Could not download Instagram media. Check your sign-in and gallery-dl setup; the link remains saved.".to_string()} else {format!("Could not download media: {}", String::from_utf8_lossy(&output.stderr).chars().take(400).collect::<String>())}); }
            fn collect(dir:&Path, out:&mut Vec<PathBuf>) -> Result<(),String> { for entry in fs::read_dir(dir).map_err(|e|e.to_string())? { let entry=entry.map_err(|e|e.to_string())?;let path=entry.path();if entry.file_type().map_err(|e|e.to_string())?.is_dir(){collect(&path,out)?}else if ["jpg","jpeg","png","webp","gif","mp4","webm","mov"].contains(&path.extension().and_then(|v|v.to_str()).unwrap_or("").to_lowercase().as_str()){out.push(path)} } Ok(()) }
            let mut paths=Vec::new();collect(&temp,&mut paths)?;paths.sort();if paths.is_empty(){return Err("No downloadable media found. The link is saved; you can import files manually.".to_string())}
            let mut imported=Vec::new();for path in paths { imported.push(import_asset_impl(app.clone(),path.to_string_lossy().to_string(),folder.clone())?); } Ok(imported)
        })();let _=fs::remove_dir_all(&temp);result
    }).await.map_err(|e|e.to_string())?
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
        let root = library_path(&app)?;
        let (source, _) = safe_asset_path(&root, &file)?;
        let file_name = source
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or("Invalid font file")?
            .to_string();
        let path = Path::new(&file_name);
        let ext = path
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext != "ttf" && ext != "otf" {
            return Err("Windows installation requires a TTF or OTF file. This web font can still be previewed.".into());
        }
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
        let dest = dir.join(&file_name);
        if dest.exists() {
            return Ok("This font is already installed for your Windows account.".into());
        }
        if let Ok(source_bytes) = fs::read(&source) {
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let existing = entry.path();
                    if existing.extension().and_then(|v| v.to_str()).map(|v| v.eq_ignore_ascii_case(&ext)).unwrap_or(false)
                        && fs::metadata(&existing).map(|m| m.len() == source_bytes.len() as u64).unwrap_or(false)
                        && fs::read(&existing).map(|b| b == source_bytes).unwrap_or(false)
                    {
                        return Ok("This font is already installed for your Windows account.".into());
                    }
                }
            }
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
    let root = library_path(&app)?;
    let (source, _) = safe_asset_path(&root, &file)?;
    if !source.is_file() {
        return Err("Asset not found".into());
    }
    let ext = source
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext == "svg" || is_font_ext(&ext) {
        return Ok(PreviewInfo {
            thumbnail: None,
            palette: vec![],
        });
    }
    let dir = root.join("thumbnails");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!(
        "{}.jpg",
        source
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("Invalid file name")?
    );
    let output = dir.join(&name);
    let ffmpeg = ffmpeg_program();
    let mut thumb = Command::new(&ffmpeg);
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
    let mut color = Command::new(&ffmpeg);
    #[cfg(target_os = "windows")]
    color.creation_flags(0x08000000);
    let mut counts = std::collections::HashMap::<(u8, u8, u8), usize>::new();
    let mut total_pixels = 0usize;
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
                total_pixels += 1;
                *counts
                    .entry((pixel[0] / 32, pixel[1] / 32, pixel[2] / 32))
                    .or_default() += 1;
            }
        }
    }
    let mut bins: Vec<_> = counts.into_iter().collect();
    bins.sort_by(|a, b| b.1.cmp(&a.1));
    let min_count = (total_pixels / 50).max(1);
    let mut dominant: Vec<_> = bins.iter().filter(|(_, c)| *c >= min_count).take(8).cloned().collect();
    if dominant.is_empty() {
        dominant = bins.into_iter().take(4).collect();
    }
    let palette = dominant
        .into_iter()
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
#[tauri::command]
fn delete_asset_file(app: tauri::AppHandle, file: String) -> Result<(), String> {
    let root = library_path(&app)?;
    let (asset, clean_rel) = safe_asset_path(&root, &file)?;
    let index = root.join("library.json");
    if index.exists() {
        let data = fs::read_to_string(&index).map_err(|e| e.to_string())?;
        let sources: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        if let Some(items) = sources.as_array() {
            let referenced = items.iter().any(|s| {
                s["assets"]
                    .as_array()
                    .map(|assets| {
                        assets.iter().any(|a| {
                            a["file"]
                                .as_str()
                                .map(|f| f.replace('\\', "/") == clean_rel)
                                .unwrap_or(false)
                        })
                    })
                    .unwrap_or(false)
            });
            if referenced {
                return Ok(());
            }
        }
    }
    if asset.is_file() {
        fs::remove_file(&asset).map_err(|e| e.to_string())?;
        if let Some(parent) = asset.parent() {
            if parent != root.join("assets") {
                let _ = fs::remove_dir(parent);
            }
        }
    }
    if let Some(stem) = asset.file_stem().and_then(|s| s.to_str()) {
        let thumb = root.join("thumbnails").join(format!("{stem}.jpg"));
        if thumb.is_file() {
            let _ = fs::remove_file(thumb);
        }
        remove_custom_thumbnails(&root.join("thumbnails"), stem);
    }
    Ok(())
}
fn remove_custom_thumbnails(dir: &Path, stem: &str) {
    let prefix = format!("{stem}-t");
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(rest) = name.strip_prefix(&prefix) {
                if let Some(ms) = rest.strip_suffix(".jpg") {
                    if !ms.is_empty() && ms.bytes().all(|b| b.is_ascii_digit()) {
                        let _ = fs::remove_file(entry.path());
                    }
                }
            }
        }
    }
}
#[tauri::command]
async fn set_video_thumbnail(app: tauri::AppHandle, file: String, time: f64, previous: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !time.is_finite() || time < 0.0 {
            return Err("Invalid frame time".to_string());
        }
        let root = library_path(&app)?;
        let (source, _) = safe_asset_path(&root, &file)?;
        if !source.is_file() {
            return Err("Video file not found".into());
        }
        let stem = source.file_stem().and_then(|s| s.to_str()).ok_or("Invalid file name")?.to_string();
        let dir = root.join("thumbnails");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let name = format!("{stem}-t{}.jpg", (time * 1000.0).round() as u64);
        let output = dir.join(&name);
        let mut cmd = Command::new(ffmpeg_program());
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        let ok = cmd
            .args(["-v", "error", "-y", "-ss"])
            .arg(format!("{time:.3}"))
            .arg("-i")
            .arg(&source)
            .args(["-frames:v", "1", "-vf", "scale=640:-2:force_original_aspect_ratio=decrease", "-q:v", "4"])
            .arg(&output)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok || !output.is_file() {
            let _ = fs::remove_file(&output);
            return Err("Could not capture that frame. Make sure FFmpeg is installed.".into());
        }
        if let Some(prev) = previous {
            let prev_name = Path::new(&prev).file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
            let is_custom = prev_name.starts_with(&format!("{stem}-t")) && prev_name.ends_with(".jpg");
            if is_custom && prev_name != name {
                let _ = fs::remove_file(dir.join(prev_name));
            }
        }
        Ok(name)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn reset_video_thumbnail(app: tauri::AppHandle, file: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = library_path(&app)?;
        let (source, _) = safe_asset_path(&root, &file)?;
        let stem = source.file_stem().and_then(|s| s.to_str()).ok_or("Invalid file name")?.to_string();
        let dir = root.join("thumbnails");
        remove_custom_thumbnails(&dir, &stem);
        let default = dir.join(format!("{stem}.jpg"));
        if default.is_file() {
            return Ok(Some(format!("{stem}.jpg")));
        }
        Ok(preview_impl(app, file)?.thumbnail)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn reveal_asset_file(app: tauri::AppHandle, file: String) -> Result<(), String> {
    let root = library_path(&app)?;
    let (asset, _) = safe_asset_path(&root, &file)?;
    if !asset.is_file() {
        return Err("Asset file not found on disk".into());
    }
    let canonical = fs::canonicalize(&asset).unwrap_or(asset);
    #[cfg(target_os = "windows")]
    {
        // Strip extended-length `\\?\` prefix so explorer.exe selects the file reliably.
        let display = canonical.to_string_lossy();
        let clean = display.strip_prefix(r"\\?\").unwrap_or(&display);
        Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", clean))
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open File Explorer: {e}"))
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&canonical)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let dir = canonical.parent().unwrap_or(&root);
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}
#[tauri::command]
fn get_asset_path(app: tauri::AppHandle, file: String) -> Result<String, String> {
    let root = library_path(&app)?;
    let (asset, _) = safe_asset_path(&root, &file)?;
    if !asset.is_file() {
        return Err("Asset file not found on disk".into());
    }
    let canonical = fs::canonicalize(&asset).unwrap_or(asset);
    let display = canonical.to_string_lossy();
    Ok(display.strip_prefix(r"\\?\").unwrap_or(&display).to_string())
}
#[tauri::command]
async fn copy_image_to_clipboard(
    app: tauri::AppHandle,
    file: Option<String>,
    png_bytes: Option<Vec<u8>>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let resolved_asset = match file {
            Some(rel) => {
                let root = library_path(&app)?;
                let (asset, _) = safe_asset_path(&root, &rel)?;
                if !asset.is_file() {
                    return Err("Asset file not found on disk".into());
                }
                Some(asset)
            }
            None => None,
        };
        return tauri::async_runtime::spawn_blocking(move || {
            let temp_png = std::env::temp_dir()
                .join(format!("sightline-clip-{}.png", uuid::Uuid::new_v4()));
            let mut created_temp = false;
            let image_path = if let Some(bytes) = png_bytes.filter(|b| !b.is_empty()) {
                fs::write(&temp_png, bytes).map_err(|e| e.to_string())?;
                created_temp = true;
                temp_png.clone()
            } else if let Some(asset) = resolved_asset {
                let ext = asset
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_ascii_lowercase())
                    .unwrap_or_default();
                if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "bmp" | "gif") {
                    asset
                } else {
                    let mut ff = Command::new(ffmpeg_program());
                    ff.creation_flags(0x08000000);
                    let out = ff
                        .arg("-y")
                        .arg("-i")
                        .arg(&asset)
                        .args(["-frames:v", "1"])
                        .arg(&temp_png)
                        .output()
                        .map_err(|e| format!("Could not convert image for clipboard: {e}"))?;
                    if !out.status.success() || !temp_png.is_file() {
                        let _ = fs::remove_file(&temp_png);
                        return Err("Could not prepare image for clipboard".into());
                    }
                    created_temp = true;
                    temp_png.clone()
                }
            } else {
                return Err("No image provided to copy".into());
            };

            let canonical = fs::canonicalize(&image_path).unwrap_or(image_path);
            let display = canonical.to_string_lossy();
            let clean = display.strip_prefix(r"\\?\").unwrap_or(&display).to_string();

            let mut ps = Command::new("powershell.exe");
            ps.creation_flags(0x08000000);
            let script = "Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $img = [System.Drawing.Image]::FromFile($env:SIGHTLINE_CLIP_IMG); try { [System.Windows.Forms.Clipboard]::SetImage($img) } finally { $img.Dispose() }";
            let output = ps
                .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", script])
                .env("SIGHTLINE_CLIP_IMG", &clean)
                .output();
            if created_temp {
                let _ = fs::remove_file(&temp_png);
            }
            let output = output.map_err(|e| format!("Could not access clipboard: {e}"))?;
            if output.status.success() {
                Ok(())
            } else {
                Err(format!(
                    "Could not copy image to clipboard: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ))
            }
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, file, png_bytes);
        Err("Native image clipboard fallback is only configured for Windows".into())
    }
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
    #[serde(default)]
    notes: String,
    #[serde(default)]
    annotations: Vec<serde_json::Value>,
}
fn inbox(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().download_dir().map_err(|e| e.to_string())?.join("Sightline").join("inbox");
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&config).map_err(|e| e.to_string())?;
    fs::write(config.join("capture-inbox.txt"), dir.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    Ok(dir)
}
fn valid_capture(c: &Capture) -> bool {
    let extensions: &[&str] = match c.kind.as_str() {
        "image" => &["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "avif", "ico"][..],
        "video" => &["webm", "mp4"][..],
        "font" => FONT_EXTENSIONS,
        _ => return false,
    };
    uuid::Uuid::parse_str(&c.id).is_ok()
        && extensions
            .iter()
            .any(|ext| c.file == format!("{}.{}", c.id, ext))
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemFontVariant {
    family: String,
    full_name: String,
    weight: u16,
    style: String,
    path: String,
    format: String,
}

fn infer_font_weight_and_style(label: &str) -> (String, u16, String) {
    let mut clean = label
        .replace("(TrueType)", "")
        .replace("(OpenType)", "")
        .replace("(All res)", "")
        .trim()
        .to_string();
    if let Some((first, _)) = clean.split_once('&') {
        clean = first.trim().to_string();
    }
    let full_name = clean.clone();
    let lower = clean.to_ascii_lowercase();
    let style = if lower.contains("italic") || lower.contains("oblique") {
        "italic".to_string()
    } else {
        "normal".to_string()
    };
    let weight = if lower.contains("thin") || lower.contains("hairline") {
        100
    } else if lower.contains("extralight") || lower.contains("extra light") || lower.contains("ultralight") || lower.contains("ultra light") {
        200
    } else if lower.contains("semilight") || lower.contains("semi light") {
        350
    } else if lower.contains("light") {
        300
    } else if lower.contains("semibold") || lower.contains("semi bold") || lower.contains("demibold") || lower.contains("demi bold") {
        600
    } else if lower.contains("extrabold") || lower.contains("extra bold") || lower.contains("ultrabold") || lower.contains("ultra bold") {
        800
    } else if lower.contains("bold") {
        700
    } else if lower.contains("medium") {
        500
    } else if lower.contains("black") || lower.contains("heavy") {
        900
    } else {
        400
    };
    let mut family = clean;
    for suffix in [
        "ExtraLight Italic", "Extra Light Italic", "UltraLight Italic", "Ultra Light Italic",
        "SemiLight Italic", "Semi Light Italic", "SemiBold Italic", "Semi Bold Italic",
        "DemiBold Italic", "Demi Bold Italic", "ExtraBold Italic", "Extra Bold Italic",
        "UltraBold Italic", "Ultra Bold Italic", "Thin Italic", "Hairline Italic",
        "Light Italic", "Medium Italic", "Bold Italic", "Black Italic", "Heavy Italic",
        "ExtraLight", "Extra Light", "UltraLight", "Ultra Light",
        "SemiLight", "Semi Light", "SemiBold", "Semi Bold",
        "DemiBold", "Demi Bold", "ExtraBold", "Extra Bold",
        "UltraBold", "Ultra Bold", "Hairline", "Thin", "Light", "Regular", "Normal",
        "Medium", "Bold", "Black", "Heavy", "Italic", "Oblique", "Roman",
    ] {
        if family.len() > suffix.len() {
            let tail_start = family.len() - suffix.len();
            if family
                .get(tail_start..)
                .map(|tail| tail.eq_ignore_ascii_case(suffix))
                .unwrap_or(false)
                && family.as_bytes().get(tail_start.saturating_sub(1)).copied() == Some(b' ')
            {
                family = family[..tail_start].trim().to_string();
                break;
            }
        }
    }
    if family.is_empty() {
        family = full_name.clone();
    }
    (family, weight, style)
}

fn parse_windows_font_reg_line(line: &str, windows_fonts_dir: &Path) -> Option<SystemFontVariant> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let idx = trimmed.find("REG_SZ")?;
    let name_part = trimmed[..idx].trim();
    let file_part = trimmed[idx + "REG_SZ".len()..].trim();
    if name_part.is_empty() || file_part.is_empty() {
        return None;
    }
    let resolved = {
        let p = PathBuf::from(file_part);
        if p.is_absolute() {
            p
        } else {
            windows_fonts_dir.join(p)
        }
    };
    let ext = resolved
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if !is_font_ext(&ext) {
        return None;
    }
    let (family, weight, style) = infer_font_weight_and_style(name_part);
    let full_name = name_part
        .replace("(TrueType)", "")
        .replace("(OpenType)", "")
        .replace("(All res)", "")
        .trim()
        .to_string();
    Some(SystemFontVariant {
        family,
        full_name,
        weight,
        style,
        path: resolved.to_string_lossy().into_owned(),
        format: ext.to_ascii_uppercase(),
    })
}

fn system_font_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(windir) = std::env::var_os("WINDIR") {
        dirs.push(PathBuf::from(windir).join("Fonts"));
    } else {
        dirs.push(PathBuf::from(r"C:\Windows\Fonts"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        dirs.push(PathBuf::from(local).join("Microsoft").join("Windows").join("Fonts"));
    }
    dirs
}

#[tauri::command]
async fn list_system_fonts() -> Result<Vec<SystemFontVariant>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut variants = Vec::new();
        let mut seen_paths = std::collections::HashSet::<String>::new();
        #[cfg(target_os = "windows")]
        {
            let dirs = system_font_dirs();
            let win_fonts = dirs.first().cloned().unwrap_or_else(|| PathBuf::from(r"C:\Windows\Fonts"));
            for (hive, key) in [
                (winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE), r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"),
                (winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER), r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"),
            ] {
                let Ok(fonts_key) = hive.open_subkey(key) else { continue };
                for (name, value) in fonts_key.enum_values().flatten() {
                    let Ok(file) = <String as winreg::types::FromRegValue>::from_reg_value(&value) else { continue };
                    let line = format!("{name}    REG_SZ    {file}");
                    if let Some(item) = parse_windows_font_reg_line(&line, &win_fonts) {
                        if Path::new(&item.path).is_file() && seen_paths.insert(item.path.to_ascii_lowercase()) {
                            variants.push(item);
                        }
                    }
                }
            }
            for dir in dirs {                if let Ok(entries) = fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if !p.is_file() {
                            continue;
                        }
                        let ext = p
                            .extension()
                            .and_then(|s| s.to_str())
                            .map(|s| s.to_ascii_lowercase())
                            .unwrap_or_default();
                        if !is_font_ext(&ext) {
                            continue;
                        }
                        let path_str = p.to_string_lossy().into_owned();
                        if !seen_paths.insert(path_str.to_ascii_lowercase()) {
                            continue;
                        }
                        let stem = p
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Font")
                            .replace(['_', '-'], " ");
                        let (family, weight, style) = infer_font_weight_and_style(&stem);
                        variants.push(SystemFontVariant {
                            family,
                            full_name: stem,
                            weight,
                            style,
                            path: path_str,
                            format: ext.to_ascii_uppercase(),
                        });
                    }
                }
            }
        }
        variants.sort_by(|a, b| {
            a.family
                .to_ascii_lowercase()
                .cmp(&b.family.to_ascii_lowercase())
                .then(a.style.cmp(&b.style))
                .then(a.weight.cmp(&b.weight))
                .then(a.full_name.cmp(&b.full_name))
        });
        Ok(variants)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_system_font(
    app: tauri::AppHandle,
    path: String,
    folder: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let candidate = PathBuf::from(&path);
        let canonical = fs::canonicalize(&candidate).map_err(|_| "System font file not found".to_string())?;
        if !canonical.is_file() {
            return Err("System font file not found".into());
        }
        let ext = canonical
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        if !is_font_ext(&ext) {
            return Err("Unsupported font format".into());
        }
        let allowed = system_font_dirs().into_iter().any(|dir| {
            fs::canonicalize(&dir)
                .map(|cdir| canonical.starts_with(&cdir))
                .unwrap_or(false)
        });
        if !allowed {
            return Err("Font path is outside Windows font folders".into());
        }
        import_asset_impl(app, canonical.to_string_lossy().into_owned(), folder)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleFontEntry {
    family: String,
    category: String,
    variants: Vec<String>,
    popularity: u32,
    designers: Vec<String>,
}

fn parse_google_fonts_metadata(raw: &str) -> Result<Vec<GoogleFontEntry>, String> {
    let trimmed = raw.trim_start();
    let json_text = trimmed.strip_prefix(")]}'").unwrap_or(trimmed).trim_start();
    let parsed: serde_json::Value =
        serde_json::from_str(json_text).map_err(|e| format!("Invalid Google Fonts catalog: {e}"))?;
    let list = parsed["familyMetadataList"]
        .as_array()
        .ok_or("Missing Google Fonts family list")?;
    let mut entries = Vec::with_capacity(list.len());
    for item in list {
        let Some(family) = item["family"].as_str().map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        let category = item["category"].as_str().unwrap_or("Sans Serif").to_string();
        let popularity = item["popularity"].as_u64().unwrap_or(9999) as u32;
        let designers = item["designers"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut variants: Vec<String> = item["fonts"]
            .as_object()
            .map(|map| map.keys().cloned().collect())
            .unwrap_or_default();
        variants.sort_by_key(|v| {
            let is_italic = v.ends_with('i');
            let weight: u16 = v.trim_end_matches('i').parse().unwrap_or(400);
            (is_italic, weight)
        });
        if variants.is_empty() {
            variants.push("400".to_string());
        }
        entries.push(GoogleFontEntry {
            family: family.to_string(),
            category,
            variants,
            popularity,
            designers,
        });
    }
    entries.sort_by_key(|e| e.popularity);
    Ok(entries)
}

#[tauri::command]
async fn fetch_google_fonts_catalog(app: tauri::AppHandle) -> Result<Vec<GoogleFontEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let cache = dir.join("google-fonts-catalog.json");
        if let Ok(meta) = fs::metadata(&cache) {
            if let Ok(modified) = meta.modified() {
                if modified.elapsed().map(|d| d.as_secs() < 86400).unwrap_or(false) {
                    if let Ok(raw) = fs::read_to_string(&cache) {
                        if let Ok(entries) = serde_json::from_str::<Vec<GoogleFontEntry>>(&raw) {
                            if !entries.is_empty() {
                                return Ok(entries);
                            }
                        }
                    }
                }
            }
        }
        let mut cmd = Command::new("curl.exe");
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        let fetched = cmd
            .args([
                "-fsSL",
                "--max-time",
                "15",
                "https://fonts.google.com/metadata/fonts",
            ])
            .output();
        match fetched {
            Ok(out) if out.status.success() => {
                let raw = String::from_utf8_lossy(&out.stdout);
                let entries = parse_google_fonts_metadata(&raw)?;
                if let Ok(serialized) = serde_json::to_vec(&entries) {
                    let _ = fs::write(&cache, serialized);
                }
                Ok(entries)
            }
            _ => {
                if let Ok(raw) = fs::read_to_string(&cache) {
                    if let Ok(entries) = serde_json::from_str::<Vec<GoogleFontEntry>>(&raw) {
                        return Ok(entries);
                    }
                }
                Err("Could not fetch Google Fonts catalog. Check your internet connection.".into())
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ParsedGoogleFontFace {
    style: String,
    weight: u16,
    url: String,
}

fn parse_google_font_css(css: &str) -> Vec<ParsedGoogleFontFace> {
    let mut faces = Vec::new();
    for block in css.split("@font-face") {
        let Some(body) = block.split('{').nth(1).and_then(|s| s.split('}').next()) else {
            continue;
        };
        let mut style = "normal".to_string();
        let mut weight: u16 = 400;
        let mut font_url = String::new();
        for line in body.split(';') {
            let trimmed = line.trim();
            if let Some(val) = trimmed.strip_prefix("font-style:") {
                let v = val.trim().to_ascii_lowercase();
                if v == "italic" || v == "oblique" {
                    style = "italic".to_string();
                }
            } else if let Some(val) = trimmed.strip_prefix("font-weight:") {
                let first = val.trim().split_whitespace().next().unwrap_or("400");
                if let Ok(w) = first.parse::<u16>() {
                    weight = w;
                }
            } else if let Some(val) = trimmed.strip_prefix("src:") {
                if let Some(start) = val.find("url(") {
                    let after = &val[start + 4..];
                    if let Some(end) = after.find(')') {
                        let candidate = after[..end].trim().trim_matches(|c| c == '"' || c == '\'');
                        if candidate.starts_with("https://fonts.gstatic.com/") {
                            font_url = candidate.to_string();
                        }
                    }
                }
            }
        }
        if !font_url.is_empty() {
            faces.push(ParsedGoogleFontFace {
                style,
                weight,
                url: font_url,
            });
        }
    }
    faces
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedFontVariant {
    file: String,
    name: String,
    family: String,
    weight: u16,
    style: String,
}

#[tauri::command]
async fn import_google_font(
    app: tauri::AppHandle,
    family: String,
    variants: Vec<String>,
    folder: Option<String>,
) -> Result<Vec<ImportedFontVariant>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let clean_family = family.trim();
        if clean_family.is_empty() || clean_family.len() > 120 {
            return Err("Invalid font family name".into());
        }
        let mut tuples: Vec<(u8, u16)> = variants
            .iter()
            .filter_map(|v| {
                let trim = v.trim().to_ascii_lowercase();
                let is_italic = trim.ends_with('i') || trim.ends_with("italic");
                let digits: String = trim.chars().take_while(|c| c.is_ascii_digit()).collect();
                let w = if digits.is_empty() { 400 } else { digits.parse::<u16>().ok()? };
                Some((if is_italic { 1 } else { 0 }, w.clamp(100, 1000)))
            })
            .collect();
        if tuples.is_empty() {
            tuples.push((0, 400));
        }
        tuples.sort();
        tuples.dedup();
        let has_italic = tuples.iter().any(|(it, _)| *it == 1);
        let axis_spec = if has_italic {
            let parts: Vec<String> = tuples.iter().map(|(it, w)| format!("{it},{w}")).collect();
            format!("ital,wght@{}", parts.join(";"))
        } else {
            let parts: Vec<String> = tuples.iter().map(|(_, w)| w.to_string()).collect();
            format!("wght@{}", parts.join(";"))
        };
        let mut css_url = url::Url::parse("https://fonts.googleapis.com/css2").map_err(|e| e.to_string())?;
        css_url
            .query_pairs_mut()
            .append_pair("family", &format!("{clean_family}:{axis_spec}"));

        let mut cmd = Command::new("curl.exe");
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        let css_out = cmd
            .args(["-fsSL", "--max-time", "15", css_url.as_str()])
            .output()
            .map_err(|e| format!("Could not download Google Font CSS: {e}"))?;
        if !css_out.status.success() {
            return Err(format!(
                "Could not fetch \"{clean_family}\" from Google Fonts. Try selecting fewer weights."
            ));
        }
        let css = String::from_utf8_lossy(&css_out.stdout);
        let faces = parse_google_font_css(&css);
        if faces.is_empty() {
            return Err("No downloadable font files returned by Google Fonts".into());
        }

        let mut imported = Vec::new();
        for face in faces {
            let parsed_font_url = url::Url::parse(&face.url).map_err(|_| "Invalid font file URL")?;
            if parsed_font_url.scheme() != "https" || parsed_font_url.host_str() != Some("fonts.gstatic.com") {
                continue;
            }
            let ext = Path::new(parsed_font_url.path())
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase())
                .filter(|s| is_font_ext(s))
                .unwrap_or_else(|| "ttf".to_string());
            let temp = std::env::temp_dir().join(format!("sightline-gf-{}.{}", uuid::Uuid::new_v4(), ext));
            let mut dl = Command::new("curl.exe");
            #[cfg(target_os = "windows")]
            dl.creation_flags(0x08000000);
            let dl_out = dl
                .args(["-fsSL", "--max-time", "20", "-o"])
                .arg(&temp)
                .arg(parsed_font_url.as_str())
                .output();
            let import_res = match dl_out {
                Ok(out) if out.status.success() && temp.is_file() => {
                    import_asset_impl(app.clone(), temp.to_string_lossy().into_owned(), folder.clone())
                }
                _ => Err(format!("Failed to download weight {}", face.weight)),
            };
            let _ = fs::remove_file(&temp);
            let file = import_res?;
            let style_label = if face.style == "italic" { " Italic" } else { "" };
            imported.push(ImportedFontVariant {
                file,
                name: format!("{clean_family} {}{}", face.weight, style_label),
                family: clean_family.to_string(),
                weight: face.weight,
                style: face.style,
            });
        }
        if imported.is_empty() {
            return Err("No font variants could be imported".into());
        }
        Ok(imported)
    })
    .await
    .map_err(|e| e.to_string())?
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
async fn import_capture(app: tauri::AppHandle, capture: Capture, folder: Option<String>) -> Result<String, String> {
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
            let root = library_path(&app)?;
            let clean_folder = folder
                .as_deref()
                .map(str::trim)
                .filter(|f| !f.is_empty())
                .map(sanitize_folder_name);
            let target_dir = match clean_folder {
                Some(ref f) => root.join("assets").join(f),
                None => root.join("assets"),
            };
            fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
            let name = format!("{}.mp4", uuid::Uuid::new_v4());
            let dest = target_dir.join(&name);
            fs::copy(&path, dest).map_err(|e| e.to_string())?;
            Ok(match clean_folder {
                Some(f) => format!("{f}/{name}"),
                None => name,
            })
        } else {
            import_asset_impl(app, path, folder)
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
    #[cfg(target_os = "windows")]
    if std::env::args().any(|arg| arg == "--discover-refresh") {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let dir = PathBuf::from(appdata).join("com.sightline.app");
            let stamp = dir.join("discover-scheduled-success.txt");
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
            let last = fs::read_to_string(&stamp).ok().and_then(|x| x.parse::<u64>().ok()).unwrap_or(0);
            if now.saturating_sub(last) >= 86400 {
                let result = run_discover_refresh(&dir.join("discover-sites.json"));
                if let Ok(ref output) = result {
                    if serde_json::from_str::<serde_json::Value>(output).map(|v| !v["possibleGap"].as_bool().unwrap_or(true) && !v["lapaFeedError"].as_bool().unwrap_or(true) && v["bookmarkErrors"].as_u64().unwrap_or(1)==0 && v["indexErrors"].as_u64().unwrap_or(1)==0 && v["cssErrors"].as_u64().unwrap_or(1)==0).unwrap_or(false) {
                        let _ = fs::write(&stamp, now.to_string());
                    }
                }
                let _ = fs::write(dir.join("discover-scheduled-status.txt"), format!("{now}: {:?}", result));
            }
            let instagram_stamp=dir.join("instagram-scan-success.txt");
            let instagram_last=fs::read_to_string(&instagram_stamp).ok().and_then(|x|x.parse::<u64>().ok()).unwrap_or(0);
            let instagram_attempt=fs::read_to_string(dir.join("instagram-scan-attempt.txt")).ok().and_then(|x|x.parse::<u64>().ok()).unwrap_or(0);
            if now.saturating_sub(instagram_last)>=7*86400 && now.saturating_sub(instagram_attempt)>=86400 {
                if let Ok(config)=fs::read(dir.join("instagram-sync-config.json")) {
                    if let Ok(collections)=serde_json::from_slice::<Vec<InstagramCollection>>(&config) {
                        use std::net::ToSocketAddrs;
                        let instagram_online=("www.instagram.com",443).to_socket_addrs().ok().map(|mut addresses|addresses.any(|address|std::net::TcpStream::connect_timeout(&address,std::time::Duration::from_secs(2)).is_ok())).unwrap_or(false);
                        if !instagram_online { return; }
                        let result=scan_instagram_at(&dir,&collections,false);
                        let complete=result.as_ref().map(|state|collections.iter().all(|c|state["collections"][&c.name]["status"]=="complete")).unwrap_or(false);
                        let _=fs::write(dir.join("instagram-scheduled-status.txt"),if complete{"Instagram scan completed; open Sightline to process the queue."}else{"Instagram scan failed; sign in and retry in Sightline."});
                    }
                }
            }
        }
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            refresh_discover_catalog,
            add_discover_site,
            setup_discover_schedule,
            load_discover_catalog,
            discover_images_dir,
            load_discover_palettes,
            initialize_discover_catalog,
            scan_instagram_collections,
            load_instagram_queue,
            acknowledge_instagram_posts,
            backup_to_drive,
            restore_drive_backup,
            get_library,
            fetch_favicon,
            set_library,
            load_library,
            save_library,
            rename_source_folder,
            open_url,
            import_asset,
            import_asset_bytes,
            download_post_media,
            install_font,
            list_system_fonts,
            import_system_font,
            fetch_google_fonts_catalog,
            import_google_font,
            prepare_preview,
            delete_asset_file,
            reveal_asset_file,
            get_asset_path,
            copy_image_to_clipboard,
            pending_captures,
            import_capture,
            acknowledge_capture,
            set_video_thumbnail,
            reset_video_thumbnail
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Sightline");
}

#[cfg(test)]
mod font_name_tests {
    use super::*;
    #[test]
    fn non_ascii_family_names_do_not_panic() {
        for name in ["แบบอักษรไทย Regular (TrueType)", "ก Bold (TrueType)", "خط عربي (TrueType)", "ไทย", "Noto Sans Thai Bold (TrueType)"] {
            let (family, _, _) = infer_font_weight_and_style(name);
            assert!(!family.is_empty());
        }
        assert_eq!(infer_font_weight_and_style("Noto Sans Thai Bold (TrueType)").0, "Noto Sans Thai");
    }
}

#[cfg(test)]
mod capture_tests {
    use super::*;
    #[test]
    fn rendered_mp4_is_accepted_but_untrusted_paths_are_not() {
        let id = uuid::Uuid::new_v4().to_string();
        let mut c = Capture { id: id.clone(), file: format!("{id}.mp4"), title: "Example".into(), url: String::new(), kind: "video".into(), name: String::new(), tags: vec![], category: String::new(), notes: String::new(), annotations: vec![] };
        assert!(valid_capture(&c));
        c.file = format!("../{id}.mp4");
        assert!(!valid_capture(&c));
        c.file = format!("{id}.exe");
        assert!(!valid_capture(&c));
        c.kind = "image".into();
        for ext in ["jpg", "webp", "gif", "svg", "avif"] {
            c.file = format!("{id}.{ext}");
            assert!(valid_capture(&c));
        }
        c.file = format!("../{id}.gif");
        assert!(!valid_capture(&c));
    }

    #[test]
    fn font_extensions_and_registry_parsing_work_across_formats_and_weights() {
        for ext in ["ttf", "otf", "woff", "woff2", "eot", "ttc", "dfont", "pfb"] {
            assert!(is_font_ext(ext), "expected {ext} to be recognized");
        }
        assert!(!is_font_ext("exe"));

        let win_fonts = Path::new(r"C:\Windows\Fonts");
        let parsed = parse_windows_font_reg_line(
            "    Arial Bold Italic (TrueType)    REG_SZ    arialbi.ttf",
            win_fonts,
        )
        .expect("registry font line should parse");
        assert_eq!(parsed.family, "Arial");
        assert_eq!(parsed.weight, 700);
        assert_eq!(parsed.style, "italic");
        assert_eq!(parsed.format, "TTF");
        assert_eq!(parsed.path, r"C:\Windows\Fonts\arialbi.ttf");

        let semilight = parse_windows_font_reg_line(
            "    Segoe UI Semilight (TrueType)    REG_SZ    segoeuisl.ttf",
            win_fonts,
        )
        .expect("semilight font line should parse");
        assert_eq!(semilight.family, "Segoe UI");
        assert_eq!(semilight.weight, 350);
        assert_eq!(semilight.style, "normal");
    }

    #[test]
    fn google_fonts_css_parser_extracts_styles_weights_and_gstatic_urls() {
        let sample = r#"
@font-face {
  font-family: 'Inter';
  font-style: italic;
  font-weight: 600;
  src: url(https://fonts.gstatic.com/s/inter/v20/italic600.ttf) format('truetype');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/inter/v20/bold700.ttf) format('truetype');
}
@font-face {
  font-family: 'Evil';
  font-style: normal;
  font-weight: 400;
  src: url(https://evil.example/font.ttf) format('truetype');
}
"#;
        let faces = parse_google_font_css(sample);
        assert_eq!(faces.len(), 2);
        assert_eq!(
            faces[0],
            ParsedGoogleFontFace {
                style: "italic".into(),
                weight: 600,
                url: "https://fonts.gstatic.com/s/inter/v20/italic600.ttf".into(),
            }
        );
        assert_eq!(faces[1].weight, 700);
    }

    #[test]
    fn sanitize_and_safe_asset_path_handle_subfolders_and_reject_traversal() {
        assert_eq!(
            sanitize_folder_name("Extrafazant | Social Content, Video's & Animatie"),
            "Extrafazant Social Content, Video's & Animatie"
        );
        assert_eq!(sanitize_folder_name("CON"), "CON source");
        assert_eq!(sanitize_folder_name("...   "), "Untitled");

        let root = std::env::temp_dir().join("sightline-safe-path-test");
        assert!(safe_asset_path(&root, "abc.webp").is_ok());
        let nested = safe_asset_path(&root, "Revolut/abc.webp").unwrap();
        assert_eq!(nested.1, "Revolut/abc.webp");
        assert_eq!(nested.0, root.join("assets").join("Revolut").join("abc.webp"));
        assert!(safe_asset_path(&root, "../secret.txt").is_err());
        assert!(safe_asset_path(&root, "a/b/c.webp").is_err());
        assert!(safe_asset_path(&root, "/abs.webp").is_err());
        assert!(safe_asset_path(&root, "").is_err());
    }

    #[test]
    fn organize_library_assets_migrates_flat_files_and_linked_fonts() {
        let root = std::env::temp_dir().join(format!("sightline-org-test-{}", uuid::Uuid::new_v4()));
        let assets = root.join("assets");
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join("a1.webp"), b"img1").unwrap();
        fs::write(assets.join("font1.woff2"), b"fontdata").unwrap();
        fs::write(assets.join("ig1.mp4"), b"vid1").unwrap();
        fs::write(assets.join("ig2.webp"), b"img2").unwrap();

        let library = serde_json::json!([
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "title": "Extrafazant | Social Content",
                "url": "https://extrafazant.nl/",
                "assets": [
                    { "id": "a1", "file": "a1.webp", "kind": "image", "name": "Shot" },
                    { "id": "f1", "file": "font1.woff2", "kind": "font", "name": "Inter" }
                ]
            },
            {
                "id": "22222222-2222-2222-2222-222222222222",
                "title": "Instagram post",
                "url": "https://www.instagram.com/p/AAA/",
                "assets": [
                    { "id": "i1", "file": "ig1.mp4", "kind": "video", "name": "Clip" }
                ]
            },
            {
                "id": "33333333-3333-3333-3333-333333333333",
                "title": "Instagram post",
                "url": "https://www.instagram.com/p/BBB/",
                "assets": [
                    { "id": "i2", "file": "ig2.webp", "kind": "image", "name": "Post" },
                    { "id": "f2", "file": "font1.woff2", "kind": "font", "name": "Inter" }
                ]
            }
        ]);
        fs::write(root.join("library.json"), serde_json::to_string_pretty(&library).unwrap()).unwrap();

        organize_library_assets_at(&root).unwrap();

        let updated: serde_json::Value = serde_json::from_str(&fs::read_to_string(root.join("library.json")).unwrap()).unwrap();
        assert_eq!(updated[0]["folder"], "Extrafazant Social Content");
        assert_eq!(updated[0]["assets"][0]["file"], "Extrafazant Social Content/a1.webp");
        assert_eq!(updated[0]["assets"][1]["file"], "Extrafazant Social Content/font1.woff2");
        assert_eq!(updated[1]["folder"], "Instagram post");
        assert_eq!(updated[1]["assets"][0]["file"], "Instagram post/ig1.mp4");
        assert_eq!(updated[2]["folder"], "Instagram post (333333)");
        assert_eq!(updated[2]["assets"][0]["file"], "Instagram post (333333)/ig2.webp");
        assert_eq!(updated[2]["assets"][1]["file"], "Extrafazant Social Content/font1.woff2");

        assert!(assets.join("Extrafazant Social Content").join("a1.webp").is_file());
        assert!(assets.join("Extrafazant Social Content").join("font1.woff2").is_file());
        assert!(assets.join("Instagram post").join("ig1.mp4").is_file());
        assert!(assets.join("Instagram post (333333)").join("ig2.webp").is_file());
        assert!(!assets.join("a1.webp").exists());
        assert!(!assets.join("font1.woff2").exists());

        // Calling organize again should be a clean idempotent no-op
        organize_library_assets_at(&root).unwrap();
        let _ = fs::remove_dir_all(&root);
    }
}
