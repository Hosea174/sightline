import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[react(),tailwindcss()],publicDir:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'extension/ui',emptyOutDir:true,lib:{entry:'extension/ui.tsx',formats:['es'],cssFileName:'ui',fileName:()=> 'ui.js'},rollupOptions:{output:{assetFileNames:'[name][extname]'}}}});
