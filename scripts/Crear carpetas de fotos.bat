@echo off
rem ============================================================
rem  Lanzador para el cliente: doble clic y listo.
rem
rem  Windows no deja ejecutar un .ps1 con doble clic (lo abre en el
rem  Bloc de notas) y ademas bloquea los scripts sin firmar. Este .bat
rem  lo invoca con -ExecutionPolicy Bypass, que afecta SOLO a esta
rem  ejecucion: no cambia ninguna configuracion del equipo.
rem ============================================================

chcp 65001 > nul
title Crear carpetas de fotos por vehiculo

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Crear-Carpetas-Fotos.ps1"

echo.
echo Presiona una tecla para cerrar...
pause > nul
