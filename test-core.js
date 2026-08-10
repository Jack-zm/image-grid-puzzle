/* 从 index.html 提取核心纯函数并做往返测试（合成图像数据） */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/\/\*__CORE_START__\*\/([\s\S]*?)\/\*__CORE_END__\*\//);
if (!m) { console.error('FAIL: 未找到核心函数块'); process.exit(1); }

const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[1], ctx);
const { shuffledPermutation, invertPermutation, applyTransform } = ctx;

/* 构造合成图像：每个像素有确定且互异的 RGBA 值 */
function makeImage(w, h, seed) {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed >>> 0;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    data[i] = (s >> 16) & 0xff;
  }
  return { width: w, height: h, data };
}
function clone(img) {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}
function equal(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}
function crop(img, w, h) {
  const out = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  const src = img.data, dst = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * img.width + x) * 4, di = (y * w + x) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
    }
  }
  return out;
}
function transform(src, rows, cols, map) {
  const tileW = Math.floor(src.width / cols), tileH = Math.floor(src.height / rows);
  const dst = { width: tileW * cols, height: tileH * rows, data: new Uint8ClampedArray(tileW * cols * tileH * rows * 4) };
  applyTransform(dst, src, rows, cols, map);
  return dst;
}
/* 模拟一次 加密->还原 往返 */
function roundtrip(w, h, rows, cols, seed, label) {
  const src = makeImage(w, h, 0xABCDEF ^ (w * 131 + h));
  const perm = shuffledPermutation(rows * cols, seed);
  const proc = transform(src, rows, cols, perm);          // 加密：负片+打乱
  const inv = invertPermutation(perm);
  const rest = transform(proc, rows, cols, inv);          // 还原：逆置换+再取反

  const tileW = Math.floor(w / cols), tileH = Math.floor(h / rows);
  const expect = crop(src, tileW * cols, tileH * rows);   // 原图裁剪后的期望值

  let fail = 0;
  if (!equal(rest, expect)) { console.error(`  ✗ ${label}: 还原结果与期望不一致`); fail++; }
  // 加密结果不应等于原图裁剪（确保真的打乱了 / 取反了）
  if (equal(proc, expect)) { console.error(`  ✗ ${label}: 加密结果竟然与原图一致`); fail++; }
  // 验证取反：proc 第 i 格的像素应为 255 - src 第 perm[i] 格的像素
  let invertedOK = true;
  for (let i = 0; i < rows * cols && invertedOK; i++) {
    const st = perm[i];
    const sr = Math.floor(st / cols), sc = st % cols;
    const dr = Math.floor(i / cols), dc = i % cols;
    const si = ((sr * tileH) * src.width + sc * tileW) * 4;
    const di = ((dr * tileH) * proc.width + dc * tileW) * 4;
    if (proc.data[di] !== 255 - src.data[si]) { invertedOK = false; break; }
  }
  if (!invertedOK) { console.error(`  ✗ ${label}: 未正确执行负片取反`); fail++; }
  // 验证种子可复现
  const perm2 = shuffledPermutation(rows * cols, seed);
  if (JSON.stringify(perm) !== JSON.stringify(perm2)) { console.error(`  ✗ ${label}: 种子不可复现`); fail++; }
  if (fail === 0) console.log(`  ✓ ${label}: 往返还原成功 (${w}×${h}, ${rows}×${cols}, seed=${seed})`);
  return fail;
}

let fails = 0;
console.log('核心逻辑测试开始...');
fails += roundtrip(16, 16, 2, 2, 12345, '整倍尺寸 2x2');
fails += roundtrip(64, 48, 8, 8, 987654321, '整倍尺寸 8x8');
fails += roundtrip(100, 60, 8, 8, 42, '8x8 非整倍 (100x60)');
fails += roundtrip(17, 19, 3, 2, 7, '非整倍 3x2 (17x19)');
fails += roundtrip(33, 21, 5, 5, 2026, '5x5 非整倍');
fails += roundtrip(20, 20, 1, 1, 1, '单格 1x1 (仅负片)');
fails += roundtrip(10, 10, 10, 10, 555, '10x10 整倍');
fails += roundtrip(1000, 750, 8, 8, 31415926, '8x8 大图 (1000x750)');
// 打乱有效性：2x2 时验证 perm 确实是 [0,1,2,3] 的排列
const p = shuffledPermutation(4, 999);
const sorted = [...p].sort((a, b) => a - b).join(',');
if (sorted !== '0,1,2,3') { console.error('  ✗ perm 不是合法排列'); fails++; } else { console.log('  ✓ 置换为合法排列'); }
// 逆置换正确性
const inv = invertPermutation(p);
if (p.every((v, i) => inv[v] === i)) { console.log('  ✓ 逆置换正确'); } else { console.error('  ✗ 逆置换错误'); fails++; }

console.log(fails === 0 ? '\n全部测试通过 ✅' : `\n存在 ${fails} 处失败 ❌`);
process.exit(fails === 0 ? 0 : 1);
