#!/usr/bin/env python3
"""Send network settings to an AquaGuard unit over its USB cable.

Usage:  python scripts/provision.py [--bench-arm] [--port /dev/cu.usbmodemXXXX]

Reads firmware/provision.local.json (copy provision.example.json and fill it
in; the file is git-ignored). The file's contents are sent only to the unit
and are never printed. Needs pyserial (it comes with PlatformIO).
"""
import argparse
import glob
import json
import pathlib
import sys
import time

import serial

ROOT = pathlib.Path(__file__).resolve().parent.parent


def read_for(port, seconds, until=None):
    end = time.time() + seconds
    text = ""
    while time.time() < end:
        chunk = port.read(4096).decode(errors="replace")
        if chunk:
            sys.stdout.write(chunk)
            sys.stdout.flush()
            text += chunk
            if until and until in text:
                break
    return text


def open_port(name):
    port = serial.Serial()
    port.port = name
    port.baudrate = 115200
    port.timeout = 0.3
    port.dtr = False
    port.rts = False
    port.open()
    return port


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port")
    parser.add_argument("--file", default=str(ROOT / "firmware" / "provision.local.json"))
    parser.add_argument("--bench-arm", action="store_true", help="bench-test build: commission and arm afterwards")
    parser.add_argument("--status-only", action="store_true")
    args = parser.parse_args()

    name = args.port or next(iter(sorted(glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/ttyACM*"))), None)
    if not name:
        sys.exit("No USB serial port found. Is the board plugged in?")

    port = open_port(name)
    read_for(port, 6, until="Device ID")  # opening the port restarts the board
    time.sleep(1)

    if not args.status_only:
        settings = json.loads(pathlib.Path(args.file).read_text())
        placeholders = [k for k, v in settings.items() if isinstance(v, str) and v.startswith("your ")]
        if placeholders:
            sys.exit(f"Fill in {', '.join(placeholders)} in {args.file} first.")
        port.write(("provision " + json.dumps(settings, separators=(",", ":")) + "\n").encode())
        reply = read_for(port, 8, until="restarting")
        if "OK saved" not in reply:
            sys.exit("\nThe unit did not accept the settings.")
        # The board restarts; the USB port may drop and come back.
        try:
            port.close()
        except Exception:
            pass
        time.sleep(3)
        port = open_port(name)

    text = read_for(port, 40, until="[cloud] ONLINE")
    if args.bench_arm and "Wi-Fi connected" in text:
        port.write(b"bench-arm\n")
        read_for(port, 6, until="bench-arm:")
    port.write(b"status\n")
    read_for(port, 3, until="[status]")
    print()


if __name__ == "__main__":
    main()
