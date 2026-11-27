const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

require('dotenv').config();

function canListenOnHost(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function canListen(port) {
  const ipv4Ok = await canListenOnHost(port, '127.0.0.1');
  const ipv6Ok = await canListenOnHost(port, '::1');
  return ipv4Ok && ipv6Ok;
}

async function findAvailablePort(startPort, maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const port = startPort + attempt;
    if (await canListen(port)) return port;
  }
  throw new Error(`No available port found starting at ${startPort}.`);
}

async function main() {
  const startPortRaw = process.env.WEB_PORT || '4200';
  const startPort = Number.parseInt(startPortRaw, 10);
  if (!Number.isInteger(startPort) || startPort < 1 || startPort > 65535) {
    console.error('WEB_PORT must be an integer between 1 and 65535.');
    process.exitCode = 1;
    return;
  }

  const port = await findAvailablePort(startPort, 25);
  if (!process.env.WEB_PORT && port !== startPort) {
    console.log(`Port ${startPort} is already in use; switching to ${port}.`);
  }

  const repoRoot = path.resolve(__dirname, '..');
  const ngBin = path.join(repoRoot, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
  const args = [ngBin, 'serve', '--port', String(port), '--proxy-config', 'proxy.conf.cjs'];

  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});



