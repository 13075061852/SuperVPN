import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react(), { name: 'supervpn-dev-health', configureServer(server) { server.middlewares.use('/__supervpn_dev', (_, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ project: 'SuperVPN' })); }); } }], base: './', server: { port: 5188, strictPort: true, watch: { usePolling: true, interval: 250, ignored: ['**/node_modules/**', '**/.git/**', '**/release/**', '**/dist/**', '**/resources/core/**'] } }, build: { outDir: 'dist' } });
