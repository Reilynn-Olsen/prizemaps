// Debug helper: check whether calibrated templates match saved screenshots,
// without touching the live window or clicking anything.
//
// Usage: cargo run --example test_detector -- <image.png>

use tcg_watcher::detector::TemplateSet;
use tcg_watcher::letterbox;

fn main() -> anyhow::Result<()> {
    let path = std::env::args().nth(1).expect("usage: test_detector <image.png>");
    let screenshot = image::open(&path)?.to_rgba8();

    let content = letterbox::detect(&screenshot);
    println!(
        "detected content rect {}x{} at ({}, {}) inside the {}x{} image",
        content.w,
        content.h,
        content.x,
        content.y,
        screenshot.width(),
        screenshot.height()
    );

    let templates_dir = dirs::config_dir().unwrap().join("tcg-watcher").join("templates");
    let templates = TemplateSet::load(&templates_dir)?;

    for name in ["show_battle_log_button", "copy_to_clipboard_button"] {
        let template = templates.find(name).expect("template not found");
        println!(
            "{name}: matches={} score={:.4} threshold={}",
            template.matches(&screenshot),
            template.similarity_for_debug(&screenshot),
            template.def.threshold
        );
    }
    Ok(())
}
