# `src/renderer/index.html`

HTML-оболочка рендерера: `<div id="root">` и модуль `/src/main.tsx`.

**Content-Security-Policy:**

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; media-src media:
```

- Скрипты загружаются только из самого приложения, без inline-скриптов и `eval`.
- `'unsafe-inline'` для стилей нужен Vite, который в dev-режиме вставляет CSS через `<style>`.
- `media-src media:` — видео можно грузить только через свой протокол (см. [media.ts](../main/media.ts.md)).
