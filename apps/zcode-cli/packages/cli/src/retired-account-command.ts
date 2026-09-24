import { getZCodeCopy } from "@zcode/i18n";

export function isRetiredAccountCommand(name: string | undefined): boolean {
  return name === "login" || name === "logout";
}

/** 旧命令可能包含 API key；只返回固定说明，不能回显参数、入历史或转交模型。 */
export function retiredAccountCommandResponse(locale?: string): string {
  return getZCodeCopy(locale).tui.retiredAccountCommand;
}
