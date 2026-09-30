# Read the text off flyer images using Windows' built-in OCR.
#
#   powershell -File tools\ocr-flyers.ps1 -In .tmp\ocr -Out .tmp\ocr\text.json
#
# WHY THIS EXISTS
#
# The lead batches are Google Docs of screenshots with no text in them at
# all, and reading them by eye is the accurate way. This is the fallback for
# when that is not available - the flyers still have to be turned into leads,
# and every Windows machine already has an OCR engine sitting in WinRT with
# nothing to install.
#
# It is a fallback and not the default on purpose: these are designed flyers
# with text set over photographs in display faces, and OCR reads a phone
# number reliably while making a mess of a stylised logo. What comes out
# needs a human or a model to decide what is a business name and what is a
# tagline.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = 'Stop'

# WinRT types are not loadable by Add-Type; they come in through the
# projection, which needs one reference per assembly before first use.
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]

# PowerShell 5.1 cannot await an IAsyncOperation on its own.
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1

function Await($op, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(60000) | Out-Null
  $task.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {
  throw 'No OCR language pack is installed for this user profile.'
}
"engine language: $($engine.RecognizerLanguage.DisplayName)"

$results = @{}
$files = Get-ChildItem -Path $In -Filter *.png | Sort-Object Name
"reading $($files.Count) images"

foreach ($f in $files) {
  $file    = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($f.FullName)) ([Windows.Storage.StorageFile])
  $stream  = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap  = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $ocr     = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

  # Line by line rather than the flat Text property, because the line breaks
  # are most of what tells a phone number from an address on a flyer.
  $lines = @()
  foreach ($l in $ocr.Lines) { $lines += $l.Text }
  $results[$f.BaseName] = $lines

  $stream.Dispose()
  $bitmap.Dispose()
  "  $($f.BaseName): $($lines.Count) lines"
}

$results | ConvertTo-Json -Depth 4 | Out-File -Encoding utf8 $Out
"written to $Out"
