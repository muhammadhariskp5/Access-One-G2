const fs = require('fs');
const path = require('path');

const files = [
  'node_modules/html2canvas-pro/dist/html2canvas-pro.esm.js',
  'node_modules/html2canvas-pro/dist/html2canvas-pro.js',
  'node_modules/html2canvas-pro/dist/html2canvas-pro.cjs'
];

for (const relPath of files) {
  const filePath = path.resolve(__dirname, '..', relPath);
  if (!fs.existsSync(filePath)) continue;
  let code = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // 1. Safe unsupported color function
  const colorThrowPattern = /if\s*\(\s*typeof\s+colorFunction\s*===\s*["']undefined["']\s*\)\s*throw\s+new\s+Error\([^)]+\);?\s*(?:return\s+colorFunction\([^)]+\);?)?/g;
  if (colorThrowPattern.test(code)) {
    code = code.replace(colorThrowPattern, 'if (typeof colorFunction === "undefined") return (typeof COLORS !== "undefined" ? COLORS.TRANSPARENT : 0); try { return colorFunction(context, value.values); } catch (e) { return (typeof COLORS !== "undefined" ? COLORS.TRANSPARENT : 0); }');
    changed = true;
  }

  // 2. Safe unsupported image function
  const imageThrowPattern = /if\s*\(\s*typeof\s+imageFunction\s*===\s*["']undefined["']\s*\)\s*throw\s+new\s+Error\([^)]+\);/g;
  if (imageThrowPattern.test(code)) {
    code = code.replace(imageThrowPattern, 'if (typeof imageFunction === "undefined") return null;');
    changed = true;
  }

  // 3. Safe unsupported transform function
  const transformThrowPattern = /if\s*\(\s*typeof\s+transformFunction\s*===\s*["']undefined["']\s*\)\s*throw\s+new\s+Error\([^)]+\);/g;
  if (transformThrowPattern.test(code)) {
    code = code.replace(transformThrowPattern, 'if (typeof transformFunction === "undefined") return null;');
    changed = true;
  }

  // 4. Safe relative color transforms in lab, oklab, oklch, lch, hsl, rgb
  const relColorPattern = /if\s*\(\s*isRelativeTransform\([^)]+\)\s*\)\s*throw\s+new\s+Error\([^)]+\);/g;
  if (relColorPattern.test(code)) {
    code = code.replace(relColorPattern, 'if (isRelativeTransform(args && args.filter ? args.filter(nonFunctionArgSeparator) : [])) return (typeof COLORS !== "undefined" ? COLORS.TRANSPARENT : 0);');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, code, 'utf8');
    console.log(`[patch-html2canvas] Patched ${relPath}`);
  }
}
