import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { virtualMonitorSignalingPlugin } from './server/virtual-monitor-signaling.mjs';

function readTlsOptions() {
  const keyFile = process.env.VIRTUAL_MONITOR_TLS_KEY;
  const certFile = process.env.VIRTUAL_MONITOR_TLS_CERT;
  if (!keyFile && !certFile) return undefined;
  if (!keyFile || !certFile) {
    throw new Error('Set both VIRTUAL_MONITOR_TLS_KEY and VIRTUAL_MONITOR_TLS_CERT.');
  }

  const root = realpathSync(fileURLToPath(new URL('.', import.meta.url)));
  function isInsideProject(file) {
    const location = relative(root, file);
    return location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location);
  }
  function readTlsFile(file) {
    const requested = resolve(file);
    const actual = realpathSync(requested);
    if (isInsideProject(requested) || isInsideProject(actual)) {
      throw new Error('Keep the virtual monitor TLS files outside the project directory.');
    }
    return readFileSync(actual);
  }
  return { key: readTlsFile(keyFile), cert: readTlsFile(certFile) };
}

export default defineConfig(({ command }) => ({
  plugins: [virtualMonitorSignalingPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        xrColorProbe: fileURLToPath(new URL('./tools/xr-color-probe.html', import.meta.url)),
      },
    },
  },
  server: {
    host: 'localhost',
    // Vite's CORS middleware runs before the signaling plugin.
    cors: false,
    https: command === 'serve' ? readTlsOptions() : undefined,
  },
}));
