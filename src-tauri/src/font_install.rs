use std::{fs, path::{Path, PathBuf}, process::Command};
#[cfg(windows)] use std::os::windows::{ffi::OsStrExt, process::CommandExt};
#[cfg(windows)]
#[link(name = "gdi32")]
extern "system" { fn AddFontResourceExW(name: *const u16, flags: u32, reserved: *mut std::ffi::c_void) -> i32; }
#[cfg(windows)]
#[link(name = "user32")]
extern "system" { fn SendNotifyMessageW(window: isize, message: u32, wparam: usize, lparam: isize) -> i32; }

fn decode_font(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let decoded = match bytes.get(..4) {
        Some(b"wOFF") => wuff::decompress_woff1(bytes).map_err(|e| format!("Could not convert WOFF font: {e:?}"))?,
        Some(b"wOF2") => wuff::decompress_woff2(bytes).map_err(|e| format!("Could not convert WOFF2 font: {e:?}"))?,
        Some(b"OTTO") | Some(b"\0\x01\0\0") | Some(b"true") => bytes.to_vec(),
        _ => return Err("Unsupported or invalid font file".into()),
    };
    if decoded.len() < 12 || !matches!(&decoded[..4], b"OTTO" | b"\0\x01\0\0" | b"true") { return Err("Converted font is invalid".into()); }
    Ok(decoded)
}

pub fn install(source: &Path, name: &str) -> Result<String, String> {
    #[cfg(not(windows))] { let _ = (source, name); Err("Font installation is currently supported on Windows only".into()) }
    #[cfg(windows)] {
        let source_bytes = decode_font(&fs::read(source).map_err(|e| e.to_string())?)?;
        let ext = if &source_bytes[..4] == b"OTTO" { "otf" } else { "ttf" };
        let stem = source.file_stem().and_then(|v| v.to_str()).ok_or("Invalid font file")?;
        let file_name = format!("{stem}.{ext}");
        let path = Path::new(&file_name);
        let dir = PathBuf::from(
            std::env::var_os("LOCALAPPDATA").ok_or("Local application data folder unavailable")?,
        )
        .join("Microsoft")
        .join("Windows")
        .join("Fonts");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest = dir.join(&file_name);
        let dest = if dest.exists() && fs::read(&dest).map(|b| b != source_bytes).unwrap_or(true) {
            dir.join(format!("{}-{}.{}", path.file_stem().unwrap_or_default().to_string_lossy(), uuid::Uuid::new_v4(), ext))
        } else { dest };
        {
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
        fs::write(&dest, &source_bytes).map_err(|e| e.to_string())?;
        let registry_name = format!(
            "{} [{}] (TrueType)",
            name.chars().take(80).collect::<String>(),
            dest.file_stem().unwrap_or_default().to_string_lossy()
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
            .output()
            .map_err(|e| e.to_string());
        if !matches!(status,Ok(v) if v.status.success()) {
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
                .output();
            let _ = fs::remove_file(&dest);
            return Err("Windows could not load this font file".into());
        }
        unsafe {
            SendNotifyMessageW(0xffff, 0x001d, 0, 0);
        }
        Ok("Font installed for your Windows account.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::decode_font;
    #[test]
    fn decodes_real_webfonts_and_rejects_invalid_data() {
        let mut paths = vec![std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")];
        if let Some(path) = std::env::var_os("SIGHTLINE_TEST_WOFF") { paths.push(path.into()); }
        for path in paths {
            let bytes = std::fs::read(path).unwrap();
            let decoded = decode_font(&bytes).unwrap();
            assert!(decoded.starts_with(b"\0\x01\0\0") || decoded.starts_with(b"OTTO"));
        }
        assert!(decode_font(b"not a font").is_err());
    }
}
