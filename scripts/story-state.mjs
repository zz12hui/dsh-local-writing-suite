#!/usr/bin/env node
/**
 * story-state：长篇小说的确定性状态机（不依赖任何模型，谁来跑结果都一样）。
 *
 * 状态文件：<项目>/追踪/_state.json —— 唯一结构化权威。
 * 派生文件：<项目>/追踪/上下文.md —— 每次 commit 时整份重渲染，手改会被 check 判为漂移。
 *
 * 命令：
 *   init     --dir <项目> [--title 书名] [--force]
 *   chapter  --dir <项目> --n 21 [--title 章名] [--words 2068] [--file 路径] [--outline 路径]
 *   hook     --dir <项目> add|done --id F016 [--desc 描述] [--at 7] [--due 12] [--level 高]
 *   truth    --dir <项目> add|reveal --id E001 [--desc 描述] [--at 22]
 *   status   --dir <项目> [--json]
 *   check    --dir <项目> [--json]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

/* ---------------- 参数 ---------------- */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const sub = args._[1];
const dir = resolve(args.dir || process.cwd());
const STATE_DIR = join(dir, '追踪');
const STATE_FILE = join(STATE_DIR, '_state.json');
const CONTEXT_FILE = join(STATE_DIR, '上下文.md');
const fail = (msg) => { console.error(`错误：${msg}`); process.exit(2); };

/* ---------------- 读写 ---------------- */
function emptyState(title) {
  return {
    version: 1,
    title: title || '未命名',
    revision: 0,
    current: { chapter: 0, volume: '', storyTime: '' },
    constraints: [],
    hooks: [],
    truths: [],
    known: [],
    promises: [],
    chapters: [],
  };
}

function load() {
  if (!existsSync(STATE_FILE)) fail(`找不到状态文件 ${STATE_FILE}，先跑 init`);
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

function save(state) {
  state.revision = (state.revision || 0) + 1;
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
  writeFileSync(CONTEXT_FILE, renderContext(state), 'utf8');
}

/* ---------------- 渲染 ---------------- */
function renderContext(s) {
  const L = [];
  L.push('# 续写上下文卡');
  L.push('');
  L.push('> 由 scripts/story-state.mjs 从 追踪/_state.json 整份重渲染，手改会在 check 时报漂移。');
  L.push('');
  L.push('## 当前位置');
  L.push(`- 当前章：第${s.current.chapter}章${s.current.volume ? `　卷：${s.current.volume}` : ''}　故事时间：${s.current.storyTime || '未标'}`);
  L.push('');
  L.push('## 长期约束');
  if (!s.constraints.length) L.push('- （空）');
  for (const c of s.constraints) L.push(`- ${c}`);
  L.push('');
  L.push('## 活跃伏笔');
  const open = s.hooks.filter((h) => h.status !== 'done');
  if (!open.length) L.push('- （空）');
  for (const h of open) {
    L.push(`- ${h.id}｜${h.desc}｜埋第${h.at}章｜回收章${h.due ? `第${h.due}章` : '未定'}｜${h.level || '中'}`);
  }
  L.push('');
  L.push('## 未完承诺');
  if (!s.promises.length) L.push('- （空）');
  for (const p of s.promises) L.push(`- ${p}`);
  L.push('');
  L.push('## 作者真相（不得提前当读者已知）');
  const hidden = s.truths.filter((t) => !t.revealed);
  if (!hidden.length) L.push('- （空）');
  for (const t of hidden) L.push(`- ${t.id}｜${t.desc}`);
  L.push('');
  L.push('## 最近三章');
  const recent = s.chapters.slice(-3);
  if (!recent.length) L.push('- （空）');
  for (const c of recent) L.push(`- 第${c.n}章 ${c.title || ''}｜${c.words || 0} 字${c.file ? `｜${c.file}` : ''}`);
  L.push('');
  return L.join('\n');
}

/* ---------------- 命令 ---------------- */
function cmdInit() {
  if (existsSync(STATE_FILE) && !args.force) fail('状态文件已存在，加 --force 才会覆盖');
  const state = emptyState(args.title);
  save(state);
  console.log(`已初始化：${STATE_FILE}`);
  console.log(`派生上下文卡：${CONTEXT_FILE}`);
}

function cmdChapter() {
  const n = Number(args.n);
  if (!n) fail('chapter 需要 --n <章号>');
  const state = load();
  const entry = {
    n,
    title: args.title || '',
    words: Number(args.words) || 0,
    file: args.file || '',
    outline: args.outline || '',
    at: new Date().toISOString(),
  };
  state.chapters = state.chapters.filter((c) => c.n !== n);
  state.chapters.push(entry);
  state.chapters.sort((a, b) => a.n - b.n);
  state.current.chapter = Math.max(state.current.chapter, n);
  // 回写本章回收的伏笔
  const closed = state.hooks.filter((h) => h.status !== 'done' && h.due === n);
  for (const h of closed) { h.status = 'done'; h.closedAt = n; }
  save(state);
  console.log(`已提交第${n}章：${entry.words} 字${entry.file ? `｜${entry.file}` : ''}`);
  if (closed.length) console.log(`本章到期伏笔已标记回收：${closed.map((h) => h.id).join('、')}`);
}

function cmdHook() {
  if (!args.id) fail('hook 需要 --id');
  const state = load();
  if (sub === 'add') {
    if (state.hooks.some((h) => h.id === args.id)) fail(`伏笔 ${args.id} 已存在`);
    state.hooks.push({
      id: args.id,
      desc: args.desc || '',
      at: Number(args.at) || state.current.chapter,
      due: args.due ? Number(args.due) : null,
      level: args.level || '中',
      status: 'open',
    });
    save(state);
    console.log(`已登记伏笔 ${args.id}`);
    return;
  }
  if (sub === 'done') {
    const h = state.hooks.find((x) => x.id === args.id);
    if (!h) fail(`没有这条伏笔：${args.id}`);
    h.status = 'done';
    h.closedAt = Number(args.at) || state.current.chapter;
    save(state);
    console.log(`已回收伏笔 ${args.id}（第${h.closedAt}章）`);
    return;
  }
  fail('hook 只支持 add / done');
}

function cmdTruth() {
  if (!args.id) fail('truth 需要 --id');
  const state = load();
  if (sub === 'add') {
    if (state.truths.some((t) => t.id === args.id)) fail(`真相 ${args.id} 已存在`);
    state.truths.push({ id: args.id, desc: args.desc || '', revealed: false });
    save(state);
    console.log(`已登记作者真相 ${args.id}（未揭示）`);
    return;
  }
  if (sub === 'reveal') {
    const t = state.truths.find((x) => x.id === args.id);
    if (!t) fail(`没有这条真相：${args.id}`);
    t.revealed = true;
    t.revealedAt = Number(args.at) || state.current.chapter;
    save(state);
    console.log(`已标记真相 ${args.id} 在第${t.revealedAt}章揭示`);
    return;
  }
  fail('truth 只支持 add / reveal');
}

function cmdStatus() {
  const state = load();
  if (args.json) { console.log(JSON.stringify(state, null, 2)); return; }
  console.log(renderContext(state));
}

function cmdCheck() {
  const state = load();
  const errors = [];
  const warnings = [];
  const infos = [];

  // 1. 章号连续
  const nums = state.chapters.map((c) => c.n).sort((a, b) => a - b);
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) { errors.push(`章号不连续：缺第${i + 1}章（已有 ${nums.join(',')}）`); break; }
  }
  if (state.current.chapter && nums.length && nums[nums.length - 1] !== state.current.chapter) {
    warnings.push(`current.chapter=${state.current.chapter}，但最大章号是 ${nums[nums.length - 1]}`);
  }

  // 2. 字数
  for (const c of state.chapters) {
    if (!c.words) warnings.push(`第${c.n}章没有字数记录`);
    else if (c.words < 1500) warnings.push(`第${c.n}章只有 ${c.words} 字，低于 1500（可能是残稿）`);
  }

  // 3. 伏笔逾期
  for (const h of state.hooks) {
    if (h.status === 'done') continue;
    if (h.due && h.due <= state.current.chapter) errors.push(`伏笔 ${h.id} 应在第${h.due}章前回收，当前已到第${state.current.chapter}章`);
  }
  const openHigh = state.hooks.filter((h) => h.status !== 'done' && h.level === '高');
  if (openHigh.length > 12) warnings.push(`高危未回收伏笔 ${openHigh.length} 条，超过 12 条容易写丢`);

  // 4. 作者真相与读者已知撞车
  const knownText = state.known.join('\n');
  for (const t of state.truths) {
    if (t.revealed) continue;
    const key = (t.desc || '').slice(0, 12);
    if (key && knownText.includes(key)) errors.push(`真相 ${t.id} 未标记揭示，但 读者已知 里出现了同样内容：${key}`);
  }

  // 5. 派生视图漂移
  if (existsSync(CONTEXT_FILE)) {
    const onDisk = readFileSync(CONTEXT_FILE, 'utf8');
    if (onDisk !== renderContext(state)) warnings.push('追踪/上下文.md 与 _state.json 不一致（手改过？重跑一次任何写命令即可重渲染）');
  } else warnings.push('追踪/上下文.md 不存在');

  // 6. 文件存在性
  for (const c of state.chapters) {
    if (c.file && !existsSync(join(dir, c.file))) warnings.push(`第${c.n}章的正文文件不存在：${c.file}`);
    if (c.outline && !existsSync(join(dir, c.outline))) warnings.push(`第${c.n}章的细纲文件不存在：${c.outline}`);
  }

  // 7. 空项提醒
  if (!state.constraints.length) infos.push('长期约束为空：把爽点兑现方式、作者真相边界写进去，模型才不会越界');
  if (!state.hooks.length) infos.push('伏笔表为空：至少登记 3 条主线伏笔');

  const report = {
    ok: errors.length === 0,
    chapter: state.current.chapter,
    counts: { chapters: state.chapters.length, openHooks: state.hooks.filter((h) => h.status !== 'done').length, truths: state.truths.length },
    errors, warnings, infos,
  };

  if (args.json) { console.log(JSON.stringify(report, null, 2)); process.exit(errors.length ? 1 : 0); }

  console.log(`状态检查：第${state.current.chapter}章｜${report.counts.chapters} 章｜未回收伏笔 ${report.counts.openHooks} 条`);
  if (!errors.length && !warnings.length) console.log('通过：没有发现硬问题。');
  for (const e of errors) console.log(`[阻断] ${e}`);
  for (const w of warnings) console.log(`[注意] ${w}`);
  for (const i of infos) console.log(`[提示] ${i}`);
  process.exit(errors.length ? 1 : 0);
}

/* ---------------- 入口 ---------------- */
switch (cmd) {
  case 'init': cmdInit(); break;
  case 'chapter': cmdChapter(); break;
  case 'hook': cmdHook(); break;
  case 'truth': cmdTruth(); break;
  case 'status': cmdStatus(); break;
  case 'check': cmdCheck(); break;
  default:
    console.log('用法：node scripts/story-state.mjs <init|chapter|hook|truth|status|check> --dir <项目> [选项]');
    process.exit(2);
}
