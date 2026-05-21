#!/bin/bash
# ============================================================
#  Semi-Circular Gauge Chart - Local Development Server
#  Starts a Python HTTP server on port 8000
# ============================================================

echo ""
echo " ============================================="
echo "  Gauge Extension - Local Server"
echo " ============================================="
echo ""

# Change to the directory where this script lives
cd "$(dirname "$0")"

# Try python3 first (macOS / Linux default), then python
if command -v python3 &> /dev/null; then
    echo " Starting server at: http://localhost:8000"
    echo " Extension URL:      http://localhost:8000/gauge.html"
    echo ""
    echo " Press Ctrl+C to stop the server."
    echo " ============================================="
    echo ""
    python3 -m http.server 8000
elif command -v python &> /dev/null; then
    echo " Starting server at: http://localhost:8000"
    echo " Extension URL:      http://localhost:8000/gauge.html"
    echo ""
    echo " Press Ctrl+C to stop the server."
    echo " ============================================="
    echo ""
    python -m http.server 8000
else
    echo " ERROR: Python is not installed."
    echo ""
    echo " Install Python:"
    echo "   macOS:  brew install python3"
    echo "   Ubuntu: sudo apt install python3"
    echo ""
    exit 1
fi
