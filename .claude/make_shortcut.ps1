$desktop = [Environment]::GetFolderPath('Desktop')
$target = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\index.html"
$workDir = "C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站"
$shortcutPath = Join-Path $desktop "坐忘茗舍网站预览.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = $target
$Shortcut.WorkingDirectory = $workDir
$Shortcut.Description = "坐忘茗舍网站首页预览"
$Shortcut.Save()

Write-Output "Created: $shortcutPath"
Test-Path $shortcutPath
