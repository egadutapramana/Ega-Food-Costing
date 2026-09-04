Set objShell = CreateObject("WScript.Shell")
objShell.CurrentDirectory = "C:\Users\asuse\OneDrive\Documents\Food-Cost- App\backend"
objShell.Run "cmd /c node server.js", 0, False
