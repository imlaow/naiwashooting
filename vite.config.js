import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Allow access through Cloudflare quick tunnels (*.trycloudflare.com).
// The leading dot matches any subdomain, since tunnel names change per run.
const allowedHosts = ['.trycloudflare.com'];

export default defineConfig({
  base: './',
  // Two pages: the map lobby at / and the game at /play.html.
  build: {
    rollupOptions: {
      input: {
        lobby: fileURLToPath(new URL('./index.html', import.meta.url)),
        play: fileURLToPath(new URL('./play.html', import.meta.url)),
      },
    },
  },
  server: { host: true, allowedHosts },
  preview: { host: true, allowedHosts },
});
