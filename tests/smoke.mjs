/**
 * 冒烟测试：用 mock ctx 加载 index.js，跑四条样例。
 * 运行：node tests/smoke.mjs
 */
import { apply } from '../index.js';

const tools = new Map();
const ctx = { tools: { register: (t) => tools.set(t.name, t) } };
apply(ctx);

function call(name, args) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`工具没注册：${name}`);
  return tool.execute(args);
}

const SLOP = `第7章 摊牌

他缓缓抬起头，眼底闪过一丝难以言说的情绪。空气仿佛在这一刻凝固了，时间也静止下来。

"你早就知道了？"她问。

声音不大，却像一记重锤砸在他心口。他没有回答，不是不想说，而是说不出口。没有犹豫，没有退缩，他就那样站着。

深吸一口气，他嘴角勾起一抹苦涩的弧度。心里一沉，后背发凉，冷汗顺着脊背滑下来。他知道，有些事情再也回不去了。

这个世界仿佛只剩下他们两个人。瞳孔微缩，他的手指不由得攥紧了袖口——那一瞬间，他忽然明白，有些话一旦说出口，就真的没有退路了。

这一刻，他终于明白，原来所有的等待都是值得的。`;

const CLEAN = `第7章 摊牌

他把烟按进烟灰缸，碾了两下，才抬头。

"你早就知道了？"她站在门口，鞋没换，手里还攥着车钥匙。

他没接话，伸手把桌上的凉茶推过去。杯子外壁有水珠，在桌面留下一圈印子。她没动。

窗外有人在喊收废品，喇叭声过去又回来。他数到第三遍，才开口："你妈上礼拜来过。"

她的手停在那圈水印上，指甲盖泛白。过了几秒，她把钥匙放在桌上，转身去门口换鞋。鞋跟磕在门槛上，响了一声。`;

const RESUME = `个人优势：
• 主导：负责分局 GIS 平台建设，覆盖 6 个派出所
• 赋能：通过 AI 赋能基层，打造闭环体系
• 沉淀：沉淀方法论，助力全员提效
• 协同：推动多部门协同，实现全链路贯通`;

const REPORT = `一、总体情况
我们高度重视此项工作，持续推进相关建设，不断完善工作机制，进一步加强统筹协调，全面提升服务水平，扎实推进各项任务，有力保障业务稳定运行。

二、下一步
首先，其次，此外，同时，因此，综上，我们坚信未来可期。`;

const cases = [
  ['小说 AI 腔', 'fiction', SLOP, (r) => r.counts.blocking >= 4 && r.gate && r.gate.pass === false],
  ['小说干净文本', 'fiction', CLEAN, (r) => r.counts.blocking === 0 && r.gate && r.gate.pass === true],
  ['简历标签体', 'resume', RESUME, (r) => r.counts.blocking >= 1 && r.flags.some((f) => f.kind === '标签式开头')],
  ['方案空转', 'report', REPORT, (r) => r.score > 20 && r.flags.length > 0],
  // 校准：改编自句式库的段落级对照，人工写的同场景写法不应被阻断
  ['对照·威压（AI 腔）', 'fiction',
    '他缓缓抬起头，目光扫过全场。空气仿佛凝固了。他的声音不大，却像一记重锤砸在每个人心上："谁还有意见？"全场死寂，落针可闻。',
    (r) => r.counts.blocking >= 3],
  ['对照·威压（自然写法）', 'fiction',
    '他把茶喝完，杯底在桌上磕了一声。"谁还有意见？"靠门那个人本来在嗑瓜子，手停在半空，看看左右，把瓜子放回了口袋。',
    (r) => r.counts.blocking === 0],
  ['对照·打脸（AI 腔）', 'fiction',
    '他淡淡地扫了一眼众人，嘴角勾起一抹弧度。"就凭你们，也想拦我？"话音落下，全场哗然。所有人都震惊地看着他。长老更是瞳孔一缩，失声道："这……这怎么可能！"',
    (r) => r.counts.blocking >= 4],
  ['对照·打脸（自然写法）', 'fiction',
    '"让让。"他说。挡在门口的两个弟子没动，他抬手把左边那个的剑鞘按下去，剑鞘磕在门槛上。右边那个自己退了半步。台阶上有人开始收摊，动作很快。',
    (r) => r.counts.blocking === 0],
  ['对照·决断（AI 腔）', 'fiction',
    '他站在原地，久久没有动。这一刻，他终于明白，有些路一旦走上去，就再也回不了头。他深吸一口气，转身走进雨里。他知道，从今往后，他只能一个人走下去了。',
    (r) => r.counts.blocking >= 3],
  ['对照·决断（自然写法）', 'fiction',
    '他在楼道里站了一会儿，把手机里的联系人翻到"妈"，停住，又退回去。雨还在下。他把外套的帽子扣上，走之前回头看了一眼那扇亮着灯的窗。',
    (r) => r.counts.blocking === 0],
];

let failed = 0;
for (const [label, genre, text, check] of cases) {
  const r = await call('deai_audit', { text, genre, detail: 'full' });
  const ok = check(r);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${r.score}/100  blocking=${r.counts.blocking} advisory=${r.counts.advisory} gate=${r.gate ? r.gate.pass : 'n/a'}`);
  if (!ok || process.env.VERBOSE) {
    for (const f of r.flags.slice(0, 8)) console.log(`        L${f.line} [${f.severity}] ${f.kind}：${f.sentence}`);
  }
}

const list = await call('deai_audit_config', { action: 'genres' });
console.log(`\n体裁：${list.message.replace(/\n/g, ' / ')}`);
const genres = list.genres.map((g) => g.id);
const expect = ['resume', 'report', 'doc', 'article', 'marketing', 'bid', 'email', 'fiction'];
if (expect.some((g) => !genres.includes(g))) { failed++; console.log('FAIL  体裁缺失'); }

const old = await call('deai_audit', { text: '负责浦东分局 GIS 地图平台上线，覆盖 6 个派出所，驻场 3 个月完成联调与验收。', genre: 'resume' });
console.log(`\n老体裁回归：${old.score}/100 blocking=${old.counts.blocking}`);

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 条未通过`);
process.exit(failed === 0 ? 0 : 1);
