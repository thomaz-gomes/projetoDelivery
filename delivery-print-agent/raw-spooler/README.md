# Raw Spooler Helper

This is a small .NET console helper that sends a file's raw bytes directly to a Windows printer using the Win32 spooler API (RAW data type). Useful to send ESC/POS byte sequences to a thermal printer.

## Build (requires .NET SDK)

Open PowerShell in this folder and run:

```powershell
# create a publish single-file exe for Windows x64
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o ./publish
```

The resulting executable will be in `./publish/raw-spooler.exe` (name depends on project assembly name).

## Usage

```powershell
# from delivery-print-agent folder (example)
raw-spooler\publish\raw-spooler.exe "Print iD" "C:\path\to\file.bin"
```

Return codes:
- 0: success
- non-zero: error (check stderr for details)

Notes:
- This program must run on Windows and requires permission to access the specified printer.
- It sends the file bytes as-is with data type RAW (suitable for ESC/POS sequences).
