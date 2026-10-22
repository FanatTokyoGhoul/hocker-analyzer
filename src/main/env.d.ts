/** Vite отдаёт файл с суффиксом ?raw как строку (страница пульта). */
declare module '*.html?raw' {
  const content: string
  export default content
}
