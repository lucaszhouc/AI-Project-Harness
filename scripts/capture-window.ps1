param(
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$WindowTitle = "AI Project Harness",
  [int]$Width = 0,
  [int]$Height = 0
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AphWindowCapture {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
}
"@

$process = Get-Process | Where-Object { $_.ProcessName -eq "electron" -and $_.MainWindowTitle -like "*$WindowTitle*" } | Select-Object -First 1
if (-not $process) { throw "Window not found: $WindowTitle" }

[AphWindowCapture]::ShowWindow($process.MainWindowHandle, 9) | Out-Null
[AphWindowCapture]::SetWindowPos($process.MainWindowHandle, [IntPtr](-1), 0, 0, 0, 0, 0x43) | Out-Null
[AphWindowCapture]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 250
$rect = New-Object AphWindowCapture+RECT
[AphWindowCapture]::GetWindowRect($process.MainWindowHandle, [ref]$rect) | Out-Null
if ($Width -gt 0 -and $Height -gt 0) {
  [AphWindowCapture]::MoveWindow($process.MainWindowHandle, 20, 20, $Width, $Height, $true) | Out-Null
  Start-Sleep -Milliseconds 350
  [AphWindowCapture]::GetWindowRect($process.MainWindowHandle, [ref]$rect) | Out-Null
}
[AphWindowCapture]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 200

$captureWidth = $rect.Right - $rect.Left
$captureHeight = $rect.Bottom - $rect.Top
if ($captureWidth -le 0 -or $captureHeight -le 0) { throw "Invalid window bounds" }
$dpi = [AphWindowCapture]::GetDpiForWindow($process.MainWindowHandle)
if ($dpi -le 0) { $dpi = 96 }
[int]$pixelWidth = [Math]::Round($captureWidth * $dpi / 96)
[int]$pixelHeight = [Math]::Round($captureHeight * $dpi / 96)

$directory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$bitmap = New-Object System.Drawing.Bitmap($pixelWidth, $pixelHeight)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$printed = [AphWindowCapture]::PrintWindow($process.MainWindowHandle, $hdc, 2)
$graphics.ReleaseHdc($hdc)
if (-not $printed) { throw "PrintWindow failed" }
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
[AphWindowCapture]::SetWindowPos($process.MainWindowHandle, [IntPtr](-2), 0, 0, 0, 0, 0x43) | Out-Null

"CAPTURED=$OutputPath"
"SIZE=${pixelWidth}x${pixelHeight}"
"DPI=$dpi"
