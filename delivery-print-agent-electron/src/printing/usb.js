'use strict';
/**
 * Impressão USB/Windows via RAW Spooler.
 *
 * Usa a API winspool.drv via PowerShell + P/Invoke (.NET inline) para enviar
 * bytes ESC/POS DIRETAMENTE para a fila de impressão do Windows.
 *
 * Vantagens:
 *  - Nenhum diálogo de impressão aparece
 *  - Funciona com qualquer driver (Generic/Text Only é o recomendado)
 *  - Sem dependências de pacotes nativos
 *
 * Pré-requisito no cliente:
 *  - Impressora instalada no Windows com nome exato igual a printer.windowsPrinterName
 *  - Driver "Generic / Text Only" ou driver específico da impressora
 *    (ambos aceitam dados RAW)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../logger');

/**
 * @param {object} printer  - { windowsPrinterName, ... }
 * @param {Buffer} data     - Bytes ESC/POS
 */
async function print(printer, data) {
  const printerName = printer.windowsPrinterName;
  if (!printerName) throw new Error('windowsPrinterName não configurado');

  // Salva bytes em arquivo temporário
  const tmpFile = path.join(os.tmpdir(), `escpos_${Date.now()}_${process.pid}.prn`);
  fs.writeFileSync(tmpFile, data);

  logger.info(`[usb] Enviando ${data.length} bytes para "${printerName}" via Windows RAW Spooler`);

  try {
    await _printRaw(printerName, tmpFile);
    logger.info(`[usb] Enviado com sucesso para "${printerName}"`);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

// ─── Implementação PowerShell RAW ─────────────────────────────────────────────
function _printRaw(printerName, dataFile) {
  return new Promise((resolve, reject) => {
    // Escapa aspas no nome da impressora para PowerShell
    const safeName = printerName.replace(/'/g, "''");
    const safeFile = dataFile.replace(/\\/g, '\\\\');

    const ps = `
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public struct DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
}

public class RawPrint {
    [DllImport("winspool.drv", EntryPoint="OpenPrinterA", SetLastError=true)]
    public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr def);

    [DllImport("winspool.drv", EntryPoint="ClosePrinter", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr handle);

    [DllImport("winspool.drv", EntryPoint="StartDocPrinterA", SetLastError=true)]
    public static extern Int32 StartDocPrinter(IntPtr handle, Int32 level, ref DOCINFOA info);

    [DllImport("winspool.drv", EntryPoint="EndDocPrinter", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr handle);

    [DllImport("winspool.drv", EntryPoint="StartPagePrinter", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr handle);

    [DllImport("winspool.drv", EntryPoint="EndPagePrinter", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr handle);

    [DllImport("winspool.drv", EntryPoint="WritePrinter", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr handle, IntPtr pBytes, Int32 count, out Int32 written);
}
"@ -Language CSharp

$printerName = '${safeName}'
$dataFile    = '${safeFile}'

$hPrinter = [IntPtr]::Zero
if (-not [RawPrint]::OpenPrinter($printerName, [ref]$hPrinter, [IntPtr]::Zero)) {
    throw "OpenPrinter falhou para '$printerName' (erro Win32: $([ComponentModel.Win32Exception]::new().Message))"
}

$di = New-Object DOCINFOA
$di.pDocName   = 'ESC/POS Job'
$di.pOutputFile = $null
$di.pDataType  = 'RAW'

$jobId = [RawPrint]::StartDocPrinter($hPrinter, 1, [ref]$di)
if ($jobId -le 0) { [RawPrint]::ClosePrinter($hPrinter); throw "StartDocPrinter falhou" }

[RawPrint]::StartPagePrinter($hPrinter) | Out-Null

$bytes   = [System.IO.File]::ReadAllBytes($dataFile)
$hGlobal = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $hGlobal, $bytes.Length)
$written = 0
$ok = [RawPrint]::WritePrinter($hPrinter, $hGlobal, $bytes.Length, [ref]$written)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($hGlobal)

[RawPrint]::EndPagePrinter($hPrinter) | Out-Null
[RawPrint]::EndDocPrinter($hPrinter)  | Out-Null
[RawPrint]::ClosePrinter($hPrinter)   | Out-Null

if (-not $ok) { throw "WritePrinter falhou ($written bytes escritos)" }
Write-Host "OK:$written"
`;

    const proc = spawn('powershell', [
      '-NonInteractive', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps,
    ]);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const msg = stderr.trim() || stdout.trim() || `PowerShell saiu com código ${code}`;
        reject(new Error(`[usb] Falha ao imprimir: ${msg}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`[usb] Erro ao iniciar PowerShell: ${err.message}`));
    });
  });
}

module.exports = { print };
