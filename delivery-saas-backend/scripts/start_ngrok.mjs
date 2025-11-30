#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

async function main(){
  const port = process.env.PORT || 3000;
  let ngrok;
  try {
    ngrok = await import('ngrok');
  } catch (e) {
    console.error('Module "ngrok" not found. Install with: npm i -D ngrok');
    process.exit(1);
  }

  let authtoken = process.env.NGROK_AUTHTOKEN || process.env.NGROK_TOKEN || null;
  if (authtoken && typeof authtoken === 'string') {
    authtoken = authtoken.trim()
      // remove surrounding single or double quotes
      .replace(/^'+|'+$|^"+|"+$/g, '')
      // remove a trailing semicolon if present (common when copying from env snippets)
      .replace(/;$/, '');
    if (!authtoken) authtoken = null;
  }
  console.log(`Starting ngrok tunnel to http://localhost:${port} ...`);
  try {
    // Try JS API first (v4-style). If it doesn't exist or fails, fall back to CLI (npx ngrok)
    if (typeof ngrok.connect === 'function') {
      const url = await ngrok.connect({ addr: Number(port), proto: 'http', authtoken: authtoken || undefined });
      console.log('ngrok public url:', url);
      console.log('Forwarding to: http://localhost:' + port + '/webhooks/ifood');
      console.log('\nTo test the webhook, you can POST a sample payload:');
      console.log(`curl -X POST ${url}/webhooks/ifood -H "Content-Type: application/json" -d @sample/ifood-webhook.json`);
      console.log('\nOr run the provided PowerShell test script (adjust base URL if needed):');
      console.log('  .\\test-ifood-pedido.ps1');
      console.log('\nPress Ctrl+C to stop ngrok.');
      return;
    }

    // Fallback: spawn the ngrok CLI via npx. This is more compatible with newer/beta ngrok packages.
    console.warn('ngrok.connect() not available, falling back to CLI via `npx ngrok` (requires network access).');
    const child_process = await import('child_process');
    const spawn = child_process.spawn || child_process.default?.spawn;
    const args = ['ngrok', 'http', String(port), '--log=stdout'];
    if (authtoken) args.push('--authtoken', authtoken);

    const proc = spawn('npx', args, { stdio: 'inherit', shell: true });
    proc.on('error', (err) => {
      console.error('Failed to start ngrok CLI via npx:', err.message || err);
      console.error('Install ngrok or run `npx ngrok http', port, '` manually.');
      process.exit(1);
    });

    proc.on('exit', async (code) => {
      console.log('ngrok CLI exited with code', code);
      if (code && code !== 0) {
        console.warn('ngrok CLI failed — trying localtunnel as a quick alternative...');
        try {
          const ltArgs = ['localtunnel', '--port', String(port)];
          const lt = spawn('npx', ltArgs, { stdio: 'inherit', shell: true });
          lt.on('exit', (c) => process.exit(c || 0));
          lt.on('error', (e) => {
            console.error('Failed to start localtunnel via npx:', e && e.message ? e.message : e);
            process.exit(code || 1);
          });
          return;
        } catch (e) {
          console.error('Local fallback failed:', e && (e.message || e));
          process.exit(code || 1);
        }
      }
      process.exit(code || 0);
    });
    // Keep the process running and let the CLI stream logs to the console.
  } catch (e) {
    console.warn('ngrok JS API failed:', e && (e.message || e));
    console.warn('Falling back to ngrok CLI via `npx ngrok`...');

    // Spawn the ngrok CLI via npx as a fallback. Use dynamic import for child_process
    try {
      const child_process = await import('child_process');
      const spawn = child_process.spawn || child_process.default?.spawn;
      const args = ['ngrok', 'http', String(port), '--log=stdout'];
      if (authtoken) args.push('--authtoken', authtoken);

      const proc = spawn('npx', args, { stdio: 'inherit', shell: true });
      proc.on('error', (err) => {
        console.error('Failed to start ngrok CLI via npx:', err.message || err);
        console.error('Install ngrok or run `npx ngrok http', port, '` manually.');
        process.exit(1);
      });
      proc.on('exit', async (code) => {
        console.log('ngrok CLI exited with code', code);
        if (code && code !== 0) {
          console.warn('ngrok CLI failed — trying localtunnel as a quick alternative...');
          try {
            const ltArgs = ['localtunnel', '--port', String(port)];
            const lt = spawn('npx', ltArgs, { stdio: 'inherit', shell: true });
            lt.on('exit', (c) => process.exit(c || 0));
            lt.on('error', (e) => {
              console.error('Failed to start localtunnel via npx:', e && e.message ? e.message : e);
              process.exit(code || 1);
            });
            return;
          } catch (e) {
            console.error('Local fallback failed:', e && (e.message || e));
            process.exit(code || 1);
          }
        }
        process.exit(code || 0);
      });
      // Keep the process running; CLI will stream logs to stdout.
      return;
    } catch (err) {
      console.error('Failed to spawn ngrok CLI fallback:', err && (err.message || err));
      process.exit(1);
    }
  }
}

main().catch(e=>{ console.error(e); process.exit(1) });
