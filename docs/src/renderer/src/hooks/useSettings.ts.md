# `src/renderer/src/hooks/useSettings.ts`

`const [settings, update, path] = useSettings()`

- **Чтение:** один раз при создании компонента, синхронно через `window.api.loadSettings()`. Настройки нужны уже на первой отрисовке, иначе мелькнули бы значения по умолчанию.
- **`update(patch)`:** частичное изменение; результат проходит `sanitizeSettings` ([shared/settings.ts](../../../shared/settings.ts.md)).
- **Запись:** при каждом изменении — `window.api.saveSettings(settings)`. Первая отрисовка не сохраняется: это то, что только что прочитали. Задержку и атомарную запись делает main ([main/settings.ts](../../../main/settings.ts.md)).
- **`path`:** полный путь к `settings.json`; показывается в окне настроек.

Если main недоступен (на практике не случается), настройки работают в памяти со значениями по умолчанию.
