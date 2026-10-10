$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $operation = [string]$inputData.operation
  $a = $inputData.args
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class DesktopNative {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder t, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT rect);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION data; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSE mouse; [FieldOffset(0)] public KEYBOARD keyboard; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSE { public int x,y; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBOARD { public ushort key,scan; public uint flags,time; public UIntPtr extra; }
  public static long[] Windows() { var items = new List<long>(); EnumWindows((h,l)=>{ if(IsWindowVisible(h)) items.Add(h.ToInt64()); return true; }, IntPtr.Zero); return items.ToArray(); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h,out p); return p; }
  public static string Title(IntPtr h) { var s = new StringBuilder(1024); GetWindowText(h,s,s.Capacity); return s.ToString(); }
  public static void Key(ushort key, ushort scan, uint flags) { var i = new INPUT(); i.type=1; i.data.keyboard.key=key; i.data.keyboard.scan=scan; i.data.keyboard.flags=flags; if(SendInput(1,new[]{i},Marshal.SizeOf(typeof(INPUT)))!=1) throw new Exception("Input unavailable"); }
  public static void Mouse(uint flags) { var i = new INPUT(); i.type=0; i.data.mouse.flags=flags; if(SendInput(1,new[]{i},Marshal.SizeOf(typeof(INPUT)))!=1) throw new Exception("Input unavailable"); }
}
'@
  [void][DesktopNative]::SetProcessDPIAware()
  function WindowInfo([IntPtr]$handle) {
    if ($handle -eq [IntPtr]::Zero) { return $null }
    $processId = [DesktopNative]::Pid($handle)
    $p = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (!$p) { return $null }
    return @{ processId = [int]$processId; processName = $p.ProcessName; windowTitle = [DesktopNative]::Title($handle); visible = [DesktopNative]::IsWindowVisible($handle) }
  }
  function Windows {
    foreach ($h in [DesktopNative]::Windows()) { $w = WindowInfo ([IntPtr]$h); if ($w -and $w.windowTitle) { $w } }
  }
  function AssertControl {
    if ($env:COMPUTER_CONTROL_ENABLED -cne 'true') { throw 'Control locked' }
  }
  function ConfiguredOperatorPaths {
    $names = @(
      'FREEOS_OPERATOR_BLENDER_EXE','FREEOS_OPERATOR_PREMIERE_EXE','FREEOS_OPERATOR_AFTER_EFFECTS_EXE','FREEOS_OPERATOR_PHOTOSHOP_EXE','FREEOS_OPERATOR_LIGHTROOM_EXE',
      'FREEOS_OPERATOR_UNITY_EXE','FREEOS_OPERATOR_UNREAL_EXE','FREEOS_OPERATOR_COMFYUI_EXE','FREEOS_OPERATOR_OBS_EXE','FREEOS_OPERATOR_VSCODE_EXE'
    )
    $paths = @()
    foreach ($name in $names) {
      $value = [Environment]::GetEnvironmentVariable($name)
      if ($value) { $paths += [IO.Path]::GetFullPath($value) }
    }
    return $paths
  }
  function Target {
    AssertControl
    $p = Get-Process -Id ([int]$a.processId) -ErrorAction Stop
    $path = $p.Path
    if (!$path) { throw 'Target path unavailable' }
    $blockedNames = @('cmd','powershell','pwsh','WindowsTerminal','wt','regedit','wscript','cscript','mshta','rundll32','explorer','chrome','msedge','firefox','brave','opera')
    if ($p.ProcessName -in $blockedNames) { throw 'Target application class is not allowed through Computer Operator' }
    $benign = @(
      (Join-Path $env:SystemRoot 'System32\notepad.exe'),
      (Join-Path $env:SystemRoot 'System32\calc.exe'),
      (Join-Path $env:SystemRoot 'System32\mspaint.exe')
    )
    $operatorPaths = @(ConfiguredOperatorPaths)
    $allowed = @($benign + $operatorPaths | Where-Object { $_ -and ([string]::Equals([IO.Path]::GetFullPath($_), [IO.Path]::GetFullPath($path), [StringComparison]::OrdinalIgnoreCase)) }).Count -gt 0
    if (!$allowed) { throw 'Target application is not an approved production operator' }
    $h = $p.MainWindowHandle
    if ($h -eq [IntPtr]::Zero -or ![DesktopNative]::IsWindowVisible($h)) { throw 'Target has no visible main window' }
    return $h
  }
  function AssertForeground([IntPtr]$handle) {
    AssertControl
    if ([DesktopNative]::GetForegroundWindow() -ne $handle) { throw 'Target is not the active main window; approve a focus action first' }
  }
  switch ($operation) {
    'status' {
      $monitors = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { @{ name=$_.DeviceName; primary=$_.Primary; x=$_.Bounds.X; y=$_.Bounds.Y; width=$_.Bounds.Width; height=$_.Bounds.Height } })
      $primary = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
      $result = @{ monitors=$monitors; primaryResolution=@{width=$primary.Width;height=$primary.Height}; virtualBounds=@{x=$bounds.X;y=$bounds.Y;width=$bounds.Width;height=$bounds.Height}; activeWindow=(WindowInfo ([DesktopNative]::GetForegroundWindow())); visibleWindowCount=@(Windows).Count; processCount=@(Get-Process).Count }
    }
    'windows' { $result = @{ windows=@(Windows) } }
    'active' { $result = @{ activeWindow=(WindowInfo ([DesktopNative]::GetForegroundWindow())) } }
    'processes' { $result = @{ processes=@(Get-Process | ForEach-Object { @{pid=$_.Id; processName=$_.ProcessName; mainWindowTitle=$_.MainWindowTitle} }) } }
    'capture' {
      if ($env:COMPUTER_SCREEN_CAPTURE_ENABLED -cne 'true') { throw 'Capture locked' }
      $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
      $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
      try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try { $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size) } finally { $graphics.Dispose() }
        $bitmap.Save([string]$a.path, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally { $bitmap.Dispose() }
      $result = @{width=$bounds.Width;height=$bounds.Height}
    }
    'focus' { $h = Target; if (![DesktopNative]::SetForegroundWindow($h)) { throw 'Windows refused foreground focus' }; AssertForeground $h; $result=@{focused=$true;processId=$a.processId} }
    { $_ -in @('move','click') } {
      $h = Target; AssertForeground $h
      $point = New-Object DesktopNative+POINT; $point.X=[int]$a.x; $point.Y=[int]$a.y
      $inside = @([System.Windows.Forms.Screen]::AllScreens | Where-Object { $_.Bounds.Contains($point.X,$point.Y) }).Count -gt 0
      if (!$inside) { throw 'Coordinates are outside current monitor bounds' }
      if ($operation -eq 'click' -and [DesktopNative]::GetAncestor([DesktopNative]::WindowFromPoint($point),2) -ne $h) { throw 'Click must target the approved active main window' }
      if (![DesktopNative]::SetCursorPos($point.X,$point.Y)) { throw 'Cursor move failed' }
      if ($operation -eq 'click') {
        $count = 1; if ($a.button -eq 'double') { $count=2 }
        for ($i=0; $i -lt $count; $i++) {
          AssertForeground $h
          if ([DesktopNative]::GetAncestor([DesktopNative]::WindowFromPoint($point),2) -ne $h) { throw 'Click target changed' }
          $down=2; $up=4; if ($a.button -eq 'right') { $down=8; $up=16 }
          try { [DesktopNative]::Mouse($down) } finally { [DesktopNative]::Mouse($up) }
        }
      }
      $result=@{completed=$true;processId=$a.processId;x=$a.x;y=$a.y}
    }
    'type' {
      $h = Target; AssertForeground $h
      foreach ($ch in ([string]$a.text).ToCharArray()) {
        AssertForeground $h
        try { [DesktopNative]::Key(0,[ushort]$ch,4) } finally { [DesktopNative]::Key(0,[ushort]$ch,6) }
      }
      $result=@{typedCharacters=([string]$a.text).Length;processId=$a.processId}
    }
    { $_ -in @('press','hotkey') } {
      $h = Target; AssertForeground $h
      $keys=@{Tab=9;Enter=13;Escape=27;Left=37;Right=39;Up=38;Down=40;Home=36;End=35;PageUp=33;PageDown=34;Backspace=8;Space=32;CTRL=17;SHIFT=16;A=65;C=67;S=83;O=79;Z=90;Y=89;F=70}
      $names=@([string]$a.key); if ($operation -eq 'hotkey') { $names=([string]$a.hotkey).Split('+') }
      $pressed=New-Object 'System.Collections.Generic.List[ushort]'
      try { foreach ($name in $names) { AssertForeground $h; if (!$keys.ContainsKey($name)) { throw 'Key blocked' }; $code=[ushort]$keys[$name]; $pressed.Add($code); [DesktopNative]::Key($code,0,0) } }
      finally { for ($i=$pressed.Count-1;$i -ge 0;$i--) { [DesktopNative]::Key($pressed[$i],0,2) } }
      $result=@{completed=$true;processId=$a.processId}
    }
    default { throw 'Unknown operation' }
  }
  @{ok=$true;result=$result} | ConvertTo-Json -Depth 8 -Compress
} catch {
  # Never return native exception text: it can include typed text or local secrets.
  @{ok=$false;error='Windows operation refused or unavailable. Check the target, desktop session, bounds, and policy.'} | ConvertTo-Json -Compress
  exit 1
}
