"""Real CLI fixture: release bounded downstream sockets on owned source-pipe closure."""
import array
import json
import os
import selectors
import socket
import subprocess
import sys
import tempfile
import threading

command = '''
import array, os, socket, sys
control = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
control.connect(sys.argv[1])
control.sendmsg([b'owned-source-fds'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [1, 2]))])
assert control.recv(1) == b'r'
for gate, payload in ((b'r', b'a' * 8191 + b'z'), (b's', b'b' * 4095 + b'y')):
    if gate == b's':
        assert control.recv(1) == gate
    while payload:
        payload = payload[os.write(1, payload):]
raise SystemExit(3)
'''
holder = '''
import os, sys
os.write(int(sys.argv[1]), b'ready')
os.close(int(sys.argv[1]))
try:
    remaining = 1024 * 1024
    while remaining:
        remaining -= os.write(2, b'x' * min(remaining, 65536))
    raise RuntimeError('Source never backpressured')
except BrokenPipeError:
    pass
'''
with tempfile.TemporaryDirectory(prefix='run-bounded-backpressure-') as directory:
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    path = directory + '/control.sock'
    server.bind(path)
    server.listen(1)
    out_read, out_write = socket.socketpair()
    err_read, err_write = socket.socketpair()
    for writer in (out_write, err_write):
        if sys.argv[2:] == ['nonblocking']:
            writer.setblocking(False)
        writer.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1024)
        assert writer.getsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF) < 8192
    wrapper = None
    source_holder = None
    connection = None
    owned_fds = []
    selector = selectors.DefaultSelector()
    outputs = {'stdout': bytearray(), 'stderr': bytearray()}
    wake_read, wake_write = socket.socketpair()
    disposed = threading.Event()
    wrapper_exited = threading.Event()
    closing = threading.Event()
    waiter = None
    def wake():
        try:
            wake_write.sendall(b'w')
        except OSError:
            if not closing.is_set():
                raise
    def dispose_on_input_eof():
        while os.read(0, 4096):
            pass
        disposed.set()
        wake()
        for reader in (out_read, err_read):
            try:
                reader.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
    threading.Thread(target=dispose_on_input_eof, daemon=True).start()
    def await_readable(descriptor):
        with selectors.DefaultSelector() as readiness:
            readiness.register(descriptor, selectors.EVENT_READ)
            readiness.register(wake_read, selectors.EVENT_READ)
            while True:
                if disposed.is_set():
                    raise RuntimeError('Owned fixture disposed during startup')
                if wrapper_exited.is_set():
                    raise RuntimeError('Wrapper exited before fixture readiness')
                events = readiness.select()
                if any(key.fileobj == wake_read for key, _ in events):
                    wake_read.recv(64)
                    continue
                return
    try:
        wrapper = subprocess.Popen(
            [sys.executable, sys.argv[1], '30', sys.executable, '-c', command, path],
            stdin=subprocess.PIPE, stdout=out_write, stderr=err_write,
        )
        out_write.close()
        err_write.close()
        def observe_wrapper_exit():
            wrapper.wait()
            wrapper_exited.set()
            wake()
        waiter = threading.Thread(target=observe_wrapper_exit)
        waiter.start()
        await_readable(server)
        connection, _ = server.accept()
        await_readable(connection)
        _, controls, _, _ = connection.recvmsg(64, socket.CMSG_SPACE(2 * array.array('i').itemsize))
        for level, kind, data in controls:
            assert (level, kind) == (socket.SOL_SOCKET, socket.SCM_RIGHTS)
            descriptors = array.array('i')
            descriptors.frombytes(data)
            owned_fds.extend(descriptors)
        assert len(owned_fds) == 2
        ready_read, ready_write = os.pipe()
        try:
            source_holder = subprocess.Popen(
                [sys.executable, '-c', holder, str(ready_write)],
                stdin=subprocess.DEVNULL, stdout=owned_fds[0], stderr=owned_fds[1],
                pass_fds=(ready_write,), start_new_session=True,
            )
            os.close(ready_write)
            ready_write = None
            await_readable(ready_read)
            assert os.read(ready_read, 5) == b'ready'
        finally:
            if ready_write is not None:
                os.close(ready_write)
            os.close(ready_read)
        for descriptor in owned_fds:
            os.close(descriptor)
        owned_fds.clear()
        connection.sendall(b'r')
        # Readability proves the relay has consumed the first source chunk.
        # Leave that output unread so its bounded target remains backpressured.
        await_readable(out_read)
        connection.sendall(b's')
        # No elapsed-time wait: the native source write returns EPIPE only when its reader closes.
        holder_status = source_holder.wait()
        assert holder_status == 0
        for reader, name in ((out_read, 'stdout'), (err_read, 'stderr')):
            selector.register(reader, selectors.EVENT_READ, name)
        while selector.get_map():
            for key, _ in selector.select():
                chunk = key.fileobj.recv(65536)
                if chunk:
                    outputs[key.data].extend(chunk)
                else:
                    selector.unregister(key.fileobj)
        status = wrapper.wait()
        print(json.dumps({'status': status, 'stdout': outputs['stdout'].decode(),
                          'sourceHolderStatus': holder_status, 'wrapperDrained': True}))
    finally:
        # Every owned resource gets a cleanup attempt, even after an earlier failure.
        primary = sys.exception()
        cleanup_errors = []
        def settle(operation):
            try:
                operation()
            except BaseException as err:
                cleanup_errors.append(err)
        for descriptor in owned_fds:
            settle(lambda descriptor=descriptor: os.close(descriptor))
        # Closing the listener also rejects queued, not-yet-accepted handshakes.
        settle(server.close)
        if connection is not None:
            settle(connection.close)
        for reader in (out_read, err_read):
            settle(reader.close)
        if wrapper is not None:
            if wrapper.stdin is not None:
                settle(wrapper.stdin.close)
            settle(wrapper.wait)
        if source_holder is not None:
            settle(source_holder.wait)
        if waiter is not None:
            settle(waiter.join)
        closing.set()
        for resource in (wake_read, wake_write, selector, out_write, err_write):
            settle(resource.close)
        if cleanup_errors:
            failures = ([primary] if primary is not None else []) + cleanup_errors
            raise BaseExceptionGroup('Fixture failure and owned cleanup', failures) from failures[0]
