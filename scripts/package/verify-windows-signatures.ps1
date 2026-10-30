param(
    [Parameter(Mandatory = $true)][string]$UnsignedDirectory,
    [Parameter(Mandatory = $true)][string]$SignedDirectory
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
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or $null -eq $signature.TimeStamperCertificate) {
        throw "Windows 安装包未通过可信 Authenticode 签名及时间戳验证：$($original.Name)（$($signature.Status)）"
    }
    Write-Output ("{0}：签名有效，发布者 {1}" -f $original.Name, $signature.SignerCertificate.Subject)
}

# 两个文件均验证成功后才覆盖原路径；后续附件名、上传步骤和校验和生成保持原样。
foreach ($original in $originals) {
    Copy-Item -LiteralPath (Join-Path $SignedDirectory $original.Name) -Destination $original.FullName -Force
}
