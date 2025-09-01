# PowerShell Mouse Control Script for RemoteDesk
param(
    [string]$action,
    [int]$x,
    [int]$y,
    [string]$button,
    [switch]$double
)

# Add Windows Forms assembly for mouse control
Add-Type -AssemblyName System.Windows.Forms

function Move-Mouse {
    param([int]$x, [int]$y)
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
}

function Click-Mouse {
    param([string]$button, [switch]$double)
    $mouseButton = switch ($button) {
        "left" { [System.Windows.Forms.MouseButtons]::Left }
        "right" { [System.Windows.Forms.MouseButtons]::Right }
        "middle" { [System.Windows.Forms.MouseButtons]::Middle }
        default { [System.Windows.Forms.MouseButtons]::Left }
    }

    if ($double) {
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Start-Sleep -Milliseconds 50
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    } else {
        switch ($button) {
            "left" { [System.Windows.Forms.SendKeys]::SendWait("{LEFTCLICK}") }
            "right" { [System.Windows.Forms.SendKeys]::SendWait("+{F10}") }
            "middle" { [System.Windows.Forms.SendKeys]::SendWait("{MBUTTON}") }
        }
    }
}

function Toggle-Mouse {
    param([string]$button, [string]$state)
    # This is a simplified implementation
    # For more advanced mouse button holding, we'd need more complex Win32 API calls
    Click-Mouse -button $button
}

function Scroll-Mouse {
    param([int]$deltaX, [int]$deltaY)
    # PowerShell doesn't have direct scroll support, so we'll simulate wheel events
    if ($deltaY -gt 0) {
        # Scroll up
        for ($i = 0; $i -lt [Math]::Abs($deltaY); $i++) {
            [System.Windows.Forms.SendKeys]::SendWait("{WHEELUP}")
        }
    } elseif ($deltaY -lt 0) {
        # Scroll down
        for ($i = 0; $i -lt [Math]::Abs($deltaY); $i++) {
            [System.Windows.Forms.SendKeys]::SendWait("{WHEELDOWN}")
        }
    }
}

function Get-ScreenSize {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    return @{
        width = $bounds.Width
        height = $bounds.Height
    }
}

# Main execution logic
try {
    switch ($action) {
        "move" {
            Move-Mouse -x $x -y $y
        }
        "click" {
            Click-Mouse -button $button -double:$double
        }
        "toggle" {
            Toggle-Mouse -button $button -state $button
        }
        "scroll" {
            Scroll-Mouse -deltaX $x -deltaY $y
        }
        "screensize" {
            $size = Get-ScreenSize
            Write-Output ($size | ConvertTo-Json -Compress)
        }
        default {
            Write-Error "Unknown action: $action"
            exit 1
        }
    }
} catch {
    Write-Error "Mouse control error: $($_.Exception.Message)"
    exit 1
}

