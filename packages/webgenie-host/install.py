"""
Native host manifest installer.

Usage:
    python install.py [--browser chrome|edge|brave] [--uninstall]

Installs the native messaging host manifest so Chrome/Edge/Brave can find it.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import stat
import sys
from pathlib import Path


MANIFEST_NAME = "com.webgenie.host"
HOST_SCRIPT = Path(__file__).parent / "host.py"


def manifest_content(python_path: str, host_path: str) -> dict:
    return {
        "name": MANIFEST_NAME,
        "description": "WebGenie native messaging host",
        "path": host_path,
        "type": "stdio",
        "allowed_origins": [
            # Replace with your extension ID after loading unpacked
            "chrome-extension://YOUR_EXTENSION_ID_HERE/",
        ],
    }


def get_manifest_dirs(browser: str) -> list[Path]:
    system = platform.system()
    dirs: list[Path] = []

    if system == "Darwin":
        base = Path.home() / "Library" / "Application Support"
        browser_dirs = {
            "chrome": base / "Google" / "Chrome" / "NativeMessagingHosts",
            "edge": base / "Microsoft Edge" / "NativeMessagingHosts",
            "brave": base / "BraveSoftware" / "Brave-Browser" / "NativeMessagingHosts",
        }
    elif system == "Linux":
        base = Path.home() / ".config"
        browser_dirs = {
            "chrome": base / "google-chrome" / "NativeMessagingHosts",
            "edge": base / "microsoft-edge" / "NativeMessagingHosts",
            "brave": base / "BraveSoftware" / "Brave-Browser" / "NativeMessagingHosts",
        }
    elif system == "Windows":
        import winreg
        browser_dirs = {}
        # On Windows we use registry instead, handled separately
    else:
        print(f"Unsupported platform: {system}")
        sys.exit(1)

    if browser == "all":
        dirs = list(browser_dirs.values())
    else:
        d = browser_dirs.get(browser)
        if d:
            dirs = [d]

    return dirs


def create_wrapper_script(python_path: str) -> Path:
    """Create a shell/bat wrapper that Chrome can call directly."""
    wrapper_dir = HOST_SCRIPT.parent
    system = platform.system()

    if system == "Windows":
        wrapper = wrapper_dir / "webgenie-host.bat"
        wrapper.write_text(f'@echo off\n"{python_path}" "{HOST_SCRIPT}"\n')
        return wrapper
    else:
        wrapper = wrapper_dir / "webgenie-host.sh"
        wrapper.write_text(f'#!/bin/sh\nexec "{python_path}" "{HOST_SCRIPT}" "$@"\n')
        wrapper.chmod(wrapper.stat().st_mode | stat.S_IEXEC)
        return wrapper


def install(browser: str = "all") -> None:
    python_path = sys.executable
    wrapper = create_wrapper_script(python_path)

    manifest = manifest_content(python_path, str(wrapper))
    manifest_json = json.dumps(manifest, indent=2)
    filename = f"{MANIFEST_NAME}.json"

    dirs = get_manifest_dirs(browser)

    if platform.system() == "Windows":
        _install_windows(manifest_json, filename)
        return

    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
        target = d / filename
        target.write_text(manifest_json)
        print(f"✅ Installed: {target}")

    print("\n⚠️  IMPORTANT: Update allowed_origins in the manifest files with your extension ID.")
    print("   Load the unpacked extension in Chrome → chrome://extensions → get the ID → paste it.")


def _install_windows(manifest_json: str, filename: str) -> None:
    import winreg

    key_path = rf"Software\Google\Chrome\NativeMessagingHosts\{MANIFEST_NAME}"
    tmp = Path(os.environ.get("APPDATA", ".")) / "WebGenie" / filename
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_text(manifest_json)

    try:
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path)
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(tmp))
        winreg.CloseKey(key)
        print(f"✅ Registry key set: HKCU\\{key_path}")
        print(f"✅ Manifest written: {tmp}")
    except Exception as e:
        print(f"❌ Failed to write registry: {e}")
        raise


def uninstall(browser: str = "all") -> None:
    filename = f"{MANIFEST_NAME}.json"
    for d in get_manifest_dirs(browser):
        target = d / filename
        if target.exists():
            target.unlink()
            print(f"✅ Removed: {target}")

    # Remove wrapper
    for ext in (".sh", ".bat"):
        w = HOST_SCRIPT.parent / f"webgenie-host{ext}"
        if w.exists():
            w.unlink()
            print(f"✅ Removed: {w}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Install/uninstall WebGenie native host")
    parser.add_argument("--browser", default="all", choices=["chrome", "edge", "brave", "all"])
    parser.add_argument("--uninstall", action="store_true")
    args = parser.parse_args()

    if args.uninstall:
        uninstall(args.browser)
    else:
        install(args.browser)
