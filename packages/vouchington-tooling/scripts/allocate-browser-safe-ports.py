#!/usr/bin/env python3
from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
FETCH_FORBIDDEN_PORTS_PATH = SCRIPT_DIR / "fetch-forbidden-ports.json"
RUNNER_PORT_POLICY_PATH = SCRIPT_DIR / "runner-port-policy.json"
CHROMIUM_RESTRICTED_PORTS: frozenset[int] = frozenset()


def load_forbidden_ports(path: Path) -> frozenset[int]:
    return frozenset(json.loads(path.read_text()))


def load_runner_port_policy(path: Path) -> dict[str, int]:
    policy = json.loads(path.read_text())
    required_keys = {
        "reservedPortStart",
        "reservedPortEnd",
        "portsPerRunner",
        "minimumRunnerSlot",
        "maximumRunnerSlot",
    }
    if set(policy) != required_keys or not all(
        type(policy[key]) is int for key in required_keys
    ):
        raise RuntimeError(f"invalid runner port policy at {path}")

    start = policy["reservedPortStart"]
    end = policy["reservedPortEnd"]
    ports_per_runner = policy["portsPerRunner"]
    minimum_slot = policy["minimumRunnerSlot"]
    maximum_slot = policy["maximumRunnerSlot"]
    if (
        start < 1
        or end > 65535
        or start > end
        or ports_per_runner <= 0
        or minimum_slot != 1
        or maximum_slot < minimum_slot
        or end - start + 1 != ports_per_runner * maximum_slot
    ):
        raise RuntimeError(f"invalid runner port policy at {path}")
    return policy


RUNNER_PORT_POLICY: dict[str, int] = {}


def configure_policy(policy_path: Path, forbidden_path: Path) -> None:
    global CHROMIUM_RESTRICTED_PORTS, FETCH_FORBIDDEN_PORTS_PATH, RUNNER_PORT_POLICY
    global RUNNER_PORT_POLICY_PATH
    FETCH_FORBIDDEN_PORTS_PATH = forbidden_path
    RUNNER_PORT_POLICY_PATH = policy_path
    CHROMIUM_RESTRICTED_PORTS = load_forbidden_ports(forbidden_path)
    RUNNER_PORT_POLICY = load_runner_port_policy(policy_path)


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Allocate localhost ports that Chromium will load."
    )
    parser.add_argument("count", nargs="?", type=positive_int)
    parser.add_argument("--max-bind-attempts", type=int, default=1000)
    parser.add_argument("--hold", action="store_true")
    parser.add_argument("--hold-dir", type=Path)
    parser.add_argument("--release", type=positive_int)
    parser.add_argument("--stop", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument(
        "--workspace",
        default=os.environ.get("PORT_HOLD_WORKSPACE")
        or os.environ.get("VOUCHA_PORT_HOLD_WORKSPACE")
        or os.environ.get("GITHUB_WORKSPACE")
        or os.getcwd(),
    )
    parser.add_argument("--policy", type=Path, default=RUNNER_PORT_POLICY_PATH)
    parser.add_argument("--forbidden-ports", type=Path, default=FETCH_FORBIDDEN_PORTS_PATH)
    args = parser.parse_args()
    configure_policy(args.policy, args.forbidden_ports)
    control_modes = [args.release is not None, args.stop, args.check]
    if sum(control_modes) > 1:
        parser.error("use only one of --release, --stop, or --check")
    if args.hold and any(control_modes):
        parser.error("--hold cannot be combined with --release, --stop, or --check")
    if (args.hold or any(control_modes)) and args.hold_dir is None:
        parser.error("--hold-dir is required for --hold, --release, --stop, and --check")
    if args.hold and args.count is None:
        parser.error("count is required with --hold")
    if not args.hold and not any(control_modes) and args.count is None:
        parser.error("count is required")
    return args


def numeric_runner_slots(*paths: str) -> list[int]:
    slots: list[int] = []
    for path in paths:
        if not path:
            continue
        parts = Path(path).parts
        for index, part in enumerate(parts[:-2]):
            if part not in {"actions-runner", "actions-runners"}:
                continue
            candidate = parts[index + 1]
            if parts[index + 2] != "_work":
                continue
            if candidate.isdecimal():
                if candidate != str(int(candidate)):
                    raise RuntimeError(
                        f"runner slot {candidate} must use canonical decimal spelling"
                    )
                slots.append(int(candidate))
    return slots


def detect_runner_slot(github_workspace: str, cwd: str) -> int | None:
    slots = numeric_runner_slots(github_workspace, cwd)
    if not slots:
        return None
    unique_slots = set(slots)
    if len(unique_slots) != 1:
        raise RuntimeError(
            "found conflicting numeric GitHub Actions runner slots in "
            "GITHUB_WORKSPACE/current directory"
        )
    return slots[0]


def runner_port_slice(slot: int) -> range:
    minimum_slot = RUNNER_PORT_POLICY["minimumRunnerSlot"]
    maximum_slot = RUNNER_PORT_POLICY["maximumRunnerSlot"]
    if slot < minimum_slot or slot > maximum_slot:
        raise RuntimeError(
            f"runner slot {slot} is outside the supported range "
            f"{minimum_slot}-{maximum_slot}"
        )
    start = RUNNER_PORT_POLICY["reservedPortStart"] + (
        slot - minimum_slot
    ) * RUNNER_PORT_POLICY["portsPerRunner"]
    return range(start, start + RUNNER_PORT_POLICY["portsPerRunner"])


def allocate_ports(
    count: int, max_bind_attempts: int, runner_slot: int | None = None
) -> list[int]:
    sockets: list[socket.socket] = []
    try:
        if runner_slot is not None:
            port_slice = runner_port_slice(runner_slot)
            if count > len(port_slice):
                raise RuntimeError(
                    f"requested {count} ports exceeds runner slice capacity {len(port_slice)}"
                )
            candidates = port_slice
        else:
            candidates = range(max_bind_attempts)

        for candidate_port in candidates:
            if len(sockets) == count:
                break
            candidate = socket.socket()
            try:
                candidate.bind(("", candidate_port if runner_slot is not None else 0))
            except OSError:
                candidate.close()
                continue
            port = candidate.getsockname()[1]
            if port in CHROMIUM_RESTRICTED_PORTS or (
                runner_slot is None
                and RUNNER_PORT_POLICY["reservedPortStart"]
                <= port
                <= RUNNER_PORT_POLICY["reservedPortEnd"]
            ):
                candidate.close()
                continue
            sockets.append(candidate)

        if len(sockets) != count:
            location = (
                f"runner slice {runner_slot}" if runner_slot is not None else "ephemeral ports"
            )
            raise RuntimeError(
                f"failed to allocate {count} ports after {len(candidates)} bind attempts "
                f"from {location}"
            )
        return [candidate.getsockname()[1] for candidate in sockets]
    finally:
        for candidate in sockets:
            candidate.close()


SCRIPT_NAME = "allocate-browser-safe-ports.py"
HOLD_POLL_SECONDS = 0.05
HOLD_READY_TIMEOUT_SECONDS = 2.0
CONTROL_WAIT_SECONDS = 2.0


def resolve_workspace(workspace: str) -> str:
    return str(Path(workspace).resolve())


def durable_identity_dir(workspace: str) -> Path:
    digest = hashlib.sha256(resolve_workspace(workspace).encode()).hexdigest()
    return Path(f"/tmp/port-hold-{digest}")


def process_command_line(pid: int) -> str | None:
    proc_cmd = Path(f"/proc/{pid}/cmdline")
    try:
        if proc_cmd.is_file():
            return proc_cmd.read_bytes().replace(b"\x00", b" ").decode(errors="replace")
    except OSError:
        pass
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "command="],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def process_environ(pid: int) -> dict[str, str]:
    proc_env = Path(f"/proc/{pid}/environ")
    raw = b""
    try:
        if proc_env.is_file():
            raw = proc_env.read_bytes()
    except OSError:
        raw = b""
    if not raw:
        result = subprocess.run(
            ["ps", "eww", "-p", str(pid), "-o", "command="],
            capture_output=True,
            check=False,
        )
        raw = result.stdout
    values: dict[str, str] = {}
    for entry in raw.split(b"\x00" if b"\x00" in raw else b" "):
        if b"=" not in entry:
            continue
        key, value = entry.split(b"=", 1)
        decoded_key = key.decode(errors="replace")
        if decoded_key.isidentifier() or decoded_key.endswith("PORT_HOLD_WORKSPACE"):
            values[decoded_key] = value.decode(errors="replace")
    return values


def is_our_holder(pid: int, workspace: str) -> bool:
    command = process_command_line(pid)
    if command is None or SCRIPT_NAME not in command:
        return False
    wanted = resolve_workspace(workspace)
    for token in command.split():
        try:
            if resolve_workspace(token) == wanted:
                return True
        except OSError:
            continue
    environ = process_environ(pid)
    recorded = environ.get("PORT_HOLD_WORKSPACE") or environ.get("VOUCHA_PORT_HOLD_WORKSPACE")
    return recorded in {wanted, workspace}


def pid_is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def read_pid(path: Path) -> int | None:
    try:
        return int(path.read_text().strip())
    except (ValueError, FileNotFoundError, ProcessLookupError):
        return None


def workspace_holder_pid(workspace: str) -> int | None:
    identity = durable_identity_dir(workspace)
    pid = read_pid(identity / "pid")
    if pid is None or not pid_is_alive(pid) or not is_our_holder(pid, workspace):
        return None
    return pid


def reap_stale_holder(workspace: str) -> None:
    identity = durable_identity_dir(workspace)
    pid_path = identity / "pid"
    if not pid_path.is_file():
        return
    pid = read_pid(pid_path)
    if pid is None:
        pid_path.unlink(missing_ok=True)
        return
    if not pid_is_alive(pid):
        pid_path.unlink(missing_ok=True)
        return
    if not is_our_holder(pid, workspace):
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pid_path.unlink(missing_ok=True)
        return
    deadline = time.monotonic() + CONTROL_WAIT_SECONDS
    while time.monotonic() < deadline and pid_is_alive(pid):
        time.sleep(HOLD_POLL_SECONDS)
    if pid_is_alive(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    pid_path.unlink(missing_ok=True)


def _bind_unlistening(family: int, address: tuple[str, int]) -> socket.socket:
    bound = socket.socket(family, socket.SOCK_STREAM)
    bound.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
    if family == socket.AF_INET6:
        try:
            bound.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except OSError:
            pass
    try:
        bound.bind(address)
    except OSError:
        bound.close()
        raise
    return bound


def bind_hold_sockets(port: int | None) -> tuple[int, list[socket.socket]]:
    sockets: list[socket.socket] = []
    linux = sys.platform.startswith("linux")
    chosen = port

    # Linux Node/docker listen on ::: / 127.0.0.1. Binding loopback first then
    # AF_INET6 V6ONLY=0 fails on every candidate (EADDRINUSE), which exhausted
    # the 16-port runner slice in CI.
    if linux and socket.has_ipv6:
        try:
            ipv6 = _bind_unlistening(socket.AF_INET6, ("::", 0 if port is None else port))
        except OSError as error:
            if error.errno in {errno.EAFNOSUPPORT, errno.EADDRNOTAVAIL}:
                ipv6 = None
            else:
                raise
        if ipv6 is not None:
            chosen = ipv6.getsockname()[1]
            sockets.append(ipv6)
            for host in ("127.0.0.1", "0.0.0.0"):
                try:
                    sockets.append(_bind_unlistening(socket.AF_INET, (host, chosen)))
                except OSError:
                    pass
            return chosen, sockets

    loopback = _bind_unlistening(socket.AF_INET, ("127.0.0.1", 0 if port is None else port))
    chosen = loopback.getsockname()[1]
    sockets.append(loopback)
    if socket.has_ipv6:
        try:
            sockets.append(_bind_unlistening(socket.AF_INET6, ("::", chosen)))
        except OSError:
            pass
    try:
        sockets.append(_bind_unlistening(socket.AF_INET, ("0.0.0.0", chosen)))
    except OSError:
        # Darwin cannot bind 0.0.0.0 after 127.0.0.1 with SO_REUSEADDR=0.
        # Linux can, so a wildcard failure means a non-loopback IPv4 owner.
        if linux:
            for item in sockets:
                item.close()
            raise
    return chosen, sockets


def allocate_hold_sockets(
    count: int, max_bind_attempts: int, runner_slot: int | None
) -> dict[int, list[socket.socket]]:
    held: dict[int, list[socket.socket]] = {}
    try:
        if runner_slot is not None:
            port_slice = runner_port_slice(runner_slot)
            if count > len(port_slice):
                raise RuntimeError(
                    f"requested {count} ports exceeds runner slice capacity {len(port_slice)}"
                )
            candidates: range | list[None] = port_slice
        else:
            candidates = [None] * max_bind_attempts

        for candidate_port in candidates:
            if len(held) == count:
                break
            try:
                port, sockets = bind_hold_sockets(candidate_port)
            except OSError:
                continue
            if port in CHROMIUM_RESTRICTED_PORTS or (
                runner_slot is None
                and RUNNER_PORT_POLICY["reservedPortStart"]
                <= port
                <= RUNNER_PORT_POLICY["reservedPortEnd"]
            ):
                for item in sockets:
                    item.close()
                continue
            held[port] = sockets

        if len(held) != count:
            location = (
                f"runner slice {runner_slot}" if runner_slot is not None else "ephemeral ports"
            )
            raise RuntimeError(
                f"failed to allocate {count} ports after {len(candidates)} bind attempts "
                f"from {location}"
            )
        return held
    except Exception:
        for sockets in held.values():
            for item in sockets:
                item.close()
        raise


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def daemonize_holder() -> bool:
    first = os.fork()
    if first > 0:
        os.waitpid(first, 0)
        return False
    os.setsid()
    if os.fork() > 0:
        os._exit(0)
    os.chdir("/")
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 0)
    os.dup2(devnull, 1)
    os.dup2(devnull, 2)
    if devnull > 2:
        os.close(devnull)
    return True


def holder_loop(
    held: dict[int, list[socket.socket]],
    hold_dir: Path,
    workspace: str,
) -> None:
    identity = durable_identity_dir(workspace)
    write_text(identity / "workspace", resolve_workspace(workspace))
    write_text(identity / "pid", str(os.getpid()))
    write_text(hold_dir / "pid", str(os.getpid()))
    write_text(hold_dir / "ports", " ".join(str(port) for port in held))
    write_text(hold_dir / "ready", "1")
    release_dir = hold_dir / "release"
    release_dir.mkdir(parents=True, exist_ok=True)

    def shutdown(_signum: int | None = None, _frame: object | None = None) -> None:
        for sockets in held.values():
            for item in sockets:
                item.close()
        held.clear()
        (hold_dir / "stop").unlink(missing_ok=True)
        (identity / "pid").unlink(missing_ok=True)
        os._exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGHUP, shutdown)

    while True:
        if not hold_dir.is_dir() or (hold_dir / "stop").is_file():
            shutdown()
        for release_file in list(release_dir.iterdir()):
            try:
                port = int(release_file.name)
            except ValueError:
                release_file.unlink(missing_ok=True)
                continue
            sockets = held.pop(port, [])
            for item in sockets:
                item.close()
            release_file.unlink(missing_ok=True)
            write_text(hold_dir / "ports", " ".join(str(item) for item in held))
        time.sleep(HOLD_POLL_SECONDS)


def start_holder(
    count: int,
    max_bind_attempts: int,
    runner_slot: int | None,
    hold_dir: Path,
    workspace: str,
) -> list[int]:
    hold_dir = hold_dir.resolve()
    hold_dir.mkdir(parents=True, exist_ok=True)
    release_dir = hold_dir / "release"
    release_dir.mkdir(parents=True, exist_ok=True)
    (hold_dir / "ready").unlink(missing_ok=True)
    (hold_dir / "stop").unlink(missing_ok=True)
    for stale in release_dir.iterdir():
        stale.unlink(missing_ok=True)
    resolved = resolve_workspace(workspace)
    os.environ["PORT_HOLD_WORKSPACE"] = resolved
    os.environ["VOUCHA_PORT_HOLD_WORKSPACE"] = resolved
    reap_stale_holder(workspace)
    held = allocate_hold_sockets(count, max_bind_attempts, runner_slot)
    ports = list(held)
    if daemonize_holder():
        holder_loop(held, hold_dir, workspace)
        raise AssertionError("holder_loop returned")
    for sockets in held.values():
        for item in sockets:
            item.close()
    deadline = time.monotonic() + HOLD_READY_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if (hold_dir / "ready").is_file():
            return ports
        time.sleep(HOLD_POLL_SECONDS)
    reap_stale_holder(workspace)
    raise RuntimeError(f"port holder did not become ready under {hold_dir}")


def port_is_bindable(port: int) -> bool:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
    try:
        probe.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        probe.close()


def wait_until_port_bindable(port: int) -> None:
    deadline = time.monotonic() + CONTROL_WAIT_SECONDS
    while time.monotonic() < deadline:
        if port_is_bindable(port):
            return
        time.sleep(HOLD_POLL_SECONDS)
    raise RuntimeError(f"port {port} did not become bindable")


def request_release(hold_dir: Path, port: int) -> None:
    hold_dir = hold_dir.resolve()
    release_path = hold_dir / "release" / str(port)
    release_path.parent.mkdir(parents=True, exist_ok=True)
    release_path.write_text("1")
    deadline = time.monotonic() + CONTROL_WAIT_SECONDS
    while time.monotonic() < deadline:
        if port_is_bindable(port):
            return
        time.sleep(HOLD_POLL_SECONDS)
    raise RuntimeError(f"port {port} was not released by the holder under {hold_dir}")


def request_stop(hold_dir: Path, workspace: str) -> None:
    hold_dir = hold_dir.resolve()
    hold_dir.mkdir(parents=True, exist_ok=True)
    ports_path = hold_dir / "ports"
    remaining = (
        [int(item) for item in ports_path.read_text().split() if item] if ports_path.is_file() else []
    )
    (hold_dir / "stop").write_text("1")
    pid_path = hold_dir / "pid"
    pid = read_pid(pid_path) if pid_path.is_file() else None
    if pid is not None and pid_is_alive(pid) and is_our_holder(pid, workspace):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.monotonic() + CONTROL_WAIT_SECONDS
    while time.monotonic() < deadline:
        current = read_pid(pid_path)
        if current is None or not pid_is_alive(current):
            break
        time.sleep(HOLD_POLL_SECONDS)
    successor = workspace_holder_pid(workspace)
    if successor is not None and successor != pid:
        # A replacement holder for this workspace already reaped us and took the ports.
        return
    for port in remaining:
        wait_until_port_bindable(port)


def check_holder(hold_dir: Path, workspace: str) -> None:
    hold_dir = hold_dir.resolve()
    pid_path = hold_dir / "pid"
    pid = read_pid(pid_path)
    if pid is None:
        raise RuntimeError(f"port holder pid file missing under {hold_dir}")
    if not pid_is_alive(pid):
        raise RuntimeError(f"port holder {pid} is not running")
    if not is_our_holder(pid, workspace):
        raise RuntimeError(f"pid {pid} is not the workspace port holder")
    ports_path = hold_dir / "ports"
    raw_ports = ports_path.read_text().split() if ports_path.is_file() else []
    ports = [int(item) for item in raw_ports if item]
    if not ports:
        raise RuntimeError("port holder has no remaining reserved ports")
    for port in ports:
        if port_is_bindable(port):
            raise RuntimeError(f"port {port} is bindable; holder is not reserving it")


def resolve_runner_slot() -> int | None:
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return None
    return detect_runner_slot(os.environ.get("GITHUB_WORKSPACE", ""), os.getcwd())


def main() -> int:
    args = parse_args()
    try:
        hold_dir = args.hold_dir.resolve() if args.hold_dir is not None else None
        workspace = resolve_workspace(args.workspace)
        if args.release is not None:
            request_release(hold_dir, args.release)
            return 0
        if args.stop:
            request_stop(hold_dir, workspace)
            return 0
        if args.check:
            check_holder(hold_dir, workspace)
            return 0
        runner_slot = resolve_runner_slot()
        if args.hold:
            ports = start_holder(
                args.count, args.max_bind_attempts, runner_slot, hold_dir, workspace
            )
        else:
            ports = allocate_ports(args.count, args.max_bind_attempts, runner_slot)
    except Exception as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1

    print(" ".join(str(port) for port in ports))
    return 0


if FETCH_FORBIDDEN_PORTS_PATH.is_file() and RUNNER_PORT_POLICY_PATH.is_file():
    configure_policy(RUNNER_PORT_POLICY_PATH, FETCH_FORBIDDEN_PORTS_PATH)

if __name__ == "__main__":
    raise SystemExit(main())
