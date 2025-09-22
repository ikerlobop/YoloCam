# --- run_backend.ps1 ---
# Script para inicializar entorno, instalar dependencias y arrancar el backend Flask

# Activa error inmediato
$ErrorActionPreference = "Stop"

# Crear entorno virtual si no existe
if (-not (Test-Path ".venv")) {
    Write-Host ">> Creando entorno virtual .venv..."
    python -m venv .venv
}

# Activar entorno virtual
Write-Host ">> Activando entorno virtual..."
& .\.venv\Scripts\Activate.ps1

# Instalar dependencias (forzando últimas versiones estables)
Write-Host ">> Instalando dependencias Flask + CORS + OpenCV..."
pip install --upgrade pip
pip install flask flask-cors opencv-python

# Arrancar backend
Write-Host ">> Lanzando backend en http://127.0.0.1:5000 ..."
python app.py
