type Token = { content: string; htmlStyle: Record<string, string> }
type Lang = "tsx" | "bash"
const colors = {
  text: ["#24292E", "#E1E4E8"],
  keyword: ["#D73A49", "#F97583"],
  component: ["#005CC5", "#79B8FF"],
  prop: ["#6F42C1", "#B392F0"],
  string: ["#032F62", "#9ECBFF"],
  number: ["#005CC5", "#79B8FF"],
  parameter: ["#E36209", "#FFAB70"],
  comment: ["#6A737D", "#6A737D"],
  html: ["#22863A", "#85E89D"],
} as const
const styles = Object.fromEntries(
  Object.entries(colors).map(([k, v]) => [
    k,
    { color: v[0], "--shiki-dark": v[1] },
  ])
)
const cache = new Map<string, Token[][]>()
const keywords = new Set("import export from const let var function return default type interface async await new extends satisfies as".split(" "))
const lexemes = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|<\/?[A-Za-z][\w.]*|[A-Za-z_$][\w$-]*|\b\d+(?:\.\d+)?\b|=>|=/g

export function highlight(text: string, language: Lang) {
  const key = `${language}:${text}`
  const previous = cache.get(key)
  if (previous) return previous
  const lines: Token[][] = [[]]
  const append = (content: string, kind: keyof typeof colors) => {
    content.split("\n").forEach((part, index) => {
      if (index) lines.push([])
      if (!part) return
      const line = lines[lines.length - 1]!
      const htmlStyle = styles[kind]
      const last = line[line.length - 1]
      if (last?.htmlStyle === htmlStyle) last.content += part
      else line.push({ content: part, htmlStyle })
    })
  }
  if (language === "bash") {
    text.split("\n").forEach((line, index) => {
      if (index) lines.push([])
      const command = line.search(/\S/)
      const end = command < 0 ? -1 : line.slice(command).search(/\s/)
      if (command < 0) append(line, "text")
      else {
        append(line.slice(0, command), "text")
        const boundary = end < 0 ? line.length : command + end
        append(line.slice(command, boundary), "prop")
        append(line.slice(boundary), "string")
      }
    })
  } else {
    let cursor = 0
    for (const match of text.matchAll(lexemes)) {
      const value = match[0]
      append(text.slice(cursor, match.index), "text")
      let kind: keyof typeof colors = "text"
      if (value.startsWith("//") || value.startsWith("/*")) kind = "comment"
      else if (['"', "'", "`"].includes(value[0]!)) kind = "string"
      else if (value.startsWith("<")) {
        const prefix = value.startsWith("</") ? "</" : "<"
        append(prefix, "text")
        append(value.slice(prefix.length), /^[A-Z]/.test(value.slice(prefix.length)) ? "component" : "html")
        cursor = match.index + value.length
        continue
      } else if (keywords.has(value) || value === "=" || value === "=>") kind = "keyword"
      else if (/^(true|false|null|undefined)$/.test(value) || /^[A-Z]/.test(value)) kind = "component"
      else if (/^\d/.test(value)) kind = "number"
      else if (/^\s*(?:[=:(]|\??:)/.test(text.slice(match.index + value.length))) kind = "prop"
      append(value, kind)
      cursor = match.index + value.length
    }
    append(text.slice(cursor), "text")
  }
  if (cache.size >= 64) cache.delete(cache.keys().next().value!)
  cache.set(key, lines)
  return lines
}
