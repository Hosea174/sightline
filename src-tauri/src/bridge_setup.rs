//! Manages the bundled Chrome/Brave extension folder, native messaging host manifest, and browser registry entries.

use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::Manager;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedExtension {
    pub id: String,
    pub browser: String,
    pub profile: String,
    pub path: String,
    pub registered: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSetupStatus {
    pub connected: bool,
    pub registered_ids: Vec<String>,
    pub detected: Vec<DetectedExtension>,
    pub extension_dir: String,
    pub bridge_ready: bool,
    pub bridge_path: Option<String>,
}

pub fn valid_extension_id(raw: &str) -> bool {
    raw.len() == 32 && raw.bytes().all(|b| (b'a'..=b'p').contains(&b))
}

pub fn normalize_extension_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let candidate = trimmed
        .strip_prefix("chrome-extension://")
        .unwrap_or(trimmed)
        .trim_end_matches('/');
    let lower = candidate.to_ascii_lowercase();
    if valid_extension_id(&lower) {
        Ok(lower)
    } else {
        Err("Enter the 32-character Extension ID from chrome://extensions or brave://extensions.".into())
    }
}

pub fn sightline_local_dir() -> Result<PathBuf, String> {
    let local = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .ok_or("LOCALAPPDATA unavailable")?;
    Ok(PathBuf::from(local).join("Sightline"))
}

pub fn managed_extension_dir() -> Result<PathBuf, String> {
    Ok(sightline_local_dir()?.join("extension"))
}

pub fn native_host_manifest_path() -> Result<PathBuf, String> {
    Ok(sightline_local_dir()?.join("native-host.json"))
}

pub fn find_bridge_exe() -> Option<PathBuf> {
    let exe_name = if cfg!(windows) {
        "sightline-bridge.exe"
    } else {
        "sightline-bridge"
    };
    let triple_name = if cfg!(windows) {
        "sightline-bridge-x86_64-pc-windows-msvc.exe"
    } else {
        "sightline-bridge"
    };

    if let Ok(current) = std::env::current_exe() {
        if let Some(dir) = current.parent() {
            for candidate_name in [exe_name, triple_name] {
                let sibling = dir.join(candidate_name);
                if sibling.is_file() {
                    return Some(sibling);
                }
            }
            for ancestor in current.ancestors().skip(1).take(5) {
                for rel in [
                    "target/release/sightline-bridge.exe",
                    "target/debug/sightline-bridge.exe",
                    "src-tauri/target/release/sightline-bridge.exe",
                    "src-tauri/target/debug/sightline-bridge.exe",
                    "src-tauri/binaries/sightline-bridge-x86_64-pc-windows-msvc.exe",
                ] {
                    let candidate = ancestor.join(rel);
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
        }
    }
    None
}

fn resolve_bundled_extension_source(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(res_dir) = app.path().resource_dir() {
        for sub in ["resources/extension", "extension"] {
            let candidate = res_dir.join(sub);
            if candidate.join("manifest.json").is_file() && candidate.join("ui").join("ui.js").is_file() {
                return Some(candidate);
            }
        }
    }
    if let Ok(current) = std::env::current_exe() {
        for ancestor in current.ancestors().skip(1).take(6) {
            for rel in ["src-tauri/resources/extension", "extension"] {
                let candidate = ancestor.join(rel);
                if candidate.join("manifest.json").is_file() && candidate.join("ui").join("ui.js").is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn sync_directory(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    let mut keep = std::collections::HashSet::new();
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        keep.insert(name.clone());
        let src_path = entry.path();
        let dst_path = dst.join(&name);
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        if ty.is_dir() {
            if dst_path.is_file() {
                let _ = fs::remove_file(&dst_path);
            }
            sync_directory(&src_path, &dst_path)?;
        } else if ty.is_file() {
            if dst_path.is_dir() {
                let _ = fs::remove_dir_all(&dst_path);
            }
            fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    if let Ok(entries) = fs::read_dir(dst) {
        for entry in entries.flatten() {
            if !keep.contains(&entry.file_name()) {
                let p = entry.path();
                if p.is_dir() {
                    let _ = fs::remove_dir_all(p);
                } else {
                    let _ = fs::remove_file(p);
                }
            }
        }
    }
    Ok(())
}

pub fn sync_bundled_extension(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dst = managed_extension_dir()?;
    if let Some(src) = resolve_bundled_extension_source(app) {
        sync_directory(&src, &dst)?;
    } else if !dst.join("manifest.json").is_file() {
        return Err("Bundled extension files were not found in this build.".into());
    }
    Ok(dst)
}

fn parse_origin_id(origin: &str) -> Option<String> {
    let trimmed = origin.trim();
    let rest = trimmed.strip_prefix("chrome-extension://")?;
    let id = rest.strip_suffix('/')?;
    let lower = id.to_ascii_lowercase();
    valid_extension_id(&lower).then_some(lower)
}

pub fn read_registered_ids_from(manifest_path: &Path) -> Vec<String> {
    let Ok(raw) = fs::read_to_string(manifest_path) else {
        return Vec::new();
    };
    let Ok(val) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    let mut ids = BTreeSet::new();
    if let Some(arr) = val["allowed_origins"].as_array() {
        for item in arr {
            if let Some(origin) = item.as_str() {
                if let Some(id) = parse_origin_id(origin) {
                    ids.insert(id);
                }
            }
        }
    }
    ids.into_iter().collect()
}

pub fn write_manifest_atomic(manifest_path: &Path, bridge_exe: &Path, ids: &[String]) -> Result<(), String> {
    if let Some(parent) = manifest_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let clean_bridge = {
        let s = bridge_exe.to_string_lossy();
        s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
    };
    let origins: Vec<String> = ids
        .iter()
        .map(|id| format!("chrome-extension://{id}/"))
        .collect();
    let payload = json!({
        "name": "com.sightline.capture",
        "description": "Sightline local capture bridge",
        "path": clean_bridge,
        "type": "stdio",
        "allowed_origins": origins
    });
    let serialized = serde_json::to_vec_pretty(&payload).map_err(|e| e.to_string())?;
    let tmp = manifest_path.with_extension(format!("json.{}.part", uuid::Uuid::new_v4()));
    fs::write(&tmp, serialized).map_err(|e| e.to_string())?;
    if let Err(e) = fs::rename(&tmp, manifest_path) {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn register_native_messaging_keys(manifest_path: &Path) -> Result<(), String> {
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let clean_manifest = {
        let s = manifest_path.to_string_lossy();
        s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
    };
    for subkey in [
        r"Software\Google\Chrome\NativeMessagingHosts\com.sightline.capture",
        r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.sightline.capture",
        r"Software\Microsoft\Edge\NativeMessagingHosts\com.sightline.capture",
    ] {
        let (key, _) = hkcu.create_subkey(subkey).map_err(|e| e.to_string())?;
        key.set_value("", &clean_manifest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn register_native_messaging_keys(_manifest_path: &Path) -> Result<(), String> {
    Ok(())
}

pub fn refresh_existing_bridge_manifest() -> Result<(), String> {
    let manifest_path = native_host_manifest_path()?;
    if !manifest_path.is_file() {
        return Ok(());
    }
    let Some(bridge_exe) = find_bridge_exe() else {
        return Ok(());
    };
    let ids = read_registered_ids_from(&manifest_path);
    if ids.is_empty() {
        return Ok(());
    }
    write_manifest_atomic(&manifest_path, &bridge_exe, &ids)?;
    register_native_messaging_keys(&manifest_path)
}

pub fn scan_preferences_json(
    raw: &str,
    browser: &str,
    profile: &str,
    registered_set: &BTreeSet<String>,
) -> Vec<DetectedExtension> {
    let Ok(val) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    let Some(settings) = val["extensions"]["settings"].as_object() else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for (id, entry) in settings {
        let lower = id.to_ascii_lowercase();
        if !valid_extension_id(&lower) {
            continue;
        }
        let manifest_name = entry["manifest"]["name"].as_str().unwrap_or("");
        let path_str = entry["path"].as_str().unwrap_or("");
        let path_norm = path_str.replace('\\', "/").to_ascii_lowercase();
        let is_sightline = manifest_name == "Sightline Capture"
            || path_norm.ends_with("/sightline/extension");
        if !is_sightline {
            continue;
        }
        found.push(DetectedExtension {
            id: lower.clone(),
            browser: browser.to_string(),
            profile: profile.to_string(),
            path: path_str.to_string(),
            registered: registered_set.contains(&lower),
        });
    }
    found
}

fn detect_browser_extensions(registered_ids: &[String]) -> Vec<DetectedExtension> {
    let mut results = Vec::new();
    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let base = PathBuf::from(local);
        let browsers = [
            ("Chrome", base.join("Google").join("Chrome").join("User Data")),
            ("Brave", base.join("BraveSoftware").join("Brave-Browser").join("User Data")),
            ("Edge", base.join("Microsoft").join("Edge").join("User Data")),
        ];
        let registered_set: BTreeSet<String> = registered_ids.iter().cloned().collect();
        let mut seen = std::collections::HashSet::new();
        for (browser, user_data) in browsers {
            let Ok(entries) = fs::read_dir(&user_data) else {
                continue;
            };
            for entry in entries.flatten() {
                let profile_dir = entry.path();
                if !profile_dir.is_dir() {
                    continue;
                }
                let profile_name = entry.file_name().to_string_lossy().into_owned();
                if profile_name != "Default" && !profile_name.starts_with("Profile ") {
                    continue;
                }
                for pref_name in ["Preferences", "Secure Preferences"] {
                    let pref_path = profile_dir.join(pref_name);
                    if let Ok(raw) = fs::read_to_string(&pref_path) {
                        for item in scan_preferences_json(&raw, browser, &profile_name, &registered_set) {
                            if seen.insert((item.id.clone(), item.browser.clone())) {
                                results.push(item);
                            }
                        }
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = registered_ids;
    results
}

fn build_status(app: Option<&tauri::AppHandle>) -> Result<ExtensionSetupStatus, String> {
    let ext_dir = match app {
        Some(handle) => sync_bundled_extension(handle).unwrap_or(managed_extension_dir()?),
        None => managed_extension_dir()?,
    };
    let manifest_path = native_host_manifest_path()?;
    let registered_ids = read_registered_ids_from(&manifest_path);
    let bridge = find_bridge_exe();
    let detected = detect_browser_extensions(&registered_ids);
    let connected = bridge.is_some() && manifest_path.is_file() && !registered_ids.is_empty();
    Ok(ExtensionSetupStatus {
        connected,
        registered_ids,
        detected,
        extension_dir: ext_dir.to_string_lossy().into_owned(),
        bridge_ready: bridge.is_some(),
        bridge_path: bridge.map(|p| p.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub async fn get_extension_setup_status(app: tauri::AppHandle) -> Result<ExtensionSetupStatus, String> {
    tauri::async_runtime::spawn_blocking(move || build_status(Some(&app)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_extension_folder(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = sync_bundled_extension(&app)?;
        let canonical = fs::canonicalize(&dir).unwrap_or(dir);
        let display = canonical.to_string_lossy().into_owned();
        let clean = display.strip_prefix(r"\\?\").unwrap_or(&display).to_string();
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer.exe")
                .arg(&clean)
                .spawn()
                .map_err(|e| format!("Could not open File Explorer: {e}"))?;
        }
        Ok(clean)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn connect_browser_extension(
    app: tauri::AppHandle,
    extension_id: String,
) -> Result<ExtensionSetupStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = normalize_extension_id(&extension_id)?;
        let bridge_exe = find_bridge_exe()
            .ok_or("Sightline native bridge executable was not found in this installation.")?;
        let manifest_path = native_host_manifest_path()?;
        let mut ids: BTreeSet<String> = read_registered_ids_from(&manifest_path).into_iter().collect();
        ids.insert(id);
        let merged: Vec<String> = ids.into_iter().collect();
        write_manifest_atomic(&manifest_path, &bridge_exe, &merged)?;
        register_native_messaging_keys(&manifest_path)?;
        build_status(Some(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_normalizes_extension_ids() {
        let valid = "abcdefghijklmnopabcdefghijklmnop";
        assert!(valid_extension_id(valid));
        assert_eq!(
            normalize_extension_id("  chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP/ ").unwrap(),
            valid
        );
        assert!(normalize_extension_id("too-short").is_err());
        assert!(normalize_extension_id("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz").is_err());
    }

    #[test]
    fn manifest_round_trips_and_merges_origins() {
        let tmp = std::env::temp_dir().join(format!("sightline-bridge-setup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();
        let manifest = tmp.join("native-host.json");
        let bridge = tmp.join("sightline-bridge.exe");

        let id1 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string();
        let id2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string();
        write_manifest_atomic(&manifest, &bridge, &[id1.clone()]).unwrap();
        assert_eq!(read_registered_ids_from(&manifest), vec![id1.clone()]);

        let mut merged: BTreeSet<String> = read_registered_ids_from(&manifest).into_iter().collect();
        merged.insert(id2.clone());
        let list: Vec<String> = merged.into_iter().collect();
        write_manifest_atomic(&manifest, &bridge, &list).unwrap();
        assert_eq!(read_registered_ids_from(&manifest), vec![id1, id2]);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn detects_sightline_extension_from_browser_preferences() {
        let id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let prefs = json!({
            "extensions": {
                "settings": {
                    id: {
                        "path": "C:\\Users\\demo\\AppData\\Local\\Sightline\\extension",
                        "manifest": { "name": "Sightline Capture", "version": "0.1.0" }
                    },
                    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": {
                        "path": "C:\\Other\\ext",
                        "manifest": { "name": "Unrelated Extension" }
                    }
                }
            }
        });
        let reg = BTreeSet::new();
        let found = scan_preferences_json(&prefs.to_string(), "Brave", "Default", &reg);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, id);
        assert_eq!(found[0].browser, "Brave");
        assert!(!found[0].registered);
    }
}
