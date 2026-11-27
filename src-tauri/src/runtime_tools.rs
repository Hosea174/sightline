//! Discovery and on-demand installation of external runtime tools (FFmpeg, FFprobe, Python, gallery-dl).

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
};

use serde::Serialize;

#[cfg(target_os = "windows")]
const NO_WINDOW_FLAG: u32 = 0x0800_0000;

const FFMPEG_PRIMARY_URL: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const FFMPEG_FALLBACK_URL: &str =
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
const PYTHON_EMBED_URL: &str =
    "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip";
const GALLERY_DL_EXE_URL: &str =
    "https://github.com/mikf/gallery-dl/releases/latest/download/gallery-dl.exe";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeToolsStatus {
    pub ffmpeg: bool,
    pub ffprobe: bool,
    pub python: bool,
    pub gallery_dl: bool,
}

#[derive(Clone, Debug)]
pub enum GalleryDlTool {
    Binary(PathBuf),
    PythonModule(PathBuf),
}

fn ffmpeg_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn python_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn gallery_dl_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub fn managed_tools_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(|base| PathBuf::from(base).join("Sightline").join("tools"))
}

fn hidden_cmd(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(NO_WINDOW_FLAG);
    cmd
}

fn verify_python_exe(exe: &Path) -> bool {
    if !exe.is_file() {
        return false;
    }
    // WindowsApps aliases include a python.exe stub that opens Microsoft Store with exit != 0.
    hidden_cmd(exe)
        .arg("--version")
        .output()
        .map(|out| {
            out.status.success()
                && (String::from_utf8_lossy(&out.stdout).contains("Python ")
                    || String::from_utf8_lossy(&out.stderr).contains("Python "))
        })
        .unwrap_or(false)
}

fn verify_tool_version(exe: &Path, arg: &str) -> bool {
    if !exe.is_file() {
        return false;
    }
    hidden_cmd(exe)
        .arg(arg)
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn search_path_executables(name: &str) -> Vec<PathBuf> {
    let mut found = Vec::new();
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                found.push(candidate);
            }
        }
    }
    found
}

fn winget_ffmpeg_bin(exe_name: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let packages = PathBuf::from(local)
            .join("Microsoft")
            .join("WinGet")
            .join("Packages");
        if let Ok(entries) = fs::read_dir(packages) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with("Gyan.FFmpeg_") {
                    if let Ok(builds) = fs::read_dir(entry.path()) {
                        for build in builds.flatten() {
                            let exe = build.path().join("bin").join(exe_name);
                            if exe.is_file() {
                                return Some(exe);
                            }
                        }
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = exe_name;
    None
}

pub fn find_ffmpeg() -> Option<PathBuf> {
    let exe_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if let Some(dir) = managed_tools_dir() {
        let managed = dir.join("ffmpeg").join(exe_name);
        if managed.is_file() {
            return Some(managed);
        }
    }
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            let sibling = parent.join(exe_name);
            if sibling.is_file() {
                return Some(sibling);
            }
        }
    }
    if let Some(p) = search_path_executables(exe_name).into_iter().next() {
        return Some(p);
    }
    winget_ffmpeg_bin(exe_name)
}

pub fn find_ffprobe() -> Option<PathBuf> {
    let exe_name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
    if let Some(ffmpeg) = find_ffmpeg() {
        let sibling = ffmpeg.with_file_name(exe_name);
        if sibling.is_file() {
            return Some(sibling);
        }
    }
    if let Some(dir) = managed_tools_dir() {
        let managed = dir.join("ffmpeg").join(exe_name);
        if managed.is_file() {
            return Some(managed);
        }
    }
    if let Some(p) = search_path_executables(exe_name).into_iter().next() {
        return Some(p);
    }
    winget_ffmpeg_bin(exe_name)
}

pub fn find_python() -> Option<PathBuf> {
    let exe_name = if cfg!(windows) { "python.exe" } else { "python3" };
    if let Some(dir) = managed_tools_dir() {
        let managed = dir.join("python").join(exe_name);
        if verify_python_exe(&managed) {
            return Some(managed);
        }
    }
    for candidate in search_path_executables(exe_name) {
        if verify_python_exe(&candidate) {
            return Some(candidate);
        }
    }
    #[cfg(target_os = "windows")]
    {
        let mut dirs = Vec::new();
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Programs").join("Python"));
        }
        if let Some(pf) = std::env::var_os("ProgramFiles") {
            dirs.push(PathBuf::from(pf));
        }
        for root in dirs {
            if let Ok(entries) = fs::read_dir(root) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if name.starts_with("Python3") {
                        let exe = entry.path().join("python.exe");
                        if verify_python_exe(&exe) {
                            return Some(exe);
                        }
                    }
                }
            }
        }
    }
    None
}

pub fn find_gallery_dl() -> Option<GalleryDlTool> {
    let exe_name = if cfg!(windows) { "gallery-dl.exe" } else { "gallery-dl" };
    if let Some(dir) = managed_tools_dir() {
        let managed = dir.join("gallery-dl").join(exe_name);
        if verify_tool_version(&managed, "--version") {
            return Some(GalleryDlTool::Binary(managed));
        }
    }
    for candidate in search_path_executables(exe_name) {
        if verify_tool_version(&candidate, "--version") {
            return Some(GalleryDlTool::Binary(candidate));
        }
    }
    if let Some(py) = find_python() {
        let ok = hidden_cmd(&py)
            .args(["-m", "gallery_dl", "--version"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if ok {
            return Some(GalleryDlTool::PythonModule(py));
        }
    }
    None
}

pub fn find_file_recursive(dir: &Path, filename: &str) -> Option<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return None;
    };
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(filename)
        {
            return Some(path);
        } else if path.is_dir() {
            subdirs.push(path);
        }
    }
    for sub in subdirs {
        if let Some(found) = find_file_recursive(&sub, filename) {
            return Some(found);
        }
    }
    None
}

fn download_file(urls: &[&str], dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let curl = if cfg!(windows) { "curl.exe" } else { "curl" };
    let mut last_err = String::from("Download failed");
    for url in urls {
        let _ = fs::remove_file(dest);
        let out = hidden_cmd(curl)
            .args(["-fsSL", "--retry", "2", "--connect-timeout", "20", "--max-time", "600", "-o"])
            .arg(dest)
            .arg(url)
            .output();
        match out {
            Ok(o) if o.status.success() && dest.is_file() && fs::metadata(dest).map(|m| m.len() > 0).unwrap_or(false) => {
                return Ok(());
            }
            Ok(o) => {
                let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
                last_err = if err.is_empty() {
                    format!("Could not download from {url}")
                } else {
                    err
                };
            }
            Err(e) => last_err = format!("Could not run curl: {e}"),
        }
    }
    let _ = fs::remove_file(dest);
    Err(last_err)
}

fn extract_zip(archive: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let tar = if cfg!(windows) { "tar.exe" } else { "tar" };
    let tar_ok = hidden_cmd(tar)
        .args(["-xf"])
        .arg(archive)
        .args(["-C"])
        .arg(dest)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if tar_ok {
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let out = hidden_cmd("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Expand-Archive -LiteralPath $env:SIGHTLINE_ZIP -DestinationPath $env:SIGHTLINE_DEST -Force",
            ])
            .env("SIGHTLINE_ZIP", archive)
            .env("SIGHTLINE_DEST", dest)
            .output()
            .map_err(|e| format!("Could not extract archive: {e}"))?;
        if out.status.success() {
            return Ok(());
        }
        return Err(format!(
            "Could not extract archive: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    #[cfg(not(target_os = "windows"))]
    Err("Could not extract archive".into())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = dst.join(entry.file_name());
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else if ty.is_file() {
            fs::copy(entry.path(), target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn ensure_ffmpeg() -> Result<PathBuf, String> {
    if let Some(path) = find_ffmpeg() {
        return Ok(path);
    }
    let _guard = ffmpeg_lock().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(path) = find_ffmpeg() {
        return Ok(path);
    }
    #[cfg(not(target_os = "windows"))]
    return Err("FFmpeg is not installed. Install FFmpeg and ensure it is on PATH.".into());

    #[cfg(target_os = "windows")]
    {
        let tools_dir = managed_tools_dir().ok_or("LOCALAPPDATA unavailable")?;
        let target_dir = tools_dir.join("ffmpeg");
        let work_dir = tools_dir.join(format!("ffmpeg-tmp-{}", uuid::Uuid::new_v4()));
        let zip_path = work_dir.join("ffmpeg.zip");
        let extract_dir = work_dir.join("extracted");

        let res = (|| -> Result<PathBuf, String> {
            download_file(&[FFMPEG_PRIMARY_URL, FFMPEG_FALLBACK_URL], &zip_path)?;
            extract_zip(&zip_path, &extract_dir)?;
            let src_ffmpeg = find_file_recursive(&extract_dir, "ffmpeg.exe")
                .ok_or("Downloaded FFmpeg archive did not contain ffmpeg.exe")?;
            let src_ffprobe = find_file_recursive(&extract_dir, "ffprobe.exe");
            fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
            let dest_ffmpeg = target_dir.join("ffmpeg.exe");
            let temp_ffmpeg = target_dir.join(format!("ffmpeg-{}.part", uuid::Uuid::new_v4()));
            fs::copy(&src_ffmpeg, &temp_ffmpeg).map_err(|e| e.to_string())?;
            if let Err(e) = fs::rename(&temp_ffmpeg, &dest_ffmpeg) {
                let _ = fs::remove_file(&temp_ffmpeg);
                return Err(e.to_string());
            }
            if let Some(probe_src) = src_ffprobe {
                let dest_ffprobe = target_dir.join("ffprobe.exe");
                let temp_probe = target_dir.join(format!("ffprobe-{}.part", uuid::Uuid::new_v4()));
                if fs::copy(&probe_src, &temp_probe).is_ok() {
                    if fs::rename(&temp_probe, &dest_ffprobe).is_err() {
                        let _ = fs::remove_file(&temp_probe);
                    }
                }
            }
            if !verify_tool_version(&dest_ffmpeg, "-version") {
                return Err("Downloaded ffmpeg.exe failed verification".into());
            }
            Ok(dest_ffmpeg)
        })();
        let _ = fs::remove_dir_all(&work_dir);
        res
    }
}

pub fn ensure_ffprobe() -> Result<PathBuf, String> {
    if let Some(path) = find_ffprobe() {
        return Ok(path);
    }
    let _ = ensure_ffmpeg()?;
    find_ffprobe().ok_or_else(|| "FFprobe could not be installed. Install FFmpeg manually.".to_string())
}

pub fn ensure_python() -> Result<PathBuf, String> {
    if let Some(path) = find_python() {
        return Ok(path);
    }
    let _guard = python_lock().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(path) = find_python() {
        return Ok(path);
    }
    #[cfg(not(target_os = "windows"))]
    return Err("Python 3 is not installed. Install Python and ensure it is on PATH.".into());

    #[cfg(target_os = "windows")]
    {
        let tools_dir = managed_tools_dir().ok_or("LOCALAPPDATA unavailable")?;
        let target_dir = tools_dir.join("python");
        let work_dir = tools_dir.join(format!("python-tmp-{}", uuid::Uuid::new_v4()));
        let zip_path = work_dir.join("python-embed.zip");
        let extract_dir = work_dir.join("extracted");
        let staged_dir = tools_dir.join(format!("python-stage-{}", uuid::Uuid::new_v4()));

        let res = (|| -> Result<PathBuf, String> {
            download_file(&[PYTHON_EMBED_URL], &zip_path)?;
            extract_zip(&zip_path, &extract_dir)?;
            let found_exe = find_file_recursive(&extract_dir, "python.exe")
                .ok_or("Downloaded Python archive did not contain python.exe")?;
            let root = found_exe.parent().ok_or("Invalid extracted Python directory")?;
            copy_dir_recursive(root, &staged_dir)?;
            let backup_dir = tools_dir.join(format!("python-old-{}", uuid::Uuid::new_v4()));
            if target_dir.exists() {
                let _ = fs::rename(&target_dir, &backup_dir);
            }
            if let Err(e) = fs::rename(&staged_dir, &target_dir) {
                if backup_dir.exists() {
                    let _ = fs::rename(&backup_dir, &target_dir);
                }
                return Err(e.to_string());
            }
            let _ = fs::remove_dir_all(&backup_dir);
            let final_exe = target_dir.join("python.exe");
            if !verify_python_exe(&final_exe) {
                return Err("Downloaded python.exe failed verification".into());
            }
            Ok(final_exe)
        })();
        let _ = fs::remove_dir_all(&work_dir);
        let _ = fs::remove_dir_all(&staged_dir);
        res
    }
}

pub fn ensure_gallery_dl() -> Result<GalleryDlTool, String> {
    if let Some(tool) = find_gallery_dl() {
        return Ok(tool);
    }
    let _guard = gallery_dl_lock().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(tool) = find_gallery_dl() {
        return Ok(tool);
    }
    #[cfg(not(target_os = "windows"))]
    return Err("gallery-dl is not installed. Install gallery-dl and ensure it is on PATH.".into());

    #[cfg(target_os = "windows")]
    {
        let tools_dir = managed_tools_dir().ok_or("LOCALAPPDATA unavailable")?;
        let target_dir = tools_dir.join("gallery-dl");
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
        let temp_exe = target_dir.join(format!("gallery-dl-{}.part", uuid::Uuid::new_v4()));
        let final_exe = target_dir.join("gallery-dl.exe");
        let res = (|| -> Result<GalleryDlTool, String> {
            download_file(&[GALLERY_DL_EXE_URL], &temp_exe)?;
            if let Err(e) = fs::rename(&temp_exe, &final_exe) {
                let _ = fs::remove_file(&temp_exe);
                return Err(e.to_string());
            }
            if !verify_tool_version(&final_exe, "--version") {
                return Err("Downloaded gallery-dl.exe failed verification".into());
            }
            Ok(GalleryDlTool::Binary(final_exe))
        })();
        let _ = fs::remove_file(&temp_exe);
        res
    }
}

pub fn current_status() -> RuntimeToolsStatus {
    RuntimeToolsStatus {
        ffmpeg: find_ffmpeg().is_some(),
        ffprobe: find_ffprobe().is_some(),
        python: find_python().is_some(),
        gallery_dl: find_gallery_dl().is_some(),
    }
}

#[tauri::command]
pub async fn runtime_tools_status() -> RuntimeToolsStatus {
    tauri::async_runtime::spawn_blocking(current_status)
        .await
        .unwrap_or(RuntimeToolsStatus {
            ffmpeg: false,
            ffprobe: false,
            python: false,
            gallery_dl: false,
        })
}

#[tauri::command]
pub async fn ensure_runtime_tools(tools: Vec<String>) -> Result<RuntimeToolsStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        for tool in tools {
            match tool.trim().to_ascii_lowercase().as_str() {
                "ffmpeg" => {
                    ensure_ffmpeg()?;
                }
                "ffprobe" => {
                    ensure_ffprobe()?;
                }
                "python" => {
                    ensure_python()?;
                }
                "gallery-dl" | "gallery_dl" => {
                    ensure_gallery_dl()?;
                }
                other => return Err(format!("Unknown runtime tool: {other}")),
            }
        }
        Ok(current_status())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_nested_binary_case_insensitively() {
        let root = std::env::temp_dir().join(format!("sightline-rt-test-{}", uuid::Uuid::new_v4()));
        let bin_dir = root.join("ffmpeg-7.1-essentials_build").join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let exe = bin_dir.join("ffmpeg.exe");
        fs::write(&exe, b"stub").unwrap();
        let found = find_file_recursive(&root, "FFMPEG.EXE").unwrap();
        assert_eq!(found, exe);
        assert!(find_file_recursive(&root, "missing.exe").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn status_query_succeeds_without_panicking() {
        let status = current_status();
        let serialized = serde_json::to_value(&status).unwrap();
        assert!(serialized.get("ffmpeg").is_some());
        assert!(serialized.get("galleryDl").is_some());
    }
}
