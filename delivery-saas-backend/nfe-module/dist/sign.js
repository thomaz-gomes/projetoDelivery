"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPfx = readPfx;
exports.readPfxFromBuffer = readPfxFromBuffer;
exports.signXml = signXml;
const fs_1 = __importDefault(require("fs"));
const node_forge_1 = __importDefault(require("node-forge"));
const xml_crypto_1 = require("xml-crypto");
/**
 * Read .pfx/.p12 and extract PEM private key and certificate.
 */
function readPfx(pfxPath, password) {
    const raw = fs_1.default.readFileSync(pfxPath);
    const p12Asn1 = node_forge_1.default.asn1.fromDer(raw.toString('binary'));
    const p12 = node_forge_1.default.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    let keyObj = null;
    const certs = [];
    for (const safeContent of p12.safeContents) {
        for (const safeBag of safeContent.safeBags) {
            if (safeBag.type === node_forge_1.default.pki.oids.certBag && safeBag.cert) {
                certs.push(safeBag.cert);
            }
            if (safeBag.type === node_forge_1.default.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === node_forge_1.default.pki.oids.keyBag) {
                keyObj = safeBag.key;
            }
        }
    }
    if (!keyObj || certs.length === 0)
        throw new Error('Failed to extract key/cert from PFX');
    // Pick the certificate whose public key matches the private key (modulus comparison)
    let certObj = certs[0];
    if (certs.length > 1) {
        const privModulus = keyObj.n.toString(16);
        for (const c of certs) {
            if (c.publicKey.n.toString(16) === privModulus) {
                certObj = c;
                break;
            }
        }
    }
    const privateKeyPem = node_forge_1.default.pki.privateKeyToPem(keyObj);
    const certPem = node_forge_1.default.pki.certificateToPem(certObj);
    // also return base64 cert without headers for KeyInfo
    const certB64 = node_forge_1.default.util.encode64(node_forge_1.default.pem.decode(certPem)[0].body);
    return { privateKeyPem, certPem, certB64 };
}
/**
 * Read .pfx buffer and extract PEM private key and certificate.
 */
function readPfxFromBuffer(buffer, password) {
    // forge expects binary-encoded string
    const raw = buffer.toString('binary');
    const p12Asn1 = node_forge_1.default.asn1.fromDer(raw);
    const p12 = node_forge_1.default.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    let keyObj = null;
    const certs = [];
    for (const safeContent of p12.safeContents) {
        for (const safeBag of safeContent.safeBags) {
            if (safeBag.type === node_forge_1.default.pki.oids.certBag && safeBag.cert) {
                certs.push(safeBag.cert);
            }
            if (safeBag.type === node_forge_1.default.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === node_forge_1.default.pki.oids.keyBag) {
                keyObj = safeBag.key;
            }
        }
    }
    if (!keyObj || certs.length === 0)
        throw new Error('Failed to extract key/cert from PFX buffer');
    // Pick the certificate whose public key matches the private key (modulus comparison)
    let certObj = certs[0];
    if (certs.length > 1) {
        const privModulus = keyObj.n.toString(16);
        for (const c of certs) {
            if (c.publicKey.n.toString(16) === privModulus) {
                certObj = c;
                break;
            }
        }
    }
    const privateKeyPem = node_forge_1.default.pki.privateKeyToPem(keyObj);
    const certPem = node_forge_1.default.pki.certificateToPem(certObj);
    const certB64 = node_forge_1.default.util.encode64(node_forge_1.default.pem.decode(certPem)[0].body);
    return { privateKeyPem, certPem, certB64 };
}
/**
 * Sign the NFC-e XML: signs the <infNFe> element as required by the NFe rules.
 * This implementation uses xml-crypto and SHA1withRSA (legacy but required by
 * some SEFAZ instances). Adjust according to SEFAZ requirements.
 */
function signXml(xml, privateKeyPem, certB64) {
    const sig = new xml_crypto_1.SignedXml();
    sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
    sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
    sig.addReference("//*[local-name(.)='infNFe']", ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'], 'http://www.w3.org/2000/09/xmldsig#sha1');
    sig.signingKey = privateKeyPem;
    sig.keyInfoProvider = {
        getKeyInfo: function () {
            return `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>`;
        }
    };
    sig.computeSignature(xml);
    return sig.getSignedXml();
}
