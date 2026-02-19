"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendNFCeToSefaz = sendNFCeToSefaz;
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
const fs_1 = __importDefault(require("fs"));
const xml2js_1 = require("xml2js");
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const sign_1 = require("./sign");
const xml_crypto_1 = require("xml-crypto");
// Stable WS-Security token id used in BinarySecurityToken and SecurityTokenReference
const WSSEC_TOKEN_ID = 'X509-Token';
/**
 * Build a SOAP 1.2 envelope for NFe/NFC-e Autorizacao.
 * mod='55' → NFeAutorizacao4 namespace (NF-e)
 * mod='65' → NfceAutorizacao4 namespace by default, but if the endpoint URL uses
 *             NFeAutorizacao4 (e.g. SVRS states like BA), that namespace is used instead.
 */
function buildAutorizacaoEnvelope(signedXml, mod = '65', headerXml, endpoint) {
    const lote = Date.now().toString();
    const useNfeNs = mod === '55' || (!!endpoint && /NFeAutorizacao/i.test(endpoint));
    const ns = useNfeNs
        ? 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4'
        : 'http://www.portalfiscal.inf.br/nfe/wsdl/NfceAutorizacao4';
    // Strip XML declaration from signedXml before embedding (SEFAZ rejects it inside SOAP body)
    const innerXml = signedXml.trim().replace(/^<\?xml[^?]*\?>\s*/i, '');
    // enviNFe must have NO whitespace between tags (SEFAZ cStat 588 otherwise)
    return `<?xml version="1.0" encoding="UTF-8"?>\n<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">\n  <soap12:Header>${headerXml || ''}</soap12:Header>\n  <soap12:Body>\n    <nfeDadosMsg xmlns="${ns}"><enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>${lote}</idLote><indSinc>1</indSinc>${innerXml}</enviNFe></nfeDadosMsg>\n  </soap12:Body>\n</soap12:Envelope>`;
}
function buildWsSecurityHeader(certB64) {
    const created = new Date().toISOString();
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    return `<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">\n    <wsu:Timestamp wsu:Id="TS-${Date.now()}">\n      <wsu:Created>${created}</wsu:Created>\n      <wsu:Expires>${expires}</wsu:Expires>\n    </wsu:Timestamp>\n    <wsse:BinarySecurityToken EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" wsu:Id="${WSSEC_TOKEN_ID}">\n      ${certB64}\n    </wsse:BinarySecurityToken>\n  </wsse:Security>`;
}
/**
 * Send signed NFC-e XML to SEFAZ Authorization endpoint using SOAP 1.2 with mutual TLS.
 * Supports providing PFX as buffer or file path. Returns parsed XML response.
 */
async function sendNFCeToSefaz(signedXml, opts = {}) {
    const cfg = (0, config_1.loadConfig)();
    const env = opts.environment || cfg.environment || 'homologation';
    const uf = (opts.uf || 'ba').toLowerCase();
    // Auto-detect mod from XML if not provided (look for <mod>65</mod>)
    let mod = opts.mod || '65';
    if (!opts.mod) {
        const modMatch = signedXml.match(/<mod>(\d+)<\/mod>/);
        if (modMatch)
            mod = modMatch[1];
    }
    // resolve endpoint from config.sefaz
    const sefazCfg = (cfg.sefaz && cfg.sefaz[uf]) || null;
    if (!sefazCfg)
        throw new Error(`SEFAZ config for UF '${uf}' not found in config.json`);
    // Use NFC-e endpoint (nfce) when mod=65, fallback to NF-e endpoint (nfe)
    const endpointKey = mod === '55' ? 'nfe' : 'nfce';
    const endpoint = (sefazCfg[env] && (sefazCfg[env][endpointKey] || sefazCfg[env].nfe));
    if (!endpoint)
        throw new Error(`${endpointKey.toUpperCase()} endpoint for UF '${uf}' environment '${env}' not configured`);
    // SOAP action: use NFeAutorizacao4 when endpoint uses that service (e.g. SVRS/BA for NFC-e)
    const useNfeAction = mod === '55' || /NFeAutorizacao/i.test(endpoint);
    const soapAction = useNfeAction
        ? 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote'
        : 'http://www.portalfiscal.inf.br/nfe/wsdl/NfceAutorizacao4/nfceAutorizacaoLote';
    const envelope = buildAutorizacaoEnvelope(signedXml, mod, undefined, endpoint);
    // optionally build WS-Security header and/or sign SOAP body
    let headerXml;
    if (opts.wsSecurity) {
        // obtain cert (base64) to include
        let certB64;
        let privateKeyPem;
        if (opts.certBuffer) {
            const info = (0, sign_1.readPfxFromBuffer)(opts.certBuffer, opts.certPassword ?? '');
            certB64 = info.certB64;
            privateKeyPem = info.privateKeyPem;
        }
        else if (opts.certPath) {
            const info = (0, sign_1.readPfx)(opts.certPath, opts.certPassword ?? '');
            certB64 = info.certB64;
            privateKeyPem = info.privateKeyPem;
        }
        else if (cfg.certPath) {
            const p = path_1.default.isAbsolute(cfg.certPath) ? cfg.certPath : path_1.default.join(process.cwd(), cfg.certPath);
            if (fs_1.default.existsSync(p)) {
                const info = (0, sign_1.readPfx)(p, opts.certPassword ?? cfg.certPassword ?? '');
                certB64 = info.certB64;
                privateKeyPem = info.privateKeyPem;
            }
        }
        if (certB64) {
            headerXml = buildWsSecurityHeader(certB64);
            // if signing is requested, attempt to sign the SOAP Body and insert Signature under wsse:Security
            if (opts.signSoap && privateKeyPem) {
                try {
                    // build envelope with header so signature references the Body
                    const envWithHeader = buildAutorizacaoEnvelope(signedXml, mod, headerXml, endpoint);
                    const sig = new xml_crypto_1.SignedXml();
                    sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
                    // reference SOAP Body
                    sig.addReference("//*[local-name(.)='Body']", ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'], 'http://www.w3.org/2000/09/xmldsig#sha1');
                    sig.signingKey = privateKeyPem;
                    // include SecurityTokenReference that points to BinarySecurityToken
                    sig.keyInfoProvider = {
                        getKeyInfo: function () {
                            return `<wsse:SecurityTokenReference xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><wsse:Reference URI="#${WSSEC_TOKEN_ID}" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"/></wsse:SecurityTokenReference>`;
                        }
                    };
                    sig.computeSignature(envWithHeader);
                    const signedFull = sig.getSignedXml();
                    // extract <Signature...>...</Signature>
                    const m = signedFull.match(/<Signature[\s\S]*?<\/Signature>/);
                    if (m) {
                        const signatureXml = m[0];
                        // insert signatureXml before closing </wsse:Security>
                        headerXml = headerXml.replace('</wsse:Security>', `${signatureXml}</wsse:Security>`);
                    }
                }
                catch (err) {
                    // continue without SOAP signature but log
                    // eslint-disable-next-line no-console
                    console.warn('SOAP signing failed (continuing without signature):', err.message);
                }
            }
        }
    }
    const envelopeWithHeader = buildAutorizacaoEnvelope(signedXml, mod, headerXml, endpoint);
    // Build HTTPS agent with client certificate (mutual TLS) if provided.
    // Use node-forge to extract PEM key+cert from PFX instead of passing the raw
    // PFX buffer to Node's https.Agent — Node.js 17+ uses OpenSSL 3.0 which
    // rejects legacy PKCS12 encryption (RC2/DES) commonly used by Brazilian CAs.
    let httpsAgent;
    if (opts.certBuffer || opts.certPath || cfg.certPath) {
        const passphrase = opts.certPassword ?? cfg.certPassword ?? '';
        let pfxBuf;
        if (opts.certBuffer)
            pfxBuf = opts.certBuffer;
        else {
            const cp = opts.certPath || cfg.certPath;
            const p = path_1.default.isAbsolute(cp) ? cp : path_1.default.join(process.cwd(), cp);
            if (!fs_1.default.existsSync(p))
                throw new Error(`Certificate file not found: ${p}`);
            pfxBuf = fs_1.default.readFileSync(p);
        }
        try {
            // Extract PEM via node-forge (handles legacy PKCS12 algorithms)
            const pemInfo = opts.certBuffer
                ? (0, sign_1.readPfxFromBuffer)(pfxBuf, passphrase)
                : (opts.certPath ? (0, sign_1.readPfx)(opts.certPath, passphrase) : (0, sign_1.readPfx)(cfg.certPath, passphrase));
            httpsAgent = new https_1.default.Agent({
                key: pemInfo.privateKeyPem,
                cert: pemInfo.certPem,
                rejectUnauthorized: false
            });
        }
        catch (forgeErr) {
            // Fallback: try raw PFX in case the cert uses modern algorithms
            // eslint-disable-next-line no-console
            console.warn('node-forge PFX extraction failed, falling back to raw PFX:', forgeErr.message);
            httpsAgent = new https_1.default.Agent({ pfx: pfxBuf, passphrase, rejectUnauthorized: false });
        }
    }
    const headers = {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"`
    };
    const res = await axios_1.default.post(endpoint, envelopeWithHeader, { headers, httpsAgent, timeout: 60000 });
    const text = typeof res.data === 'string' ? res.data : res.data.toString();
    // persist raw response to disk if configured
    try {
        const xmlDirs = cfg.xmlDirs || {};
        const retornoDir = xmlDirs.retorno ? (path_1.default.isAbsolute(xmlDirs.retorno) ? xmlDirs.retorno : path_1.default.join(process.cwd(), xmlDirs.retorno)) : null;
        if (retornoDir) {
            fs_1.default.mkdirSync(retornoDir, { recursive: true });
            const fname = `sefaz_response_${(new Date()).toISOString().replace(/[:.]/g, '-')}.xml`;
            fs_1.default.writeFileSync(path_1.default.join(retornoDir, fname), text, 'utf8');
        }
    }
    catch (err) {
        // don't fail on save errors
        // eslint-disable-next-line no-console
        console.warn('Failed to save SEFAZ response to disk:', err.message);
    }
    // parse XML response
    const parsed = await (0, xml2js_1.parseStringPromise)(text, { explicitArray: false, ignoreAttrs: false });
    // try to locate protocol info (protNFe / infProt) and return a concise summary
    function findKey(o, key) {
        if (!o || typeof o !== 'object')
            return null;
        if (key in o)
            return o[key];
        for (const k of Object.keys(o)) {
            const res = findKey(o[k], key);
            if (res)
                return res;
        }
        return null;
    }
    const protNFe = findKey(parsed, 'protNFe') || findKey(parsed, 'protNFe');
    const infProt = protNFe ? (protNFe.infProt || protNFe) : findKey(parsed, 'infProt');
    let protocolo;
    let cStat;
    let xMotivo;
    if (infProt) {
        protocolo = infProt.nProt || infProt.prot || undefined;
        cStat = infProt.cStat || undefined;
        xMotivo = infProt.xMotivo || infProt.xMotivo || undefined;
    }
    // If no protocol-level info found, check batch-level rejection (retEnviNFe)
    if (!cStat) {
        const retEnvi = findKey(parsed, 'retEnviNFe');
        if (retEnvi) {
            cStat = retEnvi.cStat || undefined;
            xMotivo = retEnvi.xMotivo || undefined;
        }
    }
    // eslint-disable-next-line no-console
    console.log('[soap] SEFAZ parsed result:', { cStat, xMotivo, protocolo, hasProtNFe: !!protNFe });
    return { raw: text, parsed, protocolo, cStat, xMotivo };
}
exports.default = { sendNFCeToSefaz };
