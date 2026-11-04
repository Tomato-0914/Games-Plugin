/**
 * 已上线的游戏清单，#游戏帮助 按这里展示
 * 新增游戏时在这里登记一项即可；category 为分类（棋类 / 益智 …）
 */
export const GAMES = [
  {
    id: "Chinese_Chess",
    name: "中国象棋",
    category: "棋类",
    piece: "帥",
    desc: "双人对战 · 人机对战（四档难度）",
    help: "#象棋帮助",
    commands: [
      { cmd: "#象棋帮助", desc: "玩法与全部指令" },
      { cmd: "#发起象棋", desc: "发起双人对局" },
      { cmd: "#加入象棋", desc: "加入对局" },
      { cmd: "#人机象棋", desc: "和 Bot 下棋" },
    ],
  },
  {
    id: "Gomoku",
    name: "五子棋",
    category: "棋类",
    piece: "棋",
    desc: "双人对战 · 人机对战（三档难度）· 黑方三三、四四禁手",
    help: "#五子棋帮助",
    commands: [
      { cmd: "#五子棋帮助", desc: "玩法与全部指令" },
      { cmd: "#发起五子棋", desc: "发起双人对局" },
      { cmd: "#加入五子棋", desc: "加入对局" },
      { cmd: "#人机五子棋", desc: "和 Bot 下棋" },
    ],
  },
  {
    id: "Minesweeper",
    name: "扫雷",
    category: "益智",
    piece: "雷",
    desc: "单人模式 · 初级 / 中级 / 高级 / 自定义",
    help: "#扫雷帮助",
    commands: [
      { cmd: "#扫雷帮助", desc: "玩法与全部指令" },
      { cmd: "#扫雷", desc: "开一盘" },
      { cmd: "C5 / 旗C5", desc: "翻开 / 插旗" },
      { cmd: "#扫雷提示", desc: "翻开一个安全格" },
    ],
  },
]
