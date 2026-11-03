/**
 * 已上线的棋类游戏清单，#棋帮助 按这里展示
 * 新增棋种时在这里登记一项即可
 */
export const GAMES = [
  {
    id: "Chinese_Chess",
    name: "中国象棋",
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
]
