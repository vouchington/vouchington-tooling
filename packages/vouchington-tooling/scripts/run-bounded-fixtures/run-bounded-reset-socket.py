"""A genuine peer RST must not replace the completed command status."""
import json
import select
import socket
import struct
import subprocess
import sys

command = 'import os; os.write(1, b"x" * 70000); os.write(2, b"err\\n"); raise SystemExit(3)'
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
    server.bind(('127.0.0.1', 0))
    server.listen(1)
    with socket.create_connection(server.getsockname(), timeout=5) as downstream:
        peer, _ = server.accept()
        with peer:
            peer.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
        # Observe peer-close readiness without consuming the pending native reset error.
        if not select.select([downstream], [], [], 5)[0]:
            raise RuntimeError('Owned reset socket never became readable')
        downstream.settimeout(None)
        result = subprocess.run(
            [sys.executable, sys.argv[1], '5', sys.executable, '-c', command],
            stdout=downstream, stderr=subprocess.PIPE, text=True,
        )
        print(json.dumps(dict(status=result.returncode, stderr=result.stderr)))
