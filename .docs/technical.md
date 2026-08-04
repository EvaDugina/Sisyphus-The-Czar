# Technical — Sisyphus The Czar

## Паспорт

- **Стадия:** POC B
- **Последнее обновление:** 2026-08-04
- **Runtime:** Node.js 24, Express 5, WebSocket `ws`, React 19, Vite 8
- **Развёртывание:** один Docker-контейнер приложения; nginx/HTTPS находятся на хосте

## Архитектура

React отвечает за структуру UI, imperative runtime — за refs, animation loop, canvas, аудио и WebSocket. Express раздаёт API/shared modules/production assets. `SessionManager` авторитетно рассчитывает личные камни фиксированным шагом.

Поток данных:

1. `/` и `/drafts/` обслуживаются одним `index.html`, запускают общий `App` runtime и рендерят один `FoldLayer`.
2. Runtime вызывает `POST /api/sessions`; в debug локальный черновик/последняя локальная версия передаются новой сессии, а при их отсутствии сервер применяет актуальный debug template. Production всегда использует production preset.
3. Клиент соединяется с `WS /realtime?session=<id>&client=<id>`.
4. Input отправляется не чаще 30 Hz; snapshots публикуются до 20 Hz.
5. Сервер хранит один `holder` и рассчитывает движение камня.
6. Trail-дельты личных сессий агрегируются отдельным root trail hub и подтверждаются независимо от физики камня.

`POST /api/sessions/root` сохранён для trail hub и совместимости, но пользовательский runtime к root-комнате не подключается.

## Доменная модель

### Session

- `id`, `persistent`, `singleClient`, TTL и empty-grace metadata;
- `state`: phase, x/y, vx/vy, dragging, controllerId, suspended;
- `physics`, `physicsVersion=11`;
- `roomSettings`, `roomSettingsVersion=15`, `settingsRevision`;
- `clients: Map<clientId, client>`;
- `holder: null | {clientId,x,y,vx,vy,acquiredAt,lastMoveAt,slipAt,jumpAt}`;
- trail, imprint, summit timer, ground touch sequence, final-fall и stationary metadata.

В модели нет `holders Map`, числа рук, суммарной силы, усреднения pointer или required-holder threshold.

### Client

- `id`, одноразовый `leaveToken`, `role: "master"`;
- WebSocket, sequence, disconnect timestamp;
- pointer `{x,y,mode,visible}`.

## Физика удержания

Основные величины:

```text
Fg = m · g
r = clamp(Fhand / Fg, 0, 1)
q = cubicBezier(r)
alpha(dt) = 1 - (1 - q)^(dt / (1/60))
Prock' = Prock + alpha(dt) · (Phand - Prock)
```

- При `Fhand >= Fg` коэффициент следования равен `1`, камень достигает drag target за шаг.
- При `Fhand < Fg` захват не снимается; обе координаты плавно сближаются с target.
- Экспоненциальное преобразование `alpha(dt)` сохраняет одинаковую реакцию при разном FPS.
- На сервере drag target хранится в единственном `holder`, а `Physics.stepDragState` применяется на fixed step.
- Клиент использует ту же `dragFollowProgress` для локального preview и не отправляет уже сглаженную координату повторно.
- `control.release` не телепортирует камень к финальному pointer; импульс вычисляется из скорости единственного holder.

## Автоматические поведения камня

Настройки `roomSettings`:

| Ключ | Диапазон / default | Назначение |
|---|---|---|
| `randomDropEnabled` | `true` | Существующее случайное выпадение через `0.5–2 s` |
| `rockJumpEnabled` | `true` | Периодическое выпрыгивание вверх |
| `rockJumpIntervalSeconds` | `1–10`, default `5` | Непрерывное удержание до выпрыгивания |
| `rockJumpInertiaSpreadPercent` | `0–100`, default `25` | Разброс множителя импульса |

При захвате сервер создаёт два независимых deadline: `slipAt` и `jumpAt`. Изменение toggle во время удержания очищает или запускает соответствующий deadline; изменение интервала перезапускает только `jumpAt`. В `tick` сначала проверяется `jumpAt`, затем `slipAt`, поэтому совпадение заканчивается событием `reason="jumped"`.

Импульс выпрыгивания:

```text
S = spreadPercent / 100
k = random(1 - S, 1 + S)
J0 = Fhand · 4s · inertia
V = clamp((J0 / m) · k, 120, 1800)
theta = random(-45°, +45°)
vx = V · sin(theta)
vy = -V · cos(theta)
```

Экранная ось Y направлена вниз, поэтому `vy` всегда отрицательна. Stationary-автовыскальзывание проверяется отдельно; наличие незавершённого drag target считается движением и не даёт ложного stationary release.

## UI и схемы

- Серверная settings schema остаётся `20`; localStorage key — `sisyphus-czar-settings-v21`, `v20` и более ранние ключи мигрируются как legacy без потери `trailEnabled` из v20.
- В группе «Камень» два checkbox и два range-контрола.
- Контролы используют декларативный `enabledWhen`: строка означает checkbox-зависимость, объект `{name, values}` — допустимые значения select. Controller синхронизирует native `disabled`, `.is-disabled`, `aria-disabled` и пояснение после input/change, загрузки и remote settings.
- `glowOptimizationMode`, `glowTargetFps`, `glowBufferScalePercent`, `glowUpdateFps`, `glowMaxPoints` и `glowDecimation` имеют `scope: "local"`: сохраняются в v21, но фильтруются из version snapshots, server templates и broadcast.
- Частые range/color/cubic-bezier input объединяются через `requestAnimationFrame`; запись localStorage и сетевой update выполняются на `change` или после debounce `180 ms`.
- `FoldLayer` входит в основной `<App />`, читает живой `params` runtime через ref и синхронизирует неинтерактивную копию сцены, canvas-следа и дождя. Для trail-canvas копирование выполняется только при изменении `data-canvas-revision`; rain-canvas сохраняют покадровую синхронизацию.
- Группа `3D Fold` хранит `draftFoldAngle`, `draftFoldZoneSize`, `draftFoldBlendEnabled`, `draftFoldBlendCurve` в общем `roomSettings`; диапазоны санитизируются сервером и клиентом.
- Vite переписывает `/drafts[/]` на `/index.html`; Express отдаёт тот же production index и зеркальный путь `/drafts/assets` для относительных Vite-ассетов.
- Production без debug UI не включает settings controller; preset всё равно задаёт baseline новой сессии.

## Протокол

Оболочка: `{v,type,seq,payload}`.

- `session.snapshot` и `presence.update` содержат `holderId`, а не массив держателей.
- `control.granted` возвращает единственный `holderId`.
- Второй `control.acquire` получает `control.denied {reason:"already_controlled"}`.
- `control.slipped` использует причины `slipped`, `jumped` или `stationary`; для `jumped` добавляются `angleDegrees`, `inertiaFactor`, `speed`.
- `settings.update` использует schema `20` и optimistic `settingsRevision`.

## HTTP

- `GET /healthz` — статус сервиса.
- `POST /api/sessions` — новая личная single-client-сессия.
- `GET /drafts` и `GET /drafts/` — совместимые адреса того же production `index.html`, что и `/`.
- `POST /api/sessions/root` — внутренний persistent root/trail hub и compatibility API.
- `POST /api/sessions/:sessionId/leave` — явное завершение личной сессии.
- `/shared/physics.js`, `/shared/room-settings.js`, `/shared/production-preset.js` — общие contracts.

## Хранилища

- Session store: `/app/data/sessions.json`, atomic temporary file + rename.
- Debug templates: `config/settings-templates.json` → `/app/repository-config/settings-templates.json`, максимум 50 записей.
- Production preset: `/app/config/production-preset.json` в отдельном named volume.
- Личная single-client-сессия удаляется при окончательном disconnect/leave; persistent root trail hub сохраняется.

## Безопасность и производительность

- Origin проверяется для HTTP и WebSocket.
- Числа проходят общие sanitizers; угол прыжка дополнительно clamp’ится до `±45°`.
- Fold-зеркало имеет `inert`, `aria-hidden` и `role=presentation`; у клона удаляются `id` и `data-testid`.
- Production CSP разрешает scripts только своего origin.
- Container работает от непривилегированного пользователя с read-only root filesystem.
- Snapshots не повторяют неизменный config; MP3 загружаются лениво.

### Рендер свечения

- `.trail` рисует базовую линию без `shadowBlur`; `.trail-glow` содержит только свечение.
- Glow строит один сглаженный path, применяет один `stroke`/`fill` с blur и выбирает точки через `sampleGlowPoints(maxPoints, decimation)`.
- Профили: performance `25% / 24 FPS / 350 / 6`, balanced `50% / 30 FPS / 700 / 3`, quality `100% / 60 FPS / 2000 / 1`; manual использует UI-значения.
- Auto начинает с геометрического бюджета balanced, обновляет glow не чаще выбранных `30/45/60 FPS` и раз в `500 ms` корректирует качество по сглаженному frame time.
- Отдельный scheduler ограничивает частоту glow-слоя. При `glow=0`, выключенном следе или пустом пути pending timer/rAF отменяется, canvas очищается один раз и новые glow-проходы не планируются.
- Базовый и glow canvas увеличивают независимые revision counters только после фактического изменения; Fold сравнивает revision и размеры перед `drawImage`.

## Проверки

- `npm run lint` — syntax checks и ESLint.
- `npm run build` — production Vite bundle.
- `npm test` — unit и integration.
- Production smoke проверяет разные session ID двух браузеров и отсутствие взаимного управления.
- Draft smoke проверяет идентичность основной Fold-сцены и настроек на `/` и `/drafts/`, сохранение glow-профиля, select-зависимости и безопасную структуру зеркала.
- Dev smoke проверяет миграцию v20→v21, лимит glow-точек, отсутствие проходов при `glow=0` и копирование Fold только при новой canvas revision.

## Технический долг

- Заменить настраиваемое кинематическое следование моделью constraint spring-damper с ограничением силы.
- Разделить массу камня, силу захвата, время контакта и коэффициент восстановления для автоматического прыжка.
- Добавить распределение вероятности выпрыгивания с seed для воспроизводимых replay.
- Добавить метрики personal sessions/shared trail hub для soak-наблюдения.
