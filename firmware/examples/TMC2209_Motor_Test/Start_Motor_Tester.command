#!/bin/zsh
# Double-click to open the motor test page. Close this window (or Ctrl+C) to quit.
cd "$(dirname "$0")/tester" || exit 1
PY="/Users/Ravindu/Desktop/AquaGuard/.work/motor-test-tools/bin/python"
[ -x "$PY" ] || PY="python3"   # any Python with pyserial works: pip install pyserial
(sleep 1.5 && open "http://localhost:8765") &
exec "$PY" server.py "$@"
