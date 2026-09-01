# setup-ssh-alias.ps1
# Windows OpenSSH alias setup wizard. ASCII-safe for Windows PowerShell 5.1.

$ErrorActionPreference = "Stop"

function Read-Default {
    param(
        [string]$PromptText,
        [string]$DefaultValue
    )

    if ([string]::IsNullOrWhiteSpace($DefaultValue)) {
        $v = Read-Host $PromptText
    } else {
        $v = Read-Host "$PromptText [$DefaultValue]"
        if ([string]::IsNullOrWhiteSpace($v)) {
            $v = $DefaultValue
        }
    }

    return $v.Trim()
}

function Need-Cmd {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Command not found: $Name"
    }
}

function To-SshPath {
    param([string]$PathText)

    $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PathText)
    return $full.Replace('\', '/')
}

function Fix-KeyPermission {
    param([string]$KeyPath)

    try {
        icacls $KeyPath /inheritance:r | Out-Null
        icacls $KeyPath /grant:r "$($env:USERNAME):(R)" | Out-Null
    } catch {
        Write-Host "Warning: failed to fix key permission. You may ignore this if ssh works." -ForegroundColor Yellow
    }
}

Need-Cmd "ssh"
Need-Cmd "ssh-keygen"

$sshDir = Join-Path $HOME ".ssh"
$configPath = Join-Path $sshDir "config"

if (-not (Test-Path $sshDir)) {
    New-Item -ItemType Directory -Path $sshDir | Out-Null
}

if (-not (Test-Path $configPath)) {
    New-Item -ItemType File -Path $configPath | Out-Null
}

Write-Host ""
Write-Host "=== SSH Alias Setup Wizard ===" -ForegroundColor Cyan
Write-Host "SSH config: $configPath"
Write-Host ""

do {
    $alias = Read-Default "Input SSH alias, example: cloud-dev, tx-test, aliyun-prod" ""
    if ($alias -notmatch "^[a-zA-Z0-9._-]+$") {
        Write-Host "Alias can only contain letters, numbers, dot, underscore and dash." -ForegroundColor Yellow
        $alias = ""
    }
} while ([string]::IsNullOrWhiteSpace($alias))

$hostName = Read-Default "Input server IP or domain" ""
if ([string]::IsNullOrWhiteSpace($hostName)) {
    throw "Server IP or domain is required."
}

$sshUser = Read-Default "Input SSH username" "root"

do {
    $portText = Read-Default "Input SSH port" "22"
    $port = 0
    $portOk = [int]::TryParse($portText, [ref]$port)
    if (-not $portOk -or $port -le 0 -or $port -gt 65535) {
        Write-Host "Invalid port. Please input 1-65535." -ForegroundColor Yellow
    }
} while (-not $portOk -or $port -le 0 -or $port -gt 65535)

$safeAlias = $alias -replace "[^a-zA-Z0-9._-]", "_"
$defaultKeyPath = Join-Path $sshDir "id_ed25519_$safeAlias"
$keyPathInput = Read-Default "Input private key path" $defaultKeyPath
$keyPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($keyPathInput)
$pubKeyPath = "$keyPath.pub"

Write-Host ""
Write-Host "Config preview:" -ForegroundColor Cyan
Write-Host "Alias:        $alias"
Write-Host "HostName:     $hostName"
Write-Host "User:         $sshUser"
Write-Host "Port:         $port"
Write-Host "IdentityFile: $keyPath"
Write-Host ""

if (-not (Test-Path $keyPath)) {
    $createKey = Read-Default "Private key does not exist. Generate a new ed25519 key? Y/N" "Y"

    if ($createKey -match "^[Yy]$") {
        Write-Host "Generating key..." -ForegroundColor Cyan
        ssh-keygen -t ed25519 -f $keyPath -C "codex-$alias"
        Fix-KeyPermission $keyPath
    } else {
        throw "Private key does not exist. Canceled."
    }
} else {
    Write-Host "Private key exists. Skip key generation." -ForegroundColor Green
    Fix-KeyPermission $keyPath
}

if (-not (Test-Path $pubKeyPath)) {
    throw "Public key not found: $pubKeyPath"
}

$installPubKey = Read-Default "Install public key to server authorized_keys? First setup should choose Y. Y/N" "Y"

if ($installPubKey -match "^[Yy]$") {
    Write-Host ""
    Write-Host "Installing public key. You may need to input server password." -ForegroundColor Yellow

    $remote = "$sshUser@$hostName"
    $remoteCmd = 'umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; read -r key; grep -qxF "$key" ~/.ssh/authorized_keys || echo "$key" >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys'

    Get-Content -Raw -Path $pubKeyPath | ssh -p $port $remote $remoteCmd

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install public key."
    }

    Write-Host "Public key installed." -ForegroundColor Green
}

$identityFileForConfig = To-SshPath $keyPath

$configContent = Get-Content -Raw -Path $configPath

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = "$configPath.bak.$timestamp"
Copy-Item $configPath $backupPath -Force

$escapedAlias = [regex]::Escape($alias)
$pattern = "(?ms)^\s*Host\s+$escapedAlias\s*\r?\n.*?(?=^\s*Host\s+|\z)"
$newConfigContent = [regex]::Replace($configContent, $pattern, "").TrimEnd()

$hostBlock = @"

Host $alias
  HostName $hostName
  User $sshUser
  Port $port
  IdentityFile $identityFileForConfig
  IdentitiesOnly yes
  ServerAliveInterval 30
  ServerAliveCountMax 3
"@

$finalConfig = ($newConfigContent + $hostBlock).TrimStart() + "`r`n"

Set-Content -Path $configPath -Value $finalConfig -Encoding ascii

Write-Host ""
Write-Host "SSH config updated." -ForegroundColor Green
Write-Host "Backup: $backupPath"
Write-Host ""

Write-Host "New Host block:" -ForegroundColor Cyan
Write-Host "----------------------------------------"
Write-Host $hostBlock
Write-Host "----------------------------------------"

$testNow = Read-Default "Test connection now? Y/N" "Y"

if ($testNow -match "^[Yy]$") {
    Write-Host ""
    Write-Host "Running test command..." -ForegroundColor Cyan

    ssh $alias 'hostname && whoami && pwd'

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "SSH connection success." -ForegroundColor Green
        Write-Host "Use this in Codex App: $alias" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "SSH connection failed. Run this for debug:" -ForegroundColor Yellow
        Write-Host "ssh -v $alias"
    }
}
