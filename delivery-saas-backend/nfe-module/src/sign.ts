import fs from 'fs'
import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'

/**
 * Read .pfx/.p12 and extract PEM private key and certificate.
 */
export function readPfx(pfxPath: string, password: string) {
  const raw = fs.readFileSync(pfxPath)
  const p12Asn1 = forge.asn1.fromDer(raw.toString('binary'))
  let p12: any
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password || '')
  } catch (e1) {
    // If provided password fails and it wasn't already empty, try empty string
    // (some certificates have no password; also guards against null/undefined)
    if (password) {
      try { p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, '') } catch { throw e1 }
    } else {
      throw e1
    }
  }
  let keyObj: any = null
  const certs: any[] = []
  for (const safeContent of p12.safeContents) {
    for (const safeBag of safeContent.safeBags) {
      if (safeBag.type === forge.pki.oids.certBag && safeBag.cert) {
        certs.push(safeBag.cert)
      }
      if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === forge.pki.oids.keyBag) {
        keyObj = safeBag.key
      }
    }
  }
  if (!keyObj || certs.length === 0) throw new Error('Failed to extract key/cert from PFX')
  // Pick the certificate whose public key matches the private key (modulus comparison)
  let certObj = certs[0]
  if (certs.length > 1) {
    const privModulus = (keyObj as any).n.toString(16)
    for (const c of certs) {
      if ((c.publicKey as any).n.toString(16) === privModulus) {
        certObj = c
        break
      }
    }
  }
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
  let p12: any
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password || '')
  } catch (e1) {
    // If provided password fails and it wasn't already empty, try empty string
    if (password) {
      try { p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, '') } catch { throw e1 }
    } else {
      throw e1
    }
  }
  let keyObj: any = null
  const certs: any[] = []
  for (const safeContent of p12.safeContents) {
    for (const safeBag of safeContent.safeBags) {
      if (safeBag.type === forge.pki.oids.certBag && safeBag.cert) {
        certs.push(safeBag.cert)
      }
      if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === forge.pki.oids.keyBag) {
        keyObj = safeBag.key
      }
    }
  }
  if (!keyObj || certs.length === 0) throw new Error('Failed to extract key/cert from PFX buffer')
  // Pick the certificate whose public key matches the private key (modulus comparison)
  let certObj = certs[0]
  if (certs.length > 1) {
    const privModulus = (keyObj as any).n.toString(16)
    for (const c of certs) {
      if ((c.publicKey as any).n.toString(16) === privModulus) {
        certObj = c
        break
      }
    }
  }
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
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
  sig.addReference(
    "//*[local-name(.)='infNFe']",
    ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    'http://www.w3.org/2000/09/xmldsig#sha1'
  )

  sig.signingKey = privateKeyPem
  sig.keyInfoProvider = {
    getKeyInfo: function () {
      return `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>`
    }
  } as any

  sig.computeSignature(xml)
  let signed = sig.getSignedXml()

  // Ensure default NFe namespace present — some consumers (SEFAZ) reject
  // documents that don't include the standard namespace on the NFe element.
  if (!/\<NFe[^>]*xmlns=/.test(signed)) {
    signed = signed.replace(/<NFe(\s|>)/, `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"$1`)
  }

  return signed
}
