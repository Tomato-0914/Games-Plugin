import { plugin, Plugin_Name, Version, makeButtons } from "../../components/index.js"
import { GAMES } from "../../components/Games.js"
import { helpMessage } from "../../components/Help.js"

/** #棋帮助：列出所有棋类游戏；每个棋种的玩法见各自的帮助（如 #象棋帮助） */
export class ChessHelp extends plugin {
  constructor() {
    super({
      name: "Chess-帮助",
      dsc: "棋类游戏总帮助",
      event: "message",
      priority: 100,
      rule: [{ reg: /^#?(棋|Chess\s*)(帮助|help|菜单)$/i, fnc: "help" }],
    })
  }

  async help(e) {
    const data = {
      title: "棋类游戏",
      subtitle: "发送对应的帮助指令查看每种棋的玩法",
      piece: "棋",
      badge: `v${Version.ver}`,
      sections: [
        ...GAMES.map(g => ({ title: g.name, tag: g.id, piece: g.piece, desc: g.desc, items: g.commands, cols: 2 })),
        {
          title: "插件维护",
          tag: "仅主人",
          piece: "帅",
          color: "black",
          items: [
            { cmd: "#棋更新", desc: "拉取更新，PM2 下自动重启" },
            { cmd: "#棋强制更新", desc: "丢弃本地改动后更新" },
            { cmd: "#棋版本", desc: "当前版本与更新内容" },
          ],
        },
      ],
      footer: `${Plugin_Name} · 更多棋类游戏开发中`,
    }
    const msg = [await helpMessage(data, "help-chess")]
    const buttons = makeButtons(e, [GAMES.map(g => ({ text: `${g.name}帮助`, cmd: g.help }))])
    if (buttons) msg.push(buttons)
    await e.reply(msg)
    return true
  }
}
