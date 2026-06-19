$ErrorActionPreference = "Continue"

Write-Host "FREEOS system check" -ForegroundColor Cyan
Write-Host "Node: $(node --version)"
Write-Host "npm:  $(npm --version)"

try {
    $response = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 3
    $models = @($response.models | ForEach-Object { $_.name })
    Write-Host "Ollama: connected" -ForegroundColor Green
    if ($models.Count -gt 0) { Write-Host "Models: $($models -join ', ')" }
    else { Write-Host "Models: none installed" -ForegroundColor Yellow }
}
catch {
    Write-Host "Ollama: not reachable; start Ollama when local model access is needed." -ForegroundColor Yellow
}

Write-Host "Check complete. No system changes were made."

