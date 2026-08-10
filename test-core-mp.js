/* 小程序版核心测试：直接加载 utils/core.js 并运行共享测试套件 */
const path = require('path');
const { runSuite } = require('./test-suite.js');

const core = require(path.join(__dirname, '..', 'image-grid-puzzle-mp', 'utils', 'core.js'));
const fails = runSuite(core);
console.log(fails === 0 ? '\n小程序版核心测试全部通过 ✅' : `\n小程序版核心测试存在 ${fails} 处失败 ❌`);
process.exit(fails === 0 ? 0 : 1);
