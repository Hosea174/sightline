//! Trash lifecycle management for Sightline libraries.
//!
//! Trashed assets are moved out of `assets/` (along with unshared thumbnails and
//! video previews) into dedicated storage under `<library>/trash/`:
//! - `<library>/trash/assets/<rel>`
//! - `<library>/trash/thumbnails/<name>`
//! - `<library>/trash/previews/<name>`
//!
//! Files shared with any active (non-trashed) source/asset remain in active
//! storage until no active references exist. Restoring moves files back to
//! active storage, permanent delete / clear removes unreferenced files from
//! disk, and items trashed for 30 days or more are automatically expired.

use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const TRASH_DIR: &str = "trash";
pub const TRASH_RETENTION_DAYS: i64 = 30;
pub const TRASH_RETENTION_SECS: i64 = TRASH_RETENTION_DAYS * 86_400;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashTarget {
    pub source_id: String,
    #[serde(default)]
    pub asset_id: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashSyncReport {
    pub moved_to_trash: usize,
    pub restored_from_trash: usize,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashCommandResult {
    pub library: String,
    pub trashed_count: usize,
    pub restored_count: usize,
    pub deleted_sources: usize,
    pub deleted_assets: usize,
    pub deleted_files: usize,
    pub moved_to_trash: usize,
    pub restored_from_trash: usize,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TrashPurgeResult {
    pub changed: bool,
    pub deleted_sources: usize,
    pub deleted_assets: usize,
    pub deleted_files: usize,
    pub warnings: Vec<String>,
}

pub fn current_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn days_in_month(year: i64, month: u32) -> Option<u32> {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => Some(31),
        4 | 6 | 9 | 11 => Some(30),
        2 => Some(if is_leap_year(year) { 29 } else { 28 }),
        _ => None,
    }
}

/// Howard Hinnant's civil-from-days / days-from-civil conversion (1970-01-01 = 0).
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = year - if month <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = month as i64;
    let d = day as i64;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year, m as u32, d as u32)
}

pub fn format_unix_secs_iso8601(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = rem / 3600;
    let minute = (rem % 3600) / 60;
    let second = rem % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.000Z")
}

/// Parses ISO 8601 / RFC 3339 timestamps (or `YYYY-MM-DD`) into UTC Unix seconds.
/// Returns `None` on malformed or out-of-range inputs so invalid values never trigger deletion.
pub fn parse_iso8601_utc_secs(raw: &str) -> Option<i64> {
    let s = raw.trim();
    if !s.is_ascii() || s.len() < 10 {
        return None;
    }
    let bytes = s.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let parse_ascii_digits = |slice: &str| -> Option<i64> {
        if slice.is_empty() || !slice.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        slice.parse::<i64>().ok()
    };
    let year = parse_ascii_digits(&s[0..4])?;
    let month = parse_ascii_digits(&s[5..7])? as u32;
    let day = parse_ascii_digits(&s[8..10])? as u32;
    let max_day = days_in_month(year, month)?;
    if day == 0 || day > max_day {
        return None;
    }
    let days = days_from_civil(year, month, day);
    if s.len() == 10 {
        return Some(days * 86_400);
    }

    let sep = bytes[10];
    if sep != b'T' && sep != b't' && sep != b' ' {
        return None;
    }
    let rest = &s[11..];
    if rest.len() < 8 {
        return None;
    }
    let rb = rest.as_bytes();
    if rb[2] != b':' || rb[5] != b':' {
        return None;
    }
    let hour = parse_ascii_digits(&rest[0..2])?;
    let minute = parse_ascii_digits(&rest[3..5])?;
    let second = parse_ascii_digits(&rest[6..8])?;
    if !(0..=23).contains(&hour) || !(0..=59).contains(&minute) || !(0..=59).contains(&second) {
        return None;
    }
    let mut idx = 8;
    if idx < rb.len() && rb[idx] == b'.' {
        idx += 1;
        let frac_start = idx;
        while idx < rb.len() && rb[idx].is_ascii_digit() {
            idx += 1;
        }
        if idx == frac_start {
            return None;
        }
    }
    let tz = &rest[idx..];
    let offset_secs: i64 = if tz.is_empty() || tz == "Z" || tz == "z" {
        0
    } else if tz.starts_with('+') || tz.starts_with('-') {
        let sign = if tz.starts_with('+') { 1 } else { -1 };
        let digits = &tz[1..];
        let (oh, om) = if digits.len() == 5 && digits.as_bytes()[2] == b':' {
            (
                parse_ascii_digits(&digits[0..2])?,
                parse_ascii_digits(&digits[3..5])?,
            )
        } else if digits.len() == 4 {
            (
                parse_ascii_digits(&digits[0..2])?,
                parse_ascii_digits(&digits[2..4])?,
            )
        } else {
            return None;
        };
        if !(0..=23).contains(&oh) || !(0..=59).contains(&om) {
            return None;
        }
        sign * (oh * 3600 + om * 60)
    } else {
        return None;
    };

    Some(days * 86_400 + hour * 3600 + minute * 60 + second - offset_secs)
}

pub fn is_expired_at(trashed_at: &str, now_secs: i64, retention_secs: i64) -> bool {
    let Some(trashed_secs) = parse_iso8601_utc_secs(trashed_at) else {
        return false;
    };
    now_secs >= trashed_secs.saturating_add(retention_secs.max(0))
}

pub fn normalize_rel(rel: &str) -> String {
    let replaced = rel.replace('\\', "/");
    let mut parts = Vec::new();
    for seg in replaced.split('/') {
        if !seg.is_empty() {
            parts.push(seg);
        }
    }
    parts.join("/")
}

pub(crate) fn ref_key(s: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        s.to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        s.to_string()
    }
}

fn is_windows_reserved_name(segment: &str) -> bool {
    let upper = segment.to_ascii_uppercase();
    let stem = upper.split('.').next().unwrap_or(&upper);
    matches!(
        stem,
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn has_unsafe_segment_chars(seg: &str) -> bool {
    if seg.is_empty() || seg == "." || seg == ".." {
        return true;
    }
    if seg
        .chars()
        .any(|c| c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
    {
        return true;
    }
    is_windows_reserved_name(seg)
}

pub fn clean_rel_subpath(rel: &str) -> Result<String, String> {
    if rel.is_empty() || rel.contains('\0') {
        return Err("Invalid asset path".into());
    }
    let normalized = rel.replace('\\', "/");
    if normalized.starts_with('/') || normalized.ends_with('/') {
        return Err("Invalid asset path".into());
    }
    let rel_path = Path::new(&normalized);
    let mut parts = Vec::new();
    for comp in rel_path.components() {
        match comp {
            Component::Normal(seg) => {
                let s = seg
                    .to_str()
                    .ok_or_else(|| "Invalid asset path".to_string())?;
                if has_unsafe_segment_chars(s) {
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
    Ok(parts.join("/"))
}

pub fn safe_subpath(base: &Path, rel: &str) -> Result<(PathBuf, String), String> {
    let clean = clean_rel_subpath(rel)?;
    let full = if let Some((folder, file)) = clean.split_once('/') {
        base.join(folder).join(file)
    } else {
        base.join(&clean)
    };
    Ok((full, clean))
}

pub fn safe_single_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("Invalid file name".into());
    }
    let mut comps = Path::new(name).components();
    match (comps.next(), comps.next()) {
        (Some(Component::Normal(seg)), None) => {
            let s = seg.to_str().ok_or_else(|| "Invalid file name".to_string())?;
            if has_unsafe_segment_chars(s) {
                Err("Invalid file name".into())
            } else {
                Ok(s)
            }
        }
        _ => Err("Invalid file name".into()),
    }
}

pub(crate) fn check_not_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            Err(format!("Refusing symlink/junction path: {}", path.display()))
        }
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub(crate) fn check_ancestors_under_root(
    root: &Path,
    rel_components: &[&str],
) -> Result<PathBuf, String> {
    match fs::symlink_metadata(root) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err(format!("Refusing symlink/junction path: {}", root.display()));
            }
            if !meta.is_dir() {
                return Err(format!("Library root is not a directory: {}", root.display()));
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    let mut cur = root.to_path_buf();
    for (idx, seg) in rel_components.iter().enumerate() {
        cur.push(seg);
        match fs::symlink_metadata(&cur) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    return Err(format!("Refusing symlink/junction path: {}", cur.display()));
                }
                if idx + 1 < rel_components.len() && !meta.is_dir() {
                    return Err(format!("Expected directory at {}", cur.display()));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(cur)
}

pub(crate) fn ensure_safe_dir_under(
    root: &Path,
    dir_components: &[&str],
) -> Result<PathBuf, String> {
    match fs::symlink_metadata(root) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err(format!("Refusing symlink/junction path: {}", root.display()));
            }
            if !meta.is_dir() {
                return Err(format!("Library root is not a directory: {}", root.display()));
            }
        }
        Err(e) => return Err(e.to_string()),
    }
    let mut cur = root.to_path_buf();
    for seg in dir_components {
        cur.push(seg);
        match fs::symlink_metadata(&cur) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    return Err(format!("Refusing symlink/junction path: {}", cur.display()));
                }
                if !meta.is_dir() {
                    return Err(format!("Expected directory at {}", cur.display()));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => match fs::create_dir(&cur) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                    let meta = fs::symlink_metadata(&cur).map_err(|e2| e2.to_string())?;
                    if meta.file_type().is_symlink() || !meta.is_dir() {
                        return Err(format!("Refusing unsafe directory at {}", cur.display()));
                    }
                }
                Err(err) => return Err(err.to_string()),
            },
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(cur)
}

pub(crate) fn check_library_dirs_safe(root: &Path) -> Result<(), String> {
    check_ancestors_under_root(root, &["assets"])?;
    check_ancestors_under_root(root, &["thumbnails"])?;
    check_ancestors_under_root(root, &["previews"])?;
    check_ancestors_under_root(root, &["favicons"])?;
    check_ancestors_under_root(root, &["trash", "assets"])?;
    check_ancestors_under_root(root, &["trash", "thumbnails"])?;
    check_ancestors_under_root(root, &["trash", "previews"])?;
    Ok(())
}

pub(crate) fn check_subpath_not_symlink_under(
    root: &Path,
    top_dir: &str,
    rel: &str,
) -> Result<(), String> {
    let clean = clean_rel_subpath(rel)?;
    if let Some((folder, file)) = clean.split_once('/') {
        check_ancestors_under_root(root, &[top_dir, folder, file])?;
    } else {
        check_ancestors_under_root(root, &[top_dir, &clean])?;
    }
    Ok(())
}

fn check_trash_subpath_not_symlink(root: &Path, sub_dir: &str, rel: &str) -> Result<(), String> {
    let clean = clean_rel_subpath(rel)?;
    if let Some((folder, file)) = clean.split_once('/') {
        check_ancestors_under_root(root, &[TRASH_DIR, sub_dir, folder, file])?;
    } else {
        check_ancestors_under_root(root, &[TRASH_DIR, sub_dir, &clean])?;
    }
    Ok(())
}

fn is_regular_file_no_follow(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                Err(format!("Refusing symlink/junction path: {}", path.display()))
            } else {
                Ok(meta.is_file())
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

pub fn trash_root(root: &Path) -> PathBuf {
    root.join(TRASH_DIR)
}

fn trash_assets_dir(root: &Path) -> PathBuf {
    trash_root(root).join("assets")
}

fn trash_thumbnails_dir(root: &Path) -> PathBuf {
    trash_root(root).join("thumbnails")
}

fn trash_previews_dir(root: &Path) -> PathBuf {
    trash_root(root).join("previews")
}

pub fn file_stem_of_rel(rel: &str) -> Option<String> {
    let norm = normalize_rel(rel);
    let base = norm.rsplit('/').next()?;
    if base.is_empty() {
        return None;
    }
    let path = Path::new(base);
    path.file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn is_trashed_value(v: &Value) -> bool {
    v.as_str().map(|s| !s.trim().is_empty()).unwrap_or(false)
}

fn rel_components_under<'a>(root: &Path, path: &'a Path) -> Result<Vec<&'a str>, String> {
    let rel = path
        .strip_prefix(root)
        .map_err(|_| format!("Path {} is outside library root {}", path.display(), root.display()))?;
    let mut out = Vec::new();
    for comp in rel.components() {
        match comp {
            Component::Normal(seg) => {
                out.push(seg.to_str().ok_or_else(|| "Invalid UTF-8 path".to_string())?);
            }
            _ => return Err(format!("Unsafe path component in {}", path.display())),
        }
    }
    Ok(out)
}

fn remove_file_with_retry(path: &Path) -> Result<(), String> {
    let mut last_err = None;
    for attempt in 0..4 {
        match fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(e) => {
                #[cfg(target_os = "windows")]
                let sharing_violation = e.raw_os_error() == Some(32);
                #[cfg(not(target_os = "windows"))]
                let sharing_violation = false;
                if sharing_violation && attempt < 3 {
                    last_err = Some(e);
                    thread::sleep(Duration::from_millis(25));
                    continue;
                }
                return Err(e.to_string());
            }
        }
    }
    Err(last_err
        .map(|e| e.to_string())
        .unwrap_or_else(|| format!("Could not remove file {}", path.display())))
}

fn rename_with_retry(src: &Path, dest: &Path) -> Result<(), std::io::Error> {
    let mut last_err = None;
    for attempt in 0..4 {
        match fs::rename(src, dest) {
            Ok(()) => return Ok(()),
            Err(e) => {
                #[cfg(target_os = "windows")]
                let sharing_violation = e.raw_os_error() == Some(32);
                #[cfg(not(target_os = "windows"))]
                let sharing_violation = false;
                if sharing_violation && attempt < 3 {
                    last_err = Some(e);
                    thread::sleep(Duration::from_millis(25));
                    continue;
                }
                return Err(e);
            }
        }
    }
    Err(last_err.unwrap_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "Could not rename file")))
}

fn files_equal(a: &Path, b: &Path) -> Result<bool, String> {
    let ma = fs::symlink_metadata(a).map_err(|e| e.to_string())?;
    let mb = fs::symlink_metadata(b).map_err(|e| e.to_string())?;
    if ma.file_type().is_symlink()
        || mb.file_type().is_symlink()
        || !ma.is_file()
        || !mb.is_file()
    {
        return Ok(false);
    }
    if ma.len() != mb.len() {
        return Ok(false);
    }
    let mut fa = File::open(a).map_err(|e| e.to_string())?;
    let mut fb = File::open(b).map_err(|e| e.to_string())?;
    let mut ba = [0u8; 16384];
    let mut bb = [0u8; 16384];
    loop {
        let na = fa.read(&mut ba).map_err(|e| e.to_string())?;
        let nb = fb.read(&mut bb).map_err(|e| e.to_string())?;
        if na != nb || ba[..na] != bb[..nb] {
            return Ok(false);
        }
        if na == 0 {
            return Ok(true);
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum MoveOutcome {
    Moved,
    Deduplicated,
    MissingSource,
}

fn move_file_safe_under(root: &Path, src: &Path, dest: &Path) -> Result<MoveOutcome, String> {
    let src_comps = rel_components_under(root, src)?;
    let dest_comps = rel_components_under(root, dest)?;
    check_ancestors_under_root(root, &src_comps)?;
    check_ancestors_under_root(root, &dest_comps)?;

    match fs::symlink_metadata(src) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err(format!("Refusing symlink/junction path: {}", src.display()));
            }
            if !meta.is_file() {
                return Err(format!("Expected file at {}", src.display()));
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(MoveOutcome::MissingSource)
        }
        Err(e) => return Err(e.to_string()),
    }

    match fs::symlink_metadata(dest) {
        Ok(meta) => {
            if meta.file_type().is_symlink() || !meta.is_file() {
                return Err(format!(
                    "Destination exists and is not a regular file: {}",
                    dest.display()
                ));
            }
            if let (Ok(ca), Ok(cb)) = (fs::canonicalize(src), fs::canonicalize(dest)) {
                if ca == cb {
                    if src == dest {
                        return Ok(MoveOutcome::Moved);
                    }
                    rename_with_retry(src, dest).map_err(|e| e.to_string())?;
                    return Ok(MoveOutcome::Moved);
                }
            }
            if files_equal(src, dest)? {
                remove_file_with_retry(src)?;
                return Ok(MoveOutcome::Deduplicated);
            }
            return Err(format!(
                "Refusing to overwrite existing file with different content: {}",
                dest.display()
            ));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }

    if dest_comps.len() > 1 {
        ensure_safe_dir_under(root, &dest_comps[..dest_comps.len() - 1])?;
    }

    match rename_with_retry(src, dest) {
        Ok(()) => Ok(MoveOutcome::Moved),
        Err(e) if e.kind() == std::io::ErrorKind::CrossesDevices => {
            let temp = dest.with_extension(format!("part-{}", uuid::Uuid::new_v4()));
            let copy_res = (|| {
                let mut reader = File::open(src).map_err(|err| err.to_string())?;
                let mut writer = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temp)
                    .map_err(|err| err.to_string())?;
                std::io::copy(&mut reader, &mut writer).map_err(|err| err.to_string())?;
                writer.sync_all().map_err(|err| err.to_string())?;
                drop(writer);
                drop(reader);
                rename_with_retry(&temp, dest).map_err(|err| err.to_string())?;
                Ok::<(), String>(())
            })();
            if let Err(err) = copy_res {
                let _ = fs::remove_file(&temp);
                return Err(err);
            }
            if let Err(err) = remove_file_with_retry(src) {
                let _ = fs::remove_file(dest);
                return Err(err);
            }
            Ok(MoveOutcome::Moved)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Debug)]
enum JournalEntry {
    Moved {
        from: PathBuf,
        to: PathBuf,
        cleanup_stop_at: Option<PathBuf>,
    },
    Deduplicated {
        removed_src: PathBuf,
        existing_dest: PathBuf,
        cleanup_stop_at: Option<PathBuf>,
    },
}

#[derive(Default)]
struct MoveJournal {
    root: PathBuf,
    entries: Vec<JournalEntry>,
}

impl MoveJournal {
    fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
            entries: Vec::new(),
        }
    }

    fn move_file(
        &mut self,
        src: &Path,
        dest: &Path,
        cleanup_stop_at: Option<&Path>,
    ) -> Result<MoveOutcome, String> {
        let outcome = move_file_safe_under(&self.root, src, dest)?;
        match outcome {
            MoveOutcome::Moved => self.entries.push(JournalEntry::Moved {
                from: src.to_path_buf(),
                to: dest.to_path_buf(),
                cleanup_stop_at: cleanup_stop_at.map(|p| p.to_path_buf()),
            }),
            MoveOutcome::Deduplicated => self.entries.push(JournalEntry::Deduplicated {
                removed_src: src.to_path_buf(),
                existing_dest: dest.to_path_buf(),
                cleanup_stop_at: cleanup_stop_at.map(|p| p.to_path_buf()),
            }),
            MoveOutcome::MissingSource => {}
        }
        Ok(outcome)
    }

    fn commit_cleanup(&self) {
        for entry in &self.entries {
            match entry {
                JournalEntry::Moved {
                    from,
                    cleanup_stop_at: Some(stop_at),
                    ..
                }
                | JournalEntry::Deduplicated {
                    removed_src: from,
                    cleanup_stop_at: Some(stop_at),
                    ..
                } => remove_empty_parent_dir(from, stop_at),
                _ => {}
            }
        }
    }

    fn rollback(&mut self) {
        for entry in self.entries.drain(..).rev() {
            match entry {
                JournalEntry::Moved { from, to, .. } => {
                    if let Ok(outcome) = move_file_safe_under(&self.root, &to, &from) {
                        let _ = outcome;
                        if let Some(stop_at) = to.parent().and_then(|_| {
                            if to.starts_with(trash_assets_dir(&self.root)) {
                                Some(trash_assets_dir(&self.root))
                            } else if to.starts_with(self.root.join("assets")) {
                                Some(self.root.join("assets"))
                            } else {
                                None
                            }
                        }) {
                            remove_empty_parent_dir(&to, &stop_at);
                        }
                    }
                }
                JournalEntry::Deduplicated {
                    removed_src,
                    existing_dest,
                    ..
                } => {
                    if let Ok(comps) = rel_components_under(&self.root, &removed_src) {
                        if comps.len() > 1 {
                            let _ = ensure_safe_dir_under(&self.root, &comps[..comps.len() - 1]);
                        }
                        if is_regular_file_no_follow(&existing_dest).unwrap_or(false)
                            && check_ancestors_under_root(&self.root, &comps).is_ok()
                        {
                            let temp =
                                removed_src.with_extension(format!("rb-{}", uuid::Uuid::new_v4()));
                            if fs::copy(&existing_dest, &temp).is_ok() {
                                if rename_with_retry(&temp, &removed_src).is_err() {
                                    let _ = fs::remove_file(&temp);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

fn remove_empty_parent_dir(file_path: &Path, stop_at: &Path) {
    if let Some(parent) = file_path.parent() {
        if parent != stop_at {
            if let Ok(meta) = fs::symlink_metadata(parent) {
                if meta.is_dir() && !meta.file_type().is_symlink() {
                    let _ = fs::remove_dir(parent);
                }
            }
        }
    }
}

fn is_custom_thumb_for_stem(name: &str, stem: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        let name_lower = name.to_lowercase();
        let stem_lower = stem.to_lowercase();
        let prefix = format!("{stem_lower}-t");
        if let Some(rest) = name_lower.strip_prefix(&prefix) {
            if let Some(ms) = rest.strip_suffix(".jpg") {
                return !ms.is_empty() && ms.bytes().all(|b| b.is_ascii_digit());
            }
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        let prefix = format!("{stem}-t");
        if let Some(rest) = name.strip_prefix(&prefix) {
            if let Some(ms) = rest.strip_suffix(".jpg") {
                return !ms.is_empty() && ms.bytes().all(|b| b.is_ascii_digit());
            }
        }
        false
    }
}

fn collect_matching_thumbs(
    root: &Path,
    dir_comps: &[&str],
    stem: &str,
    explicit_thumb: Option<&str>,
) -> Result<Vec<String>, String> {
    let dir = check_ancestors_under_root(root, dir_comps)?;
    let mut seen_keys = HashSet::new();
    let mut names = Vec::new();
    let mut push_unique = |name: String| {
        if seen_keys.insert(ref_key(&name)) {
            names.push(name);
        }
    };

    push_unique(format!("{stem}.jpg"));
    if let Some(t) = explicit_thumb {
        let valid = safe_single_name(t)?;
        push_unique(valid.to_string());
    }
    match fs::symlink_metadata(&dir) {
        Ok(meta) if meta.is_dir() => {
            for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let ft = entry.file_type().map_err(|e| e.to_string())?;
                let name = entry.file_name().to_string_lossy().into_owned();
                if is_custom_thumb_for_stem(&name, stem) {
                    if ft.is_symlink() {
                        return Err(format!(
                            "Refusing symlink/junction path: {}",
                            entry.path().display()
                        ));
                    }
                    if ft.is_file() {
                        push_unique(name);
                    }
                }
            }
        }
        Ok(_) => return Err(format!("Expected directory at {}", dir.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    Ok(names)
}

fn collect_matching_previews(stem: &str, explicit_preview: Option<&str>) -> Result<Vec<String>, String> {
    let mut seen_keys = HashSet::new();
    let mut names = Vec::new();
    let mut push_unique = |name: String| {
        if seen_keys.insert(ref_key(&name)) {
            names.push(name);
        }
    };
    push_unique(format!("{stem}.mp4"));
    push_unique(format!("{stem}.v2.mp4"));
    if let Some(p) = explicit_preview {
        let valid = safe_single_name(p)?;
        push_unique(valid.to_string());
    }
    Ok(names)
}

#[derive(Default)]
struct ReferenceSets {
    active_files: HashSet<String>,
    trashed_files: HashSet<String>,
    all_files: HashSet<String>,
    active_stems: HashSet<String>,
    all_stems: HashSet<String>,
    active_thumbs: HashSet<String>,
    all_thumbs: HashSet<String>,
    active_previews: HashSet<String>,
    all_previews: HashSet<String>,
    all_favicons: HashSet<String>,
    active_assets: Vec<(String, Option<String>, Option<String>)>,
    trashed_assets: Vec<(String, Option<String>, Option<String>)>,
    invalid_paths: Vec<String>,
}

fn collect_references(sources: &[Value]) -> ReferenceSets {
    let mut refs = ReferenceSets::default();
    for source in sources {
        let source_trashed = is_trashed_value(&source["trashedAt"]);
        if let Some(fav_raw) = source["favicon"].as_str() {
            if let Ok(fav) = safe_single_name(fav_raw) {
                refs.all_favicons.insert(ref_key(fav));
            } else if !fav_raw.trim().is_empty() {
                refs.invalid_paths.push(fav_raw.to_string());
            }
        }
        let Some(assets) = source["assets"].as_array() else {
            continue;
        };
        for asset in assets {
            let Some(file_raw) = asset["file"].as_str() else {
                continue;
            };
            let Ok(norm) = clean_rel_subpath(file_raw) else {
                refs.invalid_paths.push(file_raw.to_string());
                continue;
            };
            let asset_trashed = source_trashed || is_trashed_value(&asset["trashedAt"]);
            let thumb = match asset["thumbnail"].as_str() {
                Some(t_raw) if !t_raw.trim().is_empty() => match safe_single_name(t_raw) {
                    Ok(t) => Some(t.to_string()),
                    Err(_) => {
                        refs.invalid_paths.push(t_raw.to_string());
                        None
                    }
                },
                _ => None,
            };
            let preview = match asset["previewVideo"].as_str() {
                Some(p_raw) if !p_raw.trim().is_empty() => match safe_single_name(p_raw) {
                    Ok(p) => Some(p.to_string()),
                    Err(_) => {
                        refs.invalid_paths.push(p_raw.to_string());
                        None
                    }
                },
                _ => None,
            };

            let file_key = ref_key(&norm);
            refs.all_files.insert(file_key.clone());
            if let Some(stem) = file_stem_of_rel(&norm) {
                let stem_key = ref_key(&stem);
                refs.all_stems.insert(stem_key.clone());
                if !asset_trashed {
                    refs.active_stems.insert(stem_key);
                }
            }
            if let Some(ref t) = thumb {
                let t_key = ref_key(t);
                refs.all_thumbs.insert(t_key.clone());
                if !asset_trashed {
                    refs.active_thumbs.insert(t_key);
                }
            }
            if let Some(ref p) = preview {
                let p_key = ref_key(p);
                refs.all_previews.insert(p_key.clone());
                if !asset_trashed {
                    refs.active_previews.insert(p_key);
                }
            }

            if asset_trashed {
                refs.trashed_assets.push((norm, thumb, preview));
            } else {
                refs.active_files.insert(file_key);
                refs.active_assets.push((norm, thumb, preview));
            }
        }
    }
    for (rel, _, _) in &refs.trashed_assets {
        let key = ref_key(rel);
        if !refs.active_files.contains(&key) {
            refs.trashed_files.insert(key);
        }
    }
    refs
}

fn strip_suffix_ci<'a>(s: &'a str, suffix: &str) -> Option<&'a str> {
    #[cfg(target_os = "windows")]
    {
        if s.len() >= suffix.len() {
            let split = s.len() - suffix.len();
            if s.is_char_boundary(split) && s[split..].eq_ignore_ascii_case(suffix) {
                return Some(&s[..split]);
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        s.strip_suffix(suffix)
    }
}

fn thumb_stem_if_generated(name: &str) -> Option<&str> {
    let base = strip_suffix_ci(name, ".jpg")?;
    if let Some((stem, ms)) = base.rsplit_once("-t").or_else(|| {
        if cfg!(target_os = "windows") {
            base.rsplit_once("-T")
        } else {
            None
        }
    }) {
        if !stem.is_empty() && !ms.is_empty() && ms.bytes().all(|b| b.is_ascii_digit()) {
            return Some(stem);
        }
    }
    if !base.is_empty() {
        Some(base)
    } else {
        None
    }
}

fn preview_stem_if_generated(name: &str) -> Option<&str> {
    if let Some(stem) = strip_suffix_ci(name, ".v2.mp4") {
        if !stem.is_empty() {
            return Some(stem);
        }
    }
    if let Some(stem) = strip_suffix_ci(name, ".mp4") {
        if !stem.is_empty() {
            return Some(stem);
        }
    }
    None
}

fn is_thumb_active(name: &str, refs: &ReferenceSets) -> bool {
    if refs.active_thumbs.contains(&ref_key(name)) {
        return true;
    }
    if let Some(stem) = thumb_stem_if_generated(name) {
        if refs.active_stems.contains(&ref_key(stem)) {
            return true;
        }
    }
    false
}

fn is_preview_active(name: &str, refs: &ReferenceSets) -> bool {
    if refs.active_previews.contains(&ref_key(name)) {
        return true;
    }
    if let Some(stem) = preview_stem_if_generated(name) {
        if refs.active_stems.contains(&ref_key(stem)) {
            return true;
        }
    }
    false
}

fn is_thumb_referenced(name: &str, refs: &ReferenceSets) -> bool {
    if refs.all_thumbs.contains(&ref_key(name)) {
        return true;
    }
    if let Some(stem) = thumb_stem_if_generated(name) {
        if refs.all_stems.contains(&ref_key(stem)) {
            return true;
        }
    }
    false
}

fn is_preview_referenced(name: &str, refs: &ReferenceSets) -> bool {
    if refs.all_previews.contains(&ref_key(name)) {
        return true;
    }
    if let Some(stem) = preview_stem_if_generated(name) {
        if refs.all_stems.contains(&ref_key(stem)) {
            return true;
        }
    }
    false
}

fn is_content_collision_err(err: &str) -> bool {
    err.starts_with("Refusing to overwrite existing file with different content:")
}

fn handle_move_outcome_for_mode(
    strict: bool,
    res: Result<MoveOutcome, String>,
    action_label: &str,
    warnings: &mut Vec<String>,
) -> Result<bool, String> {
    match res {
        Ok(MoveOutcome::Moved) => Ok(true),
        Ok(MoveOutcome::Deduplicated | MoveOutcome::MissingSource) => Ok(false),
        Err(e) => {
            if !strict && is_content_collision_err(&e) {
                warnings.push(format!("{action_label}: {e}"));
                Ok(false)
            } else {
                Err(format!("{action_label}: {e}"))
            }
        }
    }
}

fn move_associated_media_to_trash(
    root: &Path,
    rel: &str,
    thumb: Option<&str>,
    preview: Option<&str>,
    refs: &ReferenceSets,
    strict: bool,
    journal: &mut MoveJournal,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    let Some(stem) = file_stem_of_rel(rel) else {
        return Ok(());
    };
    let thumbs_dir = root.join("thumbnails");
    let trash_thumbs = trash_thumbnails_dir(root);
    for name in collect_matching_thumbs(root, &["thumbnails"], &stem, thumb)? {
        if is_thumb_active(&name, refs) {
            continue;
        }
        let src = thumbs_dir.join(&name);
        if is_regular_file_no_follow(&src)? {
            let dest = trash_thumbs.join(&name);
            let res = journal.move_file(&src, &dest, None);
            handle_move_outcome_for_mode(
                strict,
                res,
                &format!("Could not move thumbnail {name} to trash"),
                warnings,
            )?;
        }
    }

    let previews_dir = root.join("previews");
    let trash_previews = trash_previews_dir(root);
    for name in collect_matching_previews(&stem, preview)? {
        if is_preview_active(&name, refs) {
            continue;
        }
        check_ancestors_under_root(root, &["previews", &name])?;
        check_ancestors_under_root(root, &[TRASH_DIR, "previews", &name])?;
        let src = previews_dir.join(&name);
        if is_regular_file_no_follow(&src)? {
            let dest = trash_previews.join(&name);
            let res = journal.move_file(&src, &dest, None);
            handle_move_outcome_for_mode(
                strict,
                res,
                &format!("Could not move preview {name} to trash"),
                warnings,
            )?;
        }
    }
    Ok(())
}

fn move_associated_media_to_active(
    root: &Path,
    rel: &str,
    thumb: Option<&str>,
    preview: Option<&str>,
    strict: bool,
    journal: &mut MoveJournal,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    let Some(stem) = file_stem_of_rel(rel) else {
        return Ok(());
    };
    let thumbs_dir = root.join("thumbnails");
    let trash_thumbs = trash_thumbnails_dir(root);
    for name in collect_matching_thumbs(root, &[TRASH_DIR, "thumbnails"], &stem, thumb)? {
        let src = trash_thumbs.join(&name);
        if is_regular_file_no_follow(&src)? {
            let dest = thumbs_dir.join(&name);
            let res = journal.move_file(&src, &dest, None);
            handle_move_outcome_for_mode(
                strict,
                res,
                &format!("Could not restore thumbnail {name}"),
                warnings,
            )?;
        }
    }

    let previews_dir = root.join("previews");
    let trash_previews = trash_previews_dir(root);
    for name in collect_matching_previews(&stem, preview)? {
        check_ancestors_under_root(root, &[TRASH_DIR, "previews", &name])?;
        check_ancestors_under_root(root, &["previews", &name])?;
        let src = trash_previews.join(&name);
        if is_regular_file_no_follow(&src)? {
            let dest = previews_dir.join(&name);
            let res = journal.move_file(&src, &dest, None);
            handle_move_outcome_for_mode(
                strict,
                res,
                &format!("Could not restore preview {name}"),
                warnings,
            )?;
        }
    }
    Ok(())
}

fn validate_reference_paths(refs: &ReferenceSets) -> Result<(), String> {
    if let Some(bad) = refs.invalid_paths.first() {
        return Err(format!("Invalid asset path in library: {bad}"));
    }
    Ok(())
}

fn reconcile_with_mode(
    root: &Path,
    sources: &[Value],
    strict: bool,
    journal_opt: Option<&mut MoveJournal>,
) -> Result<TrashSyncReport, String> {
    check_library_dirs_safe(root)?;
    let mut local_journal = MoveJournal::new(root);
    let journal = match journal_opt {
        Some(j) => j,
        None => &mut local_journal,
    };

    let mut report = TrashSyncReport::default();
    let refs = collect_references(sources);
    validate_reference_paths(&refs)?;

    let assets_dir = root.join("assets");
    let trash_assets = trash_assets_dir(root);

    // 1. Restore any active files currently sitting in trash/
    let mut restored_keys = HashSet::new();
    for (rel, thumb, preview) in &refs.active_assets {
        check_subpath_not_symlink_under(root, "assets", rel)?;
        check_trash_subpath_not_symlink(root, "assets", rel)?;
        if restored_keys.insert(ref_key(rel)) {
            let (active_path, _) = safe_subpath(&assets_dir, rel)?;
            let (trash_path, _) = safe_subpath(&trash_assets, rel)?;
            if is_regular_file_no_follow(&trash_path)? {
                let res = journal.move_file(&trash_path, &active_path, Some(&trash_assets));
                if handle_move_outcome_for_mode(
                    strict,
                    res,
                    &format!("Could not restore {rel} from trash"),
                    &mut report.warnings,
                )? {
                    report.restored_from_trash += 1;
                }
            }
        }
        move_associated_media_to_active(
            root,
            rel,
            thumb.as_deref(),
            preview.as_deref(),
            strict,
            journal,
            &mut report.warnings,
        )?;
    }

    // 2. Move any trashed-only files currently sitting in assets/ into trash/
    let mut trashed_keys = HashSet::new();
    for (rel, thumb, preview) in &refs.trashed_assets {
        let rel_key = ref_key(rel);
        if refs.active_files.contains(&rel_key) {
            continue;
        }
        check_subpath_not_symlink_under(root, "assets", rel)?;
        check_trash_subpath_not_symlink(root, "assets", rel)?;
        if trashed_keys.insert(rel_key) {
            let (active_path, _) = safe_subpath(&assets_dir, rel)?;
            let (trash_path, _) = safe_subpath(&trash_assets, rel)?;
            if is_regular_file_no_follow(&active_path)? {
                let res = journal.move_file(&active_path, &trash_path, Some(&assets_dir));
                if handle_move_outcome_for_mode(
                    strict,
                    res,
                    &format!("Could not move {rel} to trash"),
                    &mut report.warnings,
                )? {
                    report.moved_to_trash += 1;
                }
            }
        }
        move_associated_media_to_trash(
            root,
            rel,
            thumb.as_deref(),
            preview.as_deref(),
            &refs,
            strict,
            journal,
            &mut report.warnings,
        )?;
    }

    if matches!(local_journal.entries.as_slice(), [_, ..]) {
        local_journal.commit_cleanup();
    }
    Ok(report)
}

/// Synchronizes on-disk storage between `assets/` and `trash/` according to `sources`.
///
/// - Active assets whose files are in `trash/` are moved back to `assets/`.
/// - Trashed-only assets whose files are in `assets/` are moved to `trash/assets/`.
/// - Shared files with any active reference remain in `assets/`.
pub fn reconcile_trash_storage_at(
    root: &Path,
    sources: &[Value],
) -> Result<TrashSyncReport, String> {
    reconcile_with_mode(root, sources, false, None)
}

#[derive(Default)]
struct CandidateMedia {
    files: Vec<String>,
    thumbs: Vec<(String, Option<String>)>,
    previews: Vec<(String, Option<String>)>,
    favicons: Vec<String>,
}

fn collect_source_candidates(source: &Value, out: &mut CandidateMedia) -> Result<(), String> {
    if let Some(fav_raw) = source["favicon"].as_str() {
        if !fav_raw.trim().is_empty() {
            let fav = safe_single_name(fav_raw)?;
            out.favicons.push(fav.to_string());
        }
    }
    if let Some(assets) = source["assets"].as_array() {
        for asset in assets {
            collect_asset_candidates(asset, out)?;
        }
    }
    Ok(())
}

fn collect_asset_candidates(asset: &Value, out: &mut CandidateMedia) -> Result<(), String> {
    let Some(file_raw) = asset["file"].as_str() else {
        return Ok(());
    };
    if file_raw.trim().is_empty() {
        return Ok(());
    }
    let norm = clean_rel_subpath(file_raw)?;
    out.files.push(norm.clone());
    let thumb = match asset["thumbnail"].as_str() {
        Some(t_raw) if !t_raw.trim().is_empty() => Some(safe_single_name(t_raw)?.to_string()),
        _ => None,
    };
    let preview = match asset["previewVideo"].as_str() {
        Some(p_raw) if !p_raw.trim().is_empty() => Some(safe_single_name(p_raw)?.to_string()),
        _ => None,
    };
    out.thumbs.push((norm.clone(), thumb));
    out.previews.push((norm, preview));
    Ok(())
}

fn validate_candidates_safe(root: &Path, candidates: &CandidateMedia) -> Result<(), String> {
    check_library_dirs_safe(root)?;
    for rel in &candidates.files {
        check_subpath_not_symlink_under(root, "assets", rel)?;
        check_trash_subpath_not_symlink(root, "assets", rel)?;
    }
    for (rel, explicit_thumb) in &candidates.thumbs {
        if let Some(stem) = file_stem_of_rel(rel) {
            let _ = collect_matching_thumbs(root, &["thumbnails"], &stem, explicit_thumb.as_deref())?;
            let _ = collect_matching_thumbs(
                root,
                &[TRASH_DIR, "thumbnails"],
                &stem,
                explicit_thumb.as_deref(),
            )?;
        } else if let Some(name) = explicit_thumb.as_deref() {
            let valid = safe_single_name(name)?;
            check_ancestors_under_root(root, &["thumbnails", valid])?;
            check_ancestors_under_root(root, &[TRASH_DIR, "thumbnails", valid])?;
        }
    }
    for (rel, explicit_preview) in &candidates.previews {
        if let Some(stem) = file_stem_of_rel(rel) {
            for name in collect_matching_previews(&stem, explicit_preview.as_deref())? {
                check_ancestors_under_root(root, &["previews", &name])?;
                check_ancestors_under_root(root, &[TRASH_DIR, "previews", &name])?;
            }
        }
    }
    for fav in &candidates.favicons {
        let valid = safe_single_name(fav)?;
        check_ancestors_under_root(root, &["favicons", valid])?;
    }
    Ok(())
}

fn remove_file_if_regular(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err(format!("Refusing to delete symlink: {}", path.display()));
            }
            if meta.is_file() {
                remove_file_with_retry(path)?;
                return Ok(true);
            }
            Ok(false)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

fn delete_unreferenced_candidates(
    root: &Path,
    remaining_sources: &[Value],
    candidates: &CandidateMedia,
    warnings: &mut Vec<String>,
) -> usize {
    if let Err(e) = check_library_dirs_safe(root) {
        warnings.push(e);
        return 0;
    }
    let refs = collect_references(remaining_sources);
    let mut deleted = 0usize;
    let assets_dir = root.join("assets");
    let trash_assets = trash_assets_dir(root);

    let mut seen_file_keys = HashSet::new();
    for raw in &candidates.files {
        let Ok(rel) = clean_rel_subpath(raw) else {
            warnings.push(format!("Skipped unsafe asset path during cleanup: {raw}"));
            continue;
        };
        let key = ref_key(&rel);
        if !seen_file_keys.insert(key.clone()) || refs.all_files.contains(&key) {
            continue;
        }
        if let Err(e) = check_subpath_not_symlink_under(root, "assets", &rel) {
            warnings.push(e);
        } else if let Ok((active_path, _)) = safe_subpath(&assets_dir, &rel) {
            match remove_file_if_regular(&active_path) {
                Ok(true) => {
                    deleted += 1;
                    remove_empty_parent_dir(&active_path, &assets_dir);
                }
                Ok(false) => {}
                Err(e) => warnings.push(e),
            }
        }
        if let Err(e) = check_trash_subpath_not_symlink(root, "assets", &rel) {
            warnings.push(e);
        } else if let Ok((trash_path, _)) = safe_subpath(&trash_assets, &rel) {
            match remove_file_if_regular(&trash_path) {
                Ok(true) => {
                    deleted += 1;
                    remove_empty_parent_dir(&trash_path, &trash_assets);
                }
                Ok(false) => {}
                Err(e) => warnings.push(e),
            }
        }
    }

    let thumbs_dir = root.join("thumbnails");
    let trash_thumbs = trash_thumbnails_dir(root);
    let mut seen_thumbs = HashSet::new();
    for (rel, explicit_thumb) in &candidates.thumbs {
        if let Some(stem) = file_stem_of_rel(rel) {
            for (dir, dir_comps) in [
                (&thumbs_dir, &["thumbnails"][..]),
                (&trash_thumbs, &[TRASH_DIR, "thumbnails"][..]),
            ] {
                match collect_matching_thumbs(root, dir_comps, &stem, explicit_thumb.as_deref()) {
                    Ok(names) => {
                        for name in names {
                            if !seen_thumbs.insert((dir.to_path_buf(), ref_key(&name))) {
                                continue;
                            }
                            if is_thumb_referenced(&name, &refs) {
                                continue;
                            }
                            match remove_file_if_regular(&dir.join(&name)) {
                                Ok(true) => deleted += 1,
                                Ok(false) => {}
                                Err(e) => warnings.push(e),
                            }
                        }
                    }
                    Err(e) => warnings.push(e),
                }
            }
        } else if let Some(name) = explicit_thumb.as_deref().and_then(|s| safe_single_name(s).ok()) {
            for (dir, dir_comps) in [
                (&thumbs_dir, &["thumbnails"][..]),
                (&trash_thumbs, &[TRASH_DIR, "thumbnails"][..]),
            ] {
                if check_ancestors_under_root(root, dir_comps).is_ok()
                    && !is_thumb_referenced(name, &refs)
                {
                    match remove_file_if_regular(&dir.join(name)) {
                        Ok(true) => deleted += 1,
                        Ok(false) => {}
                        Err(e) => warnings.push(e),
                    }
                }
            }
        }
    }

    let previews_dir = root.join("previews");
    let trash_previews = trash_previews_dir(root);
    let mut seen_previews = HashSet::new();
    for (rel, explicit_preview) in &candidates.previews {
        if let Some(stem) = file_stem_of_rel(rel) {
            if let Ok(names) = collect_matching_previews(&stem, explicit_preview.as_deref()) {
                for (dir, dir_comps) in [
                    (&previews_dir, &["previews"][..]),
                    (&trash_previews, &[TRASH_DIR, "previews"][..]),
                ] {
                    if let Err(e) = check_ancestors_under_root(root, dir_comps) {
                        warnings.push(e);
                        continue;
                    }
                    for name in &names {
                        if !seen_previews.insert((dir.to_path_buf(), ref_key(name))) {
                            continue;
                        }
                        if is_preview_referenced(name, &refs) {
                            continue;
                        }
                        match remove_file_if_regular(&dir.join(name)) {
                            Ok(true) => deleted += 1,
                            Ok(false) => {}
                            Err(e) => warnings.push(e),
                        }
                    }
                }
            }
        }
    }

    let favicons_dir = root.join("favicons");
    if let Err(e) = check_ancestors_under_root(root, &["favicons"]) {
        warnings.push(e);
        return deleted;
    }
    let mut seen_favicons = HashSet::new();
    for raw in &candidates.favicons {
        let Ok(fav) = safe_single_name(raw) else {
            continue;
        };
        let key = ref_key(fav);
        if !seen_favicons.insert(key.clone()) || refs.all_favicons.contains(&key) {
            continue;
        }
        match remove_file_if_regular(&favicons_dir.join(fav)) {
            Ok(true) => deleted += 1,
            Ok(false) => {}
            Err(e) => warnings.push(e),
        }
    }

    deleted
}

/// Removes unreferenced files inside `<library>/trash/{assets,thumbnails,previews}` without following symlinks.
fn sweep_unreferenced_trash_dir(
    root: &Path,
    remaining_sources: &[Value],
    warnings: &mut Vec<String>,
) -> usize {
    if let Err(e) = check_ancestors_under_root(root, &[TRASH_DIR]) {
        warnings.push(e);
        return 0;
    }

    let refs = collect_references(remaining_sources);
    let mut deleted = 0usize;

    let trash_assets = trash_assets_dir(root);
    match check_ancestors_under_root(root, &[TRASH_DIR, "assets"]) {
        Err(e) => warnings.push(e),
        Ok(_) => {
            if fs::symlink_metadata(&trash_assets)
                .map(|m| m.is_dir())
                .unwrap_or(false)
            {
                if let Ok(entries) = fs::read_dir(&trash_assets) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        let Ok(meta) = fs::symlink_metadata(&path) else {
                            continue;
                        };
                        if meta.file_type().is_symlink() {
                            warnings.push(format!("Skipped symlink in trash: {}", path.display()));
                            continue;
                        }
                        let name = entry.file_name().to_string_lossy().into_owned();
                        if meta.is_file() {
                            if !refs.all_files.contains(&ref_key(&name)) {
                                match remove_file_if_regular(&path) {
                                    Ok(true) => deleted += 1,
                                    Ok(false) => {}
                                    Err(e) => warnings.push(e),
                                }
                            }
                        } else if meta.is_dir() {
                            if let Ok(sub_entries) = fs::read_dir(&path) {
                                for sub in sub_entries.flatten() {
                                    let sub_path = sub.path();
                                    let Ok(sub_meta) = fs::symlink_metadata(&sub_path) else {
                                        continue;
                                    };
                                    if sub_meta.file_type().is_symlink() {
                                        warnings.push(format!(
                                            "Skipped symlink in trash: {}",
                                            sub_path.display()
                                        ));
                                        continue;
                                    }
                                    if sub_meta.is_file() {
                                        let rel = format!(
                                            "{name}/{}",
                                            sub.file_name().to_string_lossy()
                                        );
                                        if !refs.all_files.contains(&ref_key(&rel)) {
                                            match remove_file_if_regular(&sub_path) {
                                                Ok(true) => deleted += 1,
                                                Ok(false) => {}
                                                Err(e) => warnings.push(e),
                                            }
                                        }
                                    }
                                }
                            }
                            let _ = fs::remove_dir(&path);
                        }
                    }
                }
                let _ = fs::remove_dir(&trash_assets);
            }
        }
    }

    let trash_thumbs = trash_thumbnails_dir(root);
    match check_ancestors_under_root(root, &[TRASH_DIR, "thumbnails"]) {
        Err(e) => warnings.push(e),
        Ok(_) => {
            if fs::symlink_metadata(&trash_thumbs)
                .map(|m| m.is_dir())
                .unwrap_or(false)
            {
                if let Ok(entries) = fs::read_dir(&trash_thumbs) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        let Ok(meta) = fs::symlink_metadata(&path) else {
                            continue;
                        };
                        if meta.file_type().is_symlink() || !meta.is_file() {
                            continue;
                        }
                        let name = entry.file_name().to_string_lossy().into_owned();
                        if !is_thumb_referenced(&name, &refs) {
                            match remove_file_if_regular(&path) {
                                Ok(true) => deleted += 1,
                                Ok(false) => {}
                                Err(e) => warnings.push(e),
                            }
                        }
                    }
                }
                let _ = fs::remove_dir(&trash_thumbs);
            }
        }
    }

    let trash_previews = trash_previews_dir(root);
    match check_ancestors_under_root(root, &[TRASH_DIR, "previews"]) {
        Err(e) => warnings.push(e),
        Ok(_) => {
            if fs::symlink_metadata(&trash_previews)
                .map(|m| m.is_dir())
                .unwrap_or(false)
            {
                if let Ok(entries) = fs::read_dir(&trash_previews) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        let Ok(meta) = fs::symlink_metadata(&path) else {
                            continue;
                        };
                        if meta.file_type().is_symlink() || !meta.is_file() {
                            continue;
                        }
                        let name = entry.file_name().to_string_lossy().into_owned();
                        if !is_preview_referenced(&name, &refs) {
                            match remove_file_if_regular(&path) {
                                Ok(true) => deleted += 1,
                                Ok(false) => {}
                                Err(e) => warnings.push(e),
                            }
                        }
                    }
                }
                let _ = fs::remove_dir(&trash_previews);
            }
        }
    }

    let tr = trash_root(root);
    if fs::symlink_metadata(&tr)
        .map(|m| m.is_dir() && !m.file_type().is_symlink())
        .unwrap_or(false)
    {
        let _ = fs::remove_dir(&tr);
    }

    deleted
}

/// Deletes a single unreferenced asset file (and its thumbnails/previews) from both
/// active storage and trash storage. Preserves compatibility with `delete_asset_file`.
pub fn delete_unreferenced_asset_file_at(root: &Path, rel: &str) -> Result<(), String> {
    check_library_dirs_safe(root)?;
    let assets_dir = root.join("assets");
    let trash_assets = trash_assets_dir(root);
    let (active_asset, clean_rel) = safe_subpath(&assets_dir, rel)?;
    let (trash_asset, _) = safe_subpath(&trash_assets, &clean_rel)?;

    let sources = read_library_array(root)?;
    let refs = collect_references(&sources);
    if refs.all_files.contains(&ref_key(&clean_rel)) {
        return Ok(());
    }

    check_subpath_not_symlink_under(root, "assets", &clean_rel)?;
    check_trash_subpath_not_symlink(root, "assets", &clean_rel)?;

    if remove_file_if_regular(&active_asset)? {
        remove_empty_parent_dir(&active_asset, &assets_dir);
    }
    if remove_file_if_regular(&trash_asset)? {
        remove_empty_parent_dir(&trash_asset, &trash_assets);
    }

    if let Some(stem) = file_stem_of_rel(&clean_rel) {
        for (dir, dir_comps) in [
            (root.join("thumbnails"), &["thumbnails"][..]),
            (trash_thumbnails_dir(root), &[TRASH_DIR, "thumbnails"][..]),
        ] {
            for name in collect_matching_thumbs(root, dir_comps, &stem, None)? {
                if !is_thumb_referenced(&name, &refs) {
                    remove_file_if_regular(&dir.join(&name))?;
                }
            }
        }
        for (dir, dir_comps) in [
            (root.join("previews"), &["previews"][..]),
            (trash_previews_dir(root), &[TRASH_DIR, "previews"][..]),
        ] {
            check_ancestors_under_root(root, dir_comps)?;
            for name in collect_matching_previews(&stem, None)? {
                if !is_preview_referenced(&name, &refs) {
                    check_not_symlink(&dir.join(&name))?;
                    remove_file_if_regular(&dir.join(&name))?;
                }
            }
        }
    }

    Ok(())
}

/// Resolves an asset relative path on disk, checking active storage and trash storage.
pub fn resolve_asset_disk_path(
    root: &Path,
    rel: &str,
    prefer_trash: Option<bool>,
) -> Result<PathBuf, String> {
    check_library_dirs_safe(root)?;
    let assets_dir = root.join("assets");
    let trash_assets = trash_assets_dir(root);
    let (active_path, clean_rel) = safe_subpath(&assets_dir, rel)?;
    let (trash_path, _) = safe_subpath(&trash_assets, &clean_rel)?;
    check_subpath_not_symlink_under(root, "assets", &clean_rel)?;
    check_trash_subpath_not_symlink(root, "assets", &clean_rel)?;

    let (first, second) = match prefer_trash {
        Some(true) => (trash_path, active_path),
        _ => (active_path, trash_path),
    };
    if is_regular_file_no_follow(&first)? {
        Ok(first)
    } else if is_regular_file_no_follow(&second)? {
        Ok(second)
    } else {
        Err("Asset file not found on disk".into())
    }
}

/// Renames a source's folder in `trash/assets/` if it exists, checking collisions up front.
pub fn check_trash_folder_rename_ready(
    root: &Path,
    old_folder: &str,
    new_folder: &str,
) -> Result<(), String> {
    let old_name = safe_single_name(old_folder)?;
    let new_name = safe_single_name(new_folder)?;
    check_library_dirs_safe(root)?;
    let old_path = check_ancestors_under_root(root, &[TRASH_DIR, "assets", old_name])?;
    match fs::symlink_metadata(&old_path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err(format!("Refusing symlink/junction path: {}", old_path.display()));
            }
            if !meta.is_dir() {
                return Err(format!("Expected directory at {}", old_path.display()));
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    }
    let new_path = check_ancestors_under_root(root, &[TRASH_DIR, "assets", new_name])?;
    match fs::symlink_metadata(&new_path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err(format!("Refusing symlink/junction path: {}", new_path.display()));
            }
            #[cfg(target_os = "windows")]
            let same_ci = old_name.eq_ignore_ascii_case(new_name);
            #[cfg(not(target_os = "windows"))]
            let same_ci = old_name == new_name;
            if !same_ci {
                return Err("Target source trash folder already exists".into());
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    Ok(())
}

pub fn rename_trash_folder_at(
    root: &Path,
    old_folder: &str,
    new_folder: &str,
) -> Result<(), String> {
    let old_name = safe_single_name(old_folder)?;
    let new_name = safe_single_name(new_folder)?;
    if old_name == new_name {
        return Ok(());
    }
    check_trash_folder_rename_ready(root, old_name, new_name)?;
    let trash_assets = trash_assets_dir(root);
    let old_path = trash_assets.join(old_name);
    if fs::symlink_metadata(&old_path).is_err() {
        return Ok(());
    }
    let new_path = trash_assets.join(new_name);
    fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Could not rename source trash folder: {e}"))
}

fn read_library_array(root: &Path) -> Result<Vec<Value>, String> {
    let index = root.join("library.json");
    match fs::symlink_metadata(&index) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err("Refusing symlink library.json".into());
            }
            if !meta.is_file() {
                return Err("library.json is not a regular file".into());
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    }
    let data = fs::read_to_string(&index).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    value
        .as_array()
        .cloned()
        .ok_or_else(|| "Library index must be an array".to_string())
}

fn serialize_and_write_library(root: &Path, sources: &[Value]) -> Result<String, String> {
    let json = serde_json::to_string(sources).map_err(|e| e.to_string())?;
    super::write_library_index_at(root, &json)?;
    Ok(json)
}

fn refresh_cover_id_if_needed(source_obj: &mut serde_json::Map<String, Value>) {
    let current_cover = source_obj
        .get("coverId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let Some(cover_id) = current_cover else {
        return;
    };
    let still_exists = source_obj
        .get("assets")
        .and_then(|v| v.as_array())
        .map(|assets| {
            assets.iter().any(|a| {
                a["id"].as_str() == Some(cover_id.as_str()) && !is_trashed_value(&a["trashedAt"])
            })
        })
        .unwrap_or(false);
    if !still_exists {
        source_obj.remove("coverId");
    }
}

/// Moves targeted sources or assets into Trash and moves unshared files to `trash/`.
pub fn trash_items_at(
    root: &Path,
    targets: &[TrashTarget],
    now_iso: Option<&str>,
) -> Result<TrashCommandResult, String> {
    check_library_dirs_safe(root)?;
    let mut sources = read_library_array(root)?;
    let stamp = match now_iso {
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() || parse_iso8601_utc_secs(trimmed).is_none() {
                return Err("Invalid trash timestamp".into());
            }
            trimmed.to_string()
        }
        None => format_unix_secs_iso8601(current_unix_secs()),
    };

    let mut source_targets = HashSet::new();
    let mut asset_targets: HashMap<&str, HashSet<&str>> = HashMap::new();
    for target in targets {
        match target.asset_id.as_deref() {
            Some(aid) => {
                asset_targets
                    .entry(target.source_id.as_str())
                    .or_default()
                    .insert(aid);
            }
            None => {
                source_targets.insert(target.source_id.as_str());
            }
        }
    }

    let mut trashed_count = 0usize;
    for source in sources.iter_mut() {
        let Some(sid) = source["id"].as_str().map(|s| s.to_string()) else {
            continue;
        };
        if source_targets.contains(sid.as_str()) {
            if !is_trashed_value(&source["trashedAt"]) {
                if let Some(obj) = source.as_object_mut() {
                    obj.insert("trashedAt".to_string(), Value::String(stamp.clone()));
                    trashed_count += 1;
                }
            }
            continue;
        }
        if let Some(wanted_assets) = asset_targets.get(sid.as_str()) {
            if let Some(obj) = source.as_object_mut() {
                if let Some(assets) = obj.get_mut("assets").and_then(|v| v.as_array_mut()) {
                    for asset in assets.iter_mut() {
                        let Some(aid) = asset["id"].as_str() else {
                            continue;
                        };
                        if wanted_assets.contains(aid) && !is_trashed_value(&asset["trashedAt"]) {
                            if let Some(aobj) = asset.as_object_mut() {
                                aobj.insert("trashedAt".to_string(), Value::String(stamp.clone()));
                                trashed_count += 1;
                            }
                        }
                    }
                }
                refresh_cover_id_if_needed(obj);
            }
        }
    }

    let mut journal = MoveJournal::new(root);
    let sync = match reconcile_with_mode(root, &sources, true, Some(&mut journal)) {
        Ok(report) => report,
        Err(e) => {
            journal.rollback();
            return Err(e);
        }
    };

    let library = if trashed_count > 0 {
        match serialize_and_write_library(root, &sources) {
            Ok(json) => json,
            Err(e) => {
                journal.rollback();
                return Err(e);
            }
        }
    } else {
        serde_json::to_string(&sources).map_err(|e| e.to_string())?
    };

    journal.commit_cleanup();

    Ok(TrashCommandResult {
        library,
        trashed_count,
        moved_to_trash: sync.moved_to_trash,
        restored_from_trash: sync.restored_from_trash,
        warnings: sync.warnings,
        ..Default::default()
    })
}

/// Restores targeted sources or assets from Trash, moving files back to `assets/` before saving.
pub fn restore_items_at(root: &Path, targets: &[TrashTarget]) -> Result<TrashCommandResult, String> {
    check_library_dirs_safe(root)?;
    let mut sources = read_library_array(root)?;
    let mut source_targets = HashSet::new();
    let mut asset_targets: HashMap<&str, HashSet<&str>> = HashMap::new();
    for target in targets {
        match target.asset_id.as_deref() {
            Some(aid) => {
                asset_targets
                    .entry(target.source_id.as_str())
                    .or_default()
                    .insert(aid);
            }
            None => {
                source_targets.insert(target.source_id.as_str());
            }
        }
    }

    let mut restored_count = 0usize;
    for source in sources.iter_mut() {
        let Some(sid) = source["id"].as_str().map(|s| s.to_string()) else {
            continue;
        };
        if source_targets.contains(sid.as_str()) {
            if is_trashed_value(&source["trashedAt"]) {
                if let Some(obj) = source.as_object_mut() {
                    obj.remove("trashedAt");
                    restored_count += 1;
                }
            }
            continue;
        }
        if let Some(wanted_assets) = asset_targets.get(sid.as_str()) {
            if let Some(assets) = source.get_mut("assets").and_then(|v| v.as_array_mut()) {
                for asset in assets.iter_mut() {
                    let Some(aid) = asset["id"].as_str() else {
                        continue;
                    };
                    if wanted_assets.contains(aid) && is_trashed_value(&asset["trashedAt"]) {
                        if let Some(aobj) = asset.as_object_mut() {
                            aobj.remove("trashedAt");
                            restored_count += 1;
                        }
                    }
                }
            }
        }
    }

    // Move files back to active storage before exposing restored metadata in library.json.
    let mut journal = MoveJournal::new(root);
    let sync = match reconcile_with_mode(root, &sources, true, Some(&mut journal)) {
        Ok(report) => report,
        Err(e) => {
            journal.rollback();
            return Err(e);
        }
    };

    let library = if restored_count > 0 {
        match serialize_and_write_library(root, &sources) {
            Ok(json) => json,
            Err(e) => {
                journal.rollback();
                return Err(e);
            }
        }
    } else {
        serde_json::to_string(&sources).map_err(|e| e.to_string())?
    };

    journal.commit_cleanup();

    Ok(TrashCommandResult {
        library,
        restored_count,
        moved_to_trash: sync.moved_to_trash,
        restored_from_trash: sync.restored_from_trash,
        warnings: sync.warnings,
        ..Default::default()
    })
}

/// Permanently deletes only trashed sources or trashed assets from `library.json` and disk.
/// Non-trashed targets are safely ignored so active items cannot be wiped accidentally.
pub fn permanently_delete_trashed_at(
    root: &Path,
    targets: &[TrashTarget],
) -> Result<TrashCommandResult, String> {
    check_library_dirs_safe(root)?;
    let sources = read_library_array(root)?;
    let mut source_targets = HashSet::new();
    let mut asset_targets: HashMap<&str, HashSet<&str>> = HashMap::new();
    for target in targets {
        match target.asset_id.as_deref() {
            Some(aid) => {
                asset_targets
                    .entry(target.source_id.as_str())
                    .or_default()
                    .insert(aid);
            }
            None => {
                source_targets.insert(target.source_id.as_str());
            }
        }
    }

    let mut remaining = Vec::with_capacity(sources.len());
    let mut candidates = CandidateMedia::default();
    let mut deleted_sources = 0usize;
    let mut deleted_assets = 0usize;

    for mut source in sources {
        let sid = source["id"].as_str().unwrap_or("").to_string();
        let source_trashed = is_trashed_value(&source["trashedAt"]);
        if source_targets.contains(sid.as_str()) && source_trashed {
            deleted_sources += 1;
            deleted_assets += source["assets"].as_array().map(|a| a.len()).unwrap_or(0);
            collect_source_candidates(&source, &mut candidates)?;
            continue;
        }
        if let Some(wanted_assets) = asset_targets.get(sid.as_str()) {
            if let Some(obj) = source.as_object_mut() {
                if let Some(assets) = obj.get_mut("assets").and_then(|v| v.as_array_mut()) {
                    let orig = std::mem::take(assets);
                    let mut kept = Vec::with_capacity(orig.len());
                    for asset in orig {
                        let aid = asset["id"].as_str().unwrap_or("");
                        let asset_trashed = source_trashed || is_trashed_value(&asset["trashedAt"]);
                        if wanted_assets.contains(aid) && asset_trashed {
                            deleted_assets += 1;
                            collect_asset_candidates(&asset, &mut candidates)?;
                        } else {
                            kept.push(asset);
                        }
                    }
                    *assets = kept;
                }
                refresh_cover_id_if_needed(obj);
            }
        }
        remaining.push(source);
    }

    validate_reference_paths(&collect_references(&remaining))?;
    validate_candidates_safe(root, &candidates)?;

    let changed = deleted_sources > 0 || deleted_assets > 0;
    let library = if changed {
        serialize_and_write_library(root, &remaining)?
    } else {
        serde_json::to_string(&remaining).map_err(|e| e.to_string())?
    };

    let mut warnings = Vec::new();
    let deleted_files = if changed {
        delete_unreferenced_candidates(root, &remaining, &candidates, &mut warnings)
    } else {
        0
    };

    Ok(TrashCommandResult {
        library,
        deleted_sources,
        deleted_assets,
        deleted_files,
        warnings,
        ..Default::default()
    })
}

/// Permanently deletes all trashed sources and trashed assets, and sweeps `<library>/trash/`.
pub fn clear_trash_at(root: &Path) -> Result<TrashCommandResult, String> {
    check_library_dirs_safe(root)?;
    let sources = read_library_array(root)?;
    let mut remaining = Vec::with_capacity(sources.len());
    let mut candidates = CandidateMedia::default();
    let mut deleted_sources = 0usize;
    let mut deleted_assets = 0usize;

    for mut source in sources {
        if is_trashed_value(&source["trashedAt"]) {
            deleted_sources += 1;
            deleted_assets += source["assets"].as_array().map(|a| a.len()).unwrap_or(0);
            collect_source_candidates(&source, &mut candidates)?;
            continue;
        }
        if let Some(obj) = source.as_object_mut() {
            if let Some(assets) = obj.get_mut("assets").and_then(|v| v.as_array_mut()) {
                let orig = std::mem::take(assets);
                let mut kept = Vec::with_capacity(orig.len());
                for asset in orig {
                    if is_trashed_value(&asset["trashedAt"]) {
                        deleted_assets += 1;
                        collect_asset_candidates(&asset, &mut candidates)?;
                    } else {
                        kept.push(asset);
                    }
                }
                *assets = kept;
            }
            refresh_cover_id_if_needed(obj);
        }
        remaining.push(source);
    }

    validate_reference_paths(&collect_references(&remaining))?;
    validate_candidates_safe(root, &candidates)?;

    let changed = deleted_sources > 0 || deleted_assets > 0;
    let library = if changed {
        serialize_and_write_library(root, &remaining)?
    } else {
        serde_json::to_string(&remaining).map_err(|e| e.to_string())?
    };

    let mut warnings = Vec::new();
    let mut deleted_files = if changed {
        delete_unreferenced_candidates(root, &remaining, &candidates, &mut warnings)
    } else {
        0
    };
    deleted_files += sweep_unreferenced_trash_dir(root, &remaining, &mut warnings);

    Ok(TrashCommandResult {
        library,
        deleted_sources,
        deleted_assets,
        deleted_files,
        warnings,
        ..Default::default()
    })
}

/// Purges any trashed sources or trashed assets whose `trashedAt` is at least `retention_secs` old.
pub fn purge_expired_trash_in_sources(
    root: &Path,
    sources: &mut Vec<Value>,
    now_secs: i64,
    retention_secs: i64,
) -> Result<TrashPurgeResult, String> {
    check_library_dirs_safe(root)?;
    let mut remaining = Vec::with_capacity(sources.len());
    let mut candidates = CandidateMedia::default();
    let mut deleted_sources = 0usize;
    let mut deleted_assets = 0usize;

    for source in sources.iter() {
        let source_expired = source["trashedAt"]
            .as_str()
            .map(|ts| is_expired_at(ts, now_secs, retention_secs))
            .unwrap_or(false);
        if source_expired {
            deleted_sources += 1;
            deleted_assets += source["assets"].as_array().map(|a| a.len()).unwrap_or(0);
            collect_source_candidates(source, &mut candidates)?;
            continue;
        }
        let mut next_source = source.clone();
        if let Some(obj) = next_source.as_object_mut() {
            if let Some(assets) = obj.get_mut("assets").and_then(|v| v.as_array_mut()) {
                let orig = std::mem::take(assets);
                let mut kept = Vec::with_capacity(orig.len());
                for asset in orig {
                    let asset_expired = asset["trashedAt"]
                        .as_str()
                        .map(|ts| is_expired_at(ts, now_secs, retention_secs))
                        .unwrap_or(false);
                    if asset_expired {
                        deleted_assets += 1;
                        collect_asset_candidates(&asset, &mut candidates)?;
                    } else {
                        kept.push(asset);
                    }
                }
                *assets = kept;
            }
            refresh_cover_id_if_needed(obj);
        }
        remaining.push(next_source);
    }

    let changed = deleted_sources > 0 || deleted_assets > 0;
    if !changed {
        return Ok(TrashPurgeResult::default());
    }

    validate_reference_paths(&collect_references(&remaining))?;
    validate_candidates_safe(root, &candidates)?;

    let index_path = root.join("library.json");
    match fs::symlink_metadata(&index_path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err("Refusing symlink library.json".into());
            }
            serialize_and_write_library(root, &remaining)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }

    *sources = remaining;
    let mut warnings = Vec::new();
    let deleted_files = delete_unreferenced_candidates(root, sources, &candidates, &mut warnings);

    Ok(TrashPurgeResult {
        changed,
        deleted_sources,
        deleted_assets,
        deleted_files,
        warnings,
    })
}

pub fn purge_expired_trash_at(
    root: &Path,
    now_secs: i64,
    retention_secs: i64,
) -> Result<TrashCommandResult, String> {
    let mut sources = read_library_array(root)?;
    let purge = purge_expired_trash_in_sources(root, &mut sources, now_secs, retention_secs)?;
    let library = serde_json::to_string(&sources).map_err(|e| e.to_string())?;
    let sync = reconcile_trash_storage_at(root, &sources)?;
    let mut warnings = purge.warnings;
    warnings.extend(sync.warnings);

    Ok(TrashCommandResult {
        library,
        deleted_sources: purge.deleted_sources,
        deleted_assets: purge.deleted_assets,
        deleted_files: purge.deleted_files,
        moved_to_trash: sync.moved_to_trash,
        restored_from_trash: sync.restored_from_trash,
        warnings,
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct TestLib(PathBuf);
    impl TestLib {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "sightline-trash-test-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(path.join("assets")).unwrap();
            fs::create_dir_all(path.join("thumbnails")).unwrap();
            fs::create_dir_all(path.join("previews")).unwrap();
            fs::create_dir_all(path.join("favicons")).unwrap();
            Self(path)
        }

        fn write_index(&self, value: Value) {
            fs::write(
                self.0.join("library.json"),
                serde_json::to_string_pretty(&value).unwrap(),
            )
            .unwrap();
        }

        fn read_index(&self) -> Vec<Value> {
            let raw = fs::read_to_string(self.0.join("library.json")).unwrap();
            serde_json::from_str(&raw).unwrap()
        }

        fn write_asset(&self, rel: &str, bytes: &[u8]) {
            let p = self.0.join("assets").join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, bytes).unwrap();
        }

        fn write_thumb(&self, name: &str, bytes: &[u8]) {
            fs::write(self.0.join("thumbnails").join(name), bytes).unwrap();
        }

        fn write_preview(&self, name: &str, bytes: &[u8]) {
            fs::write(self.0.join("previews").join(name), bytes).unwrap();
        }

        fn write_favicon(&self, name: &str, bytes: &[u8]) {
            fs::write(self.0.join("favicons").join(name), bytes).unwrap();
        }
    }
    impl Drop for TestLib {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn parses_iso_timestamps_and_checks_30_day_expiration_safely() {
        let t0 = parse_iso8601_utc_secs("2026-10-01T12:00:00.000Z").unwrap();
        assert_eq!(
            parse_iso8601_utc_secs("2026-10-01T15:00:00+03:00").unwrap(),
            t0
        );
        assert_eq!(
            parse_iso8601_utc_secs("2026-10-01T07:00:00-05:00").unwrap(),
            t0
        );
        assert_eq!(
            parse_iso8601_utc_secs("2026-10-01").unwrap(),
            parse_iso8601_utc_secs("2026-10-01T00:00:00Z").unwrap()
        );
        assert_eq!(format_unix_secs_iso8601(t0), "2026-10-01T12:00:00.000Z");

        // Leap year validation
        assert!(parse_iso8601_utc_secs("2024-02-29T00:00:00Z").is_some());
        assert!(parse_iso8601_utc_secs("2025-02-29T00:00:00Z").is_none());
        assert!(parse_iso8601_utc_secs("not-a-date").is_none());
        assert!(parse_iso8601_utc_secs("").is_none());

        // Exactly 30 days boundary
        assert!(!is_expired_at(
            "2026-10-01T12:00:00Z",
            t0 + TRASH_RETENTION_SECS - 1,
            TRASH_RETENTION_SECS
        ));
        assert!(is_expired_at(
            "2026-10-01T12:00:00Z",
            t0 + TRASH_RETENTION_SECS,
            TRASH_RETENTION_SECS
        ));
        // Future or invalid timestamps never expire
        assert!(!is_expired_at("2026-10-05T12:00:00Z", t0, TRASH_RETENTION_SECS));
        assert!(!is_expired_at("garbage", t0 + TRASH_RETENTION_SECS * 10, TRASH_RETENTION_SECS));
    }

    #[test]
    fn trashing_and_restoring_asset_moves_files_and_associated_media() {
        let lib = TestLib::new();
        lib.write_asset("Studio/clip.mp4", b"video-bytes");
        lib.write_asset("Studio/keep.webp", b"img-bytes");
        lib.write_thumb("clip.jpg", b"thumb1");
        lib.write_thumb("clip-t1500.jpg", b"thumb-custom");
        lib.write_preview("clip.v2.mp4", b"proxy");
        lib.write_index(json!([
            {
                "id": "s1",
                "title": "Studio",
                "coverId": "a1",
                "folder": "Studio",
                "assets": [
                    { "id": "a1", "name": "Clip", "file": "Studio/clip.mp4", "kind": "video", "thumbnail": "clip-t1500.jpg", "previewVideo": "clip.v2.mp4" },
                    { "id": "a2", "name": "Keep", "file": "Studio/keep.webp", "kind": "image" }
                ]
            }
        ]));

        let trashed = trash_items_at(
            &lib.0,
            &[TrashTarget { source_id: "s1".into(), asset_id: Some("a1".into()) }],
            Some("2026-11-01T10:00:00.000Z"),
        )
        .unwrap();
        assert_eq!(trashed.trashed_count, 1);
        assert_eq!(trashed.moved_to_trash, 1);

        assert!(!lib.0.join("assets/Studio/clip.mp4").exists());
        assert!(lib.0.join("assets/Studio/keep.webp").is_file());
        assert!(lib.0.join("trash/assets/Studio/clip.mp4").is_file());
        assert!(!lib.0.join("thumbnails/clip.jpg").exists());
        assert!(!lib.0.join("thumbnails/clip-t1500.jpg").exists());
        assert!(lib.0.join("trash/thumbnails/clip.jpg").is_file());
        assert!(lib.0.join("trash/thumbnails/clip-t1500.jpg").is_file());
        assert!(!lib.0.join("previews/clip.v2.mp4").exists());
        assert!(lib.0.join("trash/previews/clip.v2.mp4").is_file());

        // Resolve finds trashed asset safely
        let resolved = resolve_asset_disk_path(&lib.0, "Studio/clip.mp4", Some(true)).unwrap();
        assert_eq!(resolved, lib.0.join("trash/assets/Studio/clip.mp4"));

        // Restore moves everything back and clears trashedAt + coverId was cleared on trash
        let restored = restore_items_at(
            &lib.0,
            &[TrashTarget { source_id: "s1".into(), asset_id: Some("a1".into()) }],
        )
        .unwrap();
        assert_eq!(restored.restored_count, 1);
        assert_eq!(restored.restored_from_trash, 1);
        assert!(lib.0.join("assets/Studio/clip.mp4").is_file());
        assert!(!lib.0.join("trash/assets/Studio/clip.mp4").exists());
        assert!(lib.0.join("thumbnails/clip.jpg").is_file());
        assert!(lib.0.join("thumbnails/clip-t1500.jpg").is_file());
        assert!(lib.0.join("previews/clip.v2.mp4").is_file());
        let saved = lib.read_index();
        assert!(saved[0]["assets"][0].get("trashedAt").is_none());
    }

    #[test]
    fn shared_file_stays_active_until_all_active_references_are_trashed_and_survives_partial_delete() {
        let lib = TestLib::new();
        lib.write_asset("Inter/regular.woff2", b"font-bytes");
        lib.write_index(json!([
            {
                "id": "s1",
                "title": "Inter",
                "folder": "Inter",
                "assets": [{ "id": "f1", "name": "Inter Regular", "file": "Inter/regular.woff2", "kind": "font" }]
            },
            {
                "id": "s2",
                "title": "Studio",
                "folder": "Studio",
                "assets": [{ "id": "f2", "name": "Inter Regular", "file": "Inter/regular.woff2", "kind": "font" }]
            }
        ]));

        // Trash only s1 -> file MUST remain in assets/ because s2 is still active
        let res1 = trash_items_at(
            &lib.0,
            &[TrashTarget { source_id: "s1".into(), asset_id: None }],
            Some("2026-11-01T00:00:00Z"),
        )
        .unwrap();
        assert_eq!(res1.moved_to_trash, 0);
        assert!(lib.0.join("assets/Inter/regular.woff2").is_file());
        assert!(!lib.0.join("trash/assets/Inter/regular.woff2").exists());

        // Trash s2 too -> now zero active references, file moves to trash/
        let res2 = trash_items_at(
            &lib.0,
            &[TrashTarget { source_id: "s2".into(), asset_id: None }],
            Some("2026-11-02T00:00:00Z"),
        )
        .unwrap();
        assert_eq!(res2.moved_to_trash, 1);
        assert!(!lib.0.join("assets/Inter/regular.woff2").exists());
        assert!(lib.0.join("trash/assets/Inter/regular.woff2").is_file());

        // Permanently delete s1 -> s2 (trashed) still references it, so file MUST stay in trash/
        let del1 = permanently_delete_trashed_at(
            &lib.0,
            &[TrashTarget { source_id: "s1".into(), asset_id: None }],
        )
        .unwrap();
        assert_eq!(del1.deleted_sources, 1);
        assert_eq!(del1.deleted_files, 0);
        assert!(lib.0.join("trash/assets/Inter/regular.woff2").is_file());

        // Restore s2 -> file returns to assets/
        restore_items_at(&lib.0, &[TrashTarget { source_id: "s2".into(), asset_id: None }]).unwrap();
        assert!(lib.0.join("assets/Inter/regular.woff2").is_file());
        assert!(!lib.0.join("trash/assets/Inter/regular.woff2").exists());
    }

    #[test]
    fn trashing_source_moves_assets_and_preserves_individually_trashed_assets_on_restore() {
        let lib = TestLib::new();
        lib.write_asset("Site/one.webp", b"one");
        lib.write_asset("Site/two.webp", b"two");
        lib.write_index(json!([
            {
                "id": "s1",
                "title": "Site",
                "folder": "Site",
                "assets": [
                    { "id": "a1", "name": "One", "file": "Site/one.webp", "kind": "image", "trashedAt": "2026-11-01T00:00:00Z" },
                    { "id": "a2", "name": "Two", "file": "Site/two.webp", "kind": "image" }
                ]
            }
        ]));

        // Reconcile puts a1 in trash, keeps a2 in active
        let sync = reconcile_trash_storage_at(&lib.0, &lib.read_index()).unwrap();
        assert_eq!(sync.moved_to_trash, 1);
        assert!(lib.0.join("trash/assets/Site/one.webp").is_file());
        assert!(lib.0.join("assets/Site/two.webp").is_file());

        // Trash the whole source -> a2 moves to trash, a1's original trashedAt preserved
        trash_items_at(
            &lib.0,
            &[TrashTarget { source_id: "s1".into(), asset_id: None }],
            Some("2026-11-10T00:00:00Z"),
        )
        .unwrap();
        assert!(lib.0.join("trash/assets/Site/two.webp").is_file());
        assert!(!lib.0.join("assets/Site").exists());

        // Restore source -> a2 returns to assets, a1 stays trashed in trash/!
        restore_items_at(&lib.0, &[TrashTarget { source_id: "s1".into(), asset_id: None }]).unwrap();
        assert!(lib.0.join("assets/Site/two.webp").is_file());
        assert!(lib.0.join("trash/assets/Site/one.webp").is_file());
        let saved = lib.read_index();
        assert_eq!(saved[0]["assets"][0]["trashedAt"], "2026-11-01T00:00:00Z");
        assert!(saved[0]["assets"][1].get("trashedAt").is_none());
    }

    #[test]
    fn clear_trash_permanently_deletes_all_trashed_items_and_cleans_favicons_and_orphans() {
        let lib = TestLib::new();
        lib.write_asset("Active/keep.webp", b"keep");
        lib.write_asset("Gone/drop.webp", b"drop");
        lib.write_asset("Active/trashed_child.webp", b"child");
        lib.write_thumb("drop.jpg", b"drop-thumb");
        lib.write_thumb("keep.jpg", b"keep-thumb");
        lib.write_favicon("gone-fav.png", b"fav1");
        lib.write_favicon("keep-fav.png", b"fav2");
        // Also an orphaned leftover in trash/
        let orphan = lib.0.join("trash/assets/Old/orphan.webp");
        fs::create_dir_all(orphan.parent().unwrap()).unwrap();
        fs::write(&orphan, b"orphan").unwrap();

        lib.write_index(json!([
            {
                "id": "active",
                "title": "Active",
                "favicon": "keep-fav.png",
                "assets": [
                    { "id": "k1", "name": "Keep", "file": "Active/keep.webp", "kind": "image", "thumbnail": "keep.jpg" },
                    { "id": "t1", "name": "Child", "file": "Active/trashed_child.webp", "kind": "image", "trashedAt": "2026-11-05T00:00:00Z" }
                ]
            },
            {
                "id": "gone",
                "title": "Gone",
                "favicon": "gone-fav.png",
                "trashedAt": "2026-11-06T00:00:00Z",
                "assets": [
                    { "id": "g1", "name": "Drop", "file": "Gone/drop.webp", "kind": "image", "thumbnail": "drop.jpg" }
                ]
            }
        ]));
        reconcile_trash_storage_at(&lib.0, &lib.read_index()).unwrap();
        assert!(lib.0.join("trash/assets/Gone/drop.webp").is_file());
        assert!(lib.0.join("trash/assets/Active/trashed_child.webp").is_file());

        let cleared = clear_trash_at(&lib.0).unwrap();
        assert_eq!(cleared.deleted_sources, 1);
        assert_eq!(cleared.deleted_assets, 2);
        assert!(cleared.deleted_files >= 4);

        let saved = lib.read_index();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0]["id"], "active");
        assert_eq!(saved[0]["assets"].as_array().unwrap().len(), 1);
        assert!(lib.0.join("assets/Active/keep.webp").is_file());
        assert!(lib.0.join("thumbnails/keep.jpg").is_file());
        assert!(lib.0.join("favicons/keep-fav.png").is_file());
        assert!(!lib.0.join("favicons/gone-fav.png").exists());
        assert!(!lib.0.join("trash").exists());
    }

    #[test]
    fn thirty_day_expiration_purges_old_items_and_keeps_recent_items() {
        let lib = TestLib::new();
        lib.write_asset("Old/old.webp", b"old");
        lib.write_asset("Recent/recent.webp", b"recent");
        lib.write_asset("Mixed/expired.webp", b"exp");
        lib.write_asset("Mixed/fresh.webp", b"fresh");
        lib.write_thumb("old.jpg", b"old-thumb");
        lib.write_favicon("old.png", b"old-fav");

        lib.write_index(json!([
            {
                "id": "old-src",
                "title": "Old",
                "favicon": "old.png",
                "trashedAt": "2026-10-01T00:00:00Z",
                "assets": [{ "id": "o1", "name": "Old", "file": "Old/old.webp", "kind": "image", "thumbnail": "old.jpg" }]
            },
            {
                "id": "recent-src",
                "title": "Recent",
                "trashedAt": "2026-11-10T00:00:00Z",
                "assets": [{ "id": "r1", "name": "Recent", "file": "Recent/recent.webp", "kind": "image" }]
            },
            {
                "id": "mixed-src",
                "title": "Mixed",
                "coverId": "m1",
                "assets": [
                    { "id": "m1", "name": "Expired", "file": "Mixed/expired.webp", "kind": "image", "trashedAt": "2026-10-10T00:00:00Z" },
                    { "id": "m2", "name": "Fresh", "file": "Mixed/fresh.webp", "kind": "image" }
                ]
            }
        ]));
        reconcile_trash_storage_at(&lib.0, &lib.read_index()).unwrap();

        let now = parse_iso8601_utc_secs("2026-11-17T00:00:00Z").unwrap();
        let res = purge_expired_trash_at(&lib.0, now, TRASH_RETENTION_SECS).unwrap();
        assert_eq!(res.deleted_sources, 1);
        assert_eq!(res.deleted_assets, 2);

        let saved = lib.read_index();
        assert_eq!(saved.len(), 2);
        assert_eq!(saved[0]["id"], "recent-src");
        assert_eq!(saved[1]["id"], "mixed-src");
        assert_eq!(saved[1]["assets"].as_array().unwrap().len(), 1);
        assert_eq!(saved[1]["assets"][0]["id"], "m2");
        assert!(saved[1].get("coverId").is_none());

        assert!(!lib.0.join("trash/assets/Old/old.webp").exists());
        assert!(!lib.0.join("trash/thumbnails/old.jpg").exists());
        assert!(!lib.0.join("favicons/old.png").exists());
        assert!(!lib.0.join("trash/assets/Mixed/expired.webp").exists());
        assert!(lib.0.join("trash/assets/Recent/recent.webp").is_file());
        assert!(lib.0.join("assets/Mixed/fresh.webp").is_file());
    }

    #[test]
    fn permanently_delete_refuses_active_items_and_rejects_traversal() {
        let lib = TestLib::new();
        lib.write_asset("Safe/active.webp", b"safe");
        lib.write_index(json!([
            {
                "id": "s1",
                "title": "Safe",
                "assets": [{ "id": "a1", "name": "Active", "file": "Safe/active.webp", "kind": "image" }]
            }
        ]));

        // Attempting permanent deletion on an active source/asset must be a safe no-op
        let res = permanently_delete_trashed_at(
            &lib.0,
            &[
                TrashTarget { source_id: "s1".into(), asset_id: None },
                TrashTarget { source_id: "s1".into(), asset_id: Some("a1".into()) },
            ],
        )
        .unwrap();
        assert_eq!(res.deleted_sources, 0);
        assert_eq!(res.deleted_assets, 0);
        assert!(lib.0.join("assets/Safe/active.webp").is_file());
        assert_eq!(lib.read_index().len(), 1);

        // Path traversal safety
        assert!(resolve_asset_disk_path(&lib.0, "../library.json", None).is_err());
        assert!(delete_unreferenced_asset_file_at(&lib.0, "../library.json").is_err());
        assert!(lib.0.join("library.json").is_file());
    }

    #[test]
    fn collision_with_different_content_does_not_overwrite_existing_file() {
        let lib = TestLib::new();
        lib.write_asset("Studio/item.webp", b"active-content");
        let trash_file = lib.0.join("trash/assets/Studio/item.webp");
        fs::create_dir_all(trash_file.parent().unwrap()).unwrap();
        fs::write(&trash_file, b"trashed-different-content").unwrap();

        lib.write_index(json!([
            {
                "id": "s1",
                "title": "Studio",
                "trashedAt": "2026-11-10T00:00:00Z",
                "assets": [{ "id": "a1", "name": "Item", "file": "Studio/item.webp", "kind": "image" }]
            }
        ]));

        let sync = reconcile_trash_storage_at(&lib.0, &lib.read_index()).unwrap();
        assert_eq!(sync.warnings.len(), 1);
        assert_eq!(
            fs::read(lib.0.join("assets/Studio/item.webp")).unwrap(),
            b"active-content"
        );
        assert_eq!(fs::read(&trash_file).unwrap(), b"trashed-different-content");
    }

    #[test]
    fn rename_trash_folder_moves_trashed_subfolder_safely() {
        let lib = TestLib::new();
        let trash_file = lib.0.join("trash/assets/OldName/shot.webp");
        fs::create_dir_all(trash_file.parent().unwrap()).unwrap();
        fs::write(&trash_file, b"img").unwrap();

        rename_trash_folder_at(&lib.0, "OldName", "NewName").unwrap();
        assert!(!lib.0.join("trash/assets/OldName").exists());
        assert!(lib.0.join("trash/assets/NewName/shot.webp").is_file());
    }
}
