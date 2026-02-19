"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAndSignSimpleNFCe = generateAndSignSimpleNFCe;
exports.loadCompanyCertBuffer = loadCompanyCertBuffer;
exports.sendAndPersist = sendAndPersist;
const path_1 = __importDefault(require("path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const generate_1 = require("./generate");
const sign_1 = require("./sign");
const config_1 = require("./config");
const validate_1 = require("./validate");
const soap_1 = require("./soap");
const axios_1 = __importDefault(require("axios"));
async function generateAndSignSimpleNFCe(example, options) {
    const cfg = (0, config_1.loadConfig)();
    const genResult = await (0, generate_1.generateNFCeXml)({ ...example });
    const xml = genResult.xml;
    const { chave44, tpAmb: genTpAmb, cscId: genCscId, csc: genCsc } = genResult;
    // If XSDs dir configured, attempt validation before signing
    try {
        if (cfg.xsdsDir) {
            // main NFe xsd filename may vary; try common name and report errors
            const xsdName = 'NFe_v4.00.xsd';
            const res = await (0, validate_1.validateXmlWithDir)(xml, cfg.xsdsDir, xsdName);
            if (!res.valid) {
                throw new Error('XML validation failed: ' + JSON.stringify(res.errors, null, 2));
            }
        }
    }
    catch (e) {
        // bubble up validation error
        throw new Error('XML validation step failed: ' + (e?.message || String(e)));
    }
    // read pfx and sign - support dynamic certificate per call (SAAS)
    let privateKeyPem;
    let certPem;
    let certB64;
    const password = options?.certPassword ?? cfg.certPassword;
    if (options?.certBuffer) {
        const r = (0, sign_1.readPfxFromBuffer)(options.certBuffer, password);
        privateKeyPem = r.privateKeyPem;
        certPem = r.certPem;
        certB64 = r.certB64;
    }
    else {
        const effectivePath = options?.certPath || cfg.certPath;
        const pfxPath = path_1.default.isAbsolute(effectivePath) ? effectivePath : path_1.default.join(process.cwd(), effectivePath);
        const r = (0, sign_1.readPfx)(pfxPath, password);
        privateKeyPem = r.privateKeyPem;
        certPem = r.certPem;
        certB64 = r.certB64;
    }
    let signed = (0, sign_1.signXml)(xml, privateKeyPem, certB64);
    // For NFC-e (mod 65), insert infNFeSupl with QR Code after signing
    const mod = example.mod || '65';
    if (mod === '65' && genCsc && genCscId) {
        const uf = example.uf || 'BA';
        const qrCodeUrl = (0, generate_1.buildNFCeQrCodeUrl)(chave44, genTpAmb, genCscId, genCsc, uf);
        const urlChave = (0, generate_1.getNFCeUrlChave)(genTpAmb, uf);
        signed = (0, generate_1.insertInfNFeSupl)(signed, qrCodeUrl, urlChave);
        console.log('[NFCe] QR Code URL:', qrCodeUrl);
    }
    else if (mod === '65') {
        console.warn('[NFCe] CSC/CSCId not provided - infNFeSupl will be missing. NFC-e may be rejected.');
    }
    // save signed XML to emitidas dir
    const dir = path_1.default.isAbsolute(cfg.xmlDirs.emitidas) ? cfg.xmlDirs.emitidas : path_1.default.join(process.cwd(), cfg.xmlDirs.emitidas);
    await fs_extra_1.default.mkdirp(dir);
    const filename = `nfe-${example.serie}-${example.nNF}-${Date.now()}.xml`;
    const outPath = path_1.default.join(dir, filename);
    await fs_extra_1.default.writeFile(outPath, signed, 'utf8');
    return { signedXml: signed, path: outPath };
}
exports.default = { generateAndSignSimpleNFCe };
/**
 * Helper: load company certificate file from a configured certs directory.
 * This is a simple example for SAAS where each company may have its own PFX
 * stored as <companyId>.pfx under the configured certsDir in config.json.
export async function sendSignedNFCe(signedXml: string, options?: { certBuffer?: Buffer; certPath?: string; certPassword?: string; environment?: 'homologation'|'production'; uf?: string }) {
  // delegate to soap.ts which will use mutual TLS with provided pfx
  const res = await sendNFCeToSefaz(signedXml, { certBuffer: options?.certBuffer, certPath: options?.certPath, certPassword: options?.certPassword, environment: options?.environment, uf: options?.uf })
  return res
}
 */
async function loadCompanyCertBuffer(companyId) {
    const cfg = (0, config_1.loadConfig)();
    if (!cfg || !('certsDir' in cfg))
        return null;
    const dir = cfg.certsDir;
    const p = path_1.default.isAbsolute(dir) ? path_1.default.join(dir, `${companyId}.pfx`) : path_1.default.join(process.cwd(), dir, `${companyId}.pfx`);
    try {
        if (await fs_extra_1.default.pathExists(p)) {
            return await fs_extra_1.default.readFile(p);
        }
        return null;
    }
    catch (e) {
        return null;
    }
}
/**
 * Send signed XML to SEFAZ and optionally persist the returned protocol to a backend
 * persistenceUrl: optional base URL of the delivery-saas-backend (ex: http://localhost:3000)
 * persistPayload: { companyId, orderId? }
 */
async function sendAndPersist(signedXml, sendOpts, persistenceOpts) {
    // Auto-detect mod from signed XML if not provided explicitly
    const modMatch = signedXml.match(/<mod>(\d+)<\/mod>/);
    const mod = sendOpts?.mod || (modMatch ? modMatch[1] : '65');
    const res = await (0, soap_1.sendNFCeToSefaz)(signedXml, { certBuffer: sendOpts?.certBuffer, certPath: sendOpts?.certPath, certPassword: sendOpts?.certPassword, environment: sendOpts?.environment, uf: sendOpts?.uf, mod, wsSecurity: true });
    // If persistence URL provided, call backend to save protocol
    if (persistenceOpts?.persistenceUrl && persistenceOpts?.companyId) {
        try {
            const url = `${persistenceOpts.persistenceUrl.replace(/\/$/, '')}/nfe/protocol`;
            const payload = {
                companyId: persistenceOpts.companyId,
                orderId: persistenceOpts.orderId || null,
                nProt: res.protocolo || null,
                cStat: res.cStat || null,
                xMotivo: res.xMotivo || null,
                rawXml: res.raw || null,
            };
            await axios_1.default.post(url, payload, { timeout: 10000 });
        }
        catch (err) {
            // don't throw — persistence failure should not hide SEFAZ response
            // eslint-disable-next-line no-console
            console.warn('Failed to persist NFe protocol to backend:', err.message);
        }
    }
    return res;
}
