/* 网页版核心测试：从 index.html 提取核心纯函数并运行共享测试套件 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { runSuite } = require('./test-suite.js');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/\/\*__CORE_START__\*\/([\s\S]*?)\/\*__CORE_END__\*\//);
if (!m) { console.error('FAIL: 未找到核心函数块'); process.exit(1); }

const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[1], ctx);

const fails = runSuite(ctx);
console.log(fails === 0 ? '\n网页版核心测试全部通过 ✅' : `\n网页版核心测试存在 ${fails} 处失败 ❌`);
process.exit(fails === 0 ? 0 : 1);
