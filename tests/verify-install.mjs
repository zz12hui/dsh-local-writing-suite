#!/usr/bin/env node
/**
 * verify-install.mjs — 一条命令确认插件是否装好、能不能跑
 *
 * 用法：
 *   node tests/verify-install.mjs           # 人看
 *   node tests/verify-install.mjs --json    # 机器读
 *
 * 检查七项：插件目录、profile 依赖、node_modules 链接、工具注册、体裁表、门禁实跑（AI 腔 / 干净文本）、skill 安装。
 * 只读、不联网、不改文件。全部通过 exit 0，否则 exit 1。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const DSH = path.join(HOME, '.dsh');
const PROFILE = path.join(DSH, 'profiles', 'desktop');
const LOCAL = path.join(DSH, 'local-plugins', 'dsh-local-writing-suite');
const SKILLS = path.join(DSH, 'skills');
const PKG = 'dsh-local-writing-suite';
const SKILL_DEPS = {
  'writing-suite': ['ai-fiction-patterns.md', 'state-schema.md'],
  'novel-write': ['ai-fiction-patterns.md', 'state-schema.md'],
  'novel-review': ['ai-fiction-patterns.md', 'review-rubric.md'],
  'doc-review': [],
};

const FICTION_AI = [
  '他缓缓抬起头，眼底翻涌着一种近乎执拗的平静。',
  '不是害怕，而是一种被逼到墙角之后的决绝。',
  '没有犹豫，没有退缩，只有一步一步往前。',
  '仿佛整个世界都静止了，只剩下他和那盏灯。',
  '声音不大，却像一记重锤砸在每个人心上。',
  '他知道，从这一刻起，退路已经被自己亲手斩断。',
].join('\n');

const FICTION_CLEAN = [
  '他把碗放进水池，水声盖住了客厅的电视。',
  '妻子在阳台收衣服，衣架碰在一起，叮当两声。',
  '“明天几点走？”她问。',
  '“六点四十的车。”他说，“你不用起。”',
].join('\n');

const results = [];
const record = (label, ok, detail) => results.push({ label, ok, detail: detail || '' });

function readPkg(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// 1. 插件目录
try {
  const need = ['index.js', 'package.json', 'config/deai-config.json', 'scripts/story-state.mjs'];
  const missing = need.filter((f) => !fs.existsSync(path.join(LOCAL, f)));
  if (missing.length) record('插件目录', false, '缺 ' + missing.join(', '));
  else record('插件目录', true, `${LOCAL}  v${readPkg(path.join(LOCAL, 'package.json')).version}`);
} catch (e) {
  record('插件目录', false, e.message);
}

// 2. profile 依赖
try {
  const pkg = readPkg(path.join(PROFILE, 'package.json'));
  const dep = pkg.dependencies?.[PKG];
  const legacy = pkg.dependencies?.['dsh-local-deai-audit'];
  if (!dep) record('profile 依赖', false, `dependencies 里没有 ${PKG}`);
  else if (!String(dep).startsWith('link:')) record('profile 依赖', false, `不是 link: 形式：${dep}`);
  else record('profile 依赖', true, dep + (legacy ? '（旧插件仍在，建议删）' : ''));
} catch (e) {
  record('profile 依赖', false, e.message);
}

// 3. node_modules 链接
try {
  const p = path.join(PROFILE, 'node_modules', PKG);
  if (!fs.existsSync(p)) record('node_modules 链接', false, '未安装：' + p);
  else record('node_modules 链接', true, fs.realpathSync(p));
} catch (e) {
  record('node_modules 链接', false, e.message);
}

// 4. 工具注册
const tools = new Map();
try {
  const mod = await import(new URL(`file://${path.join(LOCAL, 'index.js').replace(/\\/g, '/')}`).href);
  await mod.apply({
    tools: { register: (o) => tools.set(o.name, o) },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    on() {}, effect() {}, emit() {},
  });
  const want = ['deai_audit', 'deai_audit_config'];
  const missing = want.filter((t) => !tools.has(t));
  if (missing.length) record('工具注册', false, '缺 ' + missing.join(', '));
  else record('工具注册', true, `${[...tools.keys()].join(', ')}（导出名 ${mod.name}）`);
} catch (e) {
  record('工具注册', false, e.message);
}

// 5. 体裁表
if (tools.has('deai_audit_config')) {
  try {
    const r = await tools.get('deai_audit_config').execute({ action: 'genres' });
    const ids = (r.genres || []).map((g) => g.id);
    const ok = ids.includes('fiction') && ids.length >= 8;
    record('体裁表', ok, ok ? `${ids.length} 个：${ids.join(' / ')}` : `缺 fiction 或数量不足（${ids.join(',')}）`);
  } catch (e) {
    record('体裁表', false, e.message);
  }
} else {
  record('体裁表', false, '工具未注册，跳过');
}

// 6. 门禁实跑
if (tools.has('deai_audit')) {
  const audit = tools.get('deai_audit');
  try {
    const r = await audit.execute({ text: FICTION_AI, genre: 'fiction' });
    const ok = r.counts.blocking > 0 && r.gate.pass === false;
    record('小说门禁·AI 腔', ok, `score ${r.score} / blocking ${r.counts.blocking} / gate ${r.gate.pass ? 'pass' : 'refuse'}${ok ? '' : '（预期有 blocking 且不放行）'}`);
  } catch (e) {
    record('小说门禁·AI 腔', false, e.message);
  }
  try {
    const r = await audit.execute({ text: FICTION_CLEAN, genre: 'fiction' });
    const ok = r.counts.blocking === 0 && r.gate.pass === true;
    record('小说门禁·干净文本', ok, `score ${r.score} / blocking 0 / gate ${r.gate.pass ? 'pass' : 'refuse'}${ok ? '' : '（预期 0 条 blocking 且放行）'}`);
  } catch (e) {
    record('小说门禁·干净文本', false, e.message);
  }
} else {
  record('小说门禁·AI 腔', false, '工具未注册，跳过');
  record('小说门禁·干净文本', false, '工具未注册，跳过');
}

// 7. skill 安装
try {
  const missing = [];
  for (const [name, refs] of Object.entries(SKILL_DEPS)) {
    const dir = path.join(SKILLS, name);
    const skill = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(skill)) missing.push(name);
    else if (!fs.readFileSync(skill, 'utf8').slice(0, 400).includes(`name: ${name}`)) missing.push(`${name}(frontmatter)`);
    for (const r of refs) if (!fs.existsSync(path.join(dir, 'references', r))) missing.push(`${name}/references/${r}`);
  }
  if (missing.length) record('skill 安装', false, '缺 ' + missing.join(', '));
  else record('skill 安装', true, Object.keys(SKILL_DEPS).join(' / '));
} catch (e) {
  record('skill 安装', false, e.message);
}

const failed = results.filter((r) => !r.ok);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: failed.length === 0, checks: results }, null, 2));
} else {
  console.log(`写作套件自检  v${readPkg(path.join(LOCAL, 'package.json')).version}`);
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label.padEnd(11, ' ')} ${r.detail}`);
  console.log('');
  console.log(failed.length ? `结论：${failed.length} 项未通过` : `结论：全部通过（${results.length} 项）`);
  if (!failed.length) {
    console.log('说明：本脚本验证「装好且能跑」。当前会话有没有加载新工具，看工具表里有没有 deai_audit——改过插件要重启 DSH。');
  }
}
process.exit(failed.length ? 1 : 0);
