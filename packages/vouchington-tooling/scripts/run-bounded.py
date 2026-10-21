#!/usr/bin/env python3
"""Run a command until it exits or the deadline elapses, then kill its process group."""

from __future__ import annotations

import array
import fcntl
import os
import select
import signal
import subprocess
import sys
import threading
import termios
import time

from run_bounded_process import (
    WrapperSignal,
    arm_termination,
    command_outputs,
    output_sinks,
    reap_terminated_group,
    run,
    signal_group,
)

RELAY_JOIN_SECONDS = 3


class Relay(threading.Thread):
    def __init__(self, source, target: int | None) -> None:
        super().__init__()
        self.source = source
        self.target = target
        self.lock = threading.Lock()
        self.pending: list[bytes] = []
        self.closed = False
        self.error: BaseException | None = None
        os.set_blocking(source.fileno(), False)
        self.wake_read, self.wake_write = os.pipe()

    def cut_source(self) -> None:
        try:
            with self.lock:
                if not self.closed:
                    try:
                        available = array.array('i', [0])
                        fcntl.ioctl(self.source.fileno(), termios.FIONREAD, available, True)
                        remaining = available[0]
                        while remaining:
                            data = os.read(self.source.fileno(), min(remaining, 65536))
                            if not data:
                                break
                            self.pending.append(data)
                            remaining -= len(data)
                    finally:
                        self.closed = True
                        self.source.close()
        finally:
            os.write(self.wake_write, b'close')

    def next_chunk(self) -> bytes:
        while True:
            with self.lock:
                if self.pending:
                    return self.pending.pop(0)
                if self.closed:
                    return b''
                source_fd = self.source.fileno()
            try:
                select.select([source_fd, self.wake_read], [], [])
            except (OSError, ValueError):
                with self.lock:
                    if not self.closed:
                        raise
                continue  # Take cutoff-buffered bytes under the lock.
            with self.lock:
                if self.closed:
                    continue
                try:
                    data = os.read(source_fd, 65536)
                except BlockingIOError:
                    continue
                if not data:
                    self.closed = True
                    self.source.close()
                return data

    def run(self) -> None:
        target = self.target
        try:
            while data := self.next_chunk():
                if target is None:
                    continue
                try:
                    while data:
                        try:
                            written = os.write(target, data)
                        except BlockingIOError:
                            select.select([], [target], [])
                            continue
                        if written == 0:
                            raise RuntimeError('Output write made no progress')
                        data = data[written:]
                except (BrokenPipeError, ConnectionResetError):
                    target = None  # Downstream closed; drain without leaking a sink FD.
        except BaseException as err:
            self.error = err
        finally:
            with self.lock:
                self.closed = True
                try:
                    self.source.close()
                except BaseException as err:
                    if self.error is None:
                        self.error = err
                    else:
                        failure = RuntimeError(f'Relay failed: {self.error!r}; source close: {err!r}')
                        failure.__cause__ = self.error
                        self.error = failure


def main() -> None:
    if len(sys.argv) < 3:
        print('usage: run-bounded.py <seconds> <command> [args...]', file=sys.stderr)
        raise SystemExit(2)
    try:
        seconds = int(sys.argv[1])
    except ValueError:
        print('timeout seconds must be an integer', file=sys.stderr)
        raise SystemExit(2) from None
    if seconds < 1:
        print('timeout seconds must be positive', file=sys.stderr)
        raise SystemExit(2)

    with output_sinks() as targets:
        execute(seconds, targets)


def execute(seconds: int, targets: list[int | None]) -> None:
    proc = subprocess.Popen(
        sys.argv[2:], **command_outputs(targets), start_new_session=True
    )
    relays: list[Relay] = []
    started: list[Relay] = []
    errors: list[BaseException] = []
    status = 1
    try:
        arm_termination()
        for stream, fd in zip((proc.stdout, proc.stderr), targets):
            if stream is not None:
                relays.append(Relay(stream, fd))
        for thread in relays:
            thread.start()
            started.append(thread)
        status = run(proc, seconds)
    except WrapperSignal as err:
        status = reap_terminated_group(proc, err.signum)
    except BaseException as err:
        errors.append(err)
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                signal_group(proc.pid, sig)
                proc.wait(timeout=10)
            except BaseException as cleanup_err:
                errors.append(cleanup_err)
    finally:
        deadline = time.monotonic() + RELAY_JOIN_SECONDS
        for thread in started:
            thread.join(max(0.0, deadline - time.monotonic()))
        # Sever descendant sources, never abandon a write to the downstream consumer.
        for thread in relays:
            try:
                thread.cut_source()
            except BaseException as err:
                errors.append(err)
        for thread in started:
            thread.join()
            if thread.error is not None:
                errors.append(thread.error)
        for stream in (proc.stdout, proc.stderr):
            try:
                if stream is not None:
                    stream.close()
            except BaseException as err:
                errors.append(err)
        for thread in relays:
            for descriptor in (thread.wake_read, thread.wake_write):
                try:
                    os.close(descriptor)
                except BaseException as err:
                    errors.append(err)
    if errors:
        raise RuntimeError('Command/relay cleanup failed: ' + '; '.join(map(repr, errors))) from errors[0]
    raise SystemExit(status)


if __name__ == '__main__':
    main()
