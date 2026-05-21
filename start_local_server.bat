@echo off
REM ============================================================
REM  Semi-Circular Gauge Chart - Local Development Server
REM  Starts a Python HTTP server on port 8000
REM ============================================================

echo.
echo  =============================================
echo   Gauge Extension - Local Server
echo  =============================================
echo.

REM Check if Python is available
where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  Starting server at: http://localhost:8000
    echo  Extension URL:      http://localhost:8000/gauge.html
    echo.
    echo  Press Ctrl+C to stop the server.
    echo  =============================================
    echo.
    python -m http.server 8000
    goto :end
)

where python3 >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  Starting server at: http://localhost:8000
    echo  Extension URL:      http://localhost:8000/gauge.html
    echo.
    echo  Press Ctrl+C to stop the server.
    echo  =============================================
    echo.
    python3 -m http.server 8000
    goto :end
)

echo  ERROR: Python is not installed or not in your PATH.
echo.
echo  Please install Python from https://www.python.org/downloads/
echo  Make sure to check "Add Python to PATH" during installation.
echo.
pause

:end
