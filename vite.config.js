import { defineConfig } from 'vite';

// Allow access through Cloudflare quick tunnels (*.trycloudflare.com).
// The leading dot matches any subdomain, since tunnel names change per run.
const allowedHosts = ['.trycloudflare.com'];

export default defineConfig({
  base: './',
  server: { host: true, allowedHosts },
  preview: { host: true, allowedHosts },
});
