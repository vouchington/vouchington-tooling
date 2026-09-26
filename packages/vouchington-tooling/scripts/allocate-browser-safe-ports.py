#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import socket
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
