#[path = "../font_install.rs"]
mod font_install;
use serde_json::{json, Value};
use std::{fs::{self, File}, io::{self, Read, Write}, path::{Path, PathBuf}, process::Command};
#[cfg(windows)] use std::os::windows::process::CommandExt;

fn reply_to<W: Write>(out: &mut W, v: Value) -> io::Result<()> {
 let b = serde_json::to_vec(&v)?;
 out.write_all(&(b.len() as u32).to_le_bytes())?;
 out.write_all(&b)?;
 out.flush()
}
fn reply(v: Value) -> io::Result<()> {
 let mut out = io::stdout().lock();
 reply_to(&mut out, v)
}
fn library_config() -> Result<(PathBuf,PathBuf),Box<dyn std::error::Error>> {
 let config=PathBuf::from(std::env::var_os("APPDATA").ok_or("APPDATA unavailable")?).join("com.sightline.app");
 let library=PathBuf::from(fs::read_to_string(config.join("library-path.txt")).map_err(|_|"Open Sightline and choose a library folder first")?.trim());
 if !library.is_dir(){return Err("The selected Sightline library folder is unavailable".into())}
 let inbox=PathBuf::from(fs::read_to_string(config.join("capture-inbox.txt")).map_err(|_|"Open the updated Sightline app and choose a library first")?.trim());
 Ok((library,inbox))
}
fn ffmpeg_program() -> PathBuf {
 let exe_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
 if let Some(paths)=std::env::var_os("PATH") { for dir in std::env::split_paths(&paths) { let exe=dir.join(exe_name); if exe.is_file(){return exe} } }
 if let Some(local)=std::env::var_os("LOCALAPPDATA") {
  let managed=PathBuf::from(&local).join("Sightline").join("tools").join("ffmpeg").join(exe_name);
  if managed.is_file(){return managed}
  let packages=PathBuf::from(local).join("Microsoft").join("WinGet").join("Packages");
  if let Ok(entries)=fs::read_dir(packages) { for entry in entries.flatten() { if entry.file_name().to_string_lossy().starts_with("Gyan.FFmpeg_") { if let Ok(builds)=fs::read_dir(entry.path()) { for build in builds.flatten() {let exe=build.path().join("bin").join("ffmpeg.exe");if exe.is_file(){return exe}} } } } }
 }
 PathBuf::from("ffmpeg")
}
fn render_video(input:&Path, output:&Path, segments:&[(f64,f64)], crop:Option<(f64,f64,f64,f64)>) -> Result<(),Box<dyn std::error::Error>> {
 let mut filters=Vec::new();for (i,(start,end)) in segments.iter().enumerate(){filters.push(format!("[0:v]trim=start={start:.6}:end={end:.6},setpts=PTS-STARTPTS[v{i}]"));}
 let inputs=(0..segments.len()).map(|i|format!("[v{i}]")).collect::<String>();let crop_filter=if let Some((x,y,w,h))=crop {format!("crop=w='max(2,trunc(min(iw-min(iw-2,trunc(iw*{x:.8}/2)*2),iw*{w:.8})/2)*2)':h='max(2,trunc(min(ih-min(ih-2,trunc(ih*{y:.8}/2)*2),ih*{h:.8})/2)*2)':x='min(iw-2,trunc(iw*{x:.8}/2)*2)':y='min(ih-2,trunc(ih*{y:.8}/2)*2)',")} else {String::new()};filters.push(format!("{inputs}concat=n={}:v=1:a=0[joined];[joined]{crop_filter}pad=ceil(iw/2)*2:ceil(ih/2)*2[out]",segments.len()));
 let mut cmd=Command::new(ffmpeg_program());#[cfg(windows)] cmd.creation_flags(0x08000000);
 let result=cmd.args(["-nostdin","-hide_banner","-loglevel","error","-y","-f","webm","-i"]).arg(input).args(["-filter_complex",&filters.join(";"),"-map","[out]","-an","-c:v","libx264","-preset","veryfast","-crf","22","-pix_fmt","yuv420p","-movflags","+faststart"]).arg(output).output().map_err(|_|"Could not launch FFmpeg. Install FFmpeg and restart your browser.")?;
 if !result.status.success(){return Err(format!("Could not render clip: {}",String::from_utf8_lossy(&result.stderr).chars().take(500).collect::<String>()).into())}Ok(())
}
fn same_source(saved:&str,incoming:&str)->bool {
 if saved.is_empty() || incoming.is_empty(){return false} if saved==incoming{return true}
 let (Ok(a),Ok(b))=(url::Url::parse(saved),url::Url::parse(incoming)) else{return false};
 let (Some(a),Some(b))=(a.host_str(),b.host_str()) else{return false};
 let a=a.trim_start_matches("www.");let b=b.trim_start_matches("www.");
 let social=["pinterest.com","x.com","twitter.com","instagram.com","behance.net","dribbble.com","youtube.com","vimeo.com"];
 !social.iter().any(|s|a==*s||a.ends_with(&format!(".{s}"))) && a==b
}
fn parse_font_weight(v: &Value) -> Option<u64> {
 let n = v.as_f64()?;
 if !n.is_finite() || n < 1.0 || n > 1000.0 {
  return None;
 }
 Some(n.round() as u64)
}
fn apply_font_manifest_fields(manifest: &mut Value, msg: &Value) {
 let Some(obj) = manifest.as_object_mut() else { return };
 if let Some(family) = msg["family"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
  obj.insert("family".into(), json!(family));
 }
 let weight = parse_font_weight(&msg["weight"]);
 let raw_min = parse_font_weight(&msg["weightMin"]);
 let raw_max = parse_font_weight(&msg["weightMax"]);
 if let (Some(a), Some(b)) = (raw_min, raw_max) {
  let min_w = a.min(b);
  let max_w = a.max(b);
  let is_var = if max_w > min_w { true } else { msg["isVariable"].as_bool().unwrap_or(false) };
  let chosen_w = weight
   .filter(|&w| w >= min_w && w <= max_w)
   .unwrap_or_else(|| if min_w <= 400 && max_w >= 400 { 400 } else { min_w });
  obj.insert("weight".into(), json!(chosen_w));
  obj.insert("weightMin".into(), json!(min_w));
  obj.insert("weightMax".into(), json!(max_w));
  obj.insert("isVariable".into(), json!(is_var));
 } else if let Some(w) = weight {
  obj.insert("weight".into(), json!(w));
  obj.insert("weightMin".into(), json!(w));
  obj.insert("weightMax".into(), json!(w));
  if let Some(is_var) = msg["isVariable"].as_bool() {
   obj.insert("isVariable".into(), json!(is_var));
  }
 } else if let Some(single) = raw_min.or(raw_max) {
  obj.insert("weight".into(), json!(single));
  obj.insert("weightMin".into(), json!(single));
  obj.insert("weightMax".into(), json!(single));
  if let Some(is_var) = msg["isVariable"].as_bool() {
   obj.insert("isVariable".into(), json!(is_var));
  }
 } else if let Some(is_var) = msg["isVariable"].as_bool() {
  obj.insert("isVariable".into(), json!(is_var));
 }
 if let Some(style) = msg["style"].as_str().and_then(|s| match s { "normal" | "italic" => Some(s), _ => None }) {
  obj.insert("style".into(), json!(style));
 }
 let font_source = msg["fontSource"].as_str().and_then(|s| match s { "capture" | "local" | "google" | "upload" => Some(s), _ => None }).unwrap_or("capture");
 obj.insert("fontSource".into(), json!(font_source));
}
fn is_eot_header(header: &[u8]) -> bool {
 header.len() >= 36
  && &header[34..36] == b"LP"
  && matches!(header[8..12], [0x00, 0x00, 0x01, 0x00] | [0x01, 0x00, 0x02, 0x00] | [0x02, 0x00, 0x02, 0x00])
}
fn has_valid_sfnt_directory(header: &[u8], total_bytes: u64) -> bool {
 if header.len() < 12 {
  return false;
 }
 let num_tables = u16::from_be_bytes([header[4], header[5]]) as u64;
 num_tables >= 1 && num_tables <= 512 && 12 + num_tables * 16 <= total_bytes
}
fn is_valid_font_data(ext: &str, header: &[u8], total_bytes: u64) -> bool {
 if total_bytes < 12 || header.len() < 12 || is_eot_header(header) {
  return false;
 }
 match ext {
  "woff2" => &header[..4] == b"wOF2" && total_bytes >= 48,
  "woff" => &header[..4] == b"wOFF" && total_bytes >= 44,
  "ttf" | "otf" => {
   (&header[..4] == b"ttcf" && total_bytes >= 12)
    || ((&header[..4] == b"OTTO"
     || &header[..4] == &[0x00, 0x01, 0x00, 0x00]
     || &header[..4] == b"true"
     || &header[..4] == b"typ1")
     && has_valid_sfnt_directory(header, total_bytes))
  }
  _ => false,
 }
}
struct CaptureCleanup {
 file: Option<File>,
 part: Option<PathBuf>,
 temp_render: Option<PathBuf>,
 temp_manifest: Option<PathBuf>,
 committed_media: Option<PathBuf>,
 committed: bool,
}
impl CaptureCleanup {
 fn new() -> Self {
  Self {
   file: None,
   part: None,
   temp_render: None,
   temp_manifest: None,
   committed_media: None,
   committed: false,
  }
 }
 fn is_active(&self) -> bool {
  !self.committed && (self.file.is_some() || self.part.is_some() || self.committed_media.is_some())
 }
 fn cleanup_now(&mut self) {
  if self.committed {
   return;
  }
  drop(self.file.take());
  for slot in [
   &mut self.temp_manifest,
   &mut self.temp_render,
   &mut self.part,
   &mut self.committed_media,
  ] {
   if let Some(p) = slot.take() {
    let _ = fs::remove_file(p);
   }
  }
 }
}
impl Drop for CaptureCleanup {
 fn drop(&mut self) {
  self.cleanup_now();
 }
}
fn run_with_io<R: Read, W: Write>(input: &mut R, output: &mut W, library: &Path, inbox: &Path) -> Result<(), Box<dyn std::error::Error>> {
 fs::create_dir_all(inbox)?;
 let mut cleanup = CaptureCleanup::new();
 let mut manifest = Value::Null;
 let mut capture_ext = String::new();
 let mut capture_kind = String::new();
 let mut final_path = PathBuf::new();
 let mut bytes = 0u64;
 let mut header = Vec::<u8>::with_capacity(64);
 let mut segments: Vec<(f64, f64)> = Vec::new();
 let mut crop: Option<(f64, f64, f64, f64)> = None;
 loop {
  let mut len = [0u8; 4];
  if let Err(err) = input.read_exact(&mut len) {
   if err.kind() == io::ErrorKind::UnexpectedEof {
    if cleanup.is_active() {
     return Err("Capture ended unexpectedly before completion".into());
    }
    break;
   }
   return Err(err.into());
  }
  let n = u32::from_le_bytes(len) as usize;
  if n > 1024 * 1024 {
   return Err("Message too large".into());
  }
  let mut data = vec![0; n];
  input.read_exact(&mut data)?;
  let msg: Value = serde_json::from_slice(&data)?;
  match msg["type"].as_str().unwrap_or("") {
   "open-asset" => {
    let id = msg["id"].as_str().ok_or("Missing asset ID")?;
    let id = uuid::Uuid::parse_str(id)?;
    let marker = inbox.join(format!("{id}.open"));
    match fs::OpenOptions::new().write(true).create_new(true).open(marker) {
     Ok(_) => {},
     Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {},
     Err(err) => return Err(err.into()),
    }
    reply_to(output, json!({"ok": true}))?;
    break;
   }
   "tags" => {
    let mut tags = Vec::<String>::new();
    let mut matched = Value::Null;
    let requested = msg["url"].as_str().unwrap_or("");
    if let Ok(index) = fs::read_to_string(library.join("library.json")) {
     if let Ok(Value::Array(sources)) = serde_json::from_str::<Value>(&index) {
      for source in sources {
       if !source["trashedAt"].is_null() { continue; }
       if matched.is_null() && same_source(source["url"].as_str().unwrap_or(""), requested) {
        matched = json!({"tags": source["tags"], "category": source["category"]});
       }
       let mut all = source["tags"].as_array().cloned().unwrap_or_default();
       if let Some(assets) = source["assets"].as_array() {
        for asset in assets {
         if asset["trashedAt"].is_null() {
          if let Some(items) = asset["tags"].as_array() {
           all.extend(items.clone());
          }
         }
        }
       }
       for item in &all {
        if let Some(tag) = item.as_str() {
         if !tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
          tags.push(tag.to_string());
         }
        }
       }
      }
     }
    }
    tags.sort_by_key(|t| t.to_lowercase());
    reply_to(output, json!({"ok": true, "tags": tags, "source": matched}))?;
    break;
   }
   "begin" => {
    if cleanup.file.is_some() || cleanup.part.is_some() {
     return Err("Capture already started".into());
    }
    let id = msg["id"].as_str().ok_or("Missing id")?;
    uuid::Uuid::parse_str(id)?;
    let ext = msg["extension"].as_str().ok_or("Missing format")?;
    if !["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "avif", "ico", "webm", "woff", "woff2", "ttf", "otf"].contains(&ext) {
     return Err("Unsupported format".into());
    }
    if let Some(items) = msg["segments"].as_array() {
     if ext != "webm" || items.is_empty() || items.len() > 100 {
      return Err("Invalid clip segments".into());
     }
     for item in items {
      let a = item["start"].as_f64().ok_or("Invalid clip start")?;
      let b = item["end"].as_f64().ok_or("Invalid clip end")?;
      if !a.is_finite() || !b.is_finite() || a < 0.0 || b <= a || b > 86400.0 {
       return Err("Invalid clip range".into());
      }
      segments.push((a, b));
     }
    }
    if let Some(v) = msg.get("crop").filter(|v| !v.is_null()) {
     if segments.is_empty() {
      return Err("Crop requires video segments".into());
     }
     let x = v["x"].as_f64().ok_or("Invalid crop")?;
     let y = v["y"].as_f64().ok_or("Invalid crop")?;
     let w = v["w"].as_f64().ok_or("Invalid crop")?;
     let h = v["h"].as_f64().ok_or("Invalid crop")?;
     if ![x, y, w, h].iter().all(|n| n.is_finite()) || x < 0.0 || y < 0.0 || w <= 0.0 || h <= 0.0 || x + w > 1.000001 || y + h > 1.000001 {
      return Err("Invalid crop".into());
     }
     crop = Some((x, y, w, h));
    }
    let output_ext = if segments.is_empty() { ext } else { "mp4" };
    let name = format!("{id}.{output_ext}");
    let part = inbox.join(format!("{id}.part"));
    final_path = inbox.join(&name);
    cleanup.part = Some(part.clone());
    cleanup.file = Some(File::create(&part)?);
    capture_ext = ext.to_string();
    capture_kind = if ext == "webm" { "video" } else if ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "avif", "ico"].contains(&ext) { "image" } else { "font" }.to_string();
    manifest = json!({
     "id": id,
     "file": name,
     "title": msg["title"].as_str().unwrap_or("Untitled capture"),
     "url": msg["url"].as_str().unwrap_or(""),
     "kind": capture_kind,
     "name": msg["name"].as_str().unwrap_or(""),
     "tags": msg["tags"].as_array().cloned().unwrap_or_default(),
     "notes": msg["notes"].as_str().unwrap_or(""),
     "annotations": msg["annotations"].as_array().cloned().unwrap_or_default(),
     "category": msg["category"].as_str().unwrap_or("Web design")
    });
    if capture_kind == "font" {
     apply_font_manifest_fields(&mut manifest, &msg);
    }
    reply_to(output, json!({"ok": true}))?;
   }
   "chunk" => {
    let values = msg["data"].as_array().ok_or("Missing chunk")?;
    if values.len() > 65536 {
     return Err("Chunk too large".into());
    }
    let mut chunk = Vec::with_capacity(values.len());
    for v in values {
     chunk.push(u8::try_from(v.as_u64().ok_or("Invalid byte")?)?);
    }
    bytes += chunk.len() as u64;
    if bytes > 1024 * 1024 * 1024 {
     return Err("Capture exceeds 1 GiB".into());
    }
    if header.len() < 64 {
     let take = (64 - header.len()).min(chunk.len());
     header.extend_from_slice(&chunk[..take]);
    }
    cleanup.file.as_mut().ok_or("Capture not started")?.write_all(&chunk)?;
    reply_to(output, json!({"ok": true}))?;
   }
   "end" => {
    let mut f = cleanup.file.take().ok_or("Capture not started")?;
    f.flush()?;
    f.sync_all()?;
    drop(f);
    if bytes == 0 {
     return Err("Capture is empty".into());
    }
    if capture_kind == "font" && !is_valid_font_data(&capture_ext, &header, bytes) {
     return Err("Invalid or corrupted font file".into());
    }
    let part = cleanup.part.as_ref().ok_or("Missing capture file")?.clone();
    if segments.is_empty() {
     fs::rename(&part, &final_path)?;
     cleanup.part = None;
     cleanup.committed_media = Some(final_path.clone());
    } else {
     let temp = final_path.with_extension("rendering.mp4");
     cleanup.temp_render = Some(temp.clone());
     render_video(&part, &temp, &segments, crop)?;
     fs::rename(&temp, &final_path)?;
     cleanup.temp_render = None;
     cleanup.committed_media = Some(final_path.clone());
     if let Some(p) = cleanup.part.take() {
      let _ = fs::remove_file(p);
     }
    }
    let id = manifest["id"].as_str().ok_or("Missing id")?;
    let tmp = inbox.join(format!("{id}.json.part"));
    cleanup.temp_manifest = Some(tmp.clone());
    fs::write(&tmp, serde_json::to_vec(&manifest)?)?;
    fs::rename(&tmp, inbox.join(format!("{id}.json")))?;
    cleanup.temp_manifest = None;
    cleanup.committed = true;
    cleanup.committed_media = None;
    let install_error = if capture_kind == "font" {
     font_install::install(&final_path, manifest["name"].as_str().unwrap_or("Font")).err()
    } else { None };
    reply_to(output, json!({"ok": true, "id": id, "installed": capture_kind == "font" && install_error.is_none(), "installError": install_error}))?;
    break;
   }
   _ => return Err("Invalid capture request".into()),
  }
 }
 Ok(())
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
 let (library, inbox) = library_config()?;
 let mut stdin = io::stdin().lock();
 let mut stdout = io::stdout().lock();
 run_with_io(&mut stdin, &mut stdout, &library, &inbox)
}
fn main(){if let Err(e)=run(){let _=reply(json!({"error":e.to_string()}));}}

#[cfg(test)] mod tests {
 use super::{apply_font_manifest_fields, is_valid_font_data, run_with_io, same_source};
 use serde_json::json;
 use std::{fs, io::Cursor, path::PathBuf};

 fn framed(messages: &[serde_json::Value]) -> Vec<u8> {
  let mut buf = Vec::new();
  for m in messages {
   let raw = serde_json::to_vec(m).unwrap();
   buf.extend_from_slice(&(raw.len() as u32).to_le_bytes());
   buf.extend_from_slice(&raw);
  }
  buf
 }

 fn temp_dir(label: &str) -> PathBuf {
  let dir = std::env::temp_dir().join(format!("sightline-bridge-unit-{label}-{}", uuid::Uuid::new_v4()));
  fs::create_dir_all(&dir).unwrap();
  dir
 }

 fn valid_woff2() -> Vec<u8> {
  let mut v = vec![0u8; 48];
  v[..4].copy_from_slice(b"wOF2");
  v
 }

 fn valid_otf() -> Vec<u8> {
  let mut v = vec![0u8; 44];
  v[..4].copy_from_slice(b"OTTO");
  v[4] = 0;
  v[5] = 2; // 2 tables -> 12 + 32 = 44 bytes
  v
 }

 fn fake_eot() -> Vec<u8> {
  let mut v = vec![0u8; 64];
  v[8..12].copy_from_slice(&[0x01, 0x00, 0x02, 0x00]);
  v[34..36].copy_from_slice(b"LP");
  v
 }

 #[test] fn source_grouping(){assert!(same_source("https://www.example.com/a","https://example.com/b"));assert!(!same_source("https://x.com/u/1","https://x.com/u/2"));assert!(same_source("https://x.com/u/1","https://x.com/u/1"));}

 #[test] fn font_manifest_preserves_static_and_variable_weights(){
  let mut static_manifest = json!({"id":"1","kind":"font"});
  apply_font_manifest_fields(&mut static_manifest, &json!({"family":" Inter ","weight":700,"style":"italic"}));
  assert_eq!(static_manifest["family"], "Inter");
  assert_eq!(static_manifest["weight"], 700);
  assert_eq!(static_manifest["weightMin"], 700);
  assert_eq!(static_manifest["weightMax"], 700);
  assert_eq!(static_manifest["style"], "italic");
  assert_eq!(static_manifest["fontSource"], "capture");
  assert!(static_manifest.get("isVariable").is_none());

  let mut var_manifest = json!({"id":"2","kind":"font"});
  apply_font_manifest_fields(&mut var_manifest, &json!({"family":"Satoshi","weightMin":900,"weightMax":300,"style":"invalid"}));
  assert_eq!(var_manifest["weight"], 400);
  assert_eq!(var_manifest["weightMin"], 300);
  assert_eq!(var_manifest["weightMax"], 900);
  assert_eq!(var_manifest["isVariable"], true);
  assert!(var_manifest.get("style").is_none());
  assert_eq!(var_manifest["fontSource"], "capture");
 }

 #[test] fn font_manifest_rounds_fractional_and_rejects_invalid_weights_and_sources(){
  let mut fractional = json!({"id":"3","kind":"font"});
  apply_font_manifest_fields(&mut fractional, &json!({
   "family":"Variable",
   "weight": 450.6,
   "weightMin": 199.4,
   "weightMax": 800.2,
   "fontSource": "https://evil.test"
  }));
  assert_eq!(fractional["weight"], 451);
  assert_eq!(fractional["weightMin"], 199);
  assert_eq!(fractional["weightMax"], 800);
  assert_eq!(fractional["isVariable"], true);
  assert_eq!(fractional["fontSource"], "capture");

  let mut invalid = json!({"id":"4","kind":"font"});
  apply_font_manifest_fields(&mut invalid, &json!({
   "family":"Broken",
   "weight": 0,
   "weightMin": -10,
   "weightMax": 1500,
   "fontSource": "google"
  }));
  assert!(invalid.get("weight").is_none());
  assert!(invalid.get("weightMin").is_none());
  assert!(invalid.get("weightMax").is_none());
  assert_eq!(invalid["fontSource"], "google");

  let mut out_of_band_weight = json!({"id":"5","kind":"font"});
  apply_font_manifest_fields(&mut out_of_band_weight, &json!({
   "family":"Narrow",
   "weight": 100,
   "weightMin": 500,
   "weightMax": 800
  }));
  assert_eq!(out_of_band_weight["weight"], 500);
  assert_eq!(out_of_band_weight["weightMin"], 500);
  assert_eq!(out_of_band_weight["weightMax"], 800);
 }

 #[test] fn font_magic_validation_accepts_real_headers_and_rejects_html_eot_and_truncated(){
  let w2 = valid_woff2();
  assert!(is_valid_font_data("woff2", &w2, w2.len() as u64));
  let otf = valid_otf();
  assert!(is_valid_font_data("otf", &otf, otf.len() as u64));
  let eot = fake_eot();
  assert!(!is_valid_font_data("otf", &eot, eot.len() as u64));
  assert!(!is_valid_font_data("ttf", &eot, eot.len() as u64));
  let html = b"<!DOCTYPE html><html>not a font</html>";
  assert!(!is_valid_font_data("woff2", html, html.len() as u64));
  assert!(!is_valid_font_data("woff2", b"wOF2-short", 10));
 }

 #[test] fn invalid_font_empty_capture_and_eof_clean_up_partial_files(){
  let root = temp_dir("cleanup");
  let library = root.join("lib");
  let inbox = root.join("inbox");
  fs::create_dir_all(&library).unwrap();

  // 1. Invalid font payload leaves zero files in inbox
  let id1 = uuid::Uuid::new_v4().to_string();
  let req1 = framed(&[
   json!({"type":"begin","id":id1,"extension":"woff2","title":"t","url":"https://example.com","family":"Fake"}),
   json!({"type":"chunk","data": b"<html>not a font</html>".to_vec()}),
   json!({"type":"end"}),
  ]);
  let mut out1 = Vec::new();
  let err1 = run_with_io(&mut Cursor::new(req1), &mut out1, &library, &inbox).unwrap_err();
  assert!(err1.to_string().contains("Invalid or corrupted font file"));
  assert_eq!(fs::read_dir(&inbox).unwrap().count(), 0);

  // 2. Premature EOF after chunk leaves zero .part files
  let id2 = uuid::Uuid::new_v4().to_string();
  let req2 = framed(&[
   json!({"type":"begin","id":id2,"extension":"png","title":"t","url":"https://example.com"}),
   json!({"type":"chunk","data": vec![0x89, 0x50, 0x4e, 0x47]}),
  ]);
  let mut out2 = Vec::new();
  let err2 = run_with_io(&mut Cursor::new(req2), &mut out2, &library, &inbox).unwrap_err();
  assert!(err2.to_string().contains("ended unexpectedly"));
  assert_eq!(fs::read_dir(&inbox).unwrap().count(), 0);

  // 3. Empty capture leaves zero .part files
  let id3 = uuid::Uuid::new_v4().to_string();
  let req3 = framed(&[
   json!({"type":"begin","id":id3,"extension":"png","title":"t","url":"https://example.com"}),
   json!({"type":"end"}),
  ]);
  let mut out3 = Vec::new();
  let err3 = run_with_io(&mut Cursor::new(req3), &mut out3, &library, &inbox).unwrap_err();
  assert!(err3.to_string().contains("empty"));
  assert_eq!(fs::read_dir(&inbox).unwrap().count(), 0);

  let _ = fs::remove_dir_all(&root);
 }
}
