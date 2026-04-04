import os
import platform
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Dict

@dataclass(frozen=True)
class PlatformInfo:
    os_name: str
    os_release: str
    distro: str
    shell: str
    package_manager: str
    arch: str
    is_wsl: bool = False
    extras: Dict[str, str] = field(default_factory=dict, repr=False)

    def summary(self) -> str:
        wsl = " (WSL)" if self.is_wsl else ""
        return f"OS={self.os_name}{wsl} distro={self.distro} shell={self.shell} pkg={self.package_manager}"

def _detect_distro() -> str:
    try:
        with open("/etc/os-release") as f:
            c = f.read().lower()
        for name in ("arch", "ubuntu", "debian", "fedora", "gentoo", "void", "nixos"):
            if name in c: return name
        if "opensuse" in c or "suse" in c: return "opensuse"
        for line in c.split("\n"):
            if line.startswith("id="): return line.split("=", 1)[1].strip().strip('"')
    except FileNotFoundError:
        pass
    return "unknown"

def _detect_shell() -> str:
    system = platform.system().lower()
    if system == "windows":
        return "powershell" if os.getenv("PSModulePath") else "cmd"
    shell = os.path.basename(os.getenv("SHELL", ""))
    if shell in ("bash", "zsh", "fish", "dash"): return shell
    try:
        ppid = os.getppid()
        r = subprocess.run(["ps", "-p", str(ppid), "-o", "comm="], capture_output=True, text=True, timeout=5)
        parent = r.stdout.strip().split("/")[-1]
        if parent in ("bash", "zsh", "fish", "dash"): return parent
    except Exception:
        pass
    return "bash"

def _detect_pkg(distro: str, os_name: str) -> str:
    if os_name == "darwin": return "brew" if shutil.which("brew") else "none"
    if os_name == "windows":
        return next((pm for pm in ("winget", "choco") if shutil.which(pm)), "pip")
    distro_map = {
        "arch": ["yay", "paru", "pacman"],
        "ubuntu": ["apt"], "debian": ["apt"],
        "fedora": ["dnf"], "opensuse": ["zypper"],
        "gentoo": ["emerge"], "void": ["xbps-install"],
        "nixos": ["nix-env"],
    }
    for pm in distro_map.get(distro, []):
        if shutil.which(pm): return pm
    return "unknown"

def _is_wsl() -> bool:
    if platform.system().lower() != "linux": return False
    try:
        with open("/proc/version") as f: return "microsoft" in f.read().lower()
    except FileNotFoundError:
        return False

def detect_platform() -> PlatformInfo:
    system = platform.system().lower()
    release = platform.release()
    arch = platform.machine()
    if system == "linux":
        distro = _detect_distro()
    elif system == "darwin":
        distro = "macos"
        release = platform.mac_ver()[0] or release
    elif system == "windows":
        distro = "windows"
        release = platform.version()
    else:
        distro = system
    extras = {}
    if distro in ("arch", "gentoo", "void", "opensuse"):
        extras["rolling_release"] = "true"
    return PlatformInfo(
        os_name=system, os_release=release, distro=distro,
        shell=_detect_shell(), package_manager=_detect_pkg(distro, system),
        arch=arch, is_wsl=_is_wsl(), extras=extras,
    )
