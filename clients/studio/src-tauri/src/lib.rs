// Per architecture/phase-13.md §2.4 T1.1
// Schema Studio — Tauri 2.x shell with native menus + MCP client integration.

use tauri::Manager;
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri_plugin_shell::ShellExt;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mcp_child: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>> =
        Arc::new(Mutex::new(None));
    let mcp_child_shutdown = mcp_child.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            // Spawn the MCP server as a sidecar process on app launch.
            let shell = app.shell();
            match shell.command("schema-mcp").spawn() {
                Ok((_rx, child)) => {
                    log::info!("MCP server spawned (pid: {})", child.pid());
                    if let Ok(mut guard) = mcp_child.lock() {
                        *guard = Some(child);
                    }
                }
                Err(e) => {
                    log::warn!("Failed to spawn MCP server: {}. Studio will retry via /mcp proxy.", e);
                }
            }

            let file_menu = SubmenuBuilder::new(app, "File")
                .text("open-workspace", "Open Workspace…")
                .separator()
                .close_window()
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .text("toggle-file-tree", "Toggle File Tree")
                .text("toggle-events", "Toggle Event Log")
                .text("toggle-graph", "Show Graph")
                .separator()
                .text("command-bar", "Command Bar")
                .text("cheat-sheet", "Keyboard Shortcuts")
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .text("docs", "Documentation")
                .text("report-issue", "Report Issue")
                .separator()
                .about(None)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| {
                let id = event.id().0.as_str();
                match id {
                    "open-workspace" => {
                        use tauri_plugin_dialog::DialogExt;
                        let app_handle = app.clone();
                        app_handle.dialog().file().pick_folder(move |folder| {
                            if let Some(path) = folder {
                                if let Some(window) = app_handle.get_webview_window("main") {
                                    let path_str = path.to_string();
                                    let js = format!(
                                        "window.__schemaOpenFolder?.('{}')",
                                        path_str.replace('\\', "\\\\").replace('\'', "\\'")
                                    );
                                    let _ = window.eval(&js);
                                }
                            }
                        });
                    }
                    "toggle-file-tree" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true }))");
                        }
                    }
                    "toggle-events" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.eval("window.__schemaToggleEvents?.()");
                        }
                    }
                    "command-bar" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))");
                        }
                    }
                    "cheat-sheet" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))");
                        }
                    }
                    "docs" => {
                        let _ = open::that("https://github.com/Ijtihed/schemav3");
                    }
                    "report-issue" => {
                        let _ = open::that("https://github.com/Ijtihed/schemav3/issues");
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Ok(mut guard) = mcp_child_shutdown.lock() {
                    if let Some(child) = guard.take() {
                        log::info!("Shutting down MCP server (pid: {})", child.pid());
                        let _ = child.kill();
                    }
                }
            }
        });
}
