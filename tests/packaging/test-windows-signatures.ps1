$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$verify = Join-Path $PSScriptRoot '../../scripts/package/verify-windows-signatures.ps1'
$fixture = @(
    (Join-Path $PSHOME 'pwsh.exe'),
    (Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe')
) | Where-Object {
    (Test-Path -LiteralPath $_) -and
    (Get-AuthenticodeSignature -LiteralPath $_).Status -eq 'Valid' -and
    $null -ne (Get-AuthenticodeSignature -LiteralPath $_).TimeStamperCertificate
} | Select-Object -First 1
if (-not $fixture) { throw '测试需要 Windows Runner 自带的有效、带时间戳的 Microsoft 签名程序' }

$taskDir = Join-Path ([System.IO.Path]::GetTempPath()) ('wrong-notebook-signing-' + [guid]::NewGuid())
$names = @('WrongNotebook-Win-Setup-1.0.0-x64.exe', 'WrongNotebook-Win-Portable-1.0.0-x64.exe')

function New-FixtureSet([string]$case) {
    $unsigned = Join-Path $taskDir "$case/unsigned"
    $signed = Join-Path $taskDir "$case/signed"
    New-Item -ItemType Directory -Path $unsigned, $signed -Force | Out-Null
    foreach ($name in $names) {
        Copy-Item -LiteralPath $fixture -Destination (Join-Path $unsigned $name)
        Copy-Item -LiteralPath $fixture -Destination (Join-Path $signed $name)
    }
    return @{ UnsignedDirectory = $unsigned; SignedDirectory = $signed }
}

function Assert-Rejected([string]$case, [hashtable]$paths) {
    $before = @($names | ForEach-Object { (Get-FileHash -LiteralPath (Join-Path $paths.UnsignedDirectory $_)).Hash })
    $rejected = $false
    try { & $verify @paths } catch { $rejected = $true }
    if (-not $rejected) { throw "未拦截异常产物：$case" }
    $after = @($names | ForEach-Object { (Get-FileHash -LiteralPath (Join-Path $paths.UnsignedDirectory $_)).Hash })
    if (@(Compare-Object $before $after).Count -ne 0) { throw "失败时修改了原始产物：$case" }
    Write-Output "已拦截：$case"
}

try {
    # 使用 Runner 自带的真实签名程序检验信任链，不依赖 SignPath 凭据。
    # 产品名在提交签名前由工作流限定为 WrongNotebook；此处验证返回文件与原件一致。
    $paths = New-FixtureSet 'valid'
    & $verify @paths
    foreach ($name in $names) {
        if ((Get-FileHash -LiteralPath (Join-Path $paths.UnsignedDirectory $name)).Hash -ne (Get-FileHash -LiteralPath $fixture).Hash) {
            throw '有效签名文件未正确复制回发布目录'
        }
    }

    $paths = New-FixtureSet 'missing'
    Remove-Item -LiteralPath (Join-Path $paths.SignedDirectory $names[0])
    Assert-Rejected '缺少一个安装包' $paths

    $paths = New-FixtureSet 'extra'
    Copy-Item -LiteralPath $fixture -Destination (Join-Path $paths.SignedDirectory 'extra.exe')
    Assert-Rejected '返回额外文件' $paths

    $paths = New-FixtureSet 'unsigned'
    [System.IO.File]::WriteAllText((Join-Path $paths.SignedDirectory $names[1]), '未签名文件')
    Assert-Rejected '返回未签名文件' $paths

    $paths = New-FixtureSet 'tampered'
    $tamperedPath = Join-Path $paths.SignedDirectory $names[1]
    $bytes = [System.IO.File]::ReadAllBytes($tamperedPath)
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
    $optionalSize = [BitConverter]::ToUInt16($bytes, $peOffset + 20)
    $sectionOffset = $peOffset + 24 + $optionalSize
    $codeOffset = [BitConverter]::ToInt32($bytes, $sectionOffset + 20)
    $bytes[$codeOffset] = $bytes[$codeOffset] -bxor 1
    [System.IO.File]::WriteAllBytes($tamperedPath, $bytes)
    Assert-Rejected '签名后文件被篡改' $paths

    Write-Output 'Windows 签名验证的 5 项测试通过'
} finally {
    if (Test-Path -LiteralPath $taskDir) { Remove-Item -LiteralPath $taskDir -Recurse -Force }
}
