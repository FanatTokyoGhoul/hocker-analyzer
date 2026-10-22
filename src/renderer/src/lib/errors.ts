/** Текст ошибки для пользователя: без служебного префикса Electron IPC. */
export function errorText(e: unknown): string {
  const message =
    e instanceof Error ? e.message : typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
