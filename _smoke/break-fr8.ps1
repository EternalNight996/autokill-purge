# FR-8 verification (PowerShell). Run from repo root:  pwsh -File _smoke/break-fr8.ps1
# Works on a COPY of sample.exe so the real sample is never touched.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$Src  = Join-Path $Root '_smoke\sample.exe'
$Dir  = Join-Path $Root '_smoke\tmp-fr8'
$Exe  = Join-Path $Dir 'sample.exe'
if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force }
New-Item -ItemType Directory -Path $Dir | Out-Null
Copy-Item $Src $Exe
$Original = (Get-FileHash $Src -Algorithm SHA256).Hash.ToLower()

$script:Pass = 0
$script:Fail = 0
function Run-Break {
  param([string[]]$A)
  $raw = (& node (Join-Path $Root 'break\break.mjs') @A 2>&1) -join "`n"
  $code = $LASTEXITCODE
  $j = $null
  try { $j = $raw | ConvertFrom-Json } catch { }
  return [pscustomobject]@{ code = $code; raw = $raw; j = $j }
}
function Check {
  param([string]$Name, [bool]$Cond, [string]$Detail = '')
  if ($Cond) { $script:Pass++; Write-Output ("PASS  {0}  {1}" -f $Name, $Detail) }
  else { $script:Fail++; Write-Output ("FAIL  {0}  {1}" -f $Name, $Detail) }
}

# positive flow
$r = Run-Break @('info', $Exe)
Check 'info ok + format + sections' ($r.code -eq 0 -and $r.j.ok -and $r.j.format -and $r.j.sections.Count -gt 0) ("sections={0} format={1} machine={2} entropy={3}" -f $r.j.sections.Count, $r.j.format, $r.j.machine, $r.j.sections[0].entropy)

$r = Run-Break @('scan', $Exe, '--min-xrefs', '1')
Check 'scan --min-xrefs 1' ($r.code -eq 0 -and $r.j.ok -and $r.j.hits.Count -gt 0) ("matched={0} hits={1}" -f $r.j.matched, $r.j.hits.Count)

$r = Run-Break @('plan', $Exe)
Check 'plan candidates' ($r.code -eq 0 -and $r.j.ok -and $r.j.candidates.Count -gt 0) ("candidates={0}" -f $r.j.candidates.Count)
$c0 = $r.j.candidates[0]

$r = Run-Break @('plan', $Exe, '--string', 'zzzzz-no-match')
Check 'plan --string no-match -> empty' ($r.code -eq 0 -and $r.j.ok -and $r.j.candidates.Count -eq 0)

$r = Run-Break @('patch', $Exe, '--at', $c0.offset, '--expect', $c0.expect, '--nop', '7')
Check 'patch ok' ($r.code -eq 0 -and $r.j.ok -and $r.j.shaBefore -and $r.j.shaAfter) ("offset={0} before={1} after={2}" -f $r.j.offset, $r.j.before, $r.j.after)

$r = Run-Break @('verify', ($Exe + '.bak'), $Exe)
Check 'verify differingBytes=7' ($r.code -eq 0 -and $r.j.ok -and $r.j.differingBytes -eq 7) ("differingBytes={0}" -f $r.j.differingBytes)

$r = Run-Break @('journal', $Exe)
Check 'journal 1 entry' ($r.code -eq 0 -and $r.j.ok -and $r.j.count -eq 1 -and $r.j.entries[0].command -eq 'patch') ("count={0}" -f $r.j.count)

$r = Run-Break @('restore', $Exe)
$back = (Get-FileHash $Exe -Algorithm SHA256).Hash.ToLower()
Check 'restore ok + sha back' ($r.code -eq 0 -and $r.j.ok -and $back -eq $Original) ("sha={0}" -f $r.j.sha.Substring(0,12))

# negative: expect mismatch -> exit 3, sha unchanged
$before = (Get-FileHash $Exe -Algorithm SHA256).Hash.ToLower()
$r = Run-Break @('patch', $Exe, '--at', '0xA5638', '--expect', '00000000000000', '--nop', '7')
Check 'expect mismatch -> exit 3' ($r.code -eq 3 -and $r.j -and $r.j.ok -eq $false -and $r.j.error.code -eq 3) ("code={0} msg={1}" -f $r.code, $r.j.error.message)
Check 'expect mismatch sha unchanged' ((Get-FileHash $Exe -Algorithm SHA256).Hash.ToLower() -eq $before)

# negative: non-PE -> exit 4
$txt = Join-Path $Dir 'note.txt'
Set-Content -Path $txt -Value 'hello this is not a pe file'
$r = Run-Break @('info', $txt)
Check 'non-PE -> exit 4' ($r.code -eq 4 -and $r.j -and $r.j.ok -eq $false -and $r.j.error.code -eq 4) ("code={0} hint={1}" -f $r.code, $r.j.error.hint)

# negative: invert on non-jcc -> exit 3
$r = Run-Break @('invert', $Exe, '--at', '0x400')
Check 'invert non-jcc -> exit 3' ($r.code -eq 3 -and $r.j -and $r.j.ok -eq $false) ("code={0} msg={1}" -f $r.code, $r.j.error.message)

# negative: offset out of range -> exit 2
$r = Run-Break @('patch', $Exe, '--at', '0x7FFFFFFF', '--nop', '7')
Check 'offset out of range -> exit 2' ($r.code -eq 2 -and $r.j -and $r.j.ok -eq $false) ("code={0}" -f $r.code)

# negative: unknown command -> exit 2
$r = Run-Break @('frobnicate', $Exe)
Check 'unknown command -> exit 2' ($r.code -eq 2 -and $r.j -and $r.j.ok -eq $false) ("code={0}" -f $r.code)

# negative: tampered .bak -> restore refused (exit 5)
$r = Run-Break @('patch', $Exe, '--at', '0xA5638', '--expect', '488D1509AED701', '--nop', '7')
$bak = [System.IO.File]::ReadAllBytes($Exe + '.bak')
$bak[0] = $bak[0] -bxor 0xff
[System.IO.File]::WriteAllBytes($Exe + '.bak', $bak)
$r = Run-Break @('restore', $Exe)
Check 'tampered .bak -> restore refused (exit 5)' ($r.code -eq 5 -and $r.j -and $r.j.ok -eq $false) ("code={0} msg={1}" -f $r.code, $r.j.error.message)

# negative: missing .bak -> restore refused (exit 2)
Remove-Item ($Exe + '.bak') -Force -ErrorAction SilentlyContinue
Remove-Item ($Exe + '.purge') -Recurse -Force -ErrorAction SilentlyContinue
$r = Run-Break @('restore', $Exe)
Check 'missing .bak -> restore refused (exit 2)' ($r.code -eq 2 -and $r.j -and $r.j.ok -eq $false) ("code={0}" -f $r.code)

Write-Output ("`n== {0} passed / {1} failed ==" -f $script:Pass, $script:Fail)
if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
