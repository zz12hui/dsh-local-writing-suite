/**
 * 安装 dsh-local-writing-suite 到本机 DSH：
 *   1. 备份 profile/package.json
 *   2. 复制插件到 ~/.dsh/local-plugins/
 *   3. profile 依赖：去掉 dsh-local-deai-audit，加入 dsh-local-writing-suite
 *   4. node_modules 建符号链接（失败则退回复制）
 *   5. 复制 4 个 skill 到 ~/.dsh/skills/，并带上各自 references
 *
 * 运行：node install.mjs [--dry-run]
 */
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const DSH = join(HOME, '.dsh');
const PLUGIN_NAME = 'dsh-local-writing-suite';
const DEST = join(DSH, 'local-plugins', PLUGIN_NAME);
const PROFILE = join(DSH, 'profiles', 'desktop');
const PROFILE_PKG = join(PROFILE, 'package.json');
const NM = join(PROFILE, 'node_modules');
const SKILLS = join(DSH, 'skills');
const dry = process.argv.includes('--dry-run');

const log = (...a) => console.log(dry ? '[dry]' : '[install]', ...a);

/* 1. 备份 profile */
const stamp = new Date().toISOString().slice(0, 10);
const backup = join(DSH, 'backups', `profile-package-${stamp}-writing-suite.json`);
if (!dry) {
  mkdirSync(dirname(backup), { recursive: true });
  writeFileSync(backup, readFileSync(PROFILE_PKG, 'utf8'), 'utf8');
}
log(`profile 已备份：${backup}`);

/* 2. 复制插件 */
const COPY = ['index.js', 'package.json', 'cordis.patch.yml', 'icon.svg', 'config', 'locale', 'scripts', 'references', 'skills'];
if (!dry) {
  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(DEST, { recursive: true });
  for (const item of COPY) {
    const from = join(SRC, item);
    if (!existsSync(from)) continue;
    cpSync(from, join(DEST, item), { recursive: true });
  }
}
log(`插件已复制：${DEST}`);

/* 3. 改 profile 依赖 */
const pkg = JSON.parse(readFileSync(PROFILE_PKG, 'utf8'));
delete pkg.dependencies['dsh-local-deai-audit'];
pkg.dependencies[PLUGIN_NAME] = `link:${DEST.replace(/\\/g, '/')}`;
pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)));
if (!dry) writeFileSync(PROFILE_PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
log(`依赖已更新：- dsh-local-deai-audit  + ${PLUGIN_NAME}`);

/* 4. node_modules 链接 */
const linkPath = join(NM, PLUGIN_NAME);
const oldLink = join(NM, 'dsh-local-deai-audit');
if (!dry) {
  if (existsSync(oldLink) || isSymlink(oldLink)) rmSync(oldLink, { force: true });
  if (existsSync(linkPath) || isSymlink(linkPath)) rmSync(linkPath, { force: true, recursive: true });
  let linked = false;
  try {
    symlinkSync(join('..', '..', '..', 'local-plugins', PLUGIN_NAME), linkPath, 'junction');
    linked = true;
  } catch (e) {
    console.warn('[install] 符号链接失败，退回复制：' + e.message);
  }
  if (!linked) cpSync(DEST, linkPath, { recursive: true });
  log(`node_modules 就绪：${linkPath}${linked ? '（junction）' : '（复制）'}`);
}

function isSymlink(p) {
  try { return statSync(p, { throwIfNoEntry: false }) === undefined ? false : (statSync(p).isSymbolicLink?.() ?? false); } catch { return false; }
}

/* 5. 复制 skills + references */
const SKILL_DEPS = {
  'writing-suite': ['ai-fiction-patterns.md', 'state-schema.md'],
  'novel-write': ['ai-fiction-patterns.md', 'state-schema.md'],
  'novel-review': ['ai-fiction-patterns.md', 'review-rubric.md'],
  'doc-review': [],
};
for (const [skill, refs] of Object.entries(SKILL_DEPS)) {
  const src = join(SRC, 'skills', skill);
  if (!existsSync(join(src, 'SKILL.md'))) { console.warn(`[install] 跳过（无 SKILL.md）：${skill}`); continue; }
  const dst = join(SKILLS, skill);
  if (!dry) {
    mkdirSync(dst, { recursive: true });
    cpSync(join(src, 'SKILL.md'), join(dst, 'SKILL.md'));
    if (refs.length) {
      mkdirSync(join(dst, 'references'), { recursive: true });
      for (const r of refs) cpSync(join(SRC, 'references', r), join(dst, 'references', r));
    }
  }
  log(`skill 已安装：${dst}${refs.length ? `（references: ${refs.join(', ')}）` : ''}`);
}

log('完成。工具与 skill 需要重启 DSH 后生效。');
