#!/usr/bin/env python3
"""Local test page for TMC2209_Motor_Test.

Serves tester/index.html on http://localhost:8765 and passes commands between
the page and the ESP32-S3 over its USB serial port. Needs pyserial.
Only one program can use the serial port: close any serial monitor first.
"""
import argparse
import collections
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import serial
from serial.tools import list_ports

PAGE = Path(__file__).with_name("index.html")
NUMBER = r"-?\d+(?:\.\d+)?"
ALLOWED = re.compile(rf"^(?:[frhsFRHS?]|@(?:move|run|stop|keep|zero|status|watch)(?: {NUMBER}){{0,3}})$")
USB_SERIAL_VENDORS = {0x1A86, 0x303A, 0x10C4, 0x0403}  # CH34x, Espressif, CP210x, FTDI


def find_port():
    ports = list(list_ports.comports())
    for port in ports:
        if port.vid in USB_SERIAL_VENDORS:
            return port.device
    for port in ports:
        if "usbmodem" in port.device or "usbserial" in port.device:
            return port.device
    return None


class Board:
    """Keeps the serial link open and remembers the latest status and messages."""

    def __init__(self, port_name):
        self.fixed_port = port_name
        self.port_name = port_name
        self.link = None
        self.lock = threading.Lock()
        self.status = {"pos": 0, "sps": 0, "moving": 0, "on": 0, "keep": 0}
        self.status_time = 0.0
        self.log = collections.deque(maxlen=400)
        self.seq = 0
        self.done = 0      # moves that ran to the end
        self.stopped = 0   # immediate stops
        self.note("Looking for the board...")
        threading.Thread(target=self.run, daemon=True).start()

    def note(self, text):
        with self.lock:
            self.seq += 1
            self.log.append({"n": self.seq, "text": text})

    def send(self, command):
        link = self.link
        if link is None:
            return False
        data = command if len(command) == 1 else command + "\n"
        try:
            link.write(data.encode("ascii"))
            return True
        except (serial.SerialException, OSError):
            return False

    def handle_line(self, line):
        if line.startswith("@st "):
            fields = dict(part.split("=", 1) for part in line[4:].split() if "=" in part)
            try:
                status = {key: int(fields[key]) for key in self.status}
            except (KeyError, ValueError):
                return
            with self.lock:
                self.status = status
                self.status_time = time.time()
            return
        if line.startswith(("Move complete", "Jog complete")):
            self.done += 1
        elif line.startswith("Stopped."):
            self.stopped += 1
        if not line.startswith("@ok"):
            self.note(line)

    def run(self):
        while True:
            name = self.fixed_port or find_port()
            if name is None:
                time.sleep(1.0)
                continue
            try:
                link = serial.Serial()
                link.port = name
                link.baudrate = 115200
                link.timeout = 0.05
                link.dtr = False  # do not reset the board when the port opens
                link.rts = False
                link.open()
            except (serial.SerialException, OSError) as error:
                if self.port_name != name or not self.log or "Cannot open" not in self.log[-1]["text"]:
                    self.note(f"Cannot open {name}: {error}. Is a serial monitor still open?")
                self.port_name = name
                time.sleep(2.0)
                continue
            self.port_name = name
            self.link = link
            self.note(f"Connected to {name}")
            buffer = b""
            last_ping = 0.0
            try:
                while True:
                    now = time.time()
                    if now - last_ping >= 1.0:
                        # Also re-enables status reports if the board restarted.
                        link.write(b"@watch 1\n")
                        last_ping = now
                    buffer += link.read(4096)
                    while b"\n" in buffer:
                        raw, buffer = buffer.split(b"\n", 1)
                        text = raw.decode("utf-8", "replace").strip()
                        if text:
                            self.handle_line(text)
            except (serial.SerialException, OSError):
                self.note("Board disconnected")
            finally:
                self.link = None
                try:
                    link.close()
                except Exception:
                    pass
            time.sleep(1.0)

    def snapshot(self, since):
        with self.lock:
            return {
                "port": self.port_name,
                "connected": self.link is not None,
                "alive": self.link is not None and time.time() - self.status_time < 3.0,
                "status": dict(self.status),
                "done": self.done,
                "stopped": self.stopped,
                "seq": self.seq,
                "log": [entry for entry in self.log if entry["n"] > since],
            }


def make_handler(board, http_port):
    hosts = {f"localhost:{http_port}", f"127.0.0.1:{http_port}"}
    origins = {f"http://{host}" for host in hosts}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, code, body, kind="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def local_only(self):
            # Other web pages must not be able to move the motor.
            if self.headers.get("Host") not in hosts:
                return False
            origin = self.headers.get("Origin")
            return origin is None or origin in origins

        def do_GET(self):
            if not self.local_only():
                return self.reply(403, {"error": "local use only"})
            url = urlparse(self.path)
            if url.path == "/":
                return self.reply(200, PAGE.read_bytes(), "text/html; charset=utf-8")
            if url.path == "/api/state":
                try:
                    since = int(parse_qs(url.query).get("since", ["0"])[0])
                except ValueError:
                    since = 0
                return self.reply(200, board.snapshot(since))
            self.reply(404, {"error": "not found"})

        def do_POST(self):
            if not self.local_only():
                return self.reply(403, {"error": "local use only"})
            if urlparse(self.path).path != "/api/cmd":
                return self.reply(404, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                command = json.loads(self.rfile.read(min(length, 1000)))["cmd"]
            except (ValueError, KeyError, TypeError):
                return self.reply(400, {"error": "bad request"})
            if not isinstance(command, str) or not ALLOWED.match(command):
                return self.reply(400, {"error": "command not allowed"})
            if not board.send(command):
                return self.reply(503, {"error": "board not connected"})
            self.reply(200, {"ok": True})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--serial", help="serial port, for example /dev/cu.usbmodem1234 (default: find it)")
    parser.add_argument("--http", type=int, default=8765, help="page port (default 8765)")
    args = parser.parse_args()

    board = Board(args.serial)
    server = ThreadingHTTPServer(("127.0.0.1", args.http), make_handler(board, args.http))
    print(f"Motor test page: http://localhost:{args.http}   (Ctrl+C to quit)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        board.send("s")  # leave the motor stopped and the driver off
        time.sleep(0.2)
        print("\nStopped the motor and closed.")


if __name__ == "__main__":
    main()
