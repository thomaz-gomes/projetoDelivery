import fs from 'fs'
import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'

/**
 * Read .pfx/.p12 and extract PEM private key and certificate.
 */
export function readPfx(pfxPath: string, password: string) {
  const raw = fs.readFileSync(pfxPath)
  const p12Asn1 = forge.asn1.fromDer(raw.toString('binary'))
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password)
  let keyObj: any = null
  let certObj: any = null
  for (const safeContent of p12.safeContents) {
    for (const safeBag of safeContent.safeBags) {
      if (safeBag.type === forge.pki.oids.certBag) {
        certObj = safeBag.cert
      }
      if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === forge.pki.oids.keyBag) {
        keyObj = safeBag.key
      }
    }
  }
  if (!keyObj || !certObj) throw new Error('Failed to extract key/cert from PFX')
  const privateKeyPem = forge.pki.privateKeyToPem(keyObj)
  const certPem = forge.pki.certificateToPem(certObj)
  // also return base64 cert without headers for KeyInfo
  const certB64 = forge.util.encode64(forge.pem.decode(certPem)[0].body)
  return { privateKeyPem, certPem, certB64 }
}

/**
 * Read .pfx buffer and extract PEM private key and certificate.
 */
export function readPfxFromBuffer(buffer: Buffer, password: string) {
  // forge expects binary-encoded string
  const raw = buffer.toString('binary')
  const p12Asn1 = forge.asn1.fromDer(raw)
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password)
  let keyObj: any = null
  let certObj: any = null
  for (const safeContent of p12.safeContents) {
    for (const safeBag of safeContent.safeBags) {
      if (safeBag.type === forge.pki.oids.certBag) {
        certObj = safeBag.cert
      }
      if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === forge.pki.oids.keyBag) {
        keyObj = safeBag.key
      }
    }
  }
  if (!keyObj || !certObj) throw new Error('Failed to extract key/cert from PFX buffer')
  const privateKeyPem = forge.pki.privateKeyToPem(keyObj)
  const certPem = forge.pki.certificateToPem(certObj)
  const certB64 = forge.util.encode64(forge.pem.decode(certPem)[0].body)
  return { privateKeyPem, certPem, certB64 }
}

/**
 * Sign the NFC-e XML: signs the <infNFe> element as required by the NFe rules.
 * This implementation uses xml-crypto and SHA1withRSA (legacy but required by
 * some SEFAZ instances). Adjust according to SEFAZ requirements.
 */
export function signXml(xml: string, privateKeyPem: string, certB64: string) {
  const sig = new SignedXml()
  sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
  sig.addReference("//*[local-name(.)='infNFe']", ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'], 'http://www.w3.org/2000/09/xmldsig#sha1')

  sig.signingKey = privateKeyPem
  sig.keyInfoProvider = {
    getKeyInfo: function () {
      return `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>`
    }
  } as any

  sig.computeSignature(xml)
  return sig.getSignedXml()
}
