/**
 * writing-suite：写作与审查套件（DSH 本地插件）
 *
 * 注册两个模型可见工具：
 *   deai_audit        —— 七维 AI 味评分 + 逐句打标（带行号 / 阻断级 / 体裁门禁）
 *   deai_audit_config —— 查看 / 列文体 / 改配置 / 恢复默认
 *
 * 相对 deai-audit 1.1.0 的增量：
 *   1. 新增第 7 维「套路句式 cliche」，由每个体裁的 rules 驱动，支持 regex 与 density 两种模式；
 *   2. 命中项带 severity（blocking / advisory）与行号；
 *   3. 每个体裁可单独定义 bands 与 gate（maxBlocking / maxScore / maxAdvisory），输出 gate.pass；
 *   4. 新增 fiction（小说 / 网文）与 doc（文档 / 说明书）两个体裁；
 *   5. 老 6 个体裁的权重、bands、行为保持不变，cliche 权重为 0。
 *
 * 配置读取顺序：DEAI_CONFIG 环境变量 → ~/.dsh/deai-audit-config.json → 包内 config/deai-config.json
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'tool-writing-suite';
export const inject = ['tools'];

const PACKAGE_CONFIG = fileURLToPath(new URL('./config/deai-config.json', import.meta.url));
const USER_CONFIG = join(homedir(), '.dsh', 'deai-audit-config.json');

const FALLBACK = {
  bands: [
    { max: 15, label: '很自然', action: '可交付' },
    { max: 30, label: '基本自然', action: '挑 1-2 处改' },
    { max: 50, label: '有模板感，建议再改', action: '结构性改，别只换词' },
    { max: 100, label: '一眼 AI，必须重写', action: '重写，别修补' },
  ],
  common: {
    templateWords: ['赋能', '闭环', '抓手', '沉淀', '打造', '助力'],
    connectors: ['首先', '其次', '此外', '同时', '因此', '综上'],
    colloquial: ['说白了', '其实', '比如', '以前', '现在'],
    concretePattern: '\\d|客户|项目|上线|交付',
    parallelStarts: ['赋能', '打造', '推动', '实现', '通过', '基于'],
    verbStarts: ['负责', '交付', '完成', '对接', '从'],
    skillSections: ['技能与证书'],
    maxSentenceLength: 50,
    triadPattern: '[^，。；：]{2,6}、[^，。；：]{2,6}、[^，。；：]{2,6}',
    uniformBulletThreshold: 0.22,
    uniformPenalty: 35,
    humanPenaltyScale: 300,
    repeatNgram: 6,
    repeatMinCount: 4,
    repeatWeight: 4,
    repeatCap: 60,
    rules: [],
  },
  genres: [{
    id: 'resume', name: '简历 / 述职',
    weights: { struct: 30, vague: 20, syntax: 15, concrete: 25, repeat: 10, human: 0, cliche: 0 },
    cliche: ['赋能', '闭环', '沉淀'], note: '最怕标签式结构和口号',
    rules: [],
  }],
  defaultGenre: 'resume',
};

/* ---------------- 配置 ---------------- */
function deepMerge(base, over) {
  if (Array.isArray(over)) return over;
  if (over && typeof over === 'object') {
    const out = Array.isArray(base) ? [] : { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base ? base[k] : undefined, over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

function configPath() {
  if (process.env.DEAI_CONFIG) return process.env.DEAI_CONFIG;
  return existsSync(USER_CONFIG) ? USER_CONFIG : PACKAGE_CONFIG;
}

function loadConfig() {
  let cfg = JSON.parse(JSON.stringify(FALLBACK));
  const candidates = [PACKAGE_CONFIG];
  const chosen = configPath();
  if (chosen !== PACKAGE_CONFIG) candidates.push(chosen);
  for (const p of candidates) {
    if (p && existsSync(p)) {
      try {
        cfg = deepMerge(cfg, JSON.parse(readFileSync(p, 'utf8')));
      } catch { /* ignore broken config */ }
    }
  }
  if (!Array.isArray(cfg.genres) || cfg.genres.length === 0) cfg.genres = FALLBACK.genres;
  return cfg;
}

function saveUserConfig(cfg) {
  const dir = join(homedir(), '.dsh');
  if (!existsSync(dir)) throw new Error('.dsh 目录不存在');
  writeFileSync(USER_CONFIG, JSON.stringify(cfg, null, 2), 'utf8');
  return USER_CONFIG;
}

/* ---------------- 通用工具 ---------------- */
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const BULLET_RE = /^[•·-]|^（?\d+[.、)]/;
const LABEL_RE = /^([^：]{1,12})：/;
const SENT_RE = /[。！？；]/;
const count = (text, w) => text.split(w).length - 1;

function std(arr) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
  return [m, Math.sqrt(v)];
}

function splitParas(text) {
  const out = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (t) out.push({ text: t, line: i + 1 });
  });
  return out;
}

function splitSents(paras) {
  const out = [];
  for (const p of paras) {
    const body = p.text.replace(/^[•·-]\s*/, '');
    for (const s of body.split(SENT_RE)) {
      const t = s.trim();
      if (t.length >= 6) out.push({ text: t, line: p.line });
    }
  }
  return out;
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

function sentenceAround(text, index) {
  let start = index;
  while (start > 0 && !/[。！？；\n]/.test(text[start - 1])) start--;
  let end = index;
  while (end < text.length && !/[。！？；\n]/.test(text[end])) end++;
  return text.slice(start, end).trim();
}

function isLabel(t, cfg) {
  const m = LABEL_RE.exec(t);
  if (!m) return false;
  if (/\d/.test(m[1])) return false;
  return !cfg.common.verbStarts.some((v) => m[1].startsWith(v));
}

/* ---------------- 规则引擎 ---------------- */
/**
 * 跑一个体裁的 rules，返回 { flags, perRule, blocking, advisory }
 * 规则两种模式：
 *   - 默认：pattern 每命中一次记一条，severity 决定级次；
 *   - density：pattern 命中次数按每千字折算，超过 minPer1k 才报一条汇总。
 */
function runRules(text, rules) {
  const perRule = {};
  const flags = [];
  for (const r of rules) {
    if (!r || !r.pattern) continue;
    let re;
    try {
      const extra = String(r.flags || '').replace(/g/g, '');
      re = new RegExp(r.pattern, 'g' + extra);
    } catch { continue; }
    const found = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      found.push({ index: m.index, match: m[0] });
      if (found.length >= 500) break;
      if (m[0] === '') re.lastIndex++;
    }
    if (!found.length) continue;
    const stat = { count: found.length, rule: r };
    perRule[r.id || r.pattern] = stat;

    if (r.mode === 'density') {
      const perK = (found.length / Math.max(1, text.length)) * 1000;
      if (perK <= (r.minPer1k || 1)) continue;
      const first = found[0];
      flags.push({
        kind: r.name || r.id,
        severity: r.severity === 'blocking' ? 'blocking' : 'advisory',
        line: lineAt(text, first.index),
        sentence: sentenceAround(text, first.index),
        fix: `${r.fix || '改写成具体动作或事实'}（每千字 ${Math.round(perK)} 次，共 ${found.length} 处）`,
      });
    } else {
      for (const hit of found.slice(0, 40)) {
        flags.push({
          kind: r.name || r.id,
          severity: r.severity === 'blocking' ? 'blocking' : 'advisory',
          line: lineAt(text, hit.index),
          sentence: sentenceAround(text, hit.index),
          fix: r.fix || '按具体信息重写',
        });
      }
    }
  }
  const blocking = flags.filter((f) => f.severity === 'blocking').length;
  const advisory = flags.filter((f) => f.severity === 'advisory').length;
  return { flags, perRule, blocking, advisory };
}

function clichePenalty(perRule, n) {
  let pen = 0;
  for (const stat of Object.values(perRule)) {
    const r = stat.rule;
    if (r.mode === 'density') {
      const perK = (stat.count / Math.max(1, n)) * 1000;
      if (perK > (r.minPer1k || 1)) pen += Math.min(25, (perK / (r.minPer1k || 1)) * 12);
    } else {
      pen += stat.count * (r.severity === 'blocking' ? 14 : 5);
    }
  }
  return clamp(pen);
}

/* ---------------- 评分引擎 ---------------- */
function analyze(paras, genreId, cfg) {
  const prof = cfg.genres.find((g) => g.id === genreId) || cfg.genres.find((g) => g.id === cfg.defaultGenre) || cfg.genres[0];
  const c = cfg.common;
  const text = paras.map((p) => p.text).join('');
  const n = text.length || 1;
  const bullets = paras.filter((p) => BULLET_RE.test(p.text));
  const sents = splitSents(paras);
  const lens = sents.map((s) => s.text.length);

  /* 结构模板 */
  let section = '';
  const workBullets = [];
  for (const p of paras) {
    if (p.text.length <= 8 && !BULLET_RE.test(p.text)) section = p.text;
    if (BULLET_RE.test(p.text) && !(c.skillSections || []).includes(section)) workBullets.push(p.text);
  }
  const labels = workBullets.filter((b) => isLabel(b.replace(/^[•·-]\s*/, ''), cfg));
  const labelRatio = labels.length / Math.max(1, workBullets.length);
  let runs = 0, run = 1, prev = false;
  for (const b of workBullets) {
    const cur = isLabel(b.replace(/^[•·-]\s*/, ''), cfg);
    run = cur && prev ? run + 1 : 1;
    prev = cur;
  }
  if (run >= 3) runs += 1;
  const parallel = workBullets.filter((b) => (c.parallelStarts || []).some(
    (x) => b.replace(/^[•·-]\s*/, '').startsWith(x),
  )).length;
  let uniformPen = 0;
  if (bullets.length >= 6) {
    const [bm, bsd] = std(bullets.map((b) => b.text.length));
    if (bm && bsd / bm < (c.uniformBulletThreshold || 0.22)) uniformPen = c.uniformPenalty || 35;
  }
  const dimStruct = clamp(
    labelRatio * 200 + runs * 12 + parallel / Math.max(1, workBullets.length) * 60 + uniformPen,
  );

  /* 空泛词 */
  const baseWords = Array.isArray(prof.templateWords) ? prof.templateWords : (c.templateWords || []);
  const cliche = [...new Set([...baseWords, ...(prof.cliche || [])])];
  const hits = cliche.reduce((a, w) => a + count(text, w), 0);
  const dimVague = clamp((hits / n) * 100 * 90);

  /* 句法机械 */
  let mean = 0, sd = 0, cv = 0;
  if (lens.length) {
    [mean, sd] = std(lens);
    cv = mean ? sd / mean : 0;
  }
  const bank = clamp(((0.42 - cv) / 0.42) * 100);
  const starts = {};
  for (const s of sents) {
    const k = s.text.slice(0, 4);
    starts[k] = (starts[k] || 0) + 1;
  }
  const startRep = Math.max(0, ...Object.values(starts)) / Math.max(1, sents.length);
  const connDensity = ((c.connectors || []).reduce((a, w) => a + count(text, w), 0) / n) * 100;
  const triads = (text.match(new RegExp(c.triadPattern, 'g')) || []).length;
  const dimSyntax = clamp(bank * 0.45 + startRep * 250 * 0.25 + connDensity * 110 * 0.2 + triads * 3);

  /* 信息具体度 */
  const concrete = new RegExp(prof.concretePattern || c.concretePattern);
  const abstract = sents.filter((s) => !concrete.test(s.text));
  const dimConcrete = clamp((abstract.length / Math.max(1, sents.length)) * 100);

  /* 重复堆砌 */
  const ng = c.repeatNgram || 6;
  const grams = {};
  for (let i = 0; i <= text.length - ng; i++) {
    const g = text.slice(i, i + ng);
    if (!/[ ，。：、｜　]/.test(g)) grams[g] = (grams[g] || 0) + 1;
  }
  let rep = 0;
  for (const v of Object.values(grams)) if (v >= (c.repeatMinCount || 4)) rep += v - 2;
  const dimRepeat = clamp(rep * (c.repeatWeight || 4), 0, c.repeatCap || 60);

  /* 人味缺失 */
  const humanHits = (c.colloquial || []).reduce((a, w) => a + count(text, w), 0);
  const dimHuman = clamp(100 - (humanHits / Math.max(1, sents.length)) * (c.humanPenaltyScale || 300));

  /* 套路句式（规则驱动） */
  const rules = [...(c.rules || []), ...(prof.rules || [])];
  const ruleRun = runRules(text, rules);
  const dimCliche = clichePenalty(ruleRun.perRule, n);

  const dims = {
    结构模板: dimStruct,
    空泛词: dimVague,
    句法机械: dimSyntax,
    信息具体度: dimConcrete,
    重复堆砌: dimRepeat,
    人味缺失: dimHuman,
    套路句式: dimCliche,
  };
  const w = prof.weights || {};
  const score = (
    dims['结构模板'] * (w.struct || 0) + dims['空泛词'] * (w.vague || 0) + dims['句法机械'] * (w.syntax || 0)
    + dims['信息具体度'] * (w.concrete || 0) + dims['重复堆砌'] * (w.repeat || 0)
    + dims['人味缺失'] * (w.human || 0) + dims['套路句式'] * (w.cliche || 0)
  ) / 100;

  /* 句内打标（与规则互不重复：规则已命中的句子不再重复报同类） */
  const flags = [...ruleRun.flags];
  const seen = new Set(flags.map((f) => `${f.kind}｜${f.sentence}`));
  const push = (kind, severity, line, sentence, fix) => {
    const key = `${kind}｜${sentence}`;
    if (sentence.length < 6 || seen.has(key)) return;
    seen.add(key);
    flags.push({ kind, severity, line, sentence, fix });
  };
  const maxLen = c.maxSentenceLength || 50;
  let longCount = 0, triadCount = 0, dashCount = 0;
  for (const s of sents) {
    const t = s.text;
    if (t.length > maxLen && longCount < 20) { push('一句太长', 'advisory', s.line, t, '拆两句，长短交错'); longCount++; }
    if (new RegExp(c.triadPattern).test(t) && triadCount < 20) { push('三连以上并列', 'advisory', s.line, t, '留 1-2 项最关键的'); triadCount++; }
    if ((t.includes('——') || t.includes('→')) && dashCount < 10) { push('破折号/箭头', 'advisory', s.line, t, '拆句或改顿号'); dashCount++; }
  }
  for (const b of bullets) {
    const t = b.text.replace(/^[•·-]\s*/, '').trim();
    if (isLabel(t, cfg)) push('标签式开头', 'blocking', b.line, t, '改成完整句，或换开头');
    const hit = cliche.filter((x) => t.includes(x)).slice(0, 3);
    if (hit.length) push(`空泛词 ${hit.join('/')}`, 'advisory', b.line, t, '换成具体动作或事实');
    if (BULLET_RE.test(t) && !concrete.test(t)) push('没有具体信息', 'advisory', b.line, t, '补对象/数字/时间/动作');
  }

  flags.sort((a, b) => (a.severity === b.severity ? a.line - b.line : a.severity === 'blocking' ? -1 : 1));
  const blocking = flags.filter((f) => f.severity === 'blocking').length;
  const advisory = flags.filter((f) => f.severity === 'advisory').length;

  const bands = Array.isArray(prof.bands) && prof.bands.length ? prof.bands : cfg.bands;
  const band = bands.find((b) => score < b.max) || bands[bands.length - 1];
  const gateCfg = prof.gate || {};
  const gate = (gateCfg.maxBlocking === undefined && gateCfg.maxScore === undefined)
    ? null
    : {
      pass: blocking <= (gateCfg.maxBlocking ?? 0) && score <= (gateCfg.maxScore ?? 100) && advisory <= (gateCfg.maxAdvisory ?? 999),
      maxBlocking: gateCfg.maxBlocking ?? 0,
      maxScore: gateCfg.maxScore ?? 100,
      maxAdvisory: gateCfg.maxAdvisory ?? 999,
    };

  return {
    score: Math.round(score * 10) / 10,
    band: band.label,
    bandAction: band.action || '',
    genreId: prof.id || genreId,
    genre: prof.name,
    note: prof.note || '',
    gate,
    counts: { blocking, advisory, rules: ruleRun.blocking + ruleRun.advisory },
    dims: Object.entries(dims).map(([k, v]) => ({ name: k, value: Math.round(v) })),
    stats: {
      段落: paras.length,
      句子: sents.length,
      平均句长: Math.round(mean * 10) / 10,
      变异系数: Math.round(cv * 100) / 100,
      标签式: labels.length,
      模板词: hits,
      空句比例: Math.round((abstract.length / Math.max(1, sents.length)) * 100) / 100,
      规则命中: ruleRun.blocking + ruleRun.advisory,
    },
    flags,
  };
}

/* ---------------- 渲染 ---------------- */
function renderAudit(args, value) {
  const lines = [
    `AI 味分数：${value.score}/100（${value.band}）　文体：${value.genre}`,
  ];
  if (value.gate) {
    const verdict = value.gate.pass
      ? '可以交付'
      : `不可交付（阻断 ${value.counts.blocking} > 上限 ${value.gate.maxBlocking}，或分数 ${value.score} > 上限 ${value.gate.maxScore}）`;
    lines.push(`门禁：${verdict}`);
  }
  lines.push(`维度：${value.dims.map((d) => `${d.name} ${d.value}`).join(' / ')}`);
  lines.push(`统计：${Object.entries(value.stats).map(([k, v]) => `${k} ${v}`).join(' / ')}`);
  if (value.note) lines.push(`提示：${value.note}`);
  lines.push('');
  if (value.flags.length === 0) {
    lines.push('没有命中打标项，读一遍念着顺就可以交付。');
    return [{ type: 'text', text: lines.join('\n') }];
  }
  const limit = args.detail === 'full' ? 40 : 10;
  const blocking = value.flags.filter((f) => f.severity === 'blocking');
  const advisory = value.flags.filter((f) => f.severity === 'advisory');
  if (blocking.length) {
    lines.push(`阻断项（${blocking.length} 条，必须改）：`);
    blocking.slice(0, Math.max(1, limit - Math.min(advisory.length, 4))).forEach((f, i) => {
      lines.push(`${i + 1}. 第 ${f.line} 行 [${f.kind}] ${f.sentence}`);
      lines.push(`   改法：${f.fix}`);
    });
  }
  if (advisory.length) {
    lines.push('');
    lines.push(`建议项（${advisory.length} 条）：`);
    advisory.slice(0, limit).forEach((f, i) => {
      lines.push(`${i + 1}. 第 ${f.line} 行 [${f.kind}] ${f.sentence}`);
      lines.push(`   改法：${f.fix}`);
    });
  }
  if (value.flags.length > limit) lines.push(`（还有 ${value.flags.length - limit} 条未展开，用 detail:"full" 看全部）`);
  return [{ type: 'text', text: lines.join('\n') }];
}

/* ---------------- 参数与输出 schema ---------------- */
const GENRE_ENUM = ['resume', 'report', 'doc', 'article', 'marketing', 'bid', 'email', 'fiction'];

const AUDIT_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', description: '要审的正文，可含换行和多段。小说请整章传，行号才对得上。' },
    genre: {
      type: 'string',
      enum: GENRE_ENUM,
      description: '文体：resume 简历/述职；report 方案/汇报；doc 文档/说明书；article 公众号/知乎；'
        + 'marketing 营销；bid 标书；email 邮件；fiction 小说/网文（走套路句式 lint，看 blocking 是否为 0）。省略则用默认文体。',
    },
    detail: {
      type: 'string',
      enum: ['summary', 'full'],
      description: 'summary 给前十来条；full 给更多。默认 summary。',
    },
  },
  required: ['text'],
};

const AUDIT_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'number' },
    band: { type: 'string' },
    bandAction: { type: 'string' },
    genreId: { type: 'string' },
    genre: { type: 'string' },
    note: { type: 'string' },
    gate: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            pass: { type: 'boolean' },
            maxBlocking: { type: 'number' },
            maxScore: { type: 'number' },
            maxAdvisory: { type: 'number' },
          },
          required: ['pass', 'maxBlocking', 'maxScore', 'maxAdvisory'],
        },
      ],
    },
    counts: {
      type: 'object',
      additionalProperties: false,
      properties: {
        blocking: { type: 'number' },
        advisory: { type: 'number' },
        rules: { type: 'number' },
      },
      required: ['blocking', 'advisory', 'rules'],
    },
    dims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { name: { type: 'string' }, value: { type: 'number' } },
        required: ['name', 'value'],
      },
    },
    stats: {
      type: 'object',
      additionalProperties: false,
      properties: {
        段落: { type: 'number' },
        句子: { type: 'number' },
        平均句长: { type: 'number' },
        变异系数: { type: 'number' },
        标签式: { type: 'number' },
        模板词: { type: 'number' },
        空句比例: { type: 'number' },
        规则命中: { type: 'number' },
      },
      required: ['段落', '句子', '平均句长', '变异系数', '标签式', '模板词', '空句比例', '规则命中'],
    },
    flags: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'advisory'] },
          line: { type: 'number' },
          sentence: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['kind', 'severity', 'line', 'sentence', 'fix'],
      },
    },
  },
  required: ['score', 'band', 'bandAction', 'genreId', 'genre', 'note', 'gate', 'counts', 'dims', 'stats', 'flags'],
};

const CONFIG_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ['get', 'genres', 'set', 'reset'],
      description: 'get 读配置；genres 列文体；set 写用户配置（config 传 JSON 字符串）；reset 恢复默认。',
    },
    config: { type: 'string', description: 'action=set 时的完整配置 JSON 字符串。' },
  },
  required: ['action'],
};

const CONFIG_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    path: { type: 'string' },
    message: { type: 'string' },
    config: { type: 'string' },
    genres: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['id', 'name', 'note'],
      },
    },
  },
  required: ['ok', 'path', 'message'],
};

/* ---------------- 注册 ---------------- */
export function apply(ctx) {
  ctx.tools.register({
    name: 'deai_audit',
    description:
      'Score Chinese copy for "AI flavor" and list the sentences that need rewriting, with line numbers. '
      + 'Use when the user asks to check or remove AI flavor (去 AI 味, 太像 AI, 润色), before delivering '
      + 'outward-facing copy (简历、述职、方案/汇报、文档、公众号、营销文案、标书、邮件), '
      + 'or before declaring a novel chapter done (genre:"fiction": 看 counts.blocking 是否为 0，而不是看总分). '
      + 'Returns a 0-100 score (lower is more natural), seven dimension scores, a gate verdict, and flags with '
      + 'severity (blocking/advisory), line number and fix hint. '
      + 'Rewrite only the flagged sentences yourself; keep facts and jargon (PMP/GIS/驻场/联调) intact.',
    parameters: AUDIT_PARAMS,
    output: { schema: AUDIT_OUTPUT, render: renderAudit },
    async execute(args) {
      const cfg = loadConfig();
      const genre = args.genre || cfg.defaultGenre || 'resume';
      return analyze(splitParas(args.text), genre, cfg);
    },
  });

  ctx.tools.register({
    name: 'deai_audit_config',
    description:
      'Read or change the deai_audit configuration: list genres, dump/merge the config JSON, or reset to defaults. '
      + 'Config covers word lists, regex rules (regex or density mode), thresholds, score bands, per-genre '
      + 'dimension weights and delivery gates.',
    parameters: CONFIG_PARAMS,
    output: { schema: CONFIG_OUTPUT, render: (_a, v) => [{ type: 'text', text: v.message }] },
    async execute(args) {
      const path = configPath();
      if (args.action === 'genres') {
        const cfg = loadConfig();
        return {
          ok: true,
          path,
          message: cfg.genres.map((g) => `${g.id}  ${g.name}`).join('\n'),
          genres: cfg.genres.map((g) => ({ id: g.id, name: g.name, note: g.note || '' })),
        };
      }
      if (args.action === 'get') {
        const cfg = loadConfig();
        const dump = JSON.stringify(cfg, null, 2);
        return {
          ok: true,
          path,
          message: `当前配置文件：${path}\n${dump.slice(0, 4000)}`,
          config: dump,
        };
      }
      if (args.action === 'set') {
        if (!args.config) throw new Error('action=set 需要 config（完整 JSON 字符串）');
        let next;
        try {
          next = JSON.parse(args.config);
        } catch (e) {
          throw new Error('config 不是合法 JSON：' + e.message);
        }
        const saved = saveUserConfig(next);
        return { ok: true, path: saved, message: `已写入用户配置：${saved}` };
      }
      if (args.action === 'reset') {
        if (existsSync(USER_CONFIG)) unlinkSync(USER_CONFIG);
        return { ok: true, path: configPath(), message: '已删除用户配置，恢复为包内默认配置' };
      }
      return { ok: false, path, message: `未知 action：${args.action}` };
    },
  });
}

export default { name, inject, apply };
