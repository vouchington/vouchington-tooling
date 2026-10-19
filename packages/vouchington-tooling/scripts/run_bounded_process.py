"""Own downstream descriptors and command process-group lifetime."""

from __future__ import annotations

import errno
import fcntl
import os
import signal
import stat
import subprocess
from contextlib import contextmanager


@contextmanager
def output_sinks():
    targets: list[int | None] = []
    primary: BaseException | None = None
    try:
        for fd in (1, 2):
            try:
                targets.append(fcntl.fcntl(fd, fcntl.F_DUPFD_CLOEXEC, 3))
            except OSError as err:
                if err.errno != errno.EBADF:
                    raise
                targets.append(None)  # Absent at entry, before Popen allocates source pipes.
                # Keep the closed number occupied so a child pipe cannot become stderr.
                occupy_closed_fd(fd)
        yield targets
    except BaseException as err:
        primary = err
        raise
    finally:
        errors: list[BaseException] = []
        for fd in targets:
            if fd is not None:
                try:
                    os.close(fd)
                except BaseException as err:
                    errors.append(err)
        if errors:
            details = ([repr(primary)] if primary is not None else []) + list(map(repr, errors))
            raise RuntimeError('Output descriptor cleanup failed: ' + '; '.join(details)) from (primary or errors[0])


class WrapperSignal(BaseException):
    def __init__(self, signum: int) -> None:
        super().__init__(signum)
        self.signum = signum


def occupy_closed_fd(fd: int) -> None:
    null = os.open(os.devnull, os.O_WRONLY)
    try:
        if null != fd:
            os.dup2(null, fd)
    finally:
        if null != fd:
            os.close(null)


def exit_status(code: int) -> int:
    if code < 0:
        return 128 - code
    return code


def signal_group(pid: int, sig: int) -> None:
    try:
        os.killpg(pid, sig)
    except ProcessLookupError:
        return


def arm_termination() -> None:
    def handle(signum: int, _frame: object) -> None:
        signal.signal(signum, signal.SIG_DFL)
        raise WrapperSignal(signum)

    signal.signal(signal.SIGTERM, handle)
    signal.signal(signal.SIGINT, handle)


def reap_terminated_group(proc: subprocess.Popen[bytes], signum: int) -> int:
    signal_group(proc.pid, signal.SIGTERM)
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass
    # A TERM-resistant descendant can outlive the parent; finish the group.
    signal_group(proc.pid, signal.SIGKILL)
    proc.wait()
    return 128 + signum


def run(proc: subprocess.Popen[bytes], seconds: int) -> int:
    try:
        return exit_status(proc.wait(timeout=seconds))
    except subprocess.TimeoutExpired:
        signal_group(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        # The parent can exit on SIGTERM while a descendant keeps running.
        # Finish cleaning the group even when waiting for the parent succeeded.
        signal_group(proc.pid, signal.SIGKILL)
        proc.wait()
        return 124



def command_outputs(targets: list[int | None]):
    """Inherit non-stream descriptors; share one pipe for merged stream sinks."""
    outputs = [
        subprocess.PIPE
        if fd is None or stat.S_ISFIFO(os.fstat(fd).st_mode) or stat.S_ISSOCK(os.fstat(fd).st_mode)
        else fd
        for fd in targets
    ]
    if all(fd is not None for fd in targets):
        left, right = (os.fstat(fd) for fd in targets)
        stream = stat.S_ISFIFO(left.st_mode) or stat.S_ISSOCK(left.st_mode)
        same_endpoint = (left.st_dev, left.st_ino, left.st_mode) == (
            right.st_dev, right.st_ino, right.st_mode
        )
        same_flags = fcntl.fcntl(targets[0], fcntl.F_GETFL) == fcntl.fcntl(targets[1], fcntl.F_GETFL)
        if stream and same_endpoint and same_flags:
            outputs[1] = subprocess.STDOUT
    return dict(stdout=outputs[0], stderr=outputs[1])
