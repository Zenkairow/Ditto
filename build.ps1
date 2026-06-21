# build.ps1 - Packages the Ditto extension into a .zip for Chrome Web Store upload
$version = "1.0.0"
$outFile = "ditto-v$version.zip"

Write-Host "Packaging Ditto v$version..." -ForegroundColor Cyan

# Remove old build if it exists
if (Test-Path $outFile) { Remove-Item $outFile }

# Compress the extension directory
Compress-Archive -Path "extension\*" -DestinationPath $outFile -Force

$sizeKB = [math]::Round((Get-Item $outFile).Length / 1KB, 1)
Write-Host "Built: $outFile ($sizeKB KB)" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Go to https://chrome.google.com/webstore/devconsole/"
Write-Host "  2. Click New Item and upload $outFile"
Write-Host "  3. Fill in screenshots and publish"
