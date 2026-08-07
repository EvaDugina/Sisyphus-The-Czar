# Technical — Sisyphus The Czar

## Паспорт

- **Стадия:** POC B
- **Последнее обновление:** 2026-08-06
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
6. Клиентский `createWindowObstacleController` считает высоту центра камня, управляет popup lifecycle и блокирует только input при наличии активных окон; серверный fixed-step цикл продолжает работать.
7. Trail-дельты личных сессий агрегируются отдельным root trail hub и подтверждаются независимо от физики камня.
8. Runtime выбирает click-gachi только из совпадения shared-манифеста с Vite audio glob, создаёт независимый `Audio` для каждого клика и при release/переходе в `falling` останавливает весь набор активных экземпляров. `СимуляцияОргазма.mov` запускается отдельно по серверному `groundTouchSeq` или локальному `touchedGround`.

`POST /api/sessions/root` сохранён для trail hub и совместимости, но пользовательский runtime к root-комнате не подключается.

## Доменная модель

### Session

- `id`, `persistent`, `singleClient`, TTL и empty-grace metadata;
- `state`: phase, x/y, vx/vy, dragging, controllerId, suspended;
- `physics`, `physicsVersion=11`;
- `roomSettings`, `roomSettingsVersion=17`, `settingsRevision`;
- `clients: Map<clientId, client>`;
- `holder: null | {clientId,x,y,vx,vy,acquiredAt,lastMoveAt,slipAt,jumpAt}`;
- trail, imprint, summit timer, ground touch sequence, final-fall, stationary и height-gate metadata.

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
| `rockJumpAngleSpreadDegrees` | `0–180`, default `90` | Полная ширина симметричного сектора вокруг вертикали вверх |
| `rockJumpInertiaSpreadPercent` | `0–100`, default `25` | Разброс множителя импульса |

При захвате сервер создаёт два независимых deadline: `slipAt` и `jumpAt`. Изменение toggle во время удержания очищает или запускает соответствующий deadline; изменение интервала перезапускает только `jumpAt`. В `tick` сначала проверяется `jumpAt`, затем `slipAt`, поэтому совпадение заканчивается событием `reason="jumped"`.

Импульс выпрыгивания:

```text
S = spreadPercent / 100
k = random(1 - S, 1 + S)
J0 = Fhand · 4s · inertia
V = clamp((J0 / m) · k, 120, 1800)
A = rockJumpAngleSpreadDegrees
theta = random(-A / 2, +A / 2)
vx = V · sin(theta)
vy = -V · cos(theta)
```

Экранная ось Y направлена вниз, поэтому для прыжка `vy ≤ 0`: внутри сектора импульс направлен вверх, а на крайних `±90°` он горизонтален. Stationary-автовыскальзывание проверяется отдельно; наличие незавершённого drag target считается движением и не даёт ложного stationary release.

## Препятствие «Окна»

`src/runtime/createWindowObstacleController.js` не участвует в серверной физике и открывает только реальные пустые browser windows через `window.open("", "_blank", features)`. Высота считается по смещению центра камня относительно его фактической стартовой позиции:

```text
heightVh = max(0, (startCenterY - currentCenterY) / viewportHeight · 100)
```

В стартовой позиции получается ровно `0vh`; движение ниже старта также ограничивается нулём. Диапазон включителен по обеим границам.

- `refresh()` сравнивает signature девяти obstacle-настроек и состояние входа в диапазон. На изменение, выход или dispose текущий schedule timeout отменяется.
- В диапазоне существует не более одного timeout следующего показа. После успешного открытия следующий интервал выбирается заново; неуспешный `window.open()` переводит permission в `blocked` и не создаёт новый schedule.
- Каждое окно имеет собственный двухсекундный close timeout и click listener. Все окна отслеживаются независимо в `Map`; один общий interval проверяет `popup.closed` и выключается, когда Map пуст.
- Ширина и высота выбираются независимо с шагом `10 px`, затем clamp-ятся по `screen.availWidth/availHeight`; позиция учитывает `availLeft/availTop` конкретного экрана.
- Test popup имеет kind `test`: он меняет состояния `unchecked → test-opened → allowed/blocked`, но не увеличивает obstacle count и не блокирует камень.
- Runtime при переходе obstacle count `0 → 1` нейтрально освобождает текущий захват без pointer-импульса. Пока count больше нуля, `startDrag` и shared acquire отклоняются; animation/physics loop не останавливается.
- Выход из диапазона отменяет только будущий schedule. Уже открытые окна сохраняют свои click/auto-close правила.

## UI и схемы

- Серверная settings schema — `31`; localStorage key — `sisyphus-czar-settings-v31`, `v30` и более ранние ключи мигрируются как legacy.
- Shared room settings schema — `27`. `preclickParallaxActivationRadiusVw` имеет диапазон `0–200` и default `50`; начальный `preclickParallaxMaxOffsetVw` — `0–150`, default `0.6`; конечный максимум — `0–50`, default `0`; начальная/конечная задержки — `0–1000 ms`, defaults `0/1000`; transition duration — `1–30 s`, default `30`; обе transition-кривые по умолчанию linear. `rockGrabRadiusVh` — `0–10`, default `0`. Старые `preclickParallaxActivationRadiusPx` и `preclickParallaxMaxOffsetPx` мигрируют по фиксированному соотношению `20 px = 1 vw`; payload версий `<27` получают defaults динамического перехода.
- Категория единственной руки называется «Рука» и содержит `handAlwaysVisible` (default `true`) и `rockGrabRadiusVh`. Категория «Камера» содержит `cameraFollowLerp` (`0.01–1`, default `0.1`). «Препятствия → Окна» содержит девять versioned controls и `WindowObstaclePermissionControl` со статусом и test action.
- В группе «Камень» находятся два checkbox, три range-контрола автоматического прыжка и одиннадцать parallax-контролов: начальный/конечный максимум, радиус, начальная/конечная задержка, duration активного движения, две cubic-bezier-кривые с фактическими осями, toggle направления, duration и кривая возврата.
- Контролы используют декларативный `enabledWhen`: строка означает checkbox-зависимость, объект `{name, values}` — допустимые значения select. Controller синхронизирует native `disabled`, `.is-disabled`, `aria-disabled` и пояснение после input/change, загрузки и remote settings.
- `glowOptimizationMode`, `glowTargetFps`, `glowBufferScalePercent`, `glowUpdateFps`, `glowMaxPoints` и `glowDecimation` имеют `scope: "local"`: сохраняются в v31, но фильтруются из version snapshots, server templates и broadcast.
- Preclick guidance является штатной функцией dev и production и не зависит от build-time flag. Parallax вычисляет базовый визуальный центр без уже применённого offset. Радиус и текущий динамический максимум переводятся из `vw` в пиксели как `valueVw / 100 · window.innerWidth`; длина смещения равна `maxOffsetPx · clamp(1 − distance / radius, 0, 1)`. Один вход хранит `activeMovementTimeMs`: sample учитывается при скорости не ниже `12 px/s` и gap не больше `120 ms`, поэтому статичная пауза не добавляет время. Нормализованный прогресс применяется к независимым delay/max cubic-bezier. Выход сбрасывает progress и samples; остановка внутри радиуса только ставит прогресс на паузу. Вход запускает отменяемый delay; пока он не завершён, рост текущей задержки пересчитывает остаток timeout. Успешный захват, нулевой начальный max/radius, смена настроек и dispose отменяют timeout. `prefers-reduced-motion` делает возврат мгновенным, но не отключает прямой parallax. Resize и смена настроек пересчитывают состояние по последней позиции. CSS-композиция камня содержит только `translate3d + scale`.
- До первого допустимого mouse-захвата `preclickRockGuidance.completed=false`: физика остаётся suspended, parallax активен, `html/body.is-manual-scroll-disabled` блокируют колесо и ручной vertical scroll. Прямой `pointerdown` по камню или круг курсора радиуса `rockGrabRadiusVh / 100 · innerHeight`, пересекающий `getBoundingClientRect()` камня, проходит через единый `startDrag`. Расширение применяется только к primary mouse, не перехватывает settings/interactive UI, wrong phase, obstacle или touch. Успешный захват завершает guidance, обнуляет offset, включает физику и camera-follow. Начальная загрузка и `resetLocalExperience()` используют единый `resetPreclickRockGuidance()`, а первый несuspended snapshot восстановленной сессии повторно завершает guidance и немедленно центрирует camera-follow на камне.
- `handAlwaysVisible=true` показывает локальную фото-руку по всей сцене и переключает `grab/grabbing` на global primary pointer. При `false` рука видима и реагирует на захват только во время hover камня. В обоих режимах интерактивная зона `.settings-toggle` / `.settings-panel.is-open` скрывает фото-руку и возвращает нативный `pointer/auto`.
- Частые range/color/cubic-bezier input объединяются через `requestAnimationFrame`; запись localStorage и сетевой update выполняются на `change` или после debounce `180 ms`.
- `FoldLayer` входит в основной `<App />`, читает живой `params` runtime через ref и синхронизирует неинтерактивную копию сцены, canvas-следа и дождя. Для trail-canvas копирование выполняется только при изменении `data-canvas-revision`; rain-canvas сохраняют покадровую синхронизацию.
- Fold-layer использует `z-index: 18`, ниже удалённых (`19`) и локального (`20`) курсоров. Курсоры внутри Fold-зеркала скрыты, поэтому 3D surface не создаёт деформированную копию руки.
- Группа `3D Fold` хранит `draftFoldAngle`, `draftFoldZoneSize`, `draftFoldBlendEnabled`, `draftFoldBlendCurve` в общем `roomSettings`; диапазоны санитизируются сервером и клиентом.
- Vite переписывает `/drafts[/]` на `/index.html`; Express отдаёт тот же production index и зеркальный путь `/drafts/assets` для относительных Vite-ассетов.
- Production без debug UI не включает settings controller; preset всё равно задаёт baseline новой сессии.

## Протокол

Оболочка: `{v,type,seq,payload}`.

- `session.snapshot` и `presence.update` содержат `holderId`, а не массив держателей.
- `control.granted` возвращает единственный `holderId`.
- Второй `control.acquire` получает `control.denied {reason:"already_controlled"}`.
- `control.slipped` использует причины `slipped`, `jumped` или `stationary`; для `jumped` добавляются `angleDegrees`, `inertiaFactor`, `speed`.
- `settings.update` использует schema `29` и optimistic `settingsRevision`.

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
- Production preset: `config/production-preset.json` → `/app/repository-config/production-preset.json`; файл создаётся при явном выборе сохранённой версии и синхронизируется через Git.
- После disconnect последнего клиента личная single-client-сессия сохраняется на grace-период и удаляется, только если клиент не переподключился; явный `leave` завершает её сразу. Persistent root trail hub сохраняется.

## Безопасность и производительность

- Origin проверяется для HTTP и WebSocket.
- Числа проходят общие sanitizers; ширина углового сектора ограничивается `0–180°`, а итоговый угол импульса — верхней полуплоскостью `±90°`.
- Min/max пары препятствия нормализуются после clamp, поэтому нижняя граница никогда не превышает верхнюю даже для старого или вручную изменённого payload.
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
- Production smoke проверяет разные session ID двух браузеров, отсутствие взаимного управления и default-видимость руки.
- Draft smoke проверяет идентичность основной Fold-сцены и настроек на `/` и `/drafts/`, диапазон максимума parallax в `vw`, режим постоянной/hover-руки, сохранение preclick и настроек при повторных reload до первого захвата, отсутствие пользовательской кнопки restart, camera lerp, obstacle defaults, popup-blocked UI, сохранение glow-профиля, select-зависимости и безопасную структуру зеркала.
- Dev smoke проверяет миграцию legacy-настроек в v31, включая перевод parallax-радиуса и максимума из px в vw, defaults динамического перехода, default-off для инверсии, default-on для постоянной руки, лимит glow-точек, отсутствие проходов при `glow=0` и копирование Fold только при новой canvas revision.
- Отдельный preclick-guidance smoke является постоянным regression-тестом и проверяет статичную камеру до активации, руку сразу после загрузки, рост смещения при приближении к центру, обычное радиальное направление, неизменность размеров камня, две временные bezier-оси, уменьшение max только при активном движении, статичную паузу, сброс при выходе, отключение parallax первым кликом и движение камеры вслед за drag камня.
- Collaboration smoke проверяет случайный актуальный gachi по click/tap, наложение независимых экземпляров, остановку всего набора при начале падения, отдельный `СимуляцияОргазма.mov` на каждый новый ground impact без повторного запуска на кадрах покоя и восстановление активной сессии с видимым камнем после reload.
- Unit-тест контроллера использует виртуальные timeout/interval и fake popup: проверяет отсутствие дублирующего schedule, одновременные окна, независимый click/2s close, выход/возврат в диапазон и паузу при блокировке.

Изменения `config/settings-templates.json` и `config/production-preset.json`, полученные через `git pull`, перечитываются при старте сервера; после обновления конфигурации работающий production-контейнер нужно перезапустить.

## Технический долг

- Заменить настраиваемое кинематическое следование моделью constraint spring-damper с ограничением силы.
- Разделить массу камня, силу захвата, время контакта и коэффициент восстановления для автоматического прыжка.
- Добавить распределение вероятности выпрыгивания с seed для воспроизводимых replay.
- Добавить метрики personal sessions/shared trail hub для soak-наблюдения.
