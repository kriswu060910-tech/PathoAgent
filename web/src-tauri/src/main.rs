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

    String::new()
}

fn resolve_python_path() -> String {
    if let Ok(p) = std::env::var("PYTHON_PATH") {
        return p;
    }
    // 尝试从 PATH 中查找 python
    if let Ok(output) = std::process::Command::new("where").arg("python").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout);
            if let Some(first) = path.lines().next() {
                let trimmed = first.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
    }
    String::new()
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

    if python_path.is_empty() {
        return Err("找不到 Python 解释器。请设置 PYTHON_PATH 环境变量。".into());
    }

    // 规范化路径，防止路径注入
    let canonical_root = std::fs::canonicalize(project_root)
        .map_err(|e| format!("项目目录无效: {}", e))?;
    let canonical_python = std::fs::canonicalize(python_path)
        .map_err(|e| format!("Python 解释器路径无效: {}", e))?;

    if !canonical_python.exists() {
        return Err("Python 解释器不存在".into());
    }

    // 先检查 launcher 是否已在运行（TCP 探测端口）
    let launcher_port: u16 = std::env::var("LAUNCHER_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8099);

    if std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", launcher_port).parse().unwrap(),
        std::time::Duration::from_millis(500),
    )
    .is_ok()
    {
        return Ok("Launcher 已在运行中".into());
    }

    // 使用锁文件防止多实例竞态启动
    let lock_path = canonical_root.join(".launcher_lock");
    if lock_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&lock_path) {
            if let Ok(pid) = content.trim().parse::<u32>() {
                // 检查持有锁的进程是否仍存活
                let alive = std::process::Command::new("tasklist")
                    .args(["/FI", &format!("PID eq {}", pid), "/NH"])
                    .output()
                    .map(|o| o.status.success() && !o.stdout.is_empty())
                    .unwrap_or(false);
                if alive {
                    return Ok("另一个实例正在启动 Launcher，请稍候...".into());
                }
            }
        }
        // 锁文件过期或进程不存在，清理
        let _ = std::fs::remove_file(&lock_path);
    }

    let child = std::process::Command::new(&canonical_python)
        .args(["-m", "launcher.main", "--auto-start"])
        .current_dir(&canonical_root)
        .creation_flags(0x00000008) // DETACHED_PROCESS
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("启动失败: {}", e))?;

    // 写入锁文件（Launcher 启动后可自行清理，或下次启动时检测过期）
    let _ = std::fs::write(&lock_path, child.id().to_string());

    Ok(format!("Launcher 已启动 (PID: {})", child.id()))
}

#[tauri::command]
fn get_launcher_info(state: tauri::State<'_, LauncherState>) -> serde_json::Value {
    serde_json::json!({
        "hasProject": !state.project_root.is_empty(),
        "hasPython": !state.python_path.is_empty(),
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
