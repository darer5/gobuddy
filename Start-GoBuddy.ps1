$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

& npm.cmd run build

Start-Process -FilePath "npm.cmd" `
    -ArgumentList @("run", "electron") `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden
