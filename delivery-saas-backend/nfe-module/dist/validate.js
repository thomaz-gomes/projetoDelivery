"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateXmlAgainstXsd = validateXmlAgainstXsd;
exports.validateXmlWithDir = validateXmlWithDir;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Validate an XML string against an XSD file. Returns validation result with errors if any.
 * @param xmlString XML content as string
 * @param xsdPath Path to XSD file
 */
async function validateXmlAgainstXsd(xmlString, xsdPath) {
    // lazy import to avoid requiring native build on install
    let libxmljs;
    try {
        libxmljs = await Promise.resolve().then(() => __importStar(require('libxmljs2')));
    }
    catch (err) {
        throw new Error('libxmljs2 is not installed or could not be loaded. To enable XSD validation install libxmljs2 (requires native build tools on Windows) or disable xsdsDir in config.json');
    }
    if (!fs_1.default.existsSync(xsdPath)) {
        throw new Error(`XSD not found: ${xsdPath}`);
    }
    const xsdRaw = fs_1.default.readFileSync(xsdPath, 'utf8');
    const xmlDoc = libxmljs.parseXml(xmlString);
    const xsdDoc = libxmljs.parseXml(xsdRaw);
    const valid = xmlDoc.validate(xsdDoc);
    const errors = (xmlDoc.validationErrors || []).map((e) => ({ line: e.line, column: e.column, message: String(e.message).trim() }));
    return { valid: Boolean(valid), errors };
}
/**
 * Helper to validate using a directory of XSDs by name. For NFC-e v4.00 the main
 * schema may be named 'NFe_v4.00.xsd' or similar depending on SEFAZ distribution.
 */
async function validateXmlWithDir(xmlString, xsdsDir, xsdFileName) {
    const candidate = path_1.default.isAbsolute(xsdsDir) ? path_1.default.join(xsdsDir, xsdFileName) : path_1.default.join(process.cwd(), xsdsDir, xsdFileName);
    return validateXmlAgainstXsd(xmlString, candidate);
}
