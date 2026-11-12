## Install

1. Download `llm-usage-overlay_*_x64-setup.exe` below.
2. Optional, check it: in PowerShell, `Get-FileHash .\llm-usage-overlay_*_x64-setup.exe` must match `SHA256SUMS.txt`.
   With the GitHub CLI you can also prove it was built here from this tag:
   `gh attestation verify .\llm-usage-overlay_*_x64-setup.exe -R nyakojiru/llm-usage-overlay`
3. Run it. The installer isn't code-signed, so Windows SmartScreen will say
   "Windows protected your PC": click **More info → Run anyway**.
   It installs for your user only (no admin rights).

The overlay opens in the top-right corner; add an account in ⚙.
To remove it: Settings → Apps → Installed apps → LLM Usage Overlay → Uninstall.
Tick "Delete the application data" to also erase your sign-in sessions.

## Instalar

1. Descarga `llm-usage-overlay_*_x64-setup.exe` aquí abajo.
2. Opcional, verifícalo: en PowerShell, `Get-FileHash .\llm-usage-overlay_*_x64-setup.exe` debe coincidir con `SHA256SUMS.txt`.
3. Ejecútalo. El instalador no está firmado, así que SmartScreen dirá
   «Windows protegió tu PC»: pulsa **Más información → Ejecutar de todas formas**.
   Se instala solo para tu usuario (sin permisos de administrador).

Para quitarlo: Configuración → Aplicaciones → Aplicaciones instaladas → LLM Usage Overlay → Desinstalar.
Marca «Delete the application data» (borrar los datos) para borrar también tus sesiones.
