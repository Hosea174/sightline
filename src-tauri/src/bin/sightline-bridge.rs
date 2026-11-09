use serde_json::{json, Value};
use std::{fs::{self, File}, io::{self, Read, Write}, path::{Path, PathBuf}, process::Command};
#[cfg(windows)] use std::os::windows::process::CommandExt;

fn reply(v: Value) -> io::Result<()> { let b=serde_json::to_vec(&v)?; let mut out=io::stdout().lock(); out.write_all(&(b.len() as u32).to_le_bytes())?; out.write_all(&b)?; out.flush() }
fn library_config() -> Result<(PathBuf,PathBuf),Box<dyn std::error::Error>> {
 let config=PathBuf::from(std::env::var_os("APPDATA").ok_or("APPDATA unavailable")?).join("com.sightline.app");
 let library=PathBuf::from(fs::read_to_string(config.join("library-path.txt")).map_err(|_|"Open Sightline and choose a library folder first")?.trim());
 if !library.is_dir(){return Err("The selected Sightline library folder is unavailable".into())}
 let inbox=PathBuf::from(fs::read_to_string(config.join("capture-inbox.txt")).map_err(|_|"Open the updated Sightline app and choose a library first")?.trim());
 Ok((library,inbox))
}
fn ffmpeg_program() -> PathBuf {
 if let Some(paths)=std::env::var_os("PATH") { for dir in std::env::split_paths(&paths) { let exe=dir.join(if cfg!(windows){"ffmpeg.exe"}else{"ffmpeg"}); if exe.is_file(){return exe} } }
 if let Some(local)=std::env::var_os("LOCALAPPDATA") { let packages=PathBuf::from(local).join("Microsoft").join("WinGet").join("Packages"); if let Ok(entries)=fs::read_dir(packages) { for entry in entries.flatten() { if entry.file_name().to_string_lossy().starts_with("Gyan.FFmpeg_") { if let Ok(builds)=fs::read_dir(entry.path()) { for build in builds.flatten() {let exe=build.path().join("bin").join("ffmpeg.exe");if exe.is_file(){return exe}} } } } } }
 PathBuf::from("ffmpeg")
}
fn render_video(input:&Path, output:&Path, segments:&[(f64,f64)]) -> Result<(),Box<dyn std::error::Error>> {
 let mut filters=Vec::new();for (i,(start,end)) in segments.iter().enumerate(){filters.push(format!("[0:v]trim=start={start:.6}:end={end:.6},setpts=PTS-STARTPTS[v{i}]"));}
 let inputs=(0..segments.len()).map(|i|format!("[v{i}]")).collect::<String>();filters.push(format!("{inputs}concat=n={}:v=1:a=0[joined];[joined]pad=ceil(iw/2)*2:ceil(ih/2)*2[out]",segments.len()));
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
fn run() -> Result<(), Box<dyn std::error::Error>> {
 let (library,inbox)=library_config()?;fs::create_dir_all(&inbox)?;
 let mut file:Option<File>=None;let mut manifest=Value::Null;let mut part=PathBuf::new();let mut final_path=PathBuf::new();let mut bytes=0u64;let mut segments:Vec<(f64,f64)>=Vec::new();
 loop {let mut len=[0u8;4];let mut input=io::stdin().lock();if input.read_exact(&mut len).is_err(){break}let n=u32::from_le_bytes(len) as usize;if n>1024*1024{return Err("Message too large".into())}let mut data=vec![0;n];input.read_exact(&mut data)?;drop(input);let msg:Value=serde_json::from_slice(&data)?;
 match msg["type"].as_str().unwrap_or("") {
 "tags"=>{let mut tags=Vec::<String>::new();let mut matched=Value::Null;let requested=msg["url"].as_str().unwrap_or("");if let Ok(index)=fs::read_to_string(library.join("library.json")){if let Ok(Value::Array(sources))=serde_json::from_str::<Value>(&index){for source in sources{if !source["trashedAt"].is_null(){continue}if matched.is_null()&&same_source(source["url"].as_str().unwrap_or(""),requested){matched=json!({"tags":source["tags"],"category":source["category"]})}if let Some(items)=source["tags"].as_array(){for item in items{if let Some(tag)=item.as_str(){if !tags.iter().any(|t|t.eq_ignore_ascii_case(tag)){tags.push(tag.to_string())}}}}}}}tags.sort_by_key(|t|t.to_lowercase());reply(json!({"ok":true,"tags":tags,"source":matched}))?;break},
 "begin"=>{if file.is_some(){return Err("Capture already started".into())}let id=msg["id"].as_str().ok_or("Missing id")?;uuid::Uuid::parse_str(id)?;let ext=msg["extension"].as_str().ok_or("Missing format")?;if !["png","jpg","jpeg","webp","gif","svg","bmp","avif","ico","webm","woff","woff2","ttf","otf"].contains(&ext){return Err("Unsupported format".into())}
 if let Some(items)=msg["segments"].as_array(){if ext!="webm"||items.is_empty()||items.len()>100{return Err("Invalid clip segments".into())}for item in items{let a=item["start"].as_f64().ok_or("Invalid clip start")?;let b=item["end"].as_f64().ok_or("Invalid clip end")?;if !a.is_finite()||!b.is_finite()||a<0.0||b<=a||b>86400.0{return Err("Invalid clip range".into())}segments.push((a,b));}}
 let output_ext=if segments.is_empty(){ext}else{"mp4"};let name=format!("{id}.{output_ext}");part=inbox.join(format!("{id}.part"));final_path=inbox.join(&name);file=Some(File::create(&part)?);manifest=json!({"id":id,"file":name,"title":msg["title"].as_str().unwrap_or("Untitled capture"),"url":msg["url"].as_str().unwrap_or(""),"kind":if ext=="webm" {"video"} else if ["png","jpg","jpeg","webp","gif","svg","bmp","avif","ico"].contains(&ext) {"image"} else {"font"},"name":msg["name"].as_str().unwrap_or(""),"tags":msg["tags"].as_array().cloned().unwrap_or_default(),"category":msg["category"].as_str().unwrap_or("Web design")});reply(json!({"ok":true}))?},
 "chunk"=>{let values=msg["data"].as_array().ok_or("Missing chunk")?;if values.len()>65536{return Err("Chunk too large".into())}let mut chunk=Vec::with_capacity(values.len());for v in values{chunk.push(u8::try_from(v.as_u64().ok_or("Invalid byte")?)?)}bytes+=chunk.len() as u64;if bytes>1024*1024*1024{return Err("Capture exceeds 1 GiB".into())}file.as_mut().ok_or("Capture not started")?.write_all(&chunk)?;reply(json!({"ok":true}))?},
 "end"=>{let mut f=file.take().ok_or("Capture not started")?;f.flush()?;f.sync_all()?;drop(f);if bytes==0{return Err("Capture is empty".into())}if segments.is_empty(){fs::rename(&part,&final_path)?}else{let temp=final_path.with_extension("rendering.mp4");if let Err(e)=render_video(&part,&temp,&segments){let _=fs::remove_file(&temp);return Err(e)}fs::rename(&temp,&final_path)?;let _=fs::remove_file(&part);}let id=manifest["id"].as_str().ok_or("Missing id")?;let tmp=inbox.join(format!("{id}.json.part"));fs::write(&tmp,serde_json::to_vec(&manifest)?)?;fs::rename(tmp,inbox.join(format!("{id}.json")))?;reply(json!({"ok":true}))?;break},
 _=>return Err("Invalid capture request".into()) }
 }
 Ok(())
}
fn main(){if let Err(e)=run(){let _=reply(json!({"error":e.to_string()}));}}

#[cfg(test)] mod tests {use super::same_source;#[test] fn source_grouping(){assert!(same_source("https://www.example.com/a","https://example.com/b"));assert!(!same_source("https://x.com/u/1","https://x.com/u/2"));assert!(same_source("https://x.com/u/1","https://x.com/u/1"));}}
