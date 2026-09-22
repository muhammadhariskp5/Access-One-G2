import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

function html2canvasPatchPlugin() {
  return {
    name: 'html2canvas-patch',
    transform(code: string, id: string) {
      if (id.includes('html2canvas')) {
        let transformed = code;
        const colorThrow = /if\s*\(\s*typeof\s+colorFunction\s*===\s*["']undefined["']\s*\)\s*throw\s+new\s+Error\([^)]+\);?\s*(?:return\s+colorFunction\([^)]+\);?)?/g;
        if (colorThrow.test(transformed)) {
          transformed = transformed.replace(colorThrow, 'if (typeof colorFunction === "undefined") return (typeof COLORS !== "undefined" ? COLORS.TRANSPARENT : 0); try { return colorFunction(context, value.values); } catch (e) { return (typeof COLORS !== "undefined" ? COLORS.TRANSPARENT : 0); }');
        }
        return {
          code: transformed,
          map: null
        };
      }
    }
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), html2canvasPatchPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'html2canvas': 'html2canvas-pro',
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
