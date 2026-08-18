# Renders every route in headless Edge and checks the expected content is
# there. The live app points at Supabase and would show the sign-in screen,
# so a copy is staged with a blank config: same index.html, same views, the
# backend adapter just falls back to local/demo mode and seeds data.
#
#   powershell -File tests\render-check.ps1
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-stage"

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($item in @('index.html', 'css', 'js', 'assets')) {
  Copy-Item -Recurse -Force (Join-Path $src $item) $stage
}
Set-Content -Encoding utf8 (Join-Path $stage 'js\config.js') @'
window.CRM_CONFIG = { supabase: { url: '', anonKey: '' } };
'@

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
# Fresh profile: a localStorage blob from an earlier run holds a database
# saved before the newest feature existed, which changes what boots.
$profile = "$env:TEMP\tfs-crm-render"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$routes = [ordered]@{
  'dashboard'          = 'My Activities'
  'leads'              = 'Follow Up Now'
  'outreach'           = 'Daily Outreach'
  'accounts'           = 'Sonoran Ridge Realty'
  'contacts'           = 'Rhonda Pike'
  'opportunities'      = 'Weighted Forecast'
  'pipeline'           = 'Drag a card to move the deal'
  'activities'         = 'Log a Call'
  'tracker'            = 'End Of Day Log'
  'workorders'         = 'Homepage wireframe review'
  'vendors'            = 'Redstone Print Works'
  'billing'            = 'Billing Calendar'
  'admin'              = 'Service Catalog'
  'accounts/c_2'       = 'Copperline'
  'customers/c_1'      = 'Sonoran Ridge'
  'contacts/ct_1'      = 'Marcy Delgado'
  'opportunities/op_3' = 'Copperline'
  'leads/l_1'          = 'Saguaro Auto Spa'
  'leads/l_7'          = 'This lead became'
  'vendors/v_1'        = 'Print / Fabrication'
  'workorders/w_1'     = 'Time Log'
}

# A cold browser profile takes several seconds to become useful, and the
# first handful of page loads used to fail the budget purely because of
# that. Warm it up once, then measure.
& $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=8000 --dump-dom "$base#/dashboard" 2>$null | Out-Null

$fails = 0
foreach ($r in $routes.Keys) {
  $dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
    --virtual-time-budget=8000 --dump-dom "$base#/$r" 2>$null | Out-String
  $expect = $routes[$r]
  if ($dom -match 'Something broke rendering') { "FAIL  $r  -> render threw"; $fails++ }
  elseif ($dom -match 'auth-card') { "FAIL  $r  -> stuck on the sign-in screen"; $fails++ }
  elseif ($dom -notmatch [regex]::Escape($expect)) { "FAIL  $r  -> missing '$expect'"; $fails++ }
  else { "ok    $r" }
}
""
if ($fails) { "RENDER FAILURES: $fails"; exit 1 } else { "ALL ROUTES RENDER" }
