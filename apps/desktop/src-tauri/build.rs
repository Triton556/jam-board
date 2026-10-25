fn main() {
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    let mut attributes = tauri_build::Attributes::new();
    if windows_msvc {
        // `rustc-link-arg-tests` misses library unit-test harnesses. Apply the
        // same manifest to every MSVC artifact; keep Tauri's icons/version
        // resources but suppress its second RT_MANIFEST in application bins.
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let manifest = std::path::PathBuf::from(
            std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo manifest directory"),
        )
        .join("windows-test.manifest");
        println!("cargo:rerun-if-changed=windows-test.manifest");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        // Match Tauri's dependency-only manifest instead of adding linker UAC policy.
        println!("cargo:rustc-link-arg=/MANIFESTUAC:NO");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
    tauri_build::try_build(attributes).expect("build desktop resources");
}
