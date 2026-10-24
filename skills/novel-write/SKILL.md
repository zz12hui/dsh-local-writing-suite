---
name: novel-write
description: 写长篇/短篇小说的流程：开书、搭大纲、写细纲、写正文、续写、导入旧稿。强制写前读状态卡、写后跑去 AI 味门禁与状态检查，防止吃书、崩人设和 AI 腔。
---

# 小说写作（novel-write）

> 状态脚本位置：`$env:USERPROFILE\.dsh\local-plugins\dsh-local-writing-suite\scripts\story-state.mjs`
> 下文写 `node scripts/story-state.mjs` 是简写，实际用绝对路径（或先 `cd` 到插件目录）。
> 本 skill 目录下的 `references/` 有完整的句式库和状态 schema。

## 项目结构（先有结构，再动笔）

```
<项目>/
  设定/            世界观、角色卡（一个角色一个文件）
  大纲/            总纲、卷纲、细纲_第NNN章.md
  正文/            第NNN章_章名.md
  拆文库/          对标书的拆文报告
  追踪/
    _state.json    唯一权威：章号、伏笔、真相、约束、逐章记录
    上下文.md      由 _state.json 渲染，不要手改
```

没有结构就先生成骨架，别直接产出正文。

## 写一章的顺序（不要跳步）

### 1. 读状态

```powershell
node scripts/story-state.mjs status --dir <项目>
```

要点：当前章号、活跃伏笔（尤其 high）、长期约束、作者真相（哪些还没揭示）。
上下文卡只有 12 KiB 以内，直接读没问题；正文和设定按需读，不要全书塞进上下文。

### 2. 读细纲

`大纲/细纲_第NNN章.md` 必须存在且写清楚：本章目标情绪、必须发生的变化、10 个左右情节点、章末钩子、字数目标。
**没有细纲就先补细纲**，补完自检一遍再写正文——直接写正文是烂尾的头号原因。

### 3. 写正文

守 `references/ai-fiction-patterns.md` 的 34 条，重点是开头 5 条：

1. 情绪不命名，改成动作/物件/对话。
2. 身体反应（心跳、冷汗、瞳孔、深吸一口气）一章最多一次。
3. 不写否定排比（没有A，没有B）。
4. 不写现成比喻（重锤、惊雷、冰水、深渊、魔神）。
5. 不写叙述者总结（他知道 / 这一刻他明白 / 他不知道的是）。

另外三条工程约束：

- 一段一件事，别把三件事挤进一段。
- 对白要能区分谁在说；不加“冷冷道”这类标签。
- 章末钩子落在具体动作或未说完的话上，不落在“他不知道的是……”。

### 4. 跑门禁

```
deai_audit({ genre: "fiction", detail: "full", text: <整章> })
```

- `counts.blocking > 0`：按 `line` 定位，逐条改。改法是“换结构”，不是换词。
- 改完再跑一次，直到 `blocking === 0`。
- `advisory` 不必全清，一章留 3–5 条很正常；超过 15 条再考虑压。

### 5. 提交状态

```powershell
node scripts/story-state.mjs chapter --dir <项目> --n 21 --title "离别怎么会开花" --words 2068 --file "正文/第021章_离别怎么会开花.md" --outline "大纲/细纲_第021章.md"
node scripts/story-state.mjs check --dir <项目>
```

`chapter` 会更新当前章、追加逐章记录、把到期的伏笔标成回收，并重渲染 `上下文.md`。
`check` 有 `[阻断]` 项就先处理，别接着写下一章。

## 伏笔与真相

```powershell
# 埋
node scripts/story-state.mjs hook add --dir <项目> --id F016 --desc "师姐带着半块玉佩" --at 4 --due 12 --level 高
# 收
node scripts/story-state.mjs hook done --dir <项目> --id F016 --at 12
# 作者真相（读者还不知道的事）
node scripts/story-state.mjs truth add --dir <项目> --id E001 --desc "师父是灭门主谋"
node scripts/story-state.mjs truth reveal --dir <项目> --id E001 --at 22
```

规则：`level: 高` 的伏笔不能拖过 `due`；作者真相揭示前，正文里不能有人物把它当成已知事实说出来。

## 字数口径

- 细纲里先写死目标字数，正文只按这个目标写（常见 2000–3000）。
- 欠字不靠加戏凑，超字最多压缩一次。
- `chapter --words` 用机器统计的字数（去掉标题、空行）。

## 常见失败与处理

| 现象 | 多半是 | 处理 |
| --- | --- | --- |
| 写出来在复述设定 | 细纲只有情节没有变化 | 回第 2 步，把细纲改成“本章必须发生什么变化” |
| 人设前后不一致 | 没读到角色卡 | 重读 `设定/角色/<名>.md`，把状态写回 state |
| 伏笔写丢 | 没看活跃伏笔 | `status` 看一眼，本章能不能顺手推进一条 |
| 改完还是 AI 腔 | 只换了词 | 按 blocking 的 fix 换结构：判断→动作、形容词→物件、总结→对话 |
