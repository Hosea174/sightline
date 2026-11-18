//! Desktop video editing backend: probing, validation, FFmpeg trim/split/speed/crop rendering,
//! and exporting edited clips as new library assets without modifying originals.

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_SEGMENTS: usize = 100;
pub const MAX_DURATION_SECS: f64 = 86_400.0;
pub const MIN_SEGMENT_SPAN_SECS: f64 = 0.001;
pub const MIN_SPEED: f64 = 0.1;
pub const MAX_SPEED: f64 = 16.0;
const DURATION_TOLERANCE_SECS: f64 = 0.25;

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCropRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

fn default_speed() -> f64 {
    1.0
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoEditSegment {
    pub start: f64,
    pub end: f64,
    #[serde(default = "default_speed")]
    pub speed: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoEditRequest {
    pub source_file: String,
    pub segments: Vec<VideoEditSegment>,
    #[serde(default)]
    pub crop: Option<VideoCropRect>,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub include_audio: Option<bool>,
    #[serde(default)]
    pub generate_preview: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoProbeInfo {
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub has_audio: bool,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoExportResult {
    pub id: String,
    pub file: String,
    pub thumbnail: Option<String>,
    pub preview_video: Option<String>,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub has_audio: bool,
}

pub fn ffprobe_program() -> PathBuf {
    let probe_name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
    let ffmpeg = super::ffmpeg_program();
    if ffmpeg.is_file() {
        let sibling = ffmpeg.with_file_name(probe_name);
        if sibling.is_file() {
            return sibling;
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let exe = dir.join(probe_name);
            if exe.is_file() {
                return exe;
            }
        }
    }
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
                            let exe = build.path().join("bin").join("ffprobe.exe");
                            if exe.is_file() {
                                return exe;
                            }
                        }
                    }
                }
            }
        }
    }
    PathBuf::from(probe_name)
}

pub fn is_full_crop(crop: &VideoCropRect) -> bool {
    crop.x.abs() < 1e-6
        && crop.y.abs() < 1e-6
        && (crop.w - 1.0).abs() < 1e-6
        && (crop.h - 1.0).abs() < 1e-6
}

pub fn validate_crop(crop: Option<VideoCropRect>) -> Result<Option<VideoCropRect>, String> {
    let Some(c) = crop else {
        return Ok(None);
    };
    if ![c.x, c.y, c.w, c.h].iter().all(|v| v.is_finite()) {
        return Err("Invalid crop: coordinates must be finite numbers".into());
    }
    if c.x < 0.0 || c.y < 0.0 || c.w <= 0.0 || c.h <= 0.0 {
        return Err("Invalid crop: coordinates must be within [0, 1] with positive size".into());
    }
    if c.x + c.w > 1.000001 || c.y + c.h > 1.000001 {
        return Err("Invalid crop: selection exceeds video bounds".into());
    }
    let clamped = VideoCropRect {
        x: c.x.clamp(0.0, 1.0),
        y: c.y.clamp(0.0, 1.0),
        w: c.w.min((1.0 - c.x.clamp(0.0, 1.0)).max(1e-6)),
        h: c.h.min((1.0 - c.y.clamp(0.0, 1.0)).max(1e-6)),
    };
    if is_full_crop(&clamped) {
        return Ok(None);
    }
    Ok(Some(clamped))
}

pub fn validate_segments(
    segments: &[VideoEditSegment],
    source_duration: Option<f64>,
) -> Result<Vec<VideoEditSegment>, String> {
    if segments.is_empty() {
        return Err("At least one clip segment is required".into());
    }
    if segments.len() > MAX_SEGMENTS {
        return Err(format!("Too many clip segments (maximum {MAX_SEGMENTS})"));
    }
    if let Some(dur) = source_duration {
        if !dur.is_finite() || dur <= 0.0 {
            return Err("Source video has an invalid duration".into());
        }
    }

    let mut validated = Vec::with_capacity(segments.len());
    for (idx, seg) in segments.iter().enumerate() {
        if ![seg.start, seg.end, seg.speed].iter().all(|v| v.is_finite()) {
            return Err(format!("Invalid clip segment {}: non-finite value", idx + 1));
        }
        if seg.start < 0.0 || seg.end > MAX_DURATION_SECS {
            return Err(format!("Invalid clip segment {}: time out of range", idx + 1));
        }
        if seg.speed < MIN_SPEED || seg.speed > MAX_SPEED {
            return Err(format!(
                "Invalid clip segment {}: speed must be between {MIN_SPEED}x and {MAX_SPEED}x",
                idx + 1
            ));
        }
        let mut end = seg.end;
        if let Some(dur) = source_duration {
            if seg.start >= dur {
                return Err(format!(
                    "Invalid clip segment {}: start ({:.3}s) is past video duration ({:.3}s)",
                    idx + 1,
                    seg.start,
                    dur
                ));
            }
            if end > dur + DURATION_TOLERANCE_SECS {
                return Err(format!(
                    "Invalid clip segment {}: end ({:.3}s) exceeds video duration ({:.3}s)",
                    idx + 1,
                    end,
                    dur
                ));
            }
            if end > dur {
                end = dur;
            }
        }
        if end - seg.start < MIN_SEGMENT_SPAN_SECS {
            return Err(format!(
                "Invalid clip segment {}: end must be greater than start",
                idx + 1
            ));
        }
        validated.push(VideoEditSegment {
            start: seg.start,
            end,
            speed: seg.speed,
        });
    }
    Ok(validated)
}

pub fn estimated_output_duration(segments: &[VideoEditSegment]) -> f64 {
    segments
        .iter()
        .map(|s| (s.end - s.start) / s.speed)
        .sum::<f64>()
}

/// Decomposes any positive speed multiplier into FFmpeg `atempo` filters (each within `[0.5, 2.0]`).
pub fn atempo_filters(speed: f64) -> Vec<String> {
    if (speed - 1.0).abs() <= 1e-6 {
        return Vec::new();
    }
    let mut filters = Vec::new();
    let mut rem = speed;
    while rem > 2.0 + 1e-9 {
        filters.push("atempo=2.0".to_string());
        rem /= 2.0;
    }
    while rem < 0.5 - 1e-9 {
        filters.push("atempo=0.5".to_string());
        rem /= 0.5;
    }
    if (rem - 2.0).abs() <= 1e-6 {
        filters.push("atempo=2.0".to_string());
    } else if (rem - 0.5).abs() <= 1e-6 {
        filters.push("atempo=0.5".to_string());
    } else if (rem - 1.0).abs() > 1e-6 {
        filters.push(format!("atempo={rem:.6}"));
    }
    filters
}

pub fn build_filter_complex(
    segments: &[VideoEditSegment],
    crop: Option<VideoCropRect>,
    with_audio: bool,
) -> String {
    let mut filters = Vec::with_capacity(segments.len() * 2 + 2);
    for (i, seg) in segments.iter().enumerate() {
        let speed_expr = if (seg.speed - 1.0).abs() <= 1e-6 {
            "PTS-STARTPTS".to_string()
        } else {
            format!("(PTS-STARTPTS)/{:.6}", seg.speed)
        };
        filters.push(format!(
            "[0:v]trim=start={:.6}:end={:.6},setpts={speed_expr}[v{i}]",
            seg.start, seg.end
        ));
        if with_audio {
            let tempo = atempo_filters(seg.speed);
            let tempo_suffix = if tempo.is_empty() {
                String::new()
            } else {
                format!(",{}", tempo.join(","))
            };
            filters.push(format!(
                "[0:a]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS{tempo_suffix}[a{i}]",
                seg.start, seg.end
            ));
        }
    }

    let inputs = (0..segments.len())
        .map(|i| {
            if with_audio {
                format!("[v{i}][a{i}]")
            } else {
                format!("[v{i}]")
            }
        })
        .collect::<String>();

    let crop_filter = if let Some(c) = crop {
        format!(
            "crop=w='max(2,trunc(min(iw-min(iw-2,trunc(iw*{:.8}/2)*2),iw*{:.8})/2)*2)':h='max(2,trunc(min(ih-min(ih-2,trunc(ih*{:.8}/2)*2),ih*{:.8})/2)*2)':x='min(iw-2,trunc(iw*{:.8}/2)*2)':y='min(ih-2,trunc(ih*{:.8}/2)*2)',",
            c.x, c.w, c.y, c.h, c.x, c.y
        )
    } else {
        String::new()
    };

    if with_audio {
        filters.push(format!(
            "{inputs}concat=n={}:v=1:a=1[joined][aout];[joined]{crop_filter}pad=ceil(iw/2)*2:ceil(ih/2)*2[vout]",
            segments.len()
        ));
    } else {
        filters.push(format!(
            "{inputs}concat=n={}:v=1:a=0[joined];[joined]{crop_filter}pad=ceil(iw/2)*2:ceil(ih/2)*2[vout]",
            segments.len()
        ));
    }
    filters.join(";")
}

pub fn build_ffmpeg_args(
    input: &Path,
    output: &Path,
    segments: &[VideoEditSegment],
    crop: Option<VideoCropRect>,
    with_audio: bool,
) -> Vec<String> {
    let filter_complex = build_filter_complex(segments, crop, with_audio);
    let mut args = vec![
        "-nostdin".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        input.to_string_lossy().into_owned(),
        "-filter_complex".to_string(),
        filter_complex,
        "-map".to_string(),
        "[vout]".to_string(),
    ];
    if with_audio {
        args.extend([
            "-map".to_string(),
            "[aout]".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
        ]);
    } else {
        args.push("-an".to_string());
    }
    args.extend([
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "veryfast".to_string(),
        "-crf".to_string(),
        "22".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        "-f".to_string(),
        "mp4".to_string(),
        output.to_string_lossy().into_owned(),
    ]);
    args
}

pub fn parse_ffprobe_json(raw: &[u8]) -> Result<VideoProbeInfo, String> {
    let parsed: Value =
        serde_json::from_slice(raw).map_err(|e| format!("Invalid ffprobe metadata: {e}"))?;
    let streams = parsed["streams"]
        .as_array()
        .ok_or_else(|| "Missing stream metadata".to_string())?;

    let mut width: u32 = 0;
    let mut height: u32 = 0;
    let mut has_audio = false;
    let mut stream_duration: Option<f64> = None;

    for stream in streams {
        match stream["codec_type"].as_str() {
            Some("video") if width == 0 || height == 0 => {
                let raw_w = stream["width"].as_u64().unwrap_or(0) as u32;
                let raw_h = stream["height"].as_u64().unwrap_or(0) as u32;
                let rotation = stream["tags"]["rotate"]
                    .as_str()
                    .and_then(|s| s.trim().parse::<i64>().ok())
                    .or_else(|| {
                        stream["side_data_list"].as_array().and_then(|list| {
                            list.iter()
                                .find_map(|sd| sd["rotation"].as_i64())
                        })
                    })
                    .unwrap_or(0)
                    .abs()
                    % 360;
                if rotation == 90 || rotation == 270 {
                    width = raw_h;
                    height = raw_w;
                } else {
                    width = raw_w;
                    height = raw_h;
                }
                if stream_duration.is_none() {
                    stream_duration = stream["duration"]
                        .as_str()
                        .and_then(|s| s.parse::<f64>().ok())
                        .filter(|d| d.is_finite() && *d > 0.0);
                }
            }
            Some("audio") => {
                has_audio = true;
            }
            _ => {}
        }
    }

    if width == 0 || height == 0 {
        return Err("Source file does not contain a valid video stream".into());
    }

    let format_duration = parsed["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|d| d.is_finite() && *d > 0.0);
    let duration = format_duration
        .or(stream_duration)
        .ok_or_else(|| "Could not determine video duration".to_string())?;

    Ok(VideoProbeInfo {
        width,
        height,
        duration,
        has_audio,
    })
}

pub fn probe_video_at(path: &Path) -> Result<VideoProbeInfo, String> {
    if !path.is_file() {
        return Err("Video file not found".into());
    }
    let mut cmd = Command::new(ffprobe_program());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x0800_0000);
    let out = cmd
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height,duration:stream_tags=rotate:stream_side_data=rotation",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .map_err(|_| "Could not launch FFprobe. Install FFmpeg and ensure it is on PATH.".to_string())?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let snippet: String = stderr.trim().chars().take(300).collect();
        return Err(if snippet.is_empty() {
            "Could not inspect video metadata".into()
        } else {
            format!("Could not inspect video metadata: {snippet}")
        });
    }
    parse_ffprobe_json(&out.stdout)
}

fn generate_video_thumbnail(source: &Path, thumb_dir: &Path, stem: &str) -> Option<String> {
    if fs::create_dir_all(thumb_dir).is_err() {
        return None;
    }
    let name = format!("{stem}.jpg");
    let output = thumb_dir.join(&name);
    let tmp = thumb_dir.join(format!(".tmp-{stem}-{}.jpg", uuid::Uuid::new_v4()));
    let mut cmd = Command::new(super::ffmpeg_program());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x0800_0000);
    let ok = cmd
        .args(["-v", "error", "-y", "-i"])
        .arg(source)
        .args([
            "-frames:v",
            "1",
            "-vf",
            "scale=400:-2:force_original_aspect_ratio=decrease",
            "-q:v",
            "5",
        ])
        .arg(&tmp)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if ok && tmp.is_file() && fs::rename(&tmp, &output).is_ok() {
        Some(name)
    } else {
        let _ = fs::remove_file(&tmp);
        None
    }
}

fn resolve_target_folder(source_rel: &str, requested_folder: Option<&str>) -> Option<String> {
    if let Some(folder) = requested_folder.map(str::trim).filter(|f| !f.is_empty()) {
        return Some(super::sanitize_folder_name(folder));
    }
    super::asset_folder_prefix(source_rel).map(|f| super::sanitize_folder_name(&f))
}

pub fn export_edited_video_at(root: &Path, req: VideoEditRequest) -> Result<VideoExportResult, String> {
    super::trash::check_library_dirs_safe(root)?;
    let (source_path, clean_rel) = super::safe_asset_path(root, &req.source_file)?;
    if !source_path.is_file() {
        return Err("Source video file not found".into());
    }

    let probe = probe_video_at(&source_path)?;
    let crop = validate_crop(req.crop)?;
    let segments = validate_segments(&req.segments, Some(probe.duration))?;
    let with_audio = probe.has_audio && req.include_audio.unwrap_or(true);

    let folder = resolve_target_folder(&clean_rel, req.folder.as_deref());
    let target_dir = match folder {
        Some(ref f) => super::trash::ensure_safe_dir_under(root, &["assets", f])?,
        None => super::trash::ensure_safe_dir_under(root, &["assets"])?,
    };

    let id = uuid::Uuid::new_v4().to_string();
    let filename = format!("{id}.mp4");
    let final_path = target_dir.join(&filename);
    let temp_path = target_dir.join(format!(".tmp-{id}.mp4"));
    let rel_path = match folder {
        Some(ref f) => format!("{f}/{filename}"),
        None => filename,
    };

    let args = build_ffmpeg_args(&source_path, &temp_path, &segments, crop, with_audio);
    let mut cmd = Command::new(super::ffmpeg_program());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x0800_0000);
    let output = cmd.args(&args).output().map_err(|_| {
        let _ = fs::remove_file(&temp_path);
        "Could not launch FFmpeg. Install FFmpeg and ensure it is on PATH.".to_string()
    })?;

    if !output.status.success() || !temp_path.is_file() {
        let _ = fs::remove_file(&temp_path);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let snippet: String = stderr.trim().chars().take(500).collect();
        return Err(if snippet.is_empty() {
            "Could not render edited video.".into()
        } else {
            format!("Could not render edited video: {snippet}")
        });
    }

    if let Err(e) = fs::rename(&temp_path, &final_path) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Could not save rendered video: {e}"));
    }

    let out_probe = probe_video_at(&final_path).unwrap_or(VideoProbeInfo {
        width: probe.width,
        height: probe.height,
        duration: estimated_output_duration(&segments),
        has_audio: with_audio,
    });

    let thumbnail = generate_video_thumbnail(&final_path, &root.join("thumbnails"), &id);
    let preview_video = if req.generate_preview.unwrap_or(false) {
        let previews_dir = root.join("previews");
        if fs::create_dir_all(&previews_dir).is_ok() {
            let preview_name = format!("{id}.v2.mp4");
            let preview_path = previews_dir.join(&preview_name);
            if super::media_cache::make_video_proxy(&final_path, &preview_path) {
                Some(preview_name)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    Ok(VideoExportResult {
        id,
        file: rel_path,
        thumbnail,
        preview_video,
        duration: out_probe.duration,
        width: out_probe.width,
        height: out_probe.height,
        has_audio: out_probe.has_audio,
    })
}

#[tauri::command]
pub async fn probe_video_asset(
    app: tauri::AppHandle,
    file: String,
    trashed: Option<bool>,
) -> Result<VideoProbeInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = super::library_path(&app)?;
        let asset_path = super::trash::resolve_asset_disk_path(&root, &file, trashed)?;
        probe_video_at(&asset_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_edited_video(
    app: tauri::AppHandle,
    request: VideoEditRequest,
) -> Result<VideoExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = super::library_io_lock();
        let root = super::library_path(&app)?;
        export_edited_video_at(&root, request)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(prefix: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "sightline-{prefix}-{}-{nanos}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn validates_crop_coordinates_and_collapses_full_frame() {
        assert_eq!(validate_crop(None).unwrap(), None);
        assert_eq!(
            validate_crop(Some(VideoCropRect {
                x: 0.0,
                y: 0.0,
                w: 1.0,
                h: 1.0
            }))
            .unwrap(),
            None
        );

        let valid = validate_crop(Some(VideoCropRect {
            x: 0.25,
            y: 0.2,
            w: 0.5,
            h: 0.6,
        }))
        .unwrap()
        .unwrap();
        assert_eq!(valid.x, 0.25);
        assert_eq!(valid.h, 0.6);

        // Rejects invalid bounds and non-finite inputs
        assert!(validate_crop(Some(VideoCropRect {
            x: -0.01,
            y: 0.0,
            w: 0.5,
            h: 0.5
        }))
        .is_err());
        assert!(validate_crop(Some(VideoCropRect {
            x: 0.6,
            y: 0.0,
            w: 0.5,
            h: 0.5
        }))
        .is_err());
        assert!(validate_crop(Some(VideoCropRect {
            x: 0.1,
            y: 0.1,
            w: 0.0,
            h: 0.5
        }))
        .is_err());
        assert!(validate_crop(Some(VideoCropRect {
            x: f64::NAN,
            y: 0.0,
            w: 0.5,
            h: 0.5
        }))
        .is_err());
    }

    #[test]
    fn validates_segments_speed_and_duration_bounds() {
        assert!(validate_segments(&[], Some(10.0)).is_err());

        let too_many = vec![
            VideoEditSegment {
                start: 0.0,
                end: 1.0,
                speed: 1.0
            };
            MAX_SEGMENTS + 1
        ];
        assert!(validate_segments(&too_many, Some(10.0)).is_err());

        assert!(validate_segments(
            &[VideoEditSegment {
                start: 3.0,
                end: 2.0,
                speed: 1.0
            }],
            Some(10.0)
        )
        .is_err());

        assert!(validate_segments(
            &[VideoEditSegment {
                start: 0.0,
                end: 2.0,
                speed: 0.0
            }],
            Some(10.0)
        )
        .is_err());

        assert!(validate_segments(
            &[VideoEditSegment {
                start: 0.0,
                end: 2.0,
                speed: 32.0
            }],
            Some(10.0)
        )
        .is_err());

        assert!(validate_segments(
            &[VideoEditSegment {
                start: 0.0,
                end: 12.0,
                speed: 1.0
            }],
            Some(10.0)
        )
        .is_err());

        // Small container rounding tolerance clamps cleanly to source duration
        let clamped = validate_segments(
            &[VideoEditSegment {
                start: 1.0,
                end: 10.05,
                speed: 2.0,
            }],
            Some(10.0),
        )
        .unwrap();
        assert_eq!(clamped[0].end, 10.0);
        assert_eq!(estimated_output_duration(&clamped), 4.5);
    }

    #[test]
    fn builds_atempo_chains_and_filter_complex_deterministically() {
        assert!(atempo_filters(1.0).is_empty());
        assert_eq!(atempo_filters(0.25), vec!["atempo=0.5", "atempo=0.5"]);
        assert_eq!(atempo_filters(4.0), vec!["atempo=2.0", "atempo=2.0"]);
        assert_eq!(
            atempo_filters(3.0),
            vec!["atempo=2.0", "atempo=1.500000"]
        );

        let segments = vec![
            VideoEditSegment {
                start: 0.5,
                end: 2.5,
                speed: 2.0,
            },
            VideoEditSegment {
                start: 4.0,
                end: 5.0,
                speed: 0.25,
            },
        ];
        let crop = Some(VideoCropRect {
            x: 0.25,
            y: 0.2,
            w: 0.5,
            h: 0.6,
        });
        let graph = build_filter_complex(&segments, crop, true);
        assert!(graph.contains("[0:v]trim=start=0.500000:end=2.500000,setpts=(PTS-STARTPTS)/2.000000[v0]"));
        assert!(graph.contains("[0:a]atrim=start=0.500000:end=2.500000,asetpts=PTS-STARTPTS,atempo=2.0[a0]"));
        assert!(graph.contains("[0:a]atrim=start=4.000000:end=5.000000,asetpts=PTS-STARTPTS,atempo=0.5,atempo=0.5[a1]"));
        assert!(graph.contains("[v0][a0][v1][a1]concat=n=2:v=1:a=1[joined][aout]"));
        assert!(graph.contains("crop=w='max(2,trunc(min(iw-min(iw-2,trunc(iw*0.25000000/2)*2),iw*0.50000000)/2)*2)'"));

        let args = build_ffmpeg_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            &segments,
            None,
            false,
        );
        assert!(args.contains(&"-an".to_string()));
        assert!(!args.contains(&"-f".to_string()) || args.windows(2).any(|w| w == ["-f", "mp4"]));
        assert!(!args.windows(2).any(|w| w == ["-f", "webm"]));
    }

    #[test]
    fn parses_ffprobe_rotation_and_rejects_audio_only_streams() {
        let rotated = br#"{
            "streams": [
                {
                    "codec_type": "video",
                    "width": 1920,
                    "height": 1080,
                    "tags": { "rotate": "90" }
                },
                { "codec_type": "audio" }
            ],
            "format": { "duration": "12.5" }
        }"#;
        let info = parse_ffprobe_json(rotated).unwrap();
        assert_eq!(info.width, 1080);
        assert_eq!(info.height, 1920);
        assert_eq!(info.duration, 12.5);
        assert!(info.has_audio);

        let audio_only = br#"{
            "streams": [{ "codec_type": "audio" }],
            "format": { "duration": "5.0" }
        }"#;
        assert!(parse_ffprobe_json(audio_only).is_err());
    }

    #[test]
    fn exports_trimmed_cropped_retimed_video_to_new_asset_without_touching_original() {
        let lib = TempDir::new("video-export-test");
        let assets = lib.0.join("assets").join("Studio");
        fs::create_dir_all(&assets).unwrap();
        let source_path = assets.join("orig.mp4");

        let mut make_src = Command::new(super::super::ffmpeg_program());
        #[cfg(target_os = "windows")]
        make_src.creation_flags(0x0800_0000);
        let status = make_src
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=160x90:rate=24",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=44100",
                "-t",
                "4",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
            ])
            .arg(&source_path)
            .status()
            .expect("ffmpeg must be installed for video export integration test");
        assert!(status.success());
        let orig_bytes = fs::read(&source_path).unwrap();

        let result = export_edited_video_at(
            &lib.0,
            VideoEditRequest {
                source_file: "Studio/orig.mp4".into(),
                segments: vec![
                    VideoEditSegment {
                        start: 0.5,
                        end: 1.5,
                        speed: 2.0,
                    },
                    VideoEditSegment {
                        start: 2.0,
                        end: 3.0,
                        speed: 0.5,
                    },
                ],
                crop: Some(VideoCropRect {
                    x: 0.25,
                    y: 0.2,
                    w: 0.5,
                    h: 0.6,
                }),
                folder: None,
                include_audio: Some(true),
                generate_preview: Some(false),
            },
        )
        .unwrap();

        assert!(result.file.starts_with("Studio/"));
        assert!(result.file.ends_with(".mp4"));
        assert_ne!(result.file, "Studio/orig.mp4");
        assert_eq!(result.width, 80);
        assert_eq!(result.height, 54);
        assert!(result.has_audio);
        assert!(
            (2.2..=2.8).contains(&result.duration),
            "expected ~2.5s output duration, got {}",
            result.duration
        );
        let exported_disk = lib.0.join("assets").join(&result.file);
        assert!(exported_disk.is_file());
        assert_eq!(fs::read(&source_path).unwrap(), orig_bytes);

        let thumb = result.thumbnail.expect("thumbnail should be generated");
        assert!(lib.0.join("thumbnails").join(thumb).is_file());

        // Traversal and invalid inputs must fail cleanly without leaving temp files
        assert!(export_edited_video_at(
            &lib.0,
            VideoEditRequest {
                source_file: "../library.json".into(),
                segments: vec![VideoEditSegment {
                    start: 0.0,
                    end: 1.0,
                    speed: 1.0
                }],
                crop: None,
                folder: None,
                include_audio: None,
                generate_preview: None,
            }
        )
        .is_err());

        assert!(export_edited_video_at(
            &lib.0,
            VideoEditRequest {
                source_file: "Studio/orig.mp4".into(),
                segments: vec![VideoEditSegment {
                    start: 10.0,
                    end: 12.0,
                    speed: 1.0
                }],
                crop: None,
                folder: None,
                include_audio: None,
                generate_preview: None,
            }
        )
        .is_err());

        // Silent video export + probe error cases
        let silent_path = assets.join("silent.mp4");
        let mut make_silent = Command::new(super::super::ffmpeg_program());
        #[cfg(target_os = "windows")]
        make_silent.creation_flags(0x0800_0000);
        let silent_ok = make_silent
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=128x72:rate=24",
                "-t",
                "2",
                "-an",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&silent_path)
            .status()
            .expect("ffmpeg must be installed");
        assert!(silent_ok.success());

        let silent_probe = probe_video_at(&silent_path).unwrap();
        assert!(!silent_probe.has_audio);
        assert_eq!(silent_probe.width, 128);
        assert_eq!(silent_probe.height, 72);

        let silent_res = export_edited_video_at(
            &lib.0,
            VideoEditRequest {
                source_file: "Studio/silent.mp4".into(),
                segments: vec![VideoEditSegment {
                    start: 0.2,
                    end: 1.4,
                    speed: 1.5,
                }],
                crop: None,
                folder: None,
                include_audio: Some(true),
                generate_preview: Some(false),
            },
        )
        .unwrap();
        assert!(!silent_res.has_audio);
        assert!((0.6..=1.0).contains(&silent_res.duration));
        assert!(probe_video_at(&lib.0.join("assets").join("missing.mp4")).is_err());
    }
}
