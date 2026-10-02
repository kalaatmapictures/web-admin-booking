import { defineConfig } from 'vite';

// Port 5174 supaya bisa berjalan berdampingan dengan landing page (5173).
export default defineConfig({
  server:  { port: 5174 },
  preview: { port: 4174 }
});
