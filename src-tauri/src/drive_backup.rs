//! Explicit, offline snapshots for a user-selected Google Drive for desktop folder.
//!
//! This uses the mounted folder as ordinary storage; it does not implement OAuth,
//! background sync, or conflict resolution. Callers choose which local files and
//! directories to include (for example, the library, Discover JSON files, and
//! serialized UI visited/removed state) and pass them to [`create_snapshot`].

use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const SNAPSHOT_PREFIX: &str = "sightline-snapshot-";
const COMPLETE_MARKER: &str = "COMPLETE";
const FORMAT_VERSION: &str = "sightline-snapshot-v1\n";
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

/// One caller-selected local file or directory to include in a snapshot.
/// `name` becomes a single directory/file name under the snapshot's `data` folder.
#[derive(Clone, Debug)]
pub struct BackupSource {
    pub name: String,
    pub path: PathBuf,
}

impl BackupSource {
    pub fn new(name: impl Into<String>, path: impl Into<PathBuf>) -> Self {
        Self {
            name: name.into(),
            path: path.into(),
        }
    }
}

/// Create a uniquely named snapshot in an existing, user-selected Drive folder.
/// Returns the completed snapshot directory. Incomplete snapshots are removed.
pub fn create_snapshot(drive_folder: &Path, sources: &[BackupSource]) -> Result<PathBuf, String> {
    validate_sources(sources)?;
    let drive_folder = fs::canonicalize(drive_folder).map_err(|e| {
        format!(
            "Cannot access backup folder {}: {e}",
            drive_folder.display()
        )
    })?;
    if !fs::metadata(&drive_folder).map_err(display_error)?.is_dir() {
        return Err("The selected backup location is not a folder".into());
    }

    for source in sources {
        let metadata = fs::symlink_metadata(&source.path)
            .map_err(|e| format!("Cannot access source {}: {e}", source.path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Refusing symlink source: {}",
                source.path.display()
            ));
        }
        let source_path = fs::canonicalize(&source.path).map_err(display_error)?;
        if source_path.starts_with(&drive_folder) || drive_folder.starts_with(&source_path) {
            return Err(format!(
                "Backup source overlaps the selected backup folder: {}",
                source.path.display()
            ));
        }
    }

    let snapshot = unique_dir(&drive_folder, SNAPSHOT_PREFIX)?;
    let result = (|| {
        let data = snapshot.join("data");
        fs::create_dir(&data).map_err(display_error)?;
        for source in sources {
            copy_entry(&source.path, &data.join(&source.name))?;
        }
        let mut marker = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(snapshot.join(COMPLETE_MARKER))
            .map_err(display_error)?;
        io::Write::write_all(&mut marker, FORMAT_VERSION.as_bytes()).map_err(display_error)?;
        marker.sync_all().map_err(display_error)?;
        Ok(snapshot.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&snapshot);
    }
    result
}

/// Restore a completed snapshot into a nonexistent or empty target directory.
/// Files are staged beside the target and then renamed into place. No target file
/// is overwritten; an incomplete restore is cleaned up without touching the target.
pub fn restore_snapshot(snapshot: &Path, target: &Path) -> Result<(), String> {
    let snapshot = fs::canonicalize(snapshot)
        .map_err(|e| format!("Cannot access snapshot {}: {e}", snapshot.display()))?;
    let marker_path = snapshot.join(COMPLETE_MARKER);
    let marker_meta = fs::symlink_metadata(&marker_path)
        .map_err(|_| "Snapshot is incomplete: completion marker is missing".to_string())?;
    if !marker_meta.is_file()
        || marker_meta.file_type().is_symlink()
        || fs::read_to_string(marker_path).map_err(display_error)? != FORMAT_VERSION
    {
        return Err("Snapshot is incomplete or has an unsupported format".into());
    }
    let data = snapshot.join("data");
    if !fs::symlink_metadata(&data)
        .map_err(|_| "Snapshot data folder is missing".to_string())?
        .is_dir()
    {
        return Err("Snapshot data folder is invalid".into());
    }

    let target_exists = match fs::symlink_metadata(target) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
            return Err("Restore target must be a folder, not a file or symlink".into());
        }
        Ok(_) => {
            if fs::read_dir(target)
                .map_err(display_error)?
                .next()
                .is_some()
            {
                return Err("Restore target is not empty; nothing was changed".into());
            }
            true
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => false,
        Err(e) => return Err(format!("Cannot inspect restore target: {e}")),
    };
    let parent = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(display_error)?;
    if fs::canonicalize(parent)
        .map_err(display_error)?
        .starts_with(&snapshot)
    {
        return Err("Restore target cannot be inside the snapshot".into());
    }
    let stage = unique_dir(parent, ".sightline-restore-")?;
    let result = (|| {
        copy_tree_contents(&data, &stage)?;
        if target_exists {
            // remove_dir is atomic with respect to emptiness and never removes user files.
            fs::remove_dir(target)
                .map_err(|e| format!("Restore target changed during restore: {e}"))?;
        }
        if let Err(e) = fs::rename(&stage, target) {
            if target_exists {
                let _ = fs::create_dir(target);
            }
            return Err(format!("Could not finalize restore: {e}"));
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&stage);
    }
    result
}

fn validate_sources(sources: &[BackupSource]) -> Result<(), String> {
    let mut names = std::collections::HashSet::new();
    for source in sources {
        let path = Path::new(&source.name);
        if source.name.is_empty()
            || path.components().count() != 1
            || !matches!(path.components().next(), Some(Component::Normal(_)))
            || source.name == COMPLETE_MARKER
            || source.name == "data"
            || !names.insert(source.name.to_lowercase())
        {
            return Err(format!(
                "Invalid or duplicate backup source name: {:?}",
                source.name
            ));
        }
    }
    Ok(())
}

fn unique_dir(parent: &Path, prefix: &str) -> Result<PathBuf, String> {
    for _ in 0..100 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = parent.join(format!(
            "{prefix}{now}-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                return Err(format!(
                    "Cannot create temporary folder {}: {e}",
                    path.display()
                ))
            }
        }
    }
    Err("Could not allocate a unique backup folder".into())
}

fn copy_entry(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(display_error)?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "Refusing symlink during backup/restore: {}",
            source.display()
        ));
    }
    if metadata.is_file() {
        copy_file(source, destination)
    } else if metadata.is_dir() {
        fs::create_dir(destination).map_err(display_error)?;
        copy_tree_contents(source, destination)
    } else {
        Err(format!(
            "Refusing unsupported filesystem entry: {}",
            source.display()
        ))
    }
}

fn copy_tree_contents(source: &Path, destination: &Path) -> Result<(), String> {
    let mut entries = fs::read_dir(source).map_err(display_error)?.collect::<Result<Vec<_>, _>>().map_err(display_error)?;
    // Snapshot the atomic index before media so later imports cannot create an
    // index reference to a file that was not present when the copy began.
    entries.sort_by_key(|entry| (entry.file_name() != "library.json", entry.file_name()));
    for entry in entries { copy_entry(&entry.path(), &destination.join(entry.file_name()))?; }
    Ok(())
}

fn copy_file(source: &Path, destination: &Path) -> Result<(), String> {
    let mut input = File::open(source).map_err(display_error)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(display_error)?;
    io::copy(&mut input, &mut output).map_err(display_error)?;
    output.sync_all().map_err(display_error)
}

fn display_error(error: io::Error) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "sightline-backup-test-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn snapshot_round_trips_files_and_directories() {
        let temp = TestDir::new();
        let library = temp.0.join("library");
        fs::create_dir_all(library.join("assets")).unwrap();
        fs::write(library.join("library.json"), "[]").unwrap();
        fs::write(library.join("assets/image.bin"), [1, 2, 3]).unwrap();
        let catalog = temp.0.join("discover.json");
        fs::write(&catalog, "[{}]").unwrap();
        let drive = temp.0.join("drive");
        fs::create_dir(&drive).unwrap();

        let snapshot = create_snapshot(
            &drive,
            &[
                BackupSource::new("library", &library),
                BackupSource::new("discover-sites.json", &catalog),
                BackupSource::new("ui-state.json", temp.0.join("ui-state.json")),
            ],
        );
        // A missing caller-selected source must fail and leave no incomplete snapshot.
        assert!(snapshot.is_err());
        assert_eq!(fs::read_dir(&drive).unwrap().count(), 0);

        let state = temp.0.join("ui-state.json");
        fs::write(&state, r#"{"sightline-study-removed":"{...}"}"#).unwrap();
        let snapshot = create_snapshot(
            &drive,
            &[
                BackupSource::new("library", &library),
                BackupSource::new("discover-sites.json", &catalog),
                BackupSource::new("ui-state.json", &state),
            ],
        )
        .unwrap();
        assert!(snapshot.join(COMPLETE_MARKER).is_file());
        let target = temp.0.join("restored");
        restore_snapshot(&snapshot, &target).unwrap();
        assert_eq!(
            fs::read(target.join("library/library.json")).unwrap(),
            b"[]"
        );
        assert_eq!(
            fs::read(target.join("library/assets/image.bin")).unwrap(),
            [1, 2, 3]
        );
        assert_eq!(
            fs::read_to_string(target.join("discover-sites.json")).unwrap(),
            "[{}]"
        );
        assert_eq!(fs::read_to_string(target.join("ui-state.json")).unwrap(), fs::read_to_string(state).unwrap());
    }

    #[test]
    fn restore_refuses_nonempty_targets_and_incomplete_snapshots() {
        let temp = TestDir::new();
        let drive = temp.0.join("drive");
        let source = temp.0.join("source");
        fs::create_dir(&drive).unwrap();
        fs::write(&source, "important").unwrap();
        let snapshot = create_snapshot(&drive, &[BackupSource::new("state.json", source)]).unwrap();
        let target = temp.0.join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep.txt"), "keep").unwrap();
        assert!(restore_snapshot(&snapshot, &target).is_err());
        assert_eq!(fs::read_to_string(target.join("keep.txt")).unwrap(), "keep");
        fs::remove_file(snapshot.join(COMPLETE_MARKER)).unwrap();
        assert!(restore_snapshot(&snapshot, &temp.0.join("other"))
            .unwrap_err()
            .contains("incomplete"));
    }

    #[test]
    fn rejects_unsafe_names_and_duplicate_sources() {
        assert!(validate_sources(&[BackupSource::new("../escape", "x")]).is_err());
        assert!(validate_sources(&[
            BackupSource::new("same", "x"),
            BackupSource::new("same", "y")
        ])
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_without_following_them() {
        use std::os::unix::fs::symlink;
        let temp = TestDir::new();
        let drive = temp.0.join("drive");
        let source = temp.0.join("source");
        fs::create_dir(&drive).unwrap();
        fs::create_dir(&source).unwrap();
        fs::write(temp.0.join("secret"), "secret").unwrap();
        symlink(temp.0.join("secret"), source.join("link")).unwrap();
        assert!(create_snapshot(&drive, &[BackupSource::new("source", source)]).is_err());
        assert_eq!(fs::read_dir(drive).unwrap().count(), 0);
    }
}
