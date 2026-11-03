import { plugin, Plugin_Name, Version, makeButtons } from "../../components/index.js"

export class ChessHelp extends plugin {
  constructor() {
    super({
      name: "Chess-帮助",
      dsc: "棋类插件帮助",
      event: "message",
      priority: 100,
      rule: [{ reg: /^#?(棋类|Chess)(帮助|help|菜单)$/i, fnc: "help" }],
    })
  }

  async help(e) {
    const text = [
      `【${Plugin_Name} v${Version.ver}】`,
      "",
      "♟️ 中国象棋（Chinese_Chess）",
      "  #象棋帮助　查看玩法与指令",
      "  #发起象棋　#加入象棋　#人机象棋",
      "",
      "🔧 插件维护（主人）",
      "  #棋更新　#棋强制更新　#棋类版本",
    ].join("\n")
    const buttons = makeButtons(e, [[
      { text: "象棋帮助", cmd: "#象棋帮助" },
      { text: "发起对局", cmd: "#发起象棋" },
      { text: "人机对战", cmd: "#人机象棋" },
    ]])
    await e.reply(buttons ? [text, buttons] : text)
    return true
  }
}
