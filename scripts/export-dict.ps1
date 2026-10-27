<#
  Exporta SX2 (tabelas) e SX3 (campos) do banco do Protheus para o JSON
  usado pela extensao AdvPL Navigator. So faz SELECT.

  Uso:
    .\export-dict.ps1 -Server 'SRVSQL\PROTHEUS' -Database 'P12' -Output 'C:\...\advpl-dict.json'
    .\export-dict.ps1 ... -IntegratedSecurity     # autenticacao do Windows
#>
param(
  [Parameter(Mandatory)] [string] $Server,
  [Parameter(Mandatory)] [string] $Database,
  [Parameter(Mandatory)] [string] $Output,
  [string] $Suffix = '010',
  [switch] $IntegratedSecurity
)
$ErrorActionPreference = 'Stop'

if ($Suffix -notmatch '^[A-Za-z0-9]{3}$') { throw "Sufixo invalido: $Suffix" }

$builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
$builder['Data Source'] = $Server
$builder['Initial Catalog'] = $Database
$builder['Application Name'] = 'AdvPL Navigator'
if ($IntegratedSecurity) {
  $builder['Integrated Security'] = $true
} else {
  $cred = Get-Credential -Message "Usuario do SQL Server ($Server / $Database)"
  if (-not $cred) { throw 'Cancelado.' }
  $builder['User ID'] = $cred.UserName
  $builder['Password'] = $cred.GetNetworkCredential().Password
}

function Esc([object] $v) {
  if ($v -is [DBNull] -or $null -eq $v) { return '""' }
  $s = ([string]$v).Trim()
  $s = $s.Replace('\', '\\').Replace('"', '\"').Replace("`r", ' ').Replace("`n", ' ').Replace("`t", ' ')
  return '"' + $s + '"'
}

function Query($conn, [string] $sql) {
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = $sql
  $cmd.CommandTimeout = 300
  # A virgula impede o PowerShell de enumerar o reader no pipeline.
  return ,$cmd.ExecuteReader()
}

$conn = New-Object System.Data.SqlClient.SqlConnection $builder.ConnectionString
$conn.Open()
try {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('{"meta":{"server":' + (Esc $Server) + ',"database":' + (Esc $Database) + ',"suffix":' + (Esc $Suffix) + ',"generatedAt":' + (Esc (Get-Date -Format s)) + '},')

  Write-Host "Lendo SX2$Suffix..."
  [void]$sb.Append('"tables":[')
  $r = Query $conn "SELECT X2_CHAVE, X2_NOME FROM SX2$Suffix WHERE D_E_L_E_T_ = ' ' ORDER BY X2_CHAVE"
  $n = 0
  while ($r.Read()) {
    if ($n++) { [void]$sb.Append(',') }
    [void]$sb.Append('[' + (Esc $r[0]) + ',' + (Esc $r[1]) + ']')
  }
  $r.Close()
  Write-Host "  $n tabelas"

  Write-Host "Lendo SX3$Suffix..."
  [void]$sb.Append('],"fields":[')
  $r = Query $conn @"
SELECT X3_ARQUIVO, X3_CAMPO, X3_TIPO, X3_TAMANHO, X3_DECIMAL, X3_TITULO, X3_DESCRIC,
       X3_CONTEXT, X3_CBOX, X3_F3, X3_PICTURE
  FROM SX3$Suffix
 WHERE D_E_L_E_T_ = ' '
 ORDER BY X3_ARQUIVO, X3_ORDEM
"@
  $n = 0
  while ($r.Read()) {
    if ($n++) { [void]$sb.Append(',') }
    [void]$sb.Append('[' + (Esc $r[0]) + ',' + (Esc $r[1]) + ',' + (Esc $r[2]) + ',' + [int]$r[3] + ',' + [int]$r[4] + ',' +
      (Esc $r[5]) + ',' + (Esc $r[6]) + ',' + (Esc $r[7]) + ',' + (Esc $r[8]) + ',' + (Esc $r[9]) + ',' + (Esc $r[10]) + ']')
  }
  $r.Close()
  Write-Host "  $n campos"
  [void]$sb.Append(']}')

  $dir = Split-Path -Parent $Output
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Output, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))
  Write-Host "Dicionario salvo em $Output" -ForegroundColor Green
} finally {
  $conn.Close()
}
