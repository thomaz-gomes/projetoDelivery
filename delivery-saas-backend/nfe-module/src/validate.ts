import fs from 'fs'
import path from 'path'

// libxmljs2 is an optional native dependency (requires build tools on Windows).
// We import it dynamically when validation is requested and provide a clear
// error message if it's not installed.

export type ValidationResult = {
  valid: boolean
  errors: Array<{ line?: number; column?: number; message: string }>
}

/**
 * Validate an XML string against an XSD file. Returns validation result with errors if any.
 * @param xmlString XML content as string
 * @param xsdPath Path to XSD file
 */
export async function validateXmlAgainstXsd(xmlString: string, xsdPath: string): Promise<ValidationResult> {
  // lazy import to avoid requiring native build on install
  let libxmljs: any
  try {
    libxmljs = await import('libxmljs2')
  } catch (err) {
    throw new Error('libxmljs2 is not installed or could not be loaded. To enable XSD validation install libxmljs2 (requires native build tools on Windows) or disable xsdsDir in config.json')
  }

  if (!fs.existsSync(xsdPath)) {
    throw new Error(`XSD not found: ${xsdPath}`)
  }
  const xsdRaw = fs.readFileSync(xsdPath, 'utf8')
  const xmlDoc = libxmljs.parseXml(xmlString)
  const xsdDoc = libxmljs.parseXml(xsdRaw)
  const valid = xmlDoc.validate(xsdDoc)
  const errors = (xmlDoc.validationErrors || []).map((e: any) => ({ line: e.line, column: e.column, message: String(e.message).trim() }))
  return { valid: Boolean(valid), errors }
}

/**
 * Helper to validate using a directory of XSDs by name. For NFC-e v4.00 the main
 * schema may be named 'NFe_v4.00.xsd' or similar depending on SEFAZ distribution.
 */
export async function validateXmlWithDir(xmlString: string, xsdsDir: string, xsdFileName: string): Promise<ValidationResult> {
  const candidate = path.isAbsolute(xsdsDir) ? path.join(xsdsDir, xsdFileName) : path.join(process.cwd(), xsdsDir, xsdFileName)
  return validateXmlAgainstXsd(xmlString, candidate)
}
