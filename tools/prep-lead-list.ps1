# Prepare an extracted lead list for the CRM importer.
#
#   powershell -File tools\prep-lead-list.ps1 -In <raw.csv> -Out <ready.csv> [-Against .tmp\crm-export.csv]
#
# WHY THIS EXISTS
#
# The importer keeps a column only when its header matches an alias it knows
# (ALIASES in js/views/leads.js). Two things go wrong with a list scraped out
# of flyers or Facebook posts, and neither announces itself:
#
#   · a header it does not know is dropped in silence. "Service Area" is the
#     expensive one - most rows carry no street address, so the lead lands
#     with no location, and the zone filter has no state to read.
#
#   · a header it half-recognises is worse than one it drops. The matcher
#     falls back to a whole-word match, so "Facebook Poster" - the person who
#     posted the ad - was read as the BUSINESS's Facebook handle. A social
#     handle outranks the website and the name in leadKey, so every lead
#     keyed on the poster: two businesses posted by the same person collide
#     as duplicates, and the same business posted twice arrives twice.
#
# So this renames what maps, splits a combined Website / Social column,
# folds everything else into the note, and holds back rows the CRM already
# has. The rule it works to: no column is dropped in silence. Anything
# without a home in the CRM is written into the note, where a rep reads it.
#
# PowerShell rather than Python: this repo's tools are Python, but no Python
# runtime is installed on the machine this was written on.
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  # More than one is allowed, and worth it: the CRM export goes stale the
  # moment a list is imported, so the lists already handed over are checked
  # too. Without that, a business on last week's batch arrives again.
  [string[]]$Against = @('.tmp\crm-export.csv')
)
$ErrorActionPreference = 'Stop'

# California area codes. Anything else is a business in another state, and
# often another time zone - which is what Josh hit ringing the east coast.
$CA = @('209','213','279','310','323','341','350','408','415','424','442','510','530','559',
        '562','619','626','628','650','657','661','669','707','714','747','760','805','818',
        '820','831','840','858','859','909','916','925','935','949','951')

function Get-Digits($s) { ($s -replace '\D','') }

function Get-Tel($s) {
  $d = Get-Digits $s
  if ($d.Length -eq 11 -and $d.StartsWith('1')) { $d = $d.Substring(1) }
  if ($d.Length -eq 10) { return '({0}) {1}-{2}' -f $d.Substring(0,3), $d.Substring(3,3), $d.Substring(6,4) }
  return "$s".Trim()
}

function Get-Site($s) {
  ("$s" -replace '^https?://','' -replace '^www\.','').TrimEnd('/').Trim()
}

# A handle is one word. "Doggie Dazzle" is the name of a page, not a handle,
# and writing it into the Instagram field would put it in a link that goes
# nowhere - so it goes in the note instead.
function Test-Handle($s) { return ("$s".Trim() -match '^[@/]?[A-Za-z0-9._]+$') }
function Get-Handle($s) { return ("$s".Trim() -replace '^[@/]+','') }

# Which CRM field a header feeds. First match wins. A header that matches
# nothing is not lost - it is carried into the note by name.
function Get-FieldFor($header) {
  $h = ($header.ToLower() -replace '[^a-z0-9]+',' ').Trim()
  switch -regex ($h) {
    '^(lead |row )?(#|no|number|id|index)$|^lead $|^lead$' { return 'skip' }
    '^business name$|^company( name)?$|^organization$|^account( name)?$|^name$' { return 'name' }
    '^contact( name)?$|^owner name$|^primary contact$|^full name$'             { return 'contact' }
    '^(contact )?title$|^role$|^position$|^job title$'                         { return 'title' }
    '^category$|^industry$|^business type$|^niche$|^sector$'                   { return 'industry' }
    '^phone( number)?$|^telephone$|^mobile$|^cell$'                            { return 'phone' }
    '^phone ?2$|^second phone$|^alt(ernate)? phone$|^office( phone)?$'         { return 'phone2' }
    '^e ?mail( address)?$'                                                     { return 'email' }
    # "Website", and "Website / Social" where one column holds either.
    '^website|^url$|^site$|^web( address)?$|^domain$'                          { return 'websiteSocial' }
    '^instagram( handle| url)?$|^ig$'                                          { return 'instagram' }
    # Only the business's own page. "Facebook Poster" deliberately falls
    # through to the note - see the header comment.
    '^facebook( page| url)?$|^fb( page)?$'                                     { return 'facebook' }
    '^tiktok$'                                                                 { return 'tiktok' }
    '^street address$|^address$|^street$|^full address$'                       { return 'address' }
    '^service area$|^areas? served$|^coverage( area)?$'                        { return 'serviceArea' }
    '^state$'                                                                  { return 'state' }
    'licen[sc]e'                                                               { return 'license' }
    '^notes?$|^comments?$|^description$|^details$'                             { return 'notes' }
    '^tags?$|^labels$|^segment$'                                               { return 'tags' }
  }
  return 'extra'
}

# "2 days ago" is unreadable a week from now. Resolved against the day the
# list was pulled, and marked ~ so nobody reads it as exact.
function Resolve-Posted($raw, $pulled) {
  $v = "$raw".Trim()
  if (-not $v) { return '' }
  if ($v -match '^(\d+)\s*hour') { return '~' + $pulled.AddHours(-1 * [int]$Matches[1]).ToString('MMM d') }
  if ($v -match '^(\d+)\s*day')  { return '~' + $pulled.AddDays(-1 * [int]$Matches[1]).ToString('MMM d') }
  if ($v -match '^(a|an|one)\s*(day|hour)') { return '~' + $pulled.AddDays(-1).ToString('MMM d') }
  if ($v -match '^yesterday')    { return '~' + $pulled.AddDays(-1).ToString('MMM d') }
  if ($v -match '^a few')        { return '~' + $pulled.ToString('MMM d') }
  return $v
}

$rows = Import-Csv $In
if (-not $rows) { throw "no rows in $In" }
$pulled = (Get-Item $In).LastWriteTime
$headers = $rows[0].PSObject.Properties.Name

$fieldOf = @{}
foreach ($h in $headers) { $fieldOf[$h] = Get-FieldFor $h }

# What the CRM already holds, keyed the four ways a business is identified.
$known = @{}
foreach ($file in $Against) {
  if (-not (Test-Path $file)) { continue }
  $cols = $null
  foreach ($c in Import-Csv $file) {
    # Each list names its columns differently - "Company" in a CRM export,
    # "Company Name" in one of ours. Worked out once per file.
    if (-not $cols) {
      $names = $c.PSObject.Properties.Name
      $cols = @{
        name  = ($names | Where-Object { $_ -match '(?i)^(company|business)( name)?$|^name$' } | Select-Object -First 1)
        phone = ($names | Where-Object { $_ -match '(?i)^phone$' } | Select-Object -First 1)
        email = ($names | Where-Object { $_ -match '(?i)^email$' } | Select-Object -First 1)
        site  = ($names | Where-Object { $_ -match '(?i)^website$' } | Select-Object -First 1)
      }
    }
    $who = if ($cols.name) { "$($c.($cols.name))".Trim() } else { '' }
    if (-not $who) { continue }
    $label = $who + $(if ($file -notmatch 'crm-export') { ' (' + (Split-Path $file -Leaf) + ')' } else { '' })
    if ($cols.phone) {
      $d = Get-Digits $c.($cols.phone)
      if ($d.Length -ge 10) { $known['p:' + $d.Substring($d.Length - 10)] = $label }
    }
    if ($cols.site) {
      $x = ((Get-Site $c.($cols.site)) -split '[/?#]')[0].ToLower()
      if ($x) { $known['d:' + $x] = $label }
    }
    if ($cols.email -and $c.($cols.email)) { $known['e:' + "$($c.($cols.email))".Trim().ToLower()] = $label }
    $known['n:' + ($who.ToLower() -replace '[^a-z0-9]','')] = $label
  }
}

$ready = @()
$skipped = @()
$seen = @{}

foreach ($r in $rows) {
  $f = @{}
  $extras = @()
  foreach ($h in $headers) {
    $v = "$($r.$h)".Trim()
    $key = $fieldOf[$h]
    if ($key -eq 'skip' -or -not $v) { continue }
    if ($key -eq 'extra') { $extras += @{ Header = $h; Value = $v }; continue }
    $f[$key] = $v
  }

  $name = "$($f['name'])".Trim()
  if ($name -match '^\(Unnamed\)\s*(.+)$') { $name = $Matches[1].Trim() + ' (business name unknown)' }
  if (-not $name -and $f['contact']) { $name = $f['contact'] }
  if (-not $name) { continue }

  $note = @()
  if ($f['notes']) { $note += $f['notes'].TrimEnd('.') }

  # One column, three kinds of value: a website, a social handle, or the
  # name of a page. Each goes where it belongs rather than all of them
  # into the website field, where a handle would key the lead wrongly.
  # One cell often holds several: "site.com; @handle", or an Instagram and
  # a Facebook separated by a semicolon. Split first, judge each piece.
  $pieces = @()
  foreach ($raw in @($f['websiteSocial'], $f['instagram'], $f['facebook'], $f['tiktok'])) {
    if (-not $raw) { continue }
    foreach ($p in ("$raw" -split ';')) { if ($p.Trim()) { $pieces += $p.Trim() } }
  }

  $site = ''; $ig = ''; $fb = ''
  foreach ($raw in $pieces) {
    $v = "$raw".Trim()
    # "@104_customs_llc (TikTok/Facebook/Instagram)" - the note in brackets
    # says where it is, which is worth keeping but is not part of the handle.
    if ($v -match '^(.+?)\s*\(([^)]+)\)\s*$') {
      $note += $Matches[2].Trim() + ': ' + $Matches[1].Trim()
      $v = $Matches[1].Trim()
    }
    # "Facebook/Instagram: /bluepeakdental" - one handle, two networks.
    if ($v -match '^(?i)(facebook|fb)\s*/\s*instagram\s*[:\-]?\s*/?(.+)$' -and (Test-Handle $Matches[2])) {
      if (-not $ig) { $ig = Get-Handle $Matches[2] }
      if (-not $fb) { $fb = Get-Handle $Matches[2] }
      continue
    }
    if ($v -match '^(?i)(instagram|ig)\s*[:\-]?\s*(.+)$') {
      $h2 = $Matches[2].Trim()
      if (Test-Handle $h2) { if (-not $ig) { $ig = Get-Handle $h2 } } else { $note += 'Instagram: ' + $h2 }
    }
    elseif ($v -match '^(?i)(facebook|fb)\s*[:\-]?\s*(.+)$') {
      $h2 = $Matches[2].Trim()
      if (Test-Handle $h2) { if (-not $fb) { $fb = Get-Handle $h2 } } else { $note += 'Facebook page: ' + $h2 }
    }
    elseif ($v -match '\.[a-z]{2,}(/|$)') { if (-not $site) { $site = Get-Site $v } }
    elseif (Test-Handle $v) { if (-not $ig) { $ig = Get-Handle $v } }
    else { $note += $v }
  }
  # A column explicitly named Instagram/Facebook wins over anything guessed
  # out of a combined column.
  if ($f['instagram'] -and (Test-Handle $f['instagram'])) { $ig = Get-Handle $f['instagram'] }
  if ($f['facebook'] -and (Test-Handle $f['facebook']))   { $fb = Get-Handle $f['facebook'] }

  $phoneRaw = "$($f['phone'])".Trim()
  $phone = if ($phoneRaw) { Get-Tel $phoneRaw } else { '' }
  $digits = Get-Digits $phoneRaw

  # A street address is more precise than a service area, so it takes the
  # Location column and the service area goes in the note. The state is
  # appended either way: the zone filter reads it, and "Bothell" alone
  # cannot say which coast it is on.
  $state = "$($f['state'])".Trim()
  $loc = if ($f['address']) { $f['address'].Trim() } else { "$($f['serviceArea'])".Trim() }
  if ($state -and $loc -and $state -notmatch '/' -and $loc -notmatch ('(?i)\b' + [regex]::Escape($state) + '\b')) {
    $loc = $loc + ', ' + $state
  } elseif (-not $loc -and $state) {
    $loc = $state
  }
  if ($f['address'] -and $f['serviceArea']) { $note += 'Serves ' + $f['serviceArea'].Trim() }

  if ($f['phone2']) {
    # Kept verbatim when it carries a label - "(775) 786-3111 (office)".
    $p2 = "$($f['phone2'])".Trim()
    $note += 'Second number: ' + $(if ($p2 -match '[A-Za-z]') { $p2 } else { Get-Tel $p2 })
  }
  if ($f['license']) { $note += 'License ' + $f['license'].Trim() }

  foreach ($e in $extras) {
    $h = $e.Header; $v = $e.Value
    if ($h -match '(?i)post date|posted') { $note += 'Posted ' + (Resolve-Posted $v $pulled) }
    elseif ($h -match '(?i)poster')       { $note += 'Posted by ' + $v }
    elseif ($h -match '(?i)\bai\b')       { if ($v -match '(?i)^y') { $note += 'Post marked as AI content' } }
    elseif ($h -match '(?i)screenshot|flyer') { $note += 'From flyer ' + $v }
    else { $note += $h.Trim() + ': ' + $v }
  }

  # Out of state is read off the state first and the area code second. A
  # bakery in Portland with no phone on the post is still out of state, and
  # an area code alone cannot say so.
  $tags = @()
  $ac = if ($digits.Length -ge 10) { $digits.Substring($digits.Length - 10, 3) } else { '' }
  $away = $false
  if ($state) { $away = ($state -notmatch '(?i)^\s*(ca|california)\s*$') }
  elseif ($loc -match '(?i),\s*([A-Z]{2})\b') { $away = ($Matches[1] -notmatch '(?i)^ca$') }
  elseif ($ac) { $away = ($CA -notcontains $ac) }
  if ($away) { $tags += 'out-of-state' }
  if (-not $phone) { $tags += 'no-phone' }
  if ($f['tags']) { $tags += ($f['tags'] -split '[|,]' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }

  $rec = [pscustomobject][ordered]@{
    'Company Name' = $name
    'Contact'      = "$($f['contact'])".Trim()
    'Title'        = "$($f['title'])".Trim()
    'Phone'        = $phone
    'Email'        = "$($f['email'])".Trim()
    'Website'      = $site
    'Instagram'    = $ig
    'Facebook'     = $fb
    'Location'     = $loc
    'Industry'     = "$($f['industry'])".Trim()
    'Tags'         = ($tags -join ' | ')
    'Notes'        = (($note | Where-Object { $_ }) -join '. ')
  }

  # Already in the CRM, or already earlier in this same file.
  $keys = @()
  if ($rec.Email) { $keys += 'e:' + $rec.Email.ToLower() }
  if ($site) { $keys += 'd:' + ($site -split '[/?#]')[0].ToLower() }
  if ($digits.Length -ge 10) { $keys += 'p:' + $digits.Substring($digits.Length - 10) }
  $keys += 'n:' + ($name.ToLower() -replace '[^a-z0-9]','')

  $hit = $null; $hitKey = ''
  foreach ($k in $keys) {
    if ($hit) { continue }
    if ($known.ContainsKey($k)) { $hit = $known[$k]; $hitKey = $k }
    elseif ($seen.ContainsKey($k)) { $hit = $seen[$k] + ' (earlier in this file)'; $hitKey = $k }
  }

  if ($hit) {
    $skipped += [pscustomobject]@{ Row = $name; AlreadyIn = $hit; Matched = $hitKey }
  } else {
    foreach ($k in $keys) { $seen[$k] = $name }
    $ready += $rec
  }
}

$ready | Export-Csv -Path $Out -NoTypeInformation -Encoding UTF8

'columns read:'
foreach ($h in $headers) {
  $k = $fieldOf[$h]
  $where = switch ($k) {
    'skip'  { 'ignored (row number)' }
    'extra' { 'into the note' }
    default { $k }
  }
  '  {0,-24} -> {1}' -f $h, $where
}
''
"ready to import : $($ready.Count) -> $Out"
"already known   : $($skipped.Count) (held back)"
if ($skipped) { $skipped | Format-Table -AutoSize }
"with a phone    : $(@($ready | Where-Object { $_.Phone }).Count) of $($ready.Count)"
"with a location : $(@($ready | Where-Object { $_.Location }).Count) of $($ready.Count)"
"with an email   : $(@($ready | Where-Object { $_.Email }).Count) of $($ready.Count)"
