#!/usr/bin/env node
// generate_qz_cert.js
// Simple script to create a self-signed certificate and private key for QZ Tray
// Uses the `selfsigned` npm package so OpenSSL is not required on Windows.

const fs = require('fs');
const path = require('path');

async function main() {
  try {
    // require dynamically so this script can be copied without forcing install
    const selfsigned = require('selfsigned');
    const hostname = process.argv[2] || 'localhost';
    const attrs = [{ name: 'commonName', value: hostname }];
    const opts = {
      days: 3650,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: hostname }, // DNS
            { type: 7, ip: '127.0.0.1' }   // IP
          ]
        }
      ]
    };

    console.log('Generating self-signed certificate for', hostname);
    const pems = selfsigned.generate(attrs, opts);

    const outDir = path.resolve(__dirname, '..', 'secure');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const keyPath = path.join(outDir, 'qz-private.key');
    const certPath = path.join(outDir, 'qz-cert.pem');

    fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });
    fs.writeFileSync(certPath, pems.cert);

    console.log('Wrote private key to', keyPath);
    console.log('Wrote certificate to', certPath);
    console.log('Do NOT commit the private key to source control. Use these files to configure /qz/cert and /qz/sign endpoints.');
  } catch (e) {
    console.error('Failed to generate cert:', e && e.message || e);
    console.error('Make sure you ran: npm install selfsigned');
    process.exit(1);
  }
}

main();
