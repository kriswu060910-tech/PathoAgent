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

    // 4. 常见开发路径
    let common_paths = [
        r"D:\agent",
        r"C:\agent",
        r"D:\Projects\agent",
        r"C:\Projects\agent",
    ];
    for p in &common_paths {
        let path = std::path::Path::new(p);
        if path.join("launcher").join("main.py").exists() {
            return p.to_string();
        }
    }

    // 5. 用户主目录下查找
    if let Ok(home) = std::env::var("USERPROFILE") {
        let candidate = std::path::Path::new(&home).join("agent");
        if candidate.join("launcher").join("main.py").exists() {
            return candidate.to_string_lossy().to_string();
        }
    }

    String::new()
}

fn resolve_python_path() -> String {
    // 1. 环境变量覆盖
    if let Ok(p) = std::env::var("PYTHON_PATH") {
        if !p.is_empty() {
            return p;
        }
    }

    // 2. 常见 conda / Python 路径（Windows）
    let common_pythons = [
        r"D:\miniconda3\python.exe",
        r"D:\miniconda3\envs\patho\python.exe",
        r"D:\Anaconda3\python.exe",
        r"D:\Anaconda3\envs\patho\python.exe",
        r"C:\miniconda3\python.exe",
        r"C:\miniconda3\envs\patho\python.exe",
        r"C:\ProgramData\miniconda3\python.exe",
    ];
    for p in &common_pythons {
        if std::path::Path::new(p).exists() {
            return p.to_string();
        }
    }

    // 3. 通过 where 命令查找
    if let Ok(output) = std::process::Command::new("where").arg("python").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout);
            for line in path.lines() {
                let trimmed = line.trim();
                // 跳过 WindowsApps 下的 store stub
                if !trimmed.is_empty() && !trimmed.contains("WindowsApps") {
                    return trimmed.to_string();
                }
            }
        }
    }

    // 4. 最后尝试 conda where
    if let Ok(output) = std::process::Command::new("conda").args(["run", "which", "python"]).output() {
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
        return Err(
            "找不到项目目录。请设置 PATHO_AGENT_PROJECT 环境变量指向项目根目录（如 D:\\agent）".into()
        );
    }

    if python_path.is_empty() {
        return Err(
            "找不到 Python 解释器。请设置 PYTHON_PATH 环境变量（如 D:\\miniconda3\\python.exe）".into()
        );
    }

    let canonical_root = std::fs::canonicalize(project_root)
        .map_err(|e| format!("项目目录无效 [{}]: {}", project_root, e))?;
    let canonical_python = std::fs::canonicalize(python_path)
        .map_err(|e| format!("Python 路径无效 [{}]: {}", python_path, e))?;

    if !canonical_python.exists() {
        return Err("Python 解释器不存在".into());
    }

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

    let lock_path = canonical_root.join(".launcher_lock");
    if lock_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&lock_path) {
            if let Ok(pid) = content.trim().parse::<u32>() {
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

    let _ = std::fs::write(&lock_path, child.id().to_string());

    Ok(format!("Launcher 已启动 (PID: {})", child.id()))
}

#[tauri::command]
fn get_launcher_info(state: tauri::State<'_, LauncherState>) -> serde_json::Value {
    serde_json::json!({
        "hasProject": !state.project_root.is_empty(),
        "hasPython": !state.python_path.is_empty(),
        "projectRoot": state.project_root,
        "pythonPath": state.python_path,
    })
}

#[tauri::command]
fn diagnose_launcher(state: tauri::State<'_, LauncherState>) -> serde_json::Value {
    let project_root = &state.project_root;
    let python_path = &state.python_path;

    let project_valid = if project_root.is_empty() {
        serde_json::json!({"ok": false, "reason": "未找到项目目录"})
    } else {
        let launcher_main = std::path::Path::new(project_root).join("launcher").join("main.py");
        serde_json::json!({
            "ok": launcher_main.exists(),
            "path": project_root,
            "launcherMain": launcher_main.to_string_lossy(),
            "launcherMainExists": launcher_main.exists(),
        })
    };

    let python_valid = if python_path.is_empty() {
        serde_json::json!({"ok": false, "reason": "未找到 Python 解释器"})
    } else {
        serde_json::json!({
            "ok": std::path::Path::new(python_path).exists(),
            "path": python_path,
            "exists": std::path::Path::new(python_path).exists(),
        })
    };

    let launcher_port: u16 = std::env::var("LAUNCHER_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8099);

    let launcher_running = std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", launcher_port).parse().unwrap(),
        std::time::Duration::from_millis(500),
    ).is_ok();

    let env_vars = serde_json::json!({
        "PATHO_AGENT_PROJECT": std::env::var("PATHO_AGENT_PROJECT").unwrap_or_default(),
        "PYTHON_PATH": std::env::var("PYTHON_PATH").unwrap_or_default(),
        "LAUNCHER_PORT": std::env::var("LAUNCHER_PORT").unwrap_or_default(),
    });

    // 检查 where python 的结果
    let where_python = std::process::Command::new("where")
        .arg("python")
        .output()
        .map(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            serde_json::json!({
                "success": o.status.success(),
                "paths": stdout.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect::<Vec<_>>(),
            })
        })
        .unwrap_or(serde_json::json!({"success": false, "error": "无法执行 where 命令"}));

    serde_json::json!({
        "projectRoot": project_valid,
        "pythonPath": python_valid,
        "launcherPort": launcher_port,
        "launcherRunning": launcher_running,
        "envVars": env_vars,
        "wherePython": where_python,
        "currentExe": std::env::current_exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        "currentDir": std::env::current_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
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
        .invoke_handler(tauri::generate_handler![
            start_launcher,
            get_launcher_info,
            diagnose_launcher,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
