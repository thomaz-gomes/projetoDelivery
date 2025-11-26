using System;
using System.IO;
using System.Runtime.InteropServices;

class RawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, ref DOCINFO pDocInfo);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    static int Main(string[] args)
    {
        try
        {
            if (args.Length < 2)
            {
                Console.Error.WriteLine("Usage: raw-print.exe <Printer Name> <FilePath>");
                return 2;
            }

            string printerName = args[0];
            string filePath = args[1];

            if (!File.Exists(filePath))
            {
                Console.Error.WriteLine("File not found: " + filePath);
                return 3;
            }

            byte[] bytes = File.ReadAllBytes(filePath);

            if (bytes == null || bytes.Length == 0)
            {
                Console.Error.WriteLine("File empty");
                return 4;
            }

            IntPtr pUnmanagedBytes = IntPtr.Zero;
            IntPtr hPrinter = IntPtr.Zero;

            if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            {
                Console.Error.WriteLine("OpenPrinter failed for: " + printerName);
                return 5;
            }

            DOCINFO di = new DOCINFO();
            di.pDocName = "RawPrintJob";
            di.pDataType = "RAW";

            if (!StartDocPrinter(hPrinter, 1, ref di))
            {
                ClosePrinter(hPrinter);
                Console.Error.WriteLine("StartDocPrinter failed");
                return 6;
            }

            if (!StartPagePrinter(hPrinter))
            {
                EndDocPrinter(hPrinter);
                ClosePrinter(hPrinter);
                Console.Error.WriteLine("StartPagePrinter failed");
                return 7;
            }

            try
            {
                pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);

                int dwWritten = 0;
                bool bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);

                if (!bSuccess || dwWritten != bytes.Length)
                {
                    Console.Error.WriteLine($"WritePrinter failed or incomplete. Written={dwWritten} Expected={bytes.Length}");
                    return 8;
                }
            }
            finally
            {
                if (pUnmanagedBytes != IntPtr.Zero) Marshal.FreeCoTaskMem(pUnmanagedBytes);
                EndPagePrinter(hPrinter);
                EndDocPrinter(hPrinter);
                ClosePrinter(hPrinter);
            }

            Console.WriteLine("RAW print sent successfully to printer: " + printerName);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Exception: " + ex.ToString());
            return 99;
        }
    }
}
