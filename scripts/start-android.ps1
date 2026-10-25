param([ValidateRange(1,65535)][int]$Port = 5173)
# One background Cloudflare launcher for Android and other phones; no SSH session required.
& (Join-Path $PSScriptRoot 'start-phone.ps1') -Port $Port
