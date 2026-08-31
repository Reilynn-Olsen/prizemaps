//! Best-effort cursor-position / window-geometry ground truth via KWin's
//! scripting API, used to *correct* otherwise-open-loop relative pointer
//! motion (originally built against `ydotool`'s relative motion, now reused
//! by `portal.rs` — see its module doc comment) — open-loop prediction
//! alone wasn't reliable enough for a small click target on this machine.
//! KDE-only, and every function here degrades to `None` on any
//! failure (missing `qdbus6`, non-KDE session, scripting disabled, no
//! journal access, etc.), so callers must have a working fallback — this is
//! a precision boost where available, not a requirement.
//!
//! There's no synchronous D-Bus return path for a KWin script's output
//! (`Script.run` returns `void`), so the mechanism is: write a small script
//! to a temp file, load + run it via `qdbus6`, have the script `print()`
//! a tagged line (KWin routes script `print()` to the systemd journal), and
//! grep the journal for it. Not glamorous, but verified reliable through
//! extensive live testing this session.

use std::process::Command;
use std::time::Duration;

fn run_script(body: &str) -> Option<String> {
    let path = std::env::temp_dir().join(format!("tcg_watcher_kwin_{}.js", std::process::id()));
    std::fs::write(&path, body).ok()?;
    let id_out = Command::new("qdbus6")
        .args(["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.loadScript", path.to_str()?])
        .output()
        .ok()?;
    if !id_out.status.success() {
        let _ = std::fs::remove_file(&path);
        return None;
    }
    let id = String::from_utf8_lossy(&id_out.stdout).trim().to_string();
    if id.is_empty() {
        let _ = std::fs::remove_file(&path);
        return None;
    }
    // loadScript only registers the path — it doesn't read the file until
    // `run` actually executes it, so the file has to still exist for this
    // call, not just the one above (verified live: deleting it right after
    // loadScript instead of after run produced
    // "org.kde.kwin.Scripting.FileError: Could not open ...").
    let ran = Command::new("qdbus6")
        .args(["org.kde.KWin", &format!("/Scripting/Script{id}"), "org.kde.kwin.Script.run"])
        .status()
        .ok();
    let _ = std::fs::remove_file(&path);
    if !ran?.success() {
        return None;
    }
    std::thread::sleep(Duration::from_millis(250));
    let journal = Command::new("journalctl").args(["--since", "-3s", "--no-pager"]).output().ok()?;
    Some(String::from_utf8_lossy(&journal.stdout).into_owned())
}

fn parse_tagged_pair(out: &str, tag: &str) -> Option<(f64, f64)> {
    let line = out.lines().rev().find(|l| l.contains(tag))?;
    let rest = line.split(tag).nth(1)?.trim();
    let mut parts = rest.split(',');
    let x: f64 = parts.next()?.trim().parse().ok()?;
    let y: f64 = parts.next()?.trim().parse().ok()?;
    Some((x, y))
}

/// Logical-space cursor position, if KWin scripting ground truth is
/// available.
pub fn cursor_pos() -> Option<(f64, f64)> {
    let out = run_script("print('TCGW_CURSOR ' + workspace.cursorPos.x + ',' + workspace.cursorPos.y);")?;
    parse_tagged_pair(&out, "TCGW_CURSOR")
}

/// Logical-space frame geometry `(x, y, width, height)` of the first window
/// whose caption contains `title_hint`, if found.
pub fn window_frame_geometry(title_hint: &str) -> Option<(f64, f64, f64, f64)> {
    let script = format!(
        r#"
        var clients = workspace.stackingOrder;
        for (var i = 0; i < clients.length; i++) {{
            var c = clients[i];
            if (c.caption && c.caption.indexOf("{title_hint}") !== -1) {{
                var g = c.frameGeometry;
                print("TCGW_GEO " + g.x + "," + g.y + "," + g.width + "," + g.height);
            }}
        }}
        "#
    );
    let out = run_script(&script)?;
    let line = out.lines().rev().find(|l| l.contains("TCGW_GEO"))?;
    let rest = line.split("TCGW_GEO").nth(1)?.trim();
    let parts: Vec<f64> = rest.split(',').filter_map(|p| p.trim().parse().ok()).collect();
    if parts.len() == 4 {
        Some((parts[0], parts[1], parts[2], parts[3]))
    } else {
        None
    }
}
