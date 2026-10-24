---
name: writing-suite
description: 写作与审查套件的入口路由。用户要写/续写小说、拆书、审稿、去 AI 味，或要写简历、方案、汇报、文档、公众号、标书、邮件并交付时使用。负责选流程（novel-write / novel-review / doc-review）、调用 deai_audit 门禁、维护追踪状态。
---

# 写作与审查套件（writing-suite）

## 先判断走哪条线

| 用户的活 | 走 |
| --- | --- |
| 开书、搭大纲、写/续写章节、补细纲、整理旧稿 | `novel-write` |
| 审一章、挑毛病、自查能不能发、多视角读感 | `novel-review` |
| 简历、述职、方案、汇报、说明书、公众号、营销、标书、邮件 | `doc-review` |
| 只问“这篇有没有 AI 味” | 直接 `deai_audit`，按体裁传 genre |

拿不准就问一句“这是小说还是文档”，别猜。

## 两个工具（本插件注册，全局可用）

- `deai_audit`：七维打分 + 逐句打标（带行号、blocking/advisory、门禁结论）。
  - `genre`：`resume` / `report` / `doc` / `article` / `marketing` / `bid` / `email` / `fiction`
  - `detail`：`summary`（默认）或 `full`
  - 小说整章传，行号才对得上；片段传也行，但行号是相对片段。
- `deai_audit_config`：`get` 看配置、`genres` 列文体、`set` 写用户配置、`reset` 恢复默认。

## 门禁口径（重要，别混用）

- **小说（fiction）**：只看 `counts.blocking`。等于 0 才算过；总分只当趋势参考。
  理由：小说可以“总分高但没硬伤”（节奏慢、信息稀），但 blocking 是确定性句式（`不是X，而是Y`、`空气凝固`、`嘴角勾起弧度`…），命中就该改。
- **文档（其余体裁）**：总分 ≤ 25、且没有 blocking 才交付（沿用旧 deai_audit 口径）。
- 门禁不通过时，**只改打标句**，不要整篇重写；改完复检一次。

## 小说状态文件（跨会话记忆）

长篇靠 `scripts/story-state.mjs`，不靠聊天记录：

```powershell
$S = "$env:USERPROFILE\.dsh\local-plugins\dsh-local-writing-suite\scripts\story-state.mjs"
node $S status --dir <项目>
node $S check  --dir <项目>
```

`追踪/_state.json` 是唯一权威，`追踪/上下文.md` 是它渲染出来的，手改会被 check 报漂移。
详细命令见 `references/state-schema.md`。

## 写作期就要守住的 5 条（省得写完再改）

1. 不替人物下情绪判词——写他做了什么、没做成什么。
2. 不写身体仪表盘——心跳、冷汗、瞳孔、深吸一口气，一章最多一次。
3. 不写整齐的否定排比——“没有犹豫，没有退缩，没有回头”是评语，不是现场。
4. 不写现成比喻——重锤、惊雷、冰水、深渊、魔神，一个都别用。
5. 不替读者总结——“他知道”“这一刻他明白”“他不知道的是”，全是叙述者在盖章。

完整规则表见 `references/ai-fiction-patterns.md`（34 条，带正则、例句、改法）。

## 交付前自检清单

- [ ] 小说：`deai_audit --genre fiction` 的 `counts.blocking === 0`
- [ ] 文档：总分 ≤ 25，无 blocking
- [ ] 小说：`story-state check` 无 `[阻断]` 项
- [ ] 事实、专有名词、数字没被改动（PMP/GIS/驻场/联调这些不算 AI 味）
- [ ] 打标句是“改写”，不是“换同义词”
