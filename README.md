<div align="center">
  <h1>Chess-Plugin</h1>
  <p><a href="https://github.com/TimeRainStarSky/Yunzai" target="_blank">TRSS-Yunzai</a> 棋类游戏插件</p>
  <p>第一个棋种：中国象棋（Chinese_Chess）—— 群友双人对战 / 人机对战</p>
</div>

## 功能

- 群内双人对战：一人发起、一人加入，加入后立即开局；红黑可以指定，也可以随机
- 人机对战：群聊、私聊都可以，四档难度（入门 / 简单 / 普通 / 困难），AI 在独立线程中思考，不卡 Bot
- 完整规则：蹩马腿、塞象眼、炮架、将帅照面、困毙判负、长将判负、自然限着
- 中文记谱（`炮二平五`、`马8进7`、`前车进一`）和坐标（`h2e2`）两种走法，走错会说明原因
- 棋盘图片：标出上一步和将军，四周印纵线编号和坐标；没有浏览器时自动改发文字棋盘
- 每步限时（默认 120 秒），超时前提醒，超时判负
- 悔棋、求和、认输；重启后对局自动恢复
- 适配 LLOneBot（OneBot v11）和 QQ 官方机器人（[QQBot-Plugin](https://github.com/Tomato-0914/QQBot-Plugin)），官方机器人下附带按钮
- `#棋类更新` 一键更新并自动重启

## 安装

在 Yunzai 根目录执行：

```sh
git clone --depth 1 https://github.com/Tomato-0914/Chess-Plugin ./plugins/Chess-Plugin
```

插件没有额外依赖，不需要 `pnpm install`。重启 Bot 即可使用。

棋盘图片使用 Yunzai 自带的 puppeteer 渲染，与其他插件的帮助图片相同。插件内置了霞鹜文楷字体（`resources/fonts/`），服务器不需要另外安装中文字体。

## 指令

### 中国象棋

| 指令 | 说明 |
| --- | --- |
| `#象棋` / `#象棋帮助` | 玩法说明 |
| `#发起象棋` / `#发起象棋 红` / `#发起象棋 黑` | 发起双人对局（群聊）；不指定颜色时，开局随机分配红黑 |
| `#加入象棋` | 加入对局，加入后立即开始，红方先走 |
| `#人机象棋 [难度] [红/黑]` | 人机对战；难度默认“普通”，默认执红先走 |
| `炮二平五` / `马8进7` / `h2e2` | 轮到你时直接发送走法 |
| `#棋盘` | 重新发送棋盘 |
| `#悔棋` | 双人：需对方 `#同意悔棋`；人机：每局 3 次 |
| `#求和` | 双人：需对方 `#同意求和`；人机：由 AI 根据局面决定 |
| `#认输` | 认输 |
| `#结束象棋` / `#取消象棋` | 强制结束，不计胜负（发起人取消等待中的对局；对局中需群管理或主人；人机对局玩家本人可结束） |

英文指令：`#Chinese_Chess create | join | ai | board | undo | draw | resign | end | help`，
人机难度也可以写 `beginner / easy / normal / hard`，颜色写 `red / black`。

### 走法写法

- 中文纵线记谱：`棋子 + 起始纵线 + 进/退/平 + 目标`，例如 `炮二平五`、`马8进7`、`车一进一`
- 同一纵线有两个同类棋子：`前车进一`、`后马退二`；三个兵：`前兵`、`中兵`、`后兵`
- 红方习惯用中文数字、黑方习惯用阿拉伯数字，两种数字双方都能识别；繁体（`傌`、`俥`、`砲`）也能识别
- 坐标：`h2e2`（列 a–i，行 0–9，红方在下），棋盘图四周印有坐标

### 插件维护（主人）

| 指令 | 说明 |
| --- | --- |
| `#棋类更新` | `git pull`，展示更新日志；`package.json` 变化时自动 `pnpm install`；PM2 守护下自动重启 |
| `#棋类强制更新` | 丢弃本地改动，与远程分支保持一致，其余同上 |
| `#棋类版本` | 当前版本与最近更新内容 |
| `#棋类帮助` | 插件总帮助 |

## 配置

`config/config.yaml`，首次启动时从 `config/default_config/config.yaml` 复制，保存后自动生效：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `xiangqi.joinTimeout` | `300` | 等待对手加入的时间（秒） |
| `xiangqi.moveTimeout` | `120` | 每步思考时间（秒），超时判负 |
| `xiangqi.moveWarnBefore` | `30` | 超时前多少秒提醒，0 不提醒 |
| `xiangqi.naturalLimit` | `60` | 双方连续多少回合没有吃子判和，0 不限制 |
| `xiangqi.flipForBlack` | `false` | 双人对战轮到黑方时翻转棋盘 |
| `xiangqi.defaultAiLevel` | `普通` | 默认人机难度 |
| `xiangqi.aiUndoLimit` | `3` | 人机对战每局悔棋次数 |
| `xiangqi.requestTimeout` | `60` | 悔棋、求和请求的有效时间（秒） |
| `xiangqi.allowPrivate` | `true` | 是否允许私聊人机对战 |
| `engine.maxConcurrent` | `2` | 同时进行的 AI 思考数量 |
| `qqbot.buttons` | `true` | 官方机器人下是否附带按钮 |
| `render.textFallback` | `true` | 截图失败时改发文字棋盘 |

## 说明

- 双人对战中，每条群消息只有在**本群有进行中的对局、发送者是轮到的一方、内容就是一步棋**时才会被当作走子，平时聊天不受影响
- QQ 官方机器人开启“接收群内全部消息”后，走子不需要 @机器人；未开启时需要 @机器人 才能收到消息
- 同一个群里同时有官方机器人和 LLOneBot 时，对局只由开局的那个 Bot 处理，不会重复回复
- 重复局面：一方一直将军（长将）判负，其他情况三次重复判和；“长捉”暂未判定
- AI 是插件内置的搜索引擎（纯 JavaScript），不需要安装其他程序

## 开发

```sh
pnpm test   # 或 npm test
```

测试覆盖：走法生成（perft）、特殊规则、记谱解析、AI、以及模拟 Yunzai 环境下的完整对局流程。

棋种逻辑在 `games/xiangqi/`，不依赖 Yunzai；`apps/` 负责指令和消息；`components/` 是各棋种共用的房间、渲染、AI 调度、配置和适配器工具，后续新棋种可以直接复用。

## 致谢

- 更新功能参考 [Cheshire-Plugin](https://github.com/Cheshire-Plugin/Cheshire-Plugin)
- 按钮写法参考 [QQBot-Plugin](https://github.com/Tomato-0914/QQBot-Plugin) 的 wiki
- 棋盘字体：[霞鹜文楷](https://github.com/lxgw/LxgwWenKai)（SIL Open Font License 1.1，裁剪为 WOFF2 仅用于截图渲染）
