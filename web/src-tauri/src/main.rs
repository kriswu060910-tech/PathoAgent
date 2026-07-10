#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

struct LauncherState {
    project_root: String,
    python_path: String,
    starting: AtomicBool,
}

fn resolve_project_root() -> String {
    // 1. 环境变量覆盖
    if let Ok(p) = std::env::var("PATHO_AGENT_PROJECT") {
        if std::path::Path::new(&p).join("launcher").exists() {
            return p;
        }
    }

    // 2. 可执行文件所在目录向上查找
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        while let Some(d) = dir {
            if d.join("launcher").join("main.py").exists() {
                return d.to_string_lossy().to_string();
            }
            dir = d.parent().map(|p| p.to_path_buf());
        }
    }

    // 3. 当前工作目录
    if let Ok(cwd) = std::env::current_dir() {
        if cwd.join("launcher").join("main.py").exists() {
            return cwd.to_string_lossy().to_string();
        }
    }

    // 4. 已知开发路径 fallback
    let fallback = r"D:\agent";
    if std::path::Path::new(fallback).join("launcher").exists() {
        return fallback.to_string();
    }

    String::new()
}

fn resolve_python_path() -> String {
    if let Ok(p) = std::env::var("PYTHON_PATH") {
        return p;
    }
    r"D:\miniconda3\envs\patho\python.exe".to_string()
}

#[tauri::command]
async fn start_launcher(state: tauri::State<'_, LauncherState>) -> Result<String, String> {
    if state.starting.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err("Launcher 正在启动中，请稍候...".into());
    }

    // RAII guard：确保 panic 时也能重置 starting 标志
    struct ResetGuard<'a>(&'a AtomicBool);
    impl<'a> Drop for ResetGuard<'a> {
        fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); }
    }
    let _guard = ResetGuard(&state.starting);

    spawn_launcher(&state)
}

fn spawn_launcher(state: &LauncherState) -> Result<String, String> {
    let project_root = &state.project_root;
    let python_path = &state.python_path;

    if project_root.is_empty() {
        return Err("找不到项目目录。请设置 PATHO_AGENT_PROJECT 环境变量。".into());
    }

    if !std::path::Path::new(python_path).exists() {
        return Err(format!("Python 解释器不存在: {}", python_path));
    }

    // 先检查 launcher 是否已在运行（TCP 探测 8099 端口）
    if std::net::TcpStream::connect_timeout(
        &"127.0.0.1:8099".parse().unwrap(),
        std::time::Duration::from_millis(500),
    )
    .is_ok()
    {
        return Ok("Launcher 已在运行中".into());
    }

    let child = std::process::Command::new(python_path)
        .args(["-m", "launcher.main", "--auto-start"])
        .current_dir(project_root)
        .creation_flags(0x00000008) // DETACHED_PROCESS
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("启动失败: {}", e))?;

    Ok(format!("Launcher 已启动 (PID: {})", child.id()))
}

#[tauri::command]
fn get_launcher_info(state: tauri::State<'_, LauncherState>) -> serde_json::Value {
    serde_json::json!({
        "projectRoot": state.project_root,
        "pythonPath": state.python_path,
        "hasProject": !state.project_root.is_empty(),
    })
}

fn main() {
    let project_root = resolve_project_root();
    let python_path = resolve_python_path();

    tauri::Builder::default()
        .manage(LauncherState {
            project_root,
            python_path,
            starting: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![start_launcher, get_launcher_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
