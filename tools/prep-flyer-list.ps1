# Prepare a flyer/screenshot lead list for the CRM importer.
#
#   powershell -File tools\prep-flyer-list.ps1 -In <raw.csv> -Out <ready.csv> [-Against .tmp\crm-export.csv]
#
# WHY THIS EXISTS
#
# The importer maps a column only when its header matches an alias it knows
# (see ALIASES in js/views/leads.js). A header it does not know is dropped
# without saying so, and a list can import "successfully" with a third of
# its content missing. The extraction lists arrive with headers the CRM has
# never heard of - Phone 2, Social, Service Area, License #, Screenshot # -
# so this renames what maps, folds what does not into the note, and leaves
# a file whose every column lands somewhere.
#
# It also drops rows the CRM already holds. The importer dedupes on its own
# key (email, then social, then domain, then name) and that key carries the
# contact name, so the SAME business arrives as new the moment a list adds a
# contact the existing record lacks - "Limo Service Orange" is in there
# twice already for exactly that reason.
#
# PowerShell rather than Python: this repo's tools are Python, but no Python
# runtime is installed on the machine this was written on. Same rules, same
# output.
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Against = '.tmp\crm-export.csv'
)
$ErrorActionPreference = 'Stop'

# California area codes. A number outside them is a lead in another time
# zone, which is worth knowing BEFORE somebody rings it at 6am their time.
$CA = @('209','213','279','310','323','341','350','408','415','424','442','510','530','559',
        '562','619','626','628','650','657','661','669','707','714','747','760','805','818',
        '820','831','840','858','859','909','916','925','935','949','951')

function Get-Digits($s) { ($s -replace '\D','') }
function Get-Tel($s) {
  $d = Get-Digits $s
  if ($d.Length -eq 11 -and $d.StartsWith('1')) { $d = $d.Substring(1) }
  if ($d.Length -eq 10) { return '({0}) {1}-{2}' -f $d.Substring(0,3), $d.Substring(3,3), $d.Substring(6,4) }
  return $s.Trim()
}
function Get-Site($s) {
  ($s -replace '^https?://','' -replace '^www\.','').TrimEnd('/').Trim()
}
function Get-Handle($s) {
  # "IG @JQ_Poop_Patrol", "IG melody_services", a bare handle or a full URL.
  $v = ($s -replace '(?i)^\s*(ig|instagram)\b[:\s]*','').Trim()
  $v = ($v -replace '^https?://','' -replace '^www\.','' -replace '(?i)^instagram\.com/','')
  $v.TrimStart('@').TrimEnd('/').Trim()
}

$rows = Import-Csv $In

# What the CRM already holds, by the three things that identify a business.
$known = @{}
if (Test-Path $Against) {
  foreach ($c in Import-Csv $Against) {
    $d = Get-Digits $c.Phone
    if ($d.Length -ge 10) { $known['p:' + $d.Substring($d.Length - 10)] = $c.Company }
    $h = ((Get-Site $c.Website) -split '[/?#]')[0].ToLower()
    if ($h) { $known['d:' + $h] = $c.Company }
    if ($c.Email) { $known['e:' + $c.Email.Trim().ToLower()] = $c.Company }
    if ($c.Company) { $known['n:' + ($c.Company.Trim().ToLower() -replace '[^a-z0-9]','')] = $c.Company }
  }
}

$ready = @()
$skipped = @()

foreach ($r in $rows) {
  $name = $r.'Business Name'.Trim()
  # "(Unnamed) Junk Removal & Demolition" is a description, not a name. Said
  # plainly instead, so nobody rings up asking for Unnamed.
  if ($name -match '^\(Unnamed\)\s*(.+)$') { $name = $Matches[1].Trim() + ' (business name unknown)' }

  $phone = Get-Tel $r.Phone
  $site  = Get-Site $r.Website
  $ig    = Get-Handle $r.Social
  $digits = Get-Digits $r.Phone

  # Already in the CRM? Checked the same four ways the importer keys on, so
  # a row is held back here rather than arriving as a second copy.
  $hit = $null
  foreach ($k in @(
    $(if ($r.Email) { 'e:' + $r.Email.Trim().ToLower() }),
    $(if ($site) { 'd:' + ($site -split '[/?#]')[0].ToLower() }),
    $(if ($digits.Length -ge 10) { 'p:' + $digits.Substring($digits.Length - 10) }),
    'n:' + ($name.ToLower() -replace '[^a-z0-9]','')
  )) { if ($k -and -not $hit -and $known.ContainsKey($k)) { $hit = $known[$k] } }

  # Everything the importer would otherwise drop, kept where a rep will
  # read it. The note is the only field that survives an unknown column.
  $note = @()
  if ($r.Notes) { $note += $r.Notes.Trim() }
  if ($r.'Phone 2') { $note += 'Second number: ' + (Get-Tel $r.'Phone 2') }
  if ($r.'License #') { $note += 'License ' + $r.'License #'.Trim() }
  # Address wins the Location column because it is the more precise of the
  # two; the service area then goes in the note rather than being lost.
  if ($r.Address -and $r.'Service Area') { $note += 'Serves ' + $r.'Service Area'.Trim() }
  if ($r.'Screenshot #') { $note += 'From flyer ' + $r.'Screenshot #'.Trim() }

  $tags = @()
  $ac = if ($digits.Length -ge 10) { $digits.Substring($digits.Length - 10, 3) } else { '' }
  if ($ac -and $CA -notcontains $ac) { $tags += 'out-of-state' }
  if (-not $phone) { $tags += 'no-phone' }

  $rec = [pscustomobject][ordered]@{
    'Company Name' = $name
    'Contact'      = $r.'Contact Name'.Trim()
    'Phone'        = $phone
    'Email'        = $r.Email.Trim()
    'Website'      = $site
    'Instagram'    = $ig
    'Location'     = $(if ($r.Address) { $r.Address.Trim() } else { $r.'Service Area'.Trim() })
    'Industry'     = $r.Industry.Trim()
    'Tags'         = ($tags -join ' | ')
    'Notes'        = ($note -join '. ')
  }

  if ($hit) { $skipped += [pscustomobject]@{ Row = $name; AlreadyInCrmAs = $hit; Phone = $phone; Website = $site; Contact = $rec.Contact } }
  else { $ready += $rec }
}

$ready | Export-Csv -Path $Out -NoTypeInformation -Encoding UTF8

"ready to import : $($ready.Count) -> $Out"
"already in CRM  : $($skipped.Count) (held back)"
$skipped | Format-Table -AutoSize
"out-of-state    : $(@($ready | Where-Object { $_.Tags -match 'out-of-state' }).Count)"
"no phone        : $(@($ready | Where-Object { -not $_.Phone }).Count)"
"no email        : $(@($ready | Where-Object { -not $_.Email }).Count)"
