$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Resolve-Path (Join-Path $scriptDir "..")

Set-Location $backendDir
& (Join-Path $backendDir ".venv\\Scripts\\python.exe") -m MCP.Postgres
