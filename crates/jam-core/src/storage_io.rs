use crate::{Result, invalid};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub(crate) fn lock(path: &Path) -> Result<File> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        match file.try_lock() {
            Ok(()) => break,
            Err(_) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(10))
            }
            Err(_) => {
                return Err(invalid(
                    "projectFolder",
                    "Project maintenance/publication is in progress; retry",
                ));
            }
        }
    }
    Ok(file)
}
pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension(format!("{}.tmp", crate::id()));
    let result = (|| {
        let mut f = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        replace(&tmp, path)?;
        #[cfg(unix)]
        File::open(path.parent().unwrap())?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(tmp);
    }
    result
}
#[cfg(not(windows))]
fn replace(source: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::rename(source, dest)
}
#[cfg(windows)]
fn replace(source: &Path, dest: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    let source = source.canonicalize()?;
    let dest = dest
        .parent()
        .ok_or_else(|| std::io::Error::other("Missing destination parent"))?
        .canonicalize()?
        .join(
            dest.file_name()
                .ok_or_else(|| std::io::Error::other("Missing destination filename"))?,
        );
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(a: *const u16, b: *const u16, flags: u32) -> i32;
    }
    let a: Vec<_> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let b: Vec<_> = dest.as_os_str().encode_wide().chain(Some(0)).collect();
    // Both paths live on the same volume; REPLACE_EXISTING | WRITE_THROUGH.
    if unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), 9) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
pub(crate) fn backup(source: &rusqlite::Connection, destination: &Path) -> Result<()> {
    let dest = rusqlite::Connection::open(crate::db::sqlite_path(destination)?)?;
    // SQLite online backup takes a consistent WAL-aware snapshot, never a raw DB copy.
    unsafe {
        let b = rusqlite::ffi::sqlite3_backup_init(
            dest.handle(),
            c"main".as_ptr(),
            source.handle(),
            c"main".as_ptr(),
        );
        if b.is_null() {
            return Err(invalid("backup", "Cannot start SQLite backup"));
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let code = loop {
            let code = rusqlite::ffi::sqlite3_backup_step(b, 128);
            if code == rusqlite::ffi::SQLITE_OK {
                continue;
            }
            if [rusqlite::ffi::SQLITE_BUSY, rusqlite::ffi::SQLITE_LOCKED].contains(&code)
                && std::time::Instant::now() < deadline
            {
                std::thread::sleep(std::time::Duration::from_millis(10));
                continue;
            }
            break code;
        };
        let finish = rusqlite::ffi::sqlite3_backup_finish(b);
        if code != rusqlite::ffi::SQLITE_DONE || finish != rusqlite::ffi::SQLITE_OK {
            return Err(invalid("backup", "SQLite backup failed or timed out"));
        }
    }
    integrity(&dest)?;
    OpenOptions::new()
        .write(true)
        .open(destination)?
        .sync_all()?;
    Ok(())
}
pub(crate) fn integrity(c: &rusqlite::Connection) -> Result<()> {
    let ok: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if ok != "ok" || c.prepare("PRAGMA foreign_key_check")?.exists([])? {
        return Err(invalid("database", "Integrity/foreign-key check failed"));
    }
    Ok(())
}
pub(crate) fn contained(root: &Path, relative: &str) -> Result<PathBuf> {
    if relative.is_empty()
        || relative.contains('\\')
        || relative.contains(':')
        || Path::new(relative).is_absolute()
        || relative
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
    {
        return Err(invalid("path", "Use a contained relative path"));
    }
    let root = root.canonicalize()?;
    let path = root.join(relative);
    let mut ancestor = path.as_path();
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| invalid("path", "No existing ancestor"))?;
    }
    if !ancestor.canonicalize()?.starts_with(&root) {
        return Err(invalid("path", "Symlink/junction escapes the root"));
    }
    Ok(path)
}
// Streaming SHA-256, kept dependency-free so this round changes no dependency lockfile.
pub(crate) fn hash_reader(mut reader: impl Read) -> Result<(String, u64)> {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut pending = Vec::with_capacity(65536 + 128);
    let mut total = 0u64;
    let mut buf = [0u8; 65536];
    loop {
        let n = reader.read(&mut buf)?;
        total += n as u64;
        pending.extend_from_slice(&buf[..n]);
        if n == 0 {
            pending.push(0x80);
            while pending.len() % 64 != 56 {
                pending.push(0);
            }
            pending.extend_from_slice(&(total * 8).to_be_bytes());
        }
        let chunks = pending.len() / 64;
        for block in pending[..chunks * 64].as_chunks::<64>().0 {
            let mut w = [0u32; 64];
            for (i, b) in block.as_chunks::<4>().0.iter().enumerate() {
                w[i] = u32::from_be_bytes(*b);
            }
            for i in 16..64 {
                let a = w[i - 15];
                let b = w[i - 2];
                w[i] = w[i - 16]
                    .wrapping_add(a.rotate_right(7) ^ a.rotate_right(18) ^ (a >> 3))
                    .wrapping_add(w[i - 7])
                    .wrapping_add(b.rotate_right(17) ^ b.rotate_right(19) ^ (b >> 10));
            }
            let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut z] = h;
            for i in 0..64 {
                let t = z
                    .wrapping_add(e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25))
                    .wrapping_add((e & f) ^ (!e & g))
                    .wrapping_add(K[i])
                    .wrapping_add(w[i]);
                let t2 = (a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22))
                    .wrapping_add((a & b) ^ (a & c) ^ (b & c));
                z = g;
                g = f;
                f = e;
                e = d.wrapping_add(t);
                d = c;
                c = b;
                b = a;
                a = t.wrapping_add(t2);
            }
            for (x, y) in h.iter_mut().zip([a, b, c, d, e, f, g, z]) {
                *x = x.wrapping_add(y);
            }
        }
        pending.drain(..chunks * 64);
        if n == 0 {
            break;
        }
    }
    Ok((h.iter().map(|v| format!("{v:08x}")).collect(), total))
}
pub(crate) fn hash(bytes: &[u8]) -> String {
    hash_reader(bytes).expect("in-memory hash").0
}
pub(crate) fn require_space(directory: &Path, bytes: u64) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetDiskFreeSpaceExW(
                path: *const u16,
                available: *mut u64,
                total: *mut u64,
                free: *mut u64,
            ) -> i32;
        }
        let path = directory.canonicalize()?;
        let path: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut available = 0;
        if unsafe {
            GetDiskFreeSpaceExW(
                path.as_ptr(),
                &mut available,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        if available < bytes.saturating_add(64 * 1024) {
            return Err(invalid(
                "diskSpace",
                "Insufficient free space; operation remains resumable and no unverified asset is committed",
            ));
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (directory, bytes);
    }
    Ok(())
}

pub(crate) fn replace_owned(source: &Path, dest: &Path) -> std::io::Result<()> {
    replace(source, dest)
}
#[cfg(test)]
mod tests {
    #[test]
    fn db_sha256_standard_vectors_cover_padding_and_multiple_chunks() {
        for (input, expected) in [
            (
                Vec::new(),
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            ),
            (
                b"abc".to_vec(),
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ),
            (
                vec![b'a'; 1_000_000],
                "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
            ),
        ] {
            assert_eq!(super::hash(&input), expected);
        }
    }
}
