/*
 * 共享核心算法测试套件
 * core 需提供：shuffledPermutation / invertPermutation / applyTransform /
 *              buildSeedStr / parseSeedStr / selfInversePermutation / randomKeyFromPixels
 * 返回失败数（0 = 全部通过）
 */
function runSuite(core) {
  const {
    shuffledPermutation,
    invertPermutation,
    applyTransform,
    buildSeedStr,
    parseSeedStr,
    selfInversePermutation,
    randomKeyFromPixels,
  } = core;

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

  let fails = 0;

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
    const perm2 = shuffledPermutation(rows * cols, seed);
    if (JSON.stringify(perm) !== JSON.stringify(perm2)) { console.error(`  ✗ ${label}: 种子不可复现`); fail++; }
    if (fail === 0) console.log(`  ✓ ${label}: 往返还原成功 (${w}×${h}, ${rows}×${cols}, seed=${seed})`);
    return fail;
  }

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

  /* ---- 种子包含分割行列（仅凭种子即可还原，无需输入行列） ---- */
  const s1 = buildSeedStr(8, 8, 12345);
  if (s1 !== '8x8-12345') { console.error('  ✗ buildSeedStr 格式错误: ' + s1); fails++; }
  else console.log('  ✓ buildSeedStr 生成「行x列-密钥」格式');
  const pFull = parseSeedStr('8x8-12345');
  if (!pFull || pFull.format !== 'full' || pFull.rows !== 8 || pFull.cols !== 8 || pFull.key !== 12345) { console.error('  ✗ parseSeedStr 完整格式解析错误'); fails++; }
  else console.log('  ✓ parseSeedStr 解析完整种子（含行列）');
  const pLegacy = parseSeedStr('12345');
  if (!pLegacy || pLegacy.format !== 'legacy' || pLegacy.key !== 12345) { console.error('  ✗ parseSeedStr 旧版数字种子解析错误'); fails++; }
  else console.log('  ✓ parseSeedStr 兼容旧版纯数字种子');
  if (parseSeedStr('abc') !== null || parseSeedStr('8x8-') !== null || parseSeedStr('8x') !== null) { console.error('  ✗ parseSeedStr 未拒绝非法输入'); fails++; }
  else console.log('  ✓ parseSeedStr 拒绝非法输入');
  const pMax = parseSeedStr('64x64-4294967295');
  if (!pMax || pMax.rows !== 64 || pMax.cols !== 64 || pMax.key !== 4294967295) { console.error('  ✗ parseSeedStr 边界值解析错误'); fails++; }
  else console.log('  ✓ parseSeedStr 边界值 64x64 / 最大密钥');

  /* 仅凭种子还原：不知道网格，只给种子也能还原 */
  function seedOnlyRoundtrip(w, h, rows, cols, key, label) {
    const src = makeImage(w, h, 0xABCDEF ^ (w * 131 + h));
    const seedStr = buildSeedStr(rows, cols, key);
    const proc = transform(src, rows, cols, shuffledPermutation(rows * cols, key));
    const parsed = parseSeedStr(seedStr);
    if (!parsed || parsed.format !== 'full') { console.error(`  ✗ ${label}: 种子解析失败`); return 1; }
    const rest = transform(proc, parsed.rows, parsed.cols, invertPermutation(shuffledPermutation(parsed.rows * parsed.cols, parsed.key)));
    const tileW = Math.floor(w / parsed.cols), tileH = Math.floor(h / parsed.rows);
    const expect = crop(src, tileW * parsed.cols, tileH * parsed.rows);
    if (!equal(rest, expect)) { console.error(`  ✗ ${label}: 仅凭种子还原失败`); return 1; }
    console.log(`  ✓ ${label} (${w}×${h}, 种子 ${seedStr})`);
    return 0;
  }
  fails += seedOnlyRoundtrip(64, 48, 8, 8, 123456, '仅凭种子还原 8x8');
  fails += seedOnlyRoundtrip(100, 60, 8, 8, 987654321, '仅凭种子还原 8x8(大密钥)');
  fails += seedOnlyRoundtrip(33, 21, 5, 5, 42, '仅凭种子还原 5x5');
  fails += seedOnlyRoundtrip(40, 40, 10, 16, 31415926, '仅凭种子还原 10x16');

  // 随机种子可复现：同一随机种子两次生成相同置换，不同种子不同置换
  const r1 = (Math.random() * 0xFFFFFFFF) >>> 0, r2 = (Math.random() * 0xFFFFFFFF) >>> 0;
  const permR1a = shuffledPermutation(64, r1), permR1b = shuffledPermutation(64, r1), permR2 = shuffledPermutation(64, r2);
  if (JSON.stringify(permR1a) !== JSON.stringify(permR1b)) { console.error('  ✗ 同种子不可复现'); fails++; }
  else console.log('  ✓ 随机种子可复现（同种子=同打乱）');
  if (r1 !== r2 && JSON.stringify(permR1a) === JSON.stringify(permR2)) { console.error('  ✗ 不同随机种子产生了相同打乱'); fails++; }
  else console.log('  ✓ 不同随机种子=不同打乱（每次处理均随机）');

  /* ---- 自逆置换（处理两次即还原的核心） ---- */
  function isInvolution(sig) {
    for (let i = 0; i < sig.length; i++) if (sig[sig[i]] !== i) return false;
    return true;
  }
  const inv1 = selfInversePermutation(64, 12345);
  const invSorted = [...inv1].sort((a, b) => a - b).join(',');
  if (invSorted !== Array.from({ length: 64 }, (_, i) => i).join(',')) { console.error('  ✗ selfInversePermutation 不是合法排列'); fails++; }
  else if (!isInvolution(inv1)) { console.error('  ✗ selfInversePermutation 不是自逆置换'); fails++; }
  else console.log('  ✓ selfInversePermutation 是合法且自逆的置换');
  const invOdd = selfInversePermutation(9, 7); // 奇数：1 个不动点
  if (!isInvolution(invOdd)) { console.error('  ✗ 奇数个元素时自逆性失败'); fails++; }
  else console.log('  ✓ 奇数元素（9 个）自逆性正确');
  const inv2 = selfInversePermutation(64, 54321);
  if (JSON.stringify(inv1) === JSON.stringify(inv2)) { console.error('  ✗ 不同种子产生了相同自逆置换'); fails++; }
  else console.log('  ✓ 不同种子=不同自逆置换');

  /* 页面新行为：同一图片用同一 map（自逆置换）处理两次 → 回到原图 */
  function involRoundtrip(w, h, rows, cols, key, label) {
    const src = makeImage(w, h, 0xABCDEF ^ (w * 131 + h));
    const sig = selfInversePermutation(rows * cols, key);
    const once = transform(src, rows, cols, sig);       // 处理第 1 次
    const twice = transform(once, rows, cols, sig);     // 同一 map 处理第 2 次 → 应还原
    const tileW = Math.floor(w / cols), tileH = Math.floor(h / rows);
    const expect = crop(src, tileW * cols, tileH * rows);
    if (!equal(twice, expect)) { console.error(`  ✗ ${label}: 处理两次未还原`); return 1; }
    if (equal(once, expect)) { console.error(`  ✗ ${label}: 处理一次竟然等于原图（未打乱）`); return 1; }
    console.log(`  ✓ ${label} (${w}×${h}, ${rows}×${cols}, key=${key})`);
    return 0;
  }
  fails += involRoundtrip(64, 48, 8, 8, 123456, '同种子处理两次还原 8x8');
  fails += involRoundtrip(100, 60, 8, 8, 987654321, '同种子处理两次还原 8x8(非整倍)');
  fails += involRoundtrip(33, 21, 5, 5, 42, '同种子处理两次还原 5x5');
  fails += involRoundtrip(40, 40, 10, 16, 31415926, '同种子处理两次还原 10x16');
  fails += involRoundtrip(20, 20, 1, 1, 1, '同种子处理两次还原 1x1');
  fails += involRoundtrip(17, 19, 3, 2, 7, '同种子处理两次还原 3x2');

  /* ---- 像素 + 时间 + 随机 混合密钥（保证每次上传/处理都不同） ---- */
  function makeSolidImage(w, h, fill) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i++) data[i] = fill;
    return { width: w, height: h, data };
  }
  const pxA = makeSolidImage(32, 32, 0x11);
  const pxB = makeSolidImage(32, 32, 0x77);
  const kA = randomKeyFromPixels(pxA, 1000, 2000);
  if (!Number.isInteger(kA) || kA < 0 || kA > 0xFFFFFFFF) { console.error('  ✗ randomKeyFromPixels 输出超出 32 位'); fails++; }
  else console.log('  ✓ randomKeyFromPixels 输出为 32 位无符号整数');
  if (randomKeyFromPixels(pxA, 1000, 2000) !== kA) { console.error('  ✗ randomKeyFromPixels 相同输入不可复现'); fails++; }
  else console.log('  ✓ randomKeyFromPixels 相同输入可复现（确定函数）');
  if (randomKeyFromPixels(pxB, 1000, 2000) === kA) { console.error('  ✗ 不同像素产生相同密钥'); fails++; }
  else console.log('  ✓ 不同图片像素 → 不同密钥');
  if (randomKeyFromPixels(pxA, 2000, 2000) === kA) { console.error('  ✗ 不同时间产生相同密钥'); fails++; }
  else console.log('  ✓ 不同时间戳 → 不同密钥');
  if (randomKeyFromPixels(pxA, 1000, 9999) === kA) { console.error('  ✗ 不同随机数产生相同密钥'); fails++; }
  else console.log('  ✓ 不同随机数 → 不同密钥');

  return fails;
}

module.exports = { runSuite };
