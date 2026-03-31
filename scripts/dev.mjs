import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const cwd = projectRoot.startsWith('\\\\?\\') ? projectRoot.slice(4) : projectRoot;
const nodeBin = process.execPath;

const commands = [
  {
    name: 'web',
    args: [resolve(projectRoot, 'node_modules/vite/bin/vite.js')],
  },
  {
    name: 'server',
    args: [resolve(projectRoot, 'node_modules/tsx/dist/cli.mjs'), 'watch', 'server/src/index.ts'],
  },
];

const children = new Set();
let shuttingDown = false;
let exitCode = 0;

const killChildren = (signal = 'SIGTERM') => {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
};

const finish = (code = exitCode) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  exitCode = code;
  killChildren();
};

for (const command of commands) {
  const child = spawn(nodeBin, command.args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });

  children.add(child);

  child.on('exit', (code, signal) => {
    children.delete(child);

    if (shuttingDown) {
      if (children.size === 0) {
        process.exit(exitCode);
      }
      return;
    }

    if (signal) {
      finish(1);
      return;
    }

    if (typeof code === 'number' && code !== 0) {
      finish(code);
      return;
    }

    if (children.size === 0) {
      process.exit(0);
    }
  });

  child.on('error', () => {
    finish(1);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => finish(0));
}
