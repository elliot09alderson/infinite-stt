Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\pratik\my\infinite-stt"
WshShell.Run """" & WshShell.CurrentDirectory & "\node_modules\.bin\electron.cmd"" .", 0, False
