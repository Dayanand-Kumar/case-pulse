const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'backend');
const lock = require(path.join(root, 'package-lock.json'));
const dependencies = {};

for (const name of ['cors', 'dotenv', 'express', 'pg']) {
  const version = lock.packages[`node_modules/${name}`]?.version;
  if (!version) throw new Error(`Missing locked version for ${name}`);
  dependencies[name] = version;
}

fs.mkdirSync(output, { recursive: true });
for (const name of ['server.js', 'schema.sql']) {
  fs.copyFileSync(path.join(root, 'backend', name), path.join(output, name));
}
fs.writeFileSync(path.join(output, 'package.json'), `${JSON.stringify({
  name: 'casepulse-api',
  version: '1.0.0',
  private: true,
  scripts: { start: 'node server.js' },
  dependencies,
}, null, 2)}\n`);
console.log(`Backend package written to ${output}`);
