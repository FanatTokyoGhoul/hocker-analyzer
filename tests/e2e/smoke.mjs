// Сквозной прогон собранного приложения: npm run build && node tests/e2e/smoke.mjs <h264.mp4> [hevc.mp4]
// Системные диалоги подменяются в main-процессе, поэтому тест идёт без участия человека.
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, copyFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'

const [h264Src, hevcSrc] = process.argv.slice(2)
if (!h264Src) {
  console.error('usage: node tests/e2e/smoke.mjs <h264.mp4> [hevc.mp4]')
  process.exit(2)
}
const work = mkdtempSync(join(process.env.E2E_TMP ?? tmpdir(), 'hockey-e2e-'))
const h264 = join(work, basename(h264Src))
copyFileSync(h264Src, h264)
const shots = process.env.E2E_SHOTS

// E2E_EXECUTABLE — проверить уже упакованное приложение (dist/linux-unpacked/hockey-analyzer)
const exe = process.env.E2E_EXECUTABLE
// отдельный профиль: тест не трогает настройки пользователя и начинает с умолчаний
const profile = join(work, 'profile')
const launch = async () => {
  const a = await electron.launch(
    exe ? { executablePath: exe, args: [`--user-data-dir=${profile}`] } : { args: ['.', `--user-data-dir=${profile}`] }
  )
  const w = await a.firstWindow()
  await w.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  return [a, w]
}
let [app, win] = await launch()
const step = (name) => console.log(`✓ ${name}`)
const shot = async (name) => shots && win.screenshot({ path: join(shots, `${name}.png`) })

const stubDialogs = (openPath, savePath) =>
  app.evaluate(
    ({ dialog }, [o, s]) => {
      dialog.showOpenDialog = async () => ({ canceled: !o, filePaths: o ? [o] : [] })
      dialog.showSaveDialog = async () => ({ canceled: !s, filePath: s })
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
      dialog.showMessageBoxSync = () => 0
    },
    [openPath, savePath]
  )

const video = () => win.evaluate(() => {
  const v = document.querySelector('video')
  return v && { t: v.currentTime, paused: v.paused, rate: v.playbackRate, ready: v.readyState, d: v.duration }
})
const waitFor = async (fn, what, timeout = 15000) => {
  const start = Date.now()
  for (;;) {
    const r = await fn()
    if (r) return r
    if (Date.now() - start > timeout) throw new Error(`timeout: ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}
const seek = async (t) => {
  await win.evaluate((t) => {
    const v = document.querySelector('video')
    v.pause()
    v.currentTime = t
  }, t)
  await waitFor(() => win.evaluate(() => !document.querySelector('video').seeking), 'seek')
}

try {
  // 1. открыть видео
  await stubDialogs(h264, null)
  await win.getByRole('button', { name: 'Открыть видео' }).first().click()
  const v0 = await waitFor(async () => {
    const v = await video()
    return v && v.ready >= 2 && v
  }, 'video ready')
  assert.ok(Math.abs(v0.d - 20) < 0.1, `duration ${v0.d}`)
  await win.getByText('30 fps').waitFor()
  step('видео открыто, fps определён через ffprobe (30)')

  // 2. пауза/продолжение
  await win.keyboard.press('Space')
  await waitFor(async () => (await video()).t > 0.3, 'playing')
  await win.keyboard.press('Space')
  await waitFor(async () => (await video()).paused, 'paused')
  step('Space — воспроизведение и пауза')

  // 3. покадровый шаг — проверяем и время, и реально показанный кадр
  await seek(0)
  for (let i = 0; i < 3; i++) await win.keyboard.press('ArrowRight')
  await waitFor(async () => Math.floor((await video()).t * 30 + 1e-6) === 3, 'frame 3')
  await win.keyboard.press('ArrowLeft')
  await waitFor(async () => Math.floor((await video()).t * 30 + 1e-6) === 2, 'frame 2')
  await win.getByText('кадр 2 ·').waitFor()
  await shot('01-frame-2')
  step('← / → — шаг на кадр (кадр 2)')

  const before = (await video()).t
  await win.keyboard.press('Shift+ArrowRight')
  await waitFor(async () => Math.abs((await video()).t - before - 0.1) < 0.002, '+100ms')
  step('Shift+→ — шаг +100 мс')

  // 4. скорость
  await win.keyboard.press('Digit2')
  await waitFor(async () => (await video()).rate === 0.5, 'rate 0.5')
  await win.keyboard.press('Digit4')
  await waitFor(async () => (await video()).rate === 1, 'rate 1')
  step('1–4 — скорость (×0.5, ×1)')

  // 5. разметка моментов через I / O / Enter
  const addMoment = async (a, b, title, tags) => {
    await seek(a)
    await win.keyboard.press('KeyI')
    await seek(b)
    await win.keyboard.press('KeyO')
    await win.locator('.draft').getByPlaceholder('Название').fill(title)
    await win.locator('.draft').getByPlaceholder('Теги через запятую').fill(tags)
    await win.locator('.draft').getByPlaceholder('Теги через запятую').press('Enter')
  }
  await addMoment(2, 4, 'хорошая перепасовка', 'пас')
  await addMoment(8, 9, 'выход из зоны', 'выход, пас')
  await win.locator('.moment').nth(1).waitFor()
  assert.equal(await win.locator('.moment').count(), 2)
  step('I / O / Enter — два момента добавлены')

  // 6. рисование на паузе внутри первого момента
  await seek(3)
  await win.keyboard.press('KeyA')
  const box = await win.locator('.drawing-layer').boundingBox()
  await win.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4, { steps: 8 })
  await win.mouse.up()
  await win.keyboard.press('KeyC')
  await win.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 5 })
  await win.mouse.up()
  await win.locator('.badge', { hasText: '✎ 2' }).waitFor()
  await shot('02-drawing')
  await win.keyboard.press('Control+KeyZ')
  await win.locator('.badge', { hasText: '✎ 1' }).waitFor()
  await win.keyboard.press('Escape')
  step('стрелка и круг нарисованы, Ctrl+Z отменил круг')

  // 6b. меню рисования на полупрозрачной кнопке, любой цвет через HEX
  await win.locator('.fab').click()
  await win.getByRole('dialog', { name: 'Рисование' }).waitFor()
  await win.getByLabel('HEX-код цвета').fill('#12AB34')
  await win.getByLabel('HEX-код цвета').press('Enter')
  await win.getByRole('button', { name: /Линия/ }).click()
  await win.locator('.fab').click()
  await win.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.9)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.8, { steps: 5 })
  await win.mouse.up()
  await win.locator('.badge', { hasText: '✎ 2' }).waitFor()
  await win.locator('.fab').click()
  await win.getByLabel('Цвет #12ab34').waitFor() // попал в «недавние»
  await shot('02b-draw-menu')
  await win.locator('.fab').click()
  await win.keyboard.press('Escape')
  step('меню рисования: линия цветом #12ab34, цвет в «недавних»')

  // 6c. клик по моменту (в списке и на таймлайне) — переход к его началу
  await seek(0)
  await win.locator('.moment').nth(1).click()
  await waitFor(async () => Math.abs((await video()).t - 8) < 0.01, 'seek to moment 2')
  await win.locator('.timeline-moment').first().click()
  await waitFor(async () => Math.abs((await video()).t - 2) < 0.01, 'seek to moment 1')
  step('клик по моменту в списке и на таймлайне — перемотка к началу')

  // 7. проиграть все: должны пройти оба момента с паузой 3 с на рисунке
  await win.getByRole('button', { name: /Проиграть все/ }).click()
  const seen = new Set()
  let held = false
  await waitFor(async () => {
    const v = await video()
    if (v.t >= 2 && v.t <= 4.05) seen.add('m1')
    if (v.t >= 8 && v.t <= 9.05) seen.add('m2')
    if (v.t > 4.1 && v.t < 7.9 && !v.paused) throw new Error(`играет вне моментов: t=${v.t}`)
    if (await win.getByText('· рисунок').count()) held = true
    return (await win.getByRole('button', { name: /Проиграть все/ }).count()) > 0
  }, 'playlist finished', 20000)
  const end = await video()
  assert.ok(seen.has('m1') && seen.has('m2'), `seen ${[...seen]}`)
  assert.ok(held, 'не было паузы на рисунке')
  assert.ok(end.paused && Math.abs(end.t - 9) < 0.1, `конец плейлиста t=${end.t}`)
  step(`«Проиграть все» — оба момента, пауза на рисунке, стоп на ${end.t.toFixed(3)} с`)

  // 7b. настройки: остановка на рисунке до нажатия клавиши, при обычном просмотре
  await win.getByRole('button', { name: 'Настройки' }).click()
  await win.getByRole('radio', { name: 'До нажатия клавиши' }).click()
  await shot('05-settings')
  await win.getByText(join(profile, 'settings.json')).waitFor()
  await win.keyboard.press('Escape')
  await win.getByRole('dialog', { name: 'Настройки' }).waitFor({ state: 'detached' })
  const settingsFile = join(profile, 'settings.json')
  await waitFor(() => existsSync(settingsFile) && JSON.parse(readFileSync(settingsFile, 'utf8')).holdMode === 'key', 'settings.json')
  assert.equal(JSON.parse(readFileSync(settingsFile, 'utf8')).version, 1)
  await seek(2.8)
  await win.keyboard.press('Space')
  await win.getByText(/нажмите любую клавишу/).waitFor()
  const heldAt = await video()
  assert.ok(heldAt.paused && Math.floor(heldAt.t * 30) === 90, `остановка не на кадре рисунка: t=${heldAt.t}`)
  await new Promise((r) => setTimeout(r, 3500))
  assert.ok((await video()).paused, 'в режиме «до клавиши» видео не должно продолжаться само')
  await shot('06-hold-key')
  await win.keyboard.press('KeyX')
  await waitFor(async () => !(await video()).paused, 'resume after key')
  await win.keyboard.press('Space')
  step('остановка на рисунке до нажатия клавиши: ждёт 3.5 с, продолжает по любой клавише; режим записан в settings.json')

  // 7b'. рисунок на самом первом кадре момента тоже останавливает плейлист; Ctrl/хоткеи не «продолжают»
  await seek(8)
  await win.keyboard.press('KeyA')
  await win.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3, { steps: 5 })
  await win.mouse.up()
  await win.keyboard.press('Escape')
  await win.locator('.moment').nth(1).getByRole('button', { name: 'Проиграть' }).click()
  await win.getByText(/нажмите любую клавишу/).waitFor()
  assert.equal(Math.floor((await video()).t * 30), 240, 'остановка не на первом кадре момента')
  await win.keyboard.press('Digit2') // хоткей скорости выполняется и не снимает остановку
  await waitFor(async () => (await video()).rate === 0.5, 'rate during hold')
  assert.ok((await video()).paused && (await win.getByText(/нажмите любую клавишу/).count()) === 1, 'хоткей не должен продолжать')
  await win.keyboard.press('KeyX')
  await win.getByRole('button', { name: /Проиграть все/ }).waitFor({ timeout: 10000 })
  await win.keyboard.press('Digit4')
  step('рисунок на первом кадре момента останавливает «▶ момент»; хоткей во время остановки делает своё')

  // 8. сохранение и повторное открытие
  const projectPath = join(work, 'match.hockey.json')
  await stubDialogs(projectPath, projectPath)
  await win.keyboard.press('Control+KeyS')
  await waitFor(() => existsSync(projectPath), 'project saved')
  const saved = JSON.parse(readFileSync(projectPath, 'utf8'))
  assert.equal(saved.videoPath, h264)
  assert.equal(saved.fps, 30)
  assert.deepEqual(saved.moments.map((m) => [m.title, m.start, m.end, m.tags]), [
    ['хорошая перепасовка', 2 + 0, 4, ['пас']],
    ['выход из зоны', 8, 9, ['выход', 'пас']]
  ])
  assert.deepEqual(saved.moments[0].drawings[0].shapes.map((s) => [s.kind, s.color]), [['arrow', '#ff3b30'], ['line', '#12ab34']])
  step('Ctrl+S — проект сохранён в JSON по модели из брифа')

  await win.reload()
  await win.getByRole('button', { name: 'Открыть проект' }).first().click()
  await win.locator('.moment').nth(1).waitFor()
  await waitFor(async () => (await video())?.ready >= 2, 'video after load')
  await seek(3)
  await win.locator('.drawing-layer canvas').first().waitFor()
  await shot('03-reopened')
  step('проект открыт заново: моменты и рисунки на месте')

  // ---------- v0.3 ----------
  const moment = (title) => win.locator('.moment', { hasText: title })

  // 10. кнопки быстрой разметки, отмена и повтор
  await seek(12)
  await win.keyboard.press('Shift+Digit1') // «Гол»: 8 с до, 3 с после
  await moment('Гол 1').waitFor()
  assert.equal(await win.locator('.moment').count(), 3)
  assert.match(await moment('Гол 1').innerText(), /0:04–0:15/)
  await win.keyboard.press('Control+KeyZ')
  await waitFor(async () => (await win.locator('.moment').count()) === 2, 'undo')
  await win.getByText('Отменено: добавление момента').waitFor()
  await win.keyboard.press('Control+Shift+KeyZ')
  await moment('Гол 1').waitFor()
  step('Shift+1 — момент «Гол 1» [t−8; t+3] с тегом; Ctrl+Z / Ctrl+Shift+Z отменяют и возвращают')

  // 11. заметка к моменту
  await moment('Гол 1').getByRole('button', { name: 'Изменить' }).click()
  await moment('Гол 1').getByLabel('Заметка').fill('закрыть дальнюю штангу')
  await moment('Гол 1').getByRole('button', { name: 'Готово' }).click()
  await moment('Гол 1').locator('.moment-notes', { hasText: 'закрыть дальнюю штангу' }).waitFor()
  step('заметка сохранена и видна в карточке')

  // 12. новые инструменты: зона, текст, подсветка, пас
  await seek(3)
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy]
  const drag = async (a, b) => {
    await win.mouse.move(...a)
    await win.mouse.down()
    await win.mouse.move(...b, { steps: 6 })
    await win.mouse.up()
  }
  const badge = (n) => moment('хорошая перепасовка').locator('.badge', { hasText: `✎ ${n}` }).waitFor()
  await badge(2)
  await win.keyboard.press('KeyZ')
  for (const p of [[0.1, 0.1], [0.3, 0.1], [0.25, 0.3]]) await win.mouse.click(...at(...p))
  await win.mouse.click(...at(0.1, 0.1))
  await badge(3)
  await win.keyboard.press('KeyT')
  await win.mouse.click(...at(0.5, 0.2))
  await win.getByLabel('Текст подписи').fill('Защитник')
  await win.getByLabel('Текст подписи').press('Enter')
  await badge(4)
  await win.keyboard.press('KeyS')
  await drag(at(0.6, 0.6), at(0.65, 0.6))
  await badge(5)
  await win.keyboard.press('KeyP')
  await drag(at(0.2, 0.8), at(0.5, 0.7))
  await badge(6)
  await shot('08-new-tools')
  await win.keyboard.press('Escape')
  step('зона кликами, текст, подсветка игрока, пунктирный пас')

  // 13. цифровой зум
  await win.mouse.move(...at(0.5, 0.5))
  await win.mouse.wheel(0, -600)
  await win.locator('.zoom-badge').waitFor()
  await shot('09-zoom')
  await win.keyboard.press('Digit0')
  await win.locator('.zoom-badge').waitFor({ state: 'detached' })
  step('колесо мыши увеличивает кадр, 0 — сброс')

  // 14. схема площадки
  await moment('хорошая перепасовка').getByRole('button', { name: 'Схема площадки' }).click()
  const board = win.getByRole('dialog', { name: /Схема:/ })
  await board.waitFor()
  const bb = await board.locator('.board-frame').boundingBox()
  await drag([bb.x + bb.width * 0.3, bb.y + bb.height * 0.5], [bb.x + bb.width * 0.7, bb.y + bb.height * 0.3])
  await shot('10-board')
  await board.getByRole('button', { name: 'Готово' }).click()
  await board.waitFor({ state: 'detached' })
  await moment('хорошая перепасовка').locator('.btn.is-active[aria-label="Схема площадки"]').waitFor()
  step('схема площадки: стрелка нарисована и сохранена в моменте')

  // 15. статистика и CSV
  const csvPath = join(work, 'моменты.csv')
  await stubDialogs(null, csvPath)
  await win.getByRole('button', { name: 'Статистика' }).click()
  const stats = win.getByRole('dialog', { name: 'Статистика' })
  await stats.getByRole('cell', { name: 'гол' }).waitFor()
  await shot('11-stats')
  await stats.getByRole('button', { name: 'Моменты в CSV' }).click()
  await waitFor(() => existsSync(csvPath), 'csv saved')
  const csv = readFileSync(csvPath, 'utf8')
  assert.ok(csv.startsWith('\uFEFF') && csv.includes('Гол 1') && csv.includes('закрыть дальнюю штангу'), csv.slice(0, 200))
  await win.keyboard.press('Escape')
  step('статистика по тегам, выгрузка моментов в CSV (UTF-8 BOM)')

  // 16. второе видео — следующий период
  const period2 = join(work, 'period2.mp4')
  copyFileSync(h264, period2)
  await stubDialogs(period2, null)
  await win.getByRole('button', { name: '+ Видео' }).click()
  await win.getByRole('button', { name: '+ Следующий период' }).click()
  await win.getByRole('tab', { name: 'Период 2', selected: true }).waitFor()
  await waitFor(async () => (await video())?.ready >= 2, 'period 2 ready')
  await seek(5)
  await win.keyboard.press('Shift+Digit2') // «Бросок»: 5 до, 2 после → время проекта 20…27
  await moment('Бросок 1').waitFor()
  assert.match(await moment('Бросок 1').innerText(), /0:20–0:27/)
  await moment('хорошая перепасовка').click()
  await win.getByRole('tab', { name: 'Видео 1', selected: true }).waitFor()
  await waitFor(async () => {
    const v = await video() // пока видео грузится, элемента нет
    return v && v.ready >= 1 && Math.abs(v.t - 2) < 0.05
  }, 'seek in video 1')
  await moment('Бросок 1').getByRole('button', { name: 'Проиграть' }).click()
  await win.getByRole('tab', { name: 'Период 2', selected: true }).waitFor()
  await waitFor(async () => {
    const v = await video()
    return v && !v.paused && v.t < 7.5
  }, 'playing moment in period 2')
  await win.getByRole('button', { name: /Стоп/ }).click()
  await shot('12-two-videos')
  step('второе видео-период: момент во времени проекта, клик и «▶ момент» переключают видео')

  // 17. экспорт подборки с рисунками
  const reel = join(work, 'подборка.mp4')
  await stubDialogs(null, reel)
  await win.getByRole('button', { name: 'Экспорт' }).click()
  const exp = win.getByRole('dialog', { name: 'Экспорт клипов' })
  await exp.getByRole('radio', { name: /Все моменты/ }).click()
  await exp.getByRole('button', { name: /Экспортировать/ }).click()
  await exp.getByText(/Готово:/).waitFor({ timeout: 180000 })
  await shot('13-export')
  await win.keyboard.press('Escape')
  const ffprobe = createRequire(import.meta.url)('ffprobe-static').path
  const probed = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', reel], { encoding: 'utf8' }))
  const reelDur = Number(probed.format.duration)
  // 2 + 3 (рисунок) + 3 (схема) | 11 | 1 + 3 (рисунок) | 7
  assert.ok(Math.abs(reelDur - 30) < 0.6, `длительность подборки ${reelDur}`)
  assert.deepEqual(probed.streams.map((x) => x.codec_type).sort(), ['audio', 'video'])
  step(`экспорт подборки: ${reelDur.toFixed(2)} с, стоп-кадры рисунков и схема на месте`)

  // 18. проект v2 на диске
  await stubDialogs(null, projectPath)
  await win.keyboard.press('Control+KeyS')
  await win.getByText('Сохранено: match.hockey.json').waitFor()
  const v2 = JSON.parse(readFileSync(projectPath, 'utf8'))
  assert.equal(v2.version, 2)
  assert.deepEqual(v2.videos.map((x) => [x.label, x.offset]), [['Видео 1', 0], ['Период 2', 20]])
  const m1 = v2.moments.find((m) => m.title === 'хорошая перепасовка')
  assert.equal(m1.board.length, 1)
  const kinds = m1.drawings.flatMap((d) => d.shapes.map((x) => x.kind + (x.dashed ? '-dashed' : '')))
  for (const k of ['zone', 'text', 'spotlight', 'arrow-dashed']) assert.ok(kinds.includes(k), `нет фигуры ${k}: ${kinds}`)
  assert.equal(v2.moments.find((m) => m.title === 'Гол 1').notes, 'закрыть дальнюю штангу')
  step('проект v2: два видео со сдвигами, заметки, схема, новые фигуры')

  // 9. HEVC → предложение конвертации → H.264 с -g 10
  if (hevcSrc) {
    const hevc = join(work, basename(hevcSrc))
    copyFileSync(hevcSrc, hevc)
    await stubDialogs(hevc, null)
    await win.getByRole('button', { name: 'Открыть видео' }).first().click()
    await win.getByText(/кодек HEVC не поддерживается/).waitFor()
    await shot('04-hevc-banner')
    await win.getByRole('button', { name: 'Конвертировать' }).click()
    await win.getByText(/Готово: .*\.h264\.mp4/).waitFor({ timeout: 120000 })
    await waitFor(async () => (await video())?.ready >= 2, 'converted video ready')
    step('HEVC распознан и сконвертирован в H.264')
  }

  // 19. восстановление после сбоя
  await seek(1)
  await win.keyboard.press('Shift+Digit3')
  await win.locator('.moment', { hasText: 'Потеря 1' }).waitFor()
  const countBefore = await win.locator('.moment').count()
  const recoveryFile = join(profile, 'recovery.json')
  await waitFor(() => existsSync(recoveryFile) && statSync(recoveryFile).size > 0, 'recovery.json', 10000)
  app.process().kill('SIGKILL')
  ;[app, win] = await launch()
  await win.getByText(/Найдена несохранённая работа/).waitFor()
  await shot('14-recovery')
  await win.getByRole('button', { name: 'Восстановить' }).click()
  await win.locator('.moment', { hasText: 'Потеря 1' }).waitFor()
  assert.equal(await win.locator('.moment').count(), countBefore)
  await waitFor(async () => (await video())?.ready >= 2, 'video after recovery')
  step('после аварийного завершения черновик восстановлен со всеми моментами')

  // 20. полный экран (последним: на некоторых мониторах после него окно перестаёт отрисовываться)
  await win.keyboard.press('KeyF')
  await waitFor(() => win.evaluate(() => document.fullscreenElement?.classList.contains('viewer') ?? false), 'fullscreen on')
  await shot('07-fullscreen')
  await win.keyboard.press('KeyF')
  await waitFor(() => win.evaluate(() => document.fullscreenElement === null), 'fullscreen off')
  step('F — полноэкранный просмотр и выход')

  console.log(`\nВсе проверки пройдены. Файлы: ${work}`)
} catch (e) {
  await shot('failure')
  console.error(e)
  process.exitCode = 1
} finally {
  // после полного экрана некоторые оконные менеджеры перестают отрисовывать окно, и close() ждёт вечно
  const closed = await Promise.race([app.close().then(() => true), new Promise((r) => setTimeout(() => r(false), 10000))])
  if (!closed) app.process().kill('SIGKILL')
}
