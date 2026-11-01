use std::path::Path;

/// Render a path for people and agents, retaining canonical paths internally.
pub fn display_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(tail) = path.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{tail}");
        }
        if let Some(tail) = path.strip_prefix(r"\\?\") {
            return tail.into();
        }
    }
    path.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_does_not_change_normal_paths() {
        assert_eq!(
            display_path(Path::new("/tmp/Камни — 🪨")),
            "/tmp/Камни — 🪨"
        );
    }

    #[test]
    fn verbatim_paths_follow_platform_rules() {
        #[cfg(windows)]
        {
            assert_eq!(display_path(Path::new(r"\\?\C:\x")), r"C:\x");
            assert_eq!(
                display_path(Path::new(r"\\?\UNC\srv\share\x")),
                r"\\srv\share\x"
            );
        }
        #[cfg(not(windows))]
        {
            assert_eq!(display_path(Path::new(r"\\?\C:\x")), r"\\?\C:\x");
            assert_eq!(
                display_path(Path::new(r"\\?\UNC\srv\share\x")),
                r"\\?\UNC\srv\share\x"
            );
        }
    }
}
