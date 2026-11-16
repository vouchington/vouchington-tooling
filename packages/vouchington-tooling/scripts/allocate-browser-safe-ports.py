#!/usr/bin/env python3
# Must stay stdlib-only and self-contained (reads only the sibling fetch-forbidden-ports.json
# and runner-port-policy.json): CI runs it from the extracted published tarball with no install.
# Enforced by allocate-browser-safe-ports-no-install.test.mts.
from __future__ import annotations

import argparse
import errno
import json
import os
import random
import socket
import subprocess
import sys
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
    parser.add_argument("count", type=positive_int)
    parser.add_argument("--max-bind-attempts", type=int, default=1000)
    parser.add_argument("--policy", type=Path, default=RUNNER_PORT_POLICY_PATH)
    parser.add_argument("--forbidden-ports", type=Path, default=FETCH_FORBIDDEN_PORTS_PATH)
    args = parser.parse_args()
    configure_policy(args.policy, args.forbidden_ports)
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


MIN_UNPRIVILEGED_PORT = 1024
IPV6_UNAVAILABLE_ERRNOS = frozenset(
    {errno.EAFNOSUPPORT, errno.EADDRNOTAVAIL, errno.EPROTONOSUPPORT}
)


def read_ephemeral_range() -> tuple[int, int] | None:
    """Return the OS ephemeral (dynamic) port range, read from the running system."""
    try:
        if sys.platform.startswith("linux"):
            first, last = Path("/proc/sys/net/ipv4/ip_local_port_range").read_text().split()
        elif sys.platform == "darwin":
            output = subprocess.run(
                ["sysctl", "-n", "net.inet.ip.portrange.first", "net.inet.ip.portrange.last"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout
            first, last = output.split()
        else:
            return None
        # macOS permits a descending range (first > last); normalize it.
        return min(int(first), int(last)), max(int(first), int(last))
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def candidate_pool() -> list[int]:
    """Ports outside the OS ephemeral range, so a later `bind(port 0)` cannot receive them."""
    ephemeral = read_ephemeral_range()
    if ephemeral is None:
        print(
            "::warning::could not read the OS ephemeral port range; allocated ports may "
            "overlap it and be handed to a later bind to port 0",
            file=sys.stderr,
        )
    reserved_start = RUNNER_PORT_POLICY["reservedPortStart"]
    reserved_end = RUNNER_PORT_POLICY["reservedPortEnd"]
    return [
        port
        for port in range(MIN_UNPRIVILEGED_PORT, 65536)
        if port not in CHROMIUM_RESTRICTED_PORTS
        and not reserved_start <= port <= reserved_end
        and (ephemeral is None or not ephemeral[0] <= port <= ephemeral[1])
    ]


IPV6_WARNING_PRINTED = False


def open_loopback_pair(port: int) -> list[socket.socket] | None:
    """Bind the port on IPv4 and on ::1; None when either is in use.

    When ::1 is unavailable (no IPv6 stack, for example IPv6-less CI) the IPv4 check
    alone is used and a warning is printed once: that environment has no ::1 listener
    that could shadow the port.
    """
    global IPV6_WARNING_PRINTED
    held: list[socket.socket] = []
    for family, host in ((socket.AF_INET, ""), (socket.AF_INET6, "::1")):
        candidate = None
        try:
            candidate = socket.socket(family, socket.SOCK_STREAM)
            candidate.bind((host, port))
        except OSError as error:
            if candidate is not None:
                candidate.close()
            if family == socket.AF_INET6 and error.errno in IPV6_UNAVAILABLE_ERRNOS:
                if not IPV6_WARNING_PRINTED:
                    IPV6_WARNING_PRINTED = True
                    print(
                        "::warning::IPv6 loopback (::1) is unavailable; ports are "
                        "checked on IPv4 only",
                        file=sys.stderr,
                    )
                continue
            for other in held:
                other.close()
            return None
        held.append(candidate)
    return held


def allocate_ports(
    count: int, max_bind_attempts: int, runner_slot: int | None = None
) -> list[int]:
    held: list[socket.socket] = []
    ports: list[int] = []
    try:
        if runner_slot is not None:
            port_slice = runner_port_slice(runner_slot)
            if count > len(port_slice):
                raise RuntimeError(
                    f"requested {count} ports exceeds runner slice capacity {len(port_slice)}"
                )
            candidates: list[int] | range = port_slice
        else:
            candidates = candidate_pool()
            random.shuffle(candidates)
            candidates = candidates[:max_bind_attempts]

        for candidate_port in candidates:
            if len(ports) == count:
                break
            if candidate_port in CHROMIUM_RESTRICTED_PORTS:
                continue
            pair = open_loopback_pair(candidate_port)
            if pair is None:
                continue
            held.extend(pair)
            ports.append(candidate_port)

        if len(ports) != count:
            location = (
                f"runner slice {runner_slot}" if runner_slot is not None else "non-ephemeral ports"
            )
            raise RuntimeError(
                f"failed to allocate {count} ports after {len(candidates)} bind attempts "
                f"from {location}"
            )
        return ports
    finally:
        for candidate in held:
            candidate.close()


def resolve_runner_slot() -> int | None:
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return None
    return detect_runner_slot(os.environ.get("GITHUB_WORKSPACE", ""), os.getcwd())


def main() -> int:
    args = parse_args()
    try:
        ports = allocate_ports(args.count, args.max_bind_attempts, resolve_runner_slot())
    except Exception as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1

    print(" ".join(str(port) for port in ports))
    return 0


if FETCH_FORBIDDEN_PORTS_PATH.is_file() and RUNNER_PORT_POLICY_PATH.is_file():
    configure_policy(RUNNER_PORT_POLICY_PATH, FETCH_FORBIDDEN_PORTS_PATH)

if __name__ == "__main__":
    raise SystemExit(main())
