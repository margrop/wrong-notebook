param(
    [Parameter(Mandatory = $true)][string]$UnsignedDirectory,
    [Parameter(Mandatory = $true)][string]$SignedDirectory,
    # SignPath 自签名测试证书：允许根证书不受信任且不要求时间戳，只验证不覆盖发布文件。
    [switch]$TestCertificate
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$originals = @(Get-ChildItem -LiteralPath $UnsignedDirectory -Filter 'WrongNotebook-Win-*.exe' -File)
$names = @($originals.Name | Sort-Object)
if ($originals.Count -ne 2 -or @($names | Where-Object { $_ -match '^WrongNotebook-Win-Setup-.+-x64\.exe$' }).Count -ne 1 -or @($names | Where-Object { $_ -match '^WrongNotebook-Win-Portable-.+-x64\.exe$' }).Count -ne 1) {
    throw '必须提供 Windows 安装版和免安装版两个原始文件'
}

# 返回文件必须完整对应原始产物，避免漏签、替换其他文件或上传未签名的旧文件。
$signedFiles = @(Get-ChildItem -LiteralPath $SignedDirectory -File -Recurse)
$signedNames = @($signedFiles.Name | Sort-Object)
if ($signedFiles.Count -ne 2 -or @(Compare-Object $names $signedNames).Count -ne 0 -or @(Get-ChildItem -LiteralPath $SignedDirectory -Directory).Count -ne 0) {
    throw 'SignPath 返回的文件必须与两个原始 Windows 安装包完全对应'
}

foreach ($original in $originals) {
    $signedPath = Join-Path $SignedDirectory $original.Name
    $signed = Get-Item -LiteralPath $signedPath
    if ([string]::IsNullOrWhiteSpace($original.VersionInfo.ProductName) -or [string]::IsNullOrWhiteSpace($original.VersionInfo.ProductVersion) -or $signed.VersionInfo.ProductName -cne $original.VersionInfo.ProductName -or $signed.VersionInfo.ProductVersion -cne $original.VersionInfo.ProductVersion) {
        throw "签名文件的产品名称或版本发生变化：$($original.Name)"
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $signedPath
    if ($TestCertificate) {
        # 自签名根证书的状态为 UnknownError；未签名、哈希不符等仍会被拒绝。
        if (@('Valid', 'UnknownError') -notcontains $signature.Status -or $null -eq $signature.SignerCertificate) {
            throw "Windows 安装包未包含测试证书的 Authenticode 签名：$($original.Name)（$($signature.Status)）"
        }
        Write-Output ("{0}：已用测试证书签名（{1}），签名者 {2}" -f $original.Name, $signature.Status, $signature.SignerCertificate.Subject)
        continue
    }
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or $null -eq $signature.TimeStamperCertificate) {
        throw "Windows 安装包未通过可信 Authenticode 签名及时间戳验证：$($original.Name)（$($signature.Status)）"
    }
    Write-Output ("{0}：签名有效，发布者 {1}" -f $original.Name, $signature.SignerCertificate.Subject)
}

# 测试证书签名的文件不能作为发布附件，保留原始未签名文件。
if ($TestCertificate) { return }

# 两个文件均验证成功后才覆盖原路径；后续附件名、上传步骤和校验和生成保持原样。
foreach ($original in $originals) {
    Copy-Item -LiteralPath (Join-Path $SignedDirectory $original.Name) -Destination $original.FullName -Force
}
