#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

// ---------------------------------------------------------------------------
// PTY state — each agent gets one PTY instance
// ---------------------------------------------------------------------------

struct PtyInstance {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
}

struct PtyState {
    instances: Mutex<HashMap<String, PtyInstance>>,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Spawn an interactive `claude` process inside a real PTY.
/// Returns the child PID. Output is streamed via `pty-output-{id}` events.
#[tauri::command]
fn spawn_pty(
    app: AppHandle,
    state: State<'_, PtyState>,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    model: Option<String>,
    system_prompt: Option<String>,
    permission_mode: Option<String>,
    max_turns: Option<u32>,
    allowed_tools: Option<Vec<String>>,
    disallowed_tools: Option<Vec<String>>,
    env_vars: Option<HashMap<String, String>>,
    session_id: Option<String>,
    resume_session_id: Option<String>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    // Resolve the actual claude executable.
    // On Windows, `claude` may be a .cmd npm shim that doesn't work with ConPTY.
    // We try the real .exe first, then fall back to the PATH entry.
    let claude_bin = if cfg!(windows) {
        // Check common install locations for the real binary
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        let exe_path = std::path::PathBuf::from(&home).join(".local/bin/claude.exe");
        if exe_path.exists() {
            exe_path.to_string_lossy().to_string()
        } else {
            // Fall back to cmd /c which handles .cmd shims
            String::from("claude")
        }
    } else {
        String::from("claude")
    };

    let mut cmd = if cfg!(windows) && !claude_bin.ends_with(".exe") {
        // .cmd shim fallback — wrap in cmd.exe
        let mut c = CommandBuilder::new("cmd");
        c.arg("/c");
        c.arg(&claude_bin);
        c
    } else {
        CommandBuilder::new(&claude_bin)
    };
    cmd.cwd(&cwd);

    // Pass --model flag if specified (e.g. "opus", "sonnet", "haiku")
    if let Some(ref m) = model {
        cmd.arg("--model");
        cmd.arg(m);
    }

    // Permission mode: "auto" uses --dangerously-skip-permissions, "interactive" omits it
    let skip_permissions = match permission_mode.as_deref() {
        Some("interactive") => false,
        _ => true, // default to auto-approve for swarm agents
    };
    if skip_permissions {
        cmd.arg("--dangerously-skip-permissions");
    }

    // Max turns limits how many conversation turns the agent can take
    if let Some(turns) = max_turns {
        cmd.arg("--max-turns");
        cmd.arg(turns.to_string());
    }

    // Tool allow/disallow lists
    if let Some(ref tools) = allowed_tools {
        for tool in tools {
            if !tool.is_empty() {
                cmd.arg("--allowedTools");
                cmd.arg(tool);
            }
        }
    }
    if let Some(ref tools) = disallowed_tools {
        for tool in tools {
            if !tool.is_empty() {
                cmd.arg("--disallowedTools");
                cmd.arg(tool);
            }
        }
    }

    // Resume a prior Claude Code session, or pin a new session ID for future resume.
    if let Some(ref sid) = resume_session_id {
        cmd.arg("--resume");
        cmd.arg(sid);
    } else if let Some(ref sid) = session_id {
        cmd.arg("--session-id");
        cmd.arg(sid);
    }

    // Inject swarm context as part of Claude's system prompt (not typed into the TUI).
    // This avoids PTY input buffer limits that truncate long typed prompts.
    if let Some(ref sp) = system_prompt {
        cmd.arg("--append-system-prompt");
        cmd.arg(sp);
    }

    // Set additional environment variables (e.g. CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS)
    if let Some(ref vars) = env_vars {
        for (key, value) in vars {
            cmd.env(key, value);
        }
    }

    // Remove the CLAUDECODE env var so the child doesn't think it's nested
    // inside another Claude Code session (which happens when developing
    // this app from within Claude Code itself).
    cmd.env_remove("CLAUDECODE");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn claude: {e}"))?;

    let pid = child.process_id().unwrap_or(0);

    // We communicate through the master side only
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    // Store master (for resize) and writer (for input)
    {
        let mut instances = state.instances.lock().unwrap();
        instances.insert(
            id.clone(),
            PtyInstance {
                writer,
                master: pair.master,
            },
        );
    }

    // Background thread: read PTY output and emit events to the frontend
    let app_handle = app.clone();
    let pty_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit(&format!("pty-output-{pty_id}"), &data);
                }
                Err(_) => break,
            }
        }
        let _ = app_handle.emit(&format!("pty-exit-{pty_id}"), ());
    });

    // Background thread: wait for process exit
    let app_handle2 = app.clone();
    let pty_id2 = id.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        let _ = app_handle2.emit(&format!("pty-exit-{pty_id2}"), ());
    });

    Ok(pid)
}

/// Write user input to a running PTY.
#[tauri::command]
fn write_pty(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap();
    if let Some(instance) = instances.get_mut(&id) {
        instance
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write failed: {e}"))?;
        instance
            .writer
            .flush()
            .map_err(|e| format!("Flush failed: {e}"))?;
        Ok(())
    } else {
        Err(format!("PTY {id} not found"))
    }
}

/// Resize a PTY (called when xterm.js detects a container resize).
#[tauri::command]
fn resize_pty(state: State<'_, PtyState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let instances = state.instances.lock().unwrap();
    if let Some(instance) = instances.get(&id) {
        instance
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {e}"))?;
        Ok(())
    } else {
        Err(format!("PTY {id} not found"))
    }
}

/// Kill a PTY and its child process.
#[tauri::command]
fn kill_pty(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap();
    // Dropping the PtyInstance closes the master, which signals EOF to the child
    instances.remove(&id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Workspace persistence — simple file I/O (no extra plugins needed)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct WorkspaceInfo {
    name: String,
    path: String,
    modified_at: String,
}

/// Return the workspaces directory, creating it if needed.
#[tauri::command]
fn get_workspaces_dir(app: AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {e}"))?;
    let dir = base.join("workspaces");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create workspaces dir: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

/// Save a workspace JSON string to a file.
#[tauri::command]
fn save_workspace(path: String, data: String) -> Result<(), String> {
    std::fs::write(&path, data.as_bytes()).map_err(|e| format!("Failed to write workspace: {e}"))
}

/// Load a workspace JSON string from a file.
#[tauri::command]
fn load_workspace(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read workspace: {e}"))
}

/// List all saved workspaces in the workspaces directory.
#[tauri::command]
fn list_workspaces(app: AppHandle) -> Result<Vec<WorkspaceInfo>, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {e}"))?;
    let dir = base.join("workspaces");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut results = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("Failed to read dir: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let name = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let modified_at = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    let duration = t
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default();
                    format!("{}000", duration.as_secs()) // ms timestamp as string
                })
                .unwrap_or_default();
            results.push(WorkspaceInfo {
                name,
                path: path.to_string_lossy().to_string(),
                modified_at,
            });
        }
    }
    // Sort by modified time descending (most recent first)
    results.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(results)
}

/// Delete a workspace file.
#[tauri::command]
fn delete_workspace(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete workspace: {e}"))
}

/// Save app settings JSON to {app_data_dir}/settings.json.
#[tauri::command]
fn save_app_settings(app: AppHandle, data: String) -> Result<(), String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {e}"))?;
    std::fs::create_dir_all(&base).ok();
    let path = base.join("settings.json");
    std::fs::write(&path, data.as_bytes())
        .map_err(|e| format!("Failed to write settings: {e}"))
}

/// Load app settings JSON from {app_data_dir}/settings.json.
#[tauri::command]
fn load_app_settings(app: AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {e}"))?;
    let path = base.join("settings.json");
    if !path.exists() {
        return Ok("{}".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {e}"))
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyState {
            instances: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            spawn_pty, write_pty, resize_pty, kill_pty,
            get_workspaces_dir, save_workspace, load_workspace, list_workspaces, delete_workspace,
            save_app_settings, load_app_settings
        ])
        .setup(|app| {
            // Create the main window programmatically so we can configure
            // WebView2 browser args and zoom hotkeys for crisp high-DPI rendering.
            let builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("Omniforge")
            .inner_size(1400.0, 900.0)
            .min_inner_size(1000.0, 700.0)
            .decorations(false)
            .transparent(false)
            .resizable(true)
            .zoom_hotkeys_enabled(true)
            .additional_browser_args(
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
                 --enable-features=OverlayScrollbar,GpuRasterization",
            );

            let window = builder.build()?;

            // WebView2 is DPI-aware by default — it renders at the full
            // physical resolution.  Do NOT call set_zoom(scale) here:
            // that would apply a *second* magnification on top of the
            // native DPI scaling (e.g. 1.5 × 1.5 = 2.25×), making
            // everything blurry.

            // Kill all PTY child processes when the window closes so
            // Claude Code sessions don't linger as orphaned processes.
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Destroyed = event {
                    let state = app_handle.state::<PtyState>();
                    let mut instances = state.instances.lock().unwrap();
                    let count = instances.len();
                    instances.clear(); // Drop all PtyInstances → EOF → child exit
                    if count > 0 {
                        eprintln!("[cleanup] Killed {count} orphaned PTY session(s) on window close");
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
