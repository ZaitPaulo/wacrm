@echo off
rem ============================================================
rem  Lanzador para el cliente: doble clic y listo.
rem
rem  Windows no deja ejecutar un .ps1 con doble clic (lo abre en el
rem  Bloc de notas) y ademas bloquea los scripts sin firmar. Este .bat
rem  lo invoca con -ExecutionPolicy Bypass, que afecta SOLO a esta
rem  ejecucion: no cambia ninguna configuracion del equipo.
rem ============================================================

rem  --- Pestana del Excel ---------------------------------------
rem  Normalmente no hace falta tocar nada: el script usa la primera
rem  pestana VISIBLE del libro y muestra en pantalla cual leyo.
rem
rem  Si el libro tiene varias y la lista buena NO es la primera,
rem  escribe su nombre aqui abajo, entre las comillas, y quita el
rem  "rem" del principio de esa linea.
rem
rem  set HOJA="LISTA DE PRECIO ACTUALIZADA"
rem  -------------------------------------------------------------

chcp 65001 > nul
title Crear carpetas de fotos por vehiculo

if defined HOJA (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Crear-Carpetas-Fotos.ps1" -Hoja %HOJA%
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Crear-Carpetas-Fotos.ps1"
)

echo.
echo Revisa arriba que diga la pestana correcta en "Pestana leida".
echo.
echo Presiona una tecla para cerrar...
pause > nul
