/**
 * 用规则表重建 fiction.rules（避免手写 JSON 转义出错）。
 * 运行：node tools/build-fiction-rules.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const P = new URL('../config/deai-config.json', import.meta.url);
const cfg = JSON.parse(readFileSync(P, 'utf8'));
const fiction = cfg.genres.find((g) => g.id === 'fiction');

const rules = [
  // —— 情绪直给 ——
  { id: 'not-is', name: '不是X，而是Y', severity: 'blocking', pattern: '不是[^，。！？；]{1,14}[，,]\\s*(而)?是', fix: '把判断换成一个动作或一个可看见的物件' },
  { id: 'not-is-2', name: '并非X，而是Y', severity: 'blocking', pattern: '并非[^，。！？；]{1,14}[，,]\\s*(而)?是', fix: '同上：别下定义，让读者自己得出' },
  { id: 'emotion-verdict', name: '心中涌起一种情绪', severity: 'blocking', pattern: '(心中|心里|内心|心头)(充满|涌起|升起|泛起|生出)了?(一种|一股|几分|些许)?[^，。！？]{1,12}(情绪|感觉|滋味|念头)', fix: '删掉情绪名词，只留一个能与之对上的动作' },
  { id: 'zhe-dai', name: '带着几分X', severity: 'advisory', pattern: '(带着|透着|含着|挂着)(几分|一丝|些许|一抹|淡淡)(的)?[^，。]{1,8}', fix: '给表情加一个不对付的细节，别贴标签' },
  { id: 'emotion-tell', name: '情绪直给', severity: 'advisory', pattern: '(非常|极其|无比|十分|极度)(愤怒|震惊|难过|悲伤|害怕|紧张|激动|痛苦|开心|恐惧|绝望)', fix: '删掉形容词，写他做了什么、没做成什么' },

  // —— 否定排比 ——
  { id: 'neg-parade', name: '没有A，没有B', severity: 'blocking', pattern: '没有[^，。！？；]{1,10}[，,]\\s*没有', fix: '留一个否定就够，另一个改成正面动作' },
  { id: 'neg-three', name: '不是X，也不是Y，而是Z', severity: 'blocking', pattern: '不是[^。！？]{1,25}，?也不是[^。！？]{1,25}，?而是', fix: '砍成一句白描加一个动作' },
  { id: 'neg-triple', name: '既不X，也不Y，只是Z', severity: 'advisory', pattern: '(既|没有|不曾)[^。！？]{1,10}，(也|也没有|不曾)[^。！？]{1,10}，(更|更没有|只是)', fix: '挑最具体的一项写足，另两项删掉' },

  // —— 万能比喻 ——
  { id: 'metaphor-hammer', name: '如同一记重锤', severity: 'blocking', pattern: '(如同|宛如|仿佛|就像|像)(一记|一柄|一把|一道)(重锤|锤子|刀|利刃|冰水|惊雷|闪电)', fix: '删掉比喻，写本体造成的具体后果' },
  { id: 'metaphor-deity', name: '宛如一尊魔神', severity: 'blocking', pattern: '(如同|宛如|仿佛|像是)(一?[个位名尊]|走出的|降临的)?[^，。]{0,6}(魔神|深渊|宿命|审判|死神|修罗|神明)', fix: '写旁人被吓到的具体反应，别贴身份标签' },
  { id: 'as-if', name: '仿佛/似乎 高频', severity: 'advisory', mode: 'density', minPer1k: 6, pattern: '(仿佛|似乎|好像|宛如|恍若|似是)', fix: '比喻每段最多一个，其余改成事实陈述' },

  // —— 身体反应 ——
  { id: 'deep-breath', name: '深吸一口气', severity: 'blocking', pattern: '(深深|缓缓|轻轻|长长|暗暗)?地?(吸|呼)(了)?(一?口气|一口气)', fix: '写他为什么需要这口气：手抖、腿软、话没接上' },
  { id: 'pupil-shrink', name: '瞳孔一缩', severity: 'blocking', pattern: '瞳孔(猛地|骤然|倏地|微微一?|狠狠)?(一缩|收缩|缩紧|放大|涣散)', fix: '写旁观者看得见的东西：杯子磕在桌沿、话说到一半改口' },
  { id: 'cold-sweat', name: '后背发凉/冒冷汗', severity: 'blocking', pattern: '(后背|脊背|背脊|后颈|头皮)(一凉|发凉|发麻|炸开)|(冒出?|沁出)(一层)?冷汗', fix: '写他为了不显得怕所做的补救动作' },
  { id: 'heart-skip', name: '心跳漏一拍', severity: 'blocking', pattern: '(心跳|心脏)(漏了?一拍|猛地一(顿|停)|骤然加速)|血液(仿佛)?(凝固|倒流|冲上头顶)', fix: '写注意力的偏移，或他答非所问' },
  { id: 'heart-drop', name: '心里一沉', severity: 'blocking', pattern: '(心里|心中|心下|心头)[^。！？]{0,2}(一凛|一沉|一紧|一颤|一暖)', fix: '写身体先于意识的反应，或他下意识做的动作' },

  // —— 神情外貌 ——
  { id: 'eye-flash', name: '眼底闪过一丝', severity: 'blocking', pattern: '(眼底|眼中|眼里|眸中|眸底|眼神)(深处)?(闪过|掠过|划过|浮起)(一丝|一抹|几分|些许|一道)', fix: '写眼睛实际在做什么，或删掉表情写下一句换了话题' },
  { id: 'mouth-arc', name: '嘴角勾起弧度', severity: 'blocking', pattern: '(嘴角|唇边|唇角)(微微)?(勾起|扬起|掀起|浮起|漾起)(了)?(一?抹|一丝|一个|淡淡的?)(弧度|笑意|笑|微笑|冷笑|嘲讽)', fix: '交代这个笑冲着谁、在什么之后' },
  { id: 'face-abstraction', name: '眉眼弯弯/神色复杂', severity: 'advisory', pattern: '眉眼(弯弯|含笑|带笑|舒展|一挑)|神色(复杂|古怪|莫名|晦暗|难辨)|表情(复杂|微妙|耐人寻味)', fix: '给一个有身份的细节，别用成语概括整张脸' },

  // —— 转折腔 ——
  { id: 'voice-but', name: '声音不大，却…', severity: 'blocking', pattern: '(声音|语气|语调|音量)(不大|不高|很轻|低沉|平静)[，,]?\\s*(却|但|可|偏偏)', fix: '写这句话造成的具体反应：谁停了手、谁放了东西' },
  { id: 'contrast-pair', name: '明明…却… / 看似…实则…', severity: 'advisory', pattern: '明明[^。！？]{2,20}(却|可是|偏偏)|看似[^。！？]{2,15}(实则|其实|却)', fix: '删掉总结那一半，只留动作和它违背常理的地方' },

  // —— 总结腔 ——
  { id: 'he-knew', name: '他知道，…', severity: 'blocking', pattern: '(他|她|我)(知道|明白|清楚|意识到|懂得)[，,]\\s*[^。！？]{4,}', fix: '删掉这句总结，换成为此做的准备或放弃' },
  { id: 'finale-sum', name: '这一刻，他明白', severity: 'blocking', pattern: '(这一刻|那一瞬|那一?刻|直到这时|多年以后)[，,]?\\s*(他|她|我)(才|终于)?(明白|懂了|知道|意识到)', fix: '把「明白」删掉，直接写他因此做了什么决定' },
  { id: 'narrator-leak', name: '他不知道的是…', severity: 'blocking', pattern: '(他|她|我)(并)?不知道的是|这一切(才)?(只)?是(个)?开始|(命运|齿轮)(开始)?转动(了)?', fix: '直接把那个人/那件事写出来，只写动作不写身份' },
  { id: 'no-return', name: '再也回不去了', severity: 'advisory', pattern: '(再也)?回不(去|了)|没有回头路|一旦[^。！？]{2,15}[，,]?就(再也)?(无法|不能|回不去)', fix: '写他放弃的那件具体东西，别预告后果' },

  // —— 时间静止 ——
  { id: 'freeze', name: '空气/时间凝固', severity: 'blocking', pattern: '(空气|气氛|时间|空间|世界|全场)(仿佛|似乎|像是)?(瞬间|刹那|一下子|陡然)?(凝固|静止|停滞|冻结|安静下来|安静了)', fix: '写一个最不该动的人动了，比写整个世界更有力' },
  { id: 'century', name: '仿佛过了一个世纪', severity: 'advisory', pattern: '(仿佛|好像|像是)(过了|过去)(一个世纪|很久很久|半个世纪)|不知(道)?过了多久', fix: '用能计时、会变化的东西：烟烧到手指、声控灯灭了两次' },

  // —— 环境起兴 ——
  { id: 'scene-open', name: '夜色深沉，月光如水', severity: 'blocking', flags: 'm', pattern: '^(夜色|夜幕|月光|月色|夜风|晚风|天边|窗外|雨声|晨光)[^。]{0,10}(深沉|如水|微凉|渐浓|低垂|洒落|笼罩)', fix: '让环境参与动作：路灯坏了一盏，他经过时脚下暗了一下' },

  // —— 万能动作 ——
  { id: 'slow-words', name: '缓缓/微微 高频', severity: 'advisory', mode: 'density', minPer1k: 8, pattern: '(缓缓|微微|轻轻|默默|静静|淡淡)', fix: '一章里留 1-2 个，其余换成直接动作' },
  { id: 'slow-verb', name: '缓缓+动作 高频', severity: 'advisory', mode: 'density', minPer1k: 6, pattern: '(缓缓|微微|轻轻|淡淡|默默|静静)地?(抬起|转头|点头|摇头|皱眉|笑了笑|开口|闭上|垂下|握紧|叹息)', fix: '只留一个动作并写实：他抬头，脖子响了一声' },
  { id: 'pause-then', name: '顿了顿，才…', severity: 'advisory', mode: 'density', minPer1k: 4, pattern: '(顿了顿|顿了一下|沉默(了)?(片刻|一会儿|半晌)|沉吟(了)?(片刻|半晌))[，,]?\\s*(才|方才|然后|随即)', fix: '删掉停顿词直接给台词，要停就写成动作' },
  { id: 'body-chain', name: '身体部件动作链', severity: 'advisory', mode: 'density', minPer1k: 6, pattern: '(抬眼|抬眸|垂眸|垂眼|抿唇|咬唇|攥|握紧|蹙眉|挑眉)', fix: '挑一个和台词冲突的动作留下' },

  // —— 对白腔 ——
  { id: 'dialogue-stutter', name: '你……你竟然', severity: 'blocking', pattern: '你[，。…\\s]{0,6}你(竟然|居然|怎么|真的|敢)', fix: '写半句没说完的话和随后的动作' },
  { id: 'cold-say', name: '淡淡道/冷道', severity: 'advisory', mode: 'density', minPer1k: 5, pattern: '(冷冷|淡淡|缓缓|沉声|低声|轻声|平静)地?(说道|开口|道|说)', fix: '删标签，让台词自己冷' },
  { id: 'sneer', name: '呵/冷笑一声', severity: 'advisory', pattern: '(^|[。！？])(呵|哼|哦)[。？…，]|(冷笑|嗤笑|轻笑)(了)?一声', fix: '换成一句真正难听的话，或一个把人晾着的动作' },

  // —— 爽点套话 ——
  { id: 'crowd-dead', name: '全场死寂/落针可闻', severity: 'blocking', pattern: '(全场|四周|大厅|包厢)(一片)?(死寂|寂静|哗然)|落针可闻|鸦雀无声|(所有人|众人|在场的人)(都)?(震惊|呆住|愣住|倒吸一口凉气)', fix: '只写一个人的反应，用它代表全场' },
  { id: 'praise-cliche', name: '此子不简单/也配', severity: 'blocking', pattern: '此子(不简单|日后必成大器|前途不可限量)|蝼蚁(一般|而已)?|也配|不知天高地厚|这怎么可能|绝对不可能', fix: '让评价带上私心或依据，或者删掉夸奖只写结果' },

  // —— 标点 ——
  { id: 'em-dash', name: '破折号', severity: 'advisory', pattern: '——', fix: '中文小说正文用句号断句，破折号只留必要时' },
];

fiction.rules = rules;
writeFileSync(P, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
const by = { blocking: 0, advisory: 0 };
for (const r of rules) by[r.severity] = (by[r.severity] || 0) + 1;
console.log(`fiction rules: ${rules.length}（blocking ${by.blocking} / advisory ${by.advisory}）`);
