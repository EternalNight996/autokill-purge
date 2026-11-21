// release 走 Windows GUI 子系统：不弹控制台黑框（debug 保留控制台方便看 panic）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// 梦神破甲 · autokill-purge 桌面壳（Tauri 2）
//
// 职责很薄：把一个**零依赖 Node 服务**拉起来，然后让 WebView 指向它。
//   · 资源布局：安装目录下 resources/app/{web,plugin,scripts,assets,package.json,node.exe}
//   · 端口：每次启动现取一个空闲端口，通过 PURGE_WEB_PORT 传给 server.mjs，避免和已开的控制台打架
//   · 退出：窗口关闭 → 杀掉 node 子进程，不留孤儿
//   · Node：优先用随包 node.exe；没有就回落到 PATH 里的 node（≥22）
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct ChildProc(Mutex<Option<Child>>);

/// 桌面壳没有控制台，排查只能靠文件日志。
fn diag(msg: &str) {
    let path = std::path::PathBuf::from(r"C:\Users\Administrator\autokill-desktop-diag.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        use std::io::Write;
        let _ = writeln!(f, "[{}] {}", chrono_like(), msg);
    }
}

fn chrono_like() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}", now.as_secs(), now.subsec_millis())
}

/// Windows 的 resource_dir() 会带 \\?\ 扩展前缀；node 解析脚本路径时不吃这个前缀。
fn plain(p: std::path::PathBuf) -> std::path::PathBuf {
    let s = p.to_string_lossy().to_string();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return std::path::PathBuf::from(rest.to_string());
    }
    p
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8792)
}

fn port_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(300),
    )
    .is_ok()
}

fn wait_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if port_open(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

/// 安装后资源在 <resource_dir>/app；开发态回落到仓库根（src-tauri/../..）。
fn app_root(app: &tauri::App) -> PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("app");
        if bundled.join("web").join("server.mjs").exists() {
            return bundled;
        }
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    for cand in [
        cwd.clone(),
        cwd.join(".."),
        cwd.join("..").join(".."),
        cwd.join("..").join("..").join(".."),
    ] {
        if cand.join("web").join("server.mjs").exists() {
            return cand;
        }
    }
    cwd
}

fn node_bin(root: &PathBuf) -> PathBuf {
    if let Ok(forced) = std::env::var("PURGE_NODE") {
        let p = PathBuf::from(forced);
        if p.exists() {
            return p;
        }
    }
    let bundled = root.join("node.exe");
    if bundled.exists() {
        return bundled;
    }
    PathBuf::from("node")
}

fn spawn_server(root: &PathBuf, port: u16) -> Option<Child> {
    let node = node_bin(root);
    let entry = root.join("web").join("server.mjs");
    let mut cmd = Command::new(&node);
    cmd.arg(&entry)
        .current_dir(root)
        .env("PURGE_WEB_PORT", port.to_string())
        .env("PURGE_ROOT", root.to_string_lossy().to_string())
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // node 的 stdout/stderr 落文件（app\data\logs\node-<pid>.log）：桌面壳崩了也能查
    let log_dir = root.join("data").join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join(format!("node-{}.log", std::process::id()));
    match std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        Ok(f) => {
            match f.try_clone() {
                Ok(f2) => { cmd.stdout(Stdio::from(f)); cmd.stderr(Stdio::from(f2)); }
                Err(_) => { cmd.stdout(Stdio::from(f)); }
            }
        }
        Err(_) => { cmd.stdout(Stdio::null()); cmd.stderr(Stdio::null()); }
    }
    cmd.spawn().ok()
}

pub fn run() {
    diag("run() entered");
    tauri::Builder::default()
        .setup(|app| {
            let root = plain(app_root(app));
            let port = free_port();
            diag(&format!("root={:?} node={:?} port={}", root, node_bin(&root), port));
            let child = spawn_server(&root, port);
            diag(&format!("spawn ok={}", child.is_some()));
            app.manage(ChildProc(Mutex::new(child)));

            let up = wait_port(port, Duration::from_secs(40));
            diag(&format!("port up={}", up));
            if !up {
                // 起不来也把窗口开出来，页面会显示本地服务不可达，比静默退出好排查
                eprintln!("[autokill-purge] server did not answer on 127.0.0.1:{}", port);
            }

            let url = format!("http://127.0.0.1:{}", port);
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("梦神破甲 · autokill-purge")
                .inner_size(1440.0, 940.0)
                .min_inner_size(1024.0, 640.0)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build tauri app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<ChildProc>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    let _ = std::fs::write(r"C:\Users\Administrator\main-entered.txt", b"ok");
    run()
}
