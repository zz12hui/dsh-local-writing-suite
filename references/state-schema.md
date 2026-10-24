# 状态文件 schema（追踪/_state.json）

状态机由 `scripts/story-state.mjs` 维护。**`_state.json` 是唯一结构化权威**，`上下文.md` 是它渲染出来的派生视图。

## 目录

```
<项目>/追踪/
  _state.json     权威状态，脚本读写，人一般不用手改
  上下文.md        每次 save 时整份重渲染，手改会被 check 判为漂移
```

## 结构

```json
{
  "version": 1,
  "title": "书名",
  "revision": 7,
  "current": { "chapter": 21, "volume": "第一卷", "storyTime": "事件后第二天" },
  "constraints": ["军宣爽点必须通过作品效果兑现，不能只靠系统播报"],
  "hooks": [
    { "id": "F016", "desc": "师姐带着半块玉佩", "at": 4, "due": 12, "level": "高", "status": "open" }
  ],
  "truths": [
    { "id": "E001", "desc": "师父是灭门主谋", "revealed": false, "revealedAt": 22 }
  ],
  "known": ["江晨看到信上那句话"],
  "promises": ["第22章补寿宴伏笔"],
  "chapters": [
    { "n": 21, "title": "离别怎么会开花", "words": 2068, "file": "正文/第021章_*.md", "outline": "大纲/细纲_第021章.md", "at": "2026-10-24T02:00:00.000Z" }
  ]
}
```

| 字段 | 含义 | 谁写 |
| --- | --- | --- |
| `current.chapter` | 当前写到第几章 | `chapter` 命令自动推进 |
| `constraints` | 长期约束（爽点兑现方式、不能越的边界） | 人工经脚本或直接编辑 |
| `hooks[]` | 伏笔：`at` 埋点章、`due` 计划回收章、`level` 高/中/低、`status` open/done | `hook add` / `hook done` |
| `truths[]` | 作者真相（读者尚不知道）；`revealed` 为 false 时正文不得当已知 | `truth add` / `truth reveal` |
| `known[]` | 读者已知信息，用来查“人物提前知道答案” | 人工维护 |
| `promises[]` | 下一章承诺（要在下一章兑现的事） | 人工维护 |
| `chapters[]` | 逐章记录，`check` 校验连续性 | `chapter` 命令追加 |

## 命令

```powershell
$S = "$env:USERPROFILE\.dsh\local-plugins\dsh-local-writing-suite\scripts\story-state.mjs"

node $S init    --dir <项目> [--title 书名] [--force]
node $S status  --dir <项目> [--json]
node $S chapter --dir <项目> --n 21 --title 章名 --words 2068 --file 正文/... --outline 大纲/...
node $S hook    --dir <项目> add  --id F016 --desc "..." --at 4 [--due 12] [--level 高]
node $S hook    --dir <项目> done --id F016 --at 12
node $S truth   --dir <项目> add    --id E001 --desc "..."
node $S truth   --dir <项目> reveal --id E001 --at 22
node $S check   --dir <项目> [--json]
```

退出码：`check` 有 `[阻断]` 项时返回 1，脚本化流水线可以直接用。

## check 的判定

**阻断（exit 1）**

1. 章号不连续（缺第 N 章）。
2. 伏笔到了 `due` 章还没回收。
3. `truths` 里未揭示的真相，其描述前 12 字出现在 `known` 里。

**注意（不影响退出码）**

- 单章字数 < 1500（疑似残稿）、没有字数记录。
- `current.chapter` 与 `chapters` 最大章号不一致。
- `上下文.md` 与 `_state.json` 不一致（手改过派生文件）。
- 正文/细纲文件不存在。
- 高危未回收伏笔 > 12 条。

**提示**

- `constraints` 为空、`hooks` 为空。

## 为什么不让模型自己记

模型上下文会被压缩、会换会话。状态必须落在磁盘上，且由确定性脚本渲染——这样“手改派生文件”和“状态静默消失”都能被抓出来。这是 oh-story 那套工程里最值得抄的一条。
