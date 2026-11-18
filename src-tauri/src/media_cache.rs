//! Lightweight media copies used for previews, so the canvas and grids never decode full-size originals.
//!
//! * Video previews: 960px, silent, H.264 copies of library videos in `<library>/previews/`.
//! * Discover cover thumbnails: 960px-wide JPEGs of cached Discover images in `discover-thumbs/`,
//!   served through the `sthumb` URI scheme. A missing thumbnail is generated in the background while
//!   the original is served once without caching, so the next request gets the small copy.

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex, OnceLock,
    },
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::http::{header, Response, StatusCode};

pub const THUMB_SCHEME: &str = "sthumb";

/// CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS, so background encodes never compete with the UI.
#[cfg(target_os = "windows")]
const BACKGROUND_PROCESS_FLAGS: u32 = 0x0800_0000 | 0x0000_4000;

/// Counting semaphore that caps concurrent FFmpeg processes.
struct Gate {
    busy: Mutex<usize>,
    cv: Condvar,
    max: usize,
}

struct Permit(&'static Gate);

impl Gate {
    fn acquire(&'static self) -> Permit {
        let mut busy = self.busy.lock().unwrap_or_else(|e| e.into_inner());
        while *busy >= self.max {
            busy = self.cv.wait(busy).unwrap_or_else(|e| e.into_inner());
        }
        *busy += 1;
        Permit(self)
    }
}

impl Drop for Permit {
    fn drop(&mut self) {
        let mut busy = self.0.busy.lock().unwrap_or_else(|e| e.into_inner());
        *busy -= 1;
        self.0.cv.notify_one();
    }
}

fn gate() -> &'static Gate {
    static GATE: OnceLock<Gate> = OnceLock::new();
    GATE.get_or_init(|| Gate { busy: Mutex::new(0), cv: Condvar::new(), max: 3 })
}

fn in_flight() -> &'static Mutex<HashSet<String>> {
    static SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

fn failed() -> &'static Mutex<HashSet<String>> {
    static SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

fn ffmpeg() -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(super::ffmpeg_program());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(BACKGROUND_PROCESS_FLAGS);
    cmd
}

/// Discover image names are content hashes with an extension. Anything else is rejected.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 200
        && !name.starts_with('.')
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
}

fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// Formats served as-is: SVG is already cheap and GIF covers may be animated.
fn passthrough(ext: &str) -> bool {
    matches!(ext, "gif" | "svg")
}

fn mime(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn discover_dirs(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let catalog = super::catalog_path(app)?;
    let images = catalog.with_file_name("discover-images");
    let thumbs = catalog.with_file_name("discover-thumbs-v2");
    fs::create_dir_all(&thumbs).map_err(|e| e.to_string())?;
    Ok((images, thumbs))
}

fn thumb_path(thumbs: &Path, name: &str) -> PathBuf {
    thumbs.join(format!("{name}.jpg"))
}

/// 960px wide, preserving the full height for scrolling page previews.
fn generate_thumb(src: &Path, out: &Path) -> bool {
    let tmp = out.with_extension(format!("tmp-{}.jpg", uuid::Uuid::new_v4()));
    let ok = ffmpeg()
        .args(["-v", "error", "-y", "-i"])
        .arg(src)
        .args([
            "-frames:v",
            "1",
            "-vf",
            "scale='min(960,iw)':-2:flags=lanczos",
            "-q:v",
            "2",
        ])
        .arg(&tmp)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if ok && tmp.is_file() && fs::rename(&tmp, out).is_ok() {
        true
    } else {
        let _ = fs::remove_file(&tmp);
        false
    }
}

fn ensure_thumb(src: PathBuf, out: PathBuf) {
    let key = out.to_string_lossy().into_owned();
    if failed().lock().map(|s| s.contains(&key)).unwrap_or(false) {
        return;
    }
    if !in_flight().lock().map(|mut s| s.insert(key.clone())).unwrap_or(false) {
        return;
    }
    if !out.is_file() {
        let _permit = gate().acquire();
        if !out.is_file() && !generate_thumb(&src, &out) {
            if let Ok(mut s) = failed().lock() {
                s.insert(key.clone());
            }
        }
    }
    if let Ok(mut s) = in_flight().lock() {
        s.remove(&key);
    }
}

fn respond(status: StatusCode, body: Vec<u8>, content_type: &str, cacheable: bool) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(
            header::CACHE_CONTROL,
            if cacheable { "public, max-age=31536000, immutable" } else { "no-store" },
        )
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn status_only(status: StatusCode) -> Response<Vec<u8>> {
    respond(status, Vec::new(), "text/plain", false)
}

/// Handler for `sthumb://localhost/<discover image name>`.
pub fn serve_discover_thumb(app: &tauri::AppHandle, uri_path: &str) -> Response<Vec<u8>> {
    let name = uri_path.trim_start_matches('/');
    if !valid_name(name) {
        return status_only(StatusCode::BAD_REQUEST);
    }
    let Ok((images, thumbs)) = discover_dirs(app) else {
        return status_only(StatusCode::INTERNAL_SERVER_ERROR);
    };
    let src = images.join(name);
    if !src.is_file() {
        return status_only(StatusCode::NOT_FOUND);
    }
    let ext = extension(name);
    if !passthrough(&ext) {
        let out = thumb_path(&thumbs, name);
        if let Ok(bytes) = fs::read(&out) {
            return respond(StatusCode::OK, bytes, "image/jpeg", true);
        }
        std::thread::spawn(move || ensure_thumb(src.clone(), out));
        let src = images.join(name);
        return match fs::read(&src) {
            Ok(bytes) => respond(StatusCode::OK, bytes, mime(&ext), false),
            Err(_) => status_only(StatusCode::NOT_FOUND),
        };
    }
    match fs::read(&src) {
        Ok(bytes) => respond(StatusCode::OK, bytes, mime(&ext), true),
        Err(_) => status_only(StatusCode::NOT_FOUND),
    }
}

/// Generates every missing Discover thumbnail in the background, once per app run.
pub fn warm_discover_thumbs(app: &tauri::AppHandle) -> Result<(), String> {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let (images, thumbs) = match discover_dirs(app) {
        Ok(dirs) => dirs,
        Err(e) => {
            STARTED.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };
    std::thread::spawn(move || {
        let names: Vec<String> = fs::read_dir(&images)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| valid_name(name) && !passthrough(&extension(name)))
            .filter(|name| !thumb_path(&thumbs, name).is_file())
            .collect();
        let queue = Arc::new(Mutex::new(names));
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let queue = Arc::clone(&queue);
                let (images, thumbs) = (images.clone(), thumbs.clone());
                std::thread::spawn(move || loop {
                    let next = queue.lock().ok().and_then(|mut q| q.pop());
                    let Some(name) = next else { break };
                    ensure_thumb(images.join(&name), thumb_path(&thumbs, &name));
                })
            })
            .collect();
        for worker in workers {
            let _ = worker.join();
        }
    });
    Ok(())
}

/// 960px (long side), 30 fps, silent H.264 copy of a library video for looping previews.
pub fn make_video_proxy(src: &Path, out: &Path) -> bool {
    let _permit = gate().acquire();
    let tmp = out.with_extension(format!("tmp-{}.mp4", uuid::Uuid::new_v4()));
    let ok = ffmpeg()
        .args(["-v", "error", "-y", "-i"])
        .arg(src)
        .args([
            "-an",
            "-vf",
            "fps=30,scale=960:960:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
        ])
        .arg(&tmp)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if ok && tmp.is_file() && fs::rename(&tmp, out).is_ok() {
        true
    } else {
        let _ = fs::remove_file(&tmp);
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_hashed_names_are_served() {
        assert!(valid_name("632ac9a1fb66060b1762e4ed33c37eb0dfa0b2d34f23734810fc73444ec09834.jpg"));
        assert!(valid_name("a-b_c.webp"));
        assert!(!valid_name(""));
        assert!(!valid_name("../secret.jpg"));
        assert!(!valid_name("dir/file.jpg"));
        assert!(!valid_name("dir\\file.jpg"));
        assert!(!valid_name(".hidden"));
        assert!(!valid_name("a%2e%2e.jpg"));
    }

    #[test]
    fn gif_and_svg_pass_through() {
        assert!(passthrough(&extension("x.GIF")));
        assert!(passthrough(&extension("x.svg")));
        assert!(!passthrough(&extension("x.avif")));
    }
}
