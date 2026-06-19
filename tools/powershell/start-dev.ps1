# If PowerShell scripts are blocked, users can run `npm run dev` from Command Prompt.
$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $ProjectRoot
npm run dev

