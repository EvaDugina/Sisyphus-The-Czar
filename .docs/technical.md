# Technical — Sisyphus The Czar

## Паспорт

- **Стадия:** POC B
- **Последнее обновление:** 2026-08-20
- **Runtime:** Node.js 24, Express 5, WebSocket `ws`, React 19, Vite 8
- **Развёртывание:** один Docker-контейнер приложения; nginx/HTTPS находятся на хосте

## Архитектура

React отвечает за структуру UI, imperative runtime — за refs, animation loop, canvas, аудио и WebSocket. Express раздаёт API/shared modules/production assets. `SessionManager` авторитетно рассчитывает личные камни фиксированным шагом.

Поток данных:

1. `main.jsx` нормализует pathname и монтирует ровно один из корневых модулей `SceneOnePage`, `SceneTwoPage`, `SceneThreePage` на `/scene-1`, `/scene-2`, `/scene-3`. `/` и неизвестный frontend path заменяются на `/scene-1`; Express отдельно перенаправляет `/settings[/]` на `/scene-1`. Удалённые `/drafts*` не получают SPA fallback и возвращают `404`.
2. Каждый корневой модуль передаёт собственный `sceneId` в общий `ScenePage`/`createSisyphusRuntime`. Runtime вызывает `POST /api/sessions` с scene-specific initial state, не восстанавливает состояние другой страницы и загружает параметры только из ключа `sisyphus-czar-settings-v54:<scene-id>`. `SessionManager` нормализует, хранит, сериализует и возвращает `sceneId`; server-side стекло/барьер/height gates разрешены только для `turnip`, hold-таймеры — для `turnip|juices`, а секундомер, magnetic lock и final fall — только для `juices`.
3. Клиент соединяется с `WS /realtime?session=<id>&client=<id>`.
4. Input отправляется не чаще 30 Hz; snapshots публикуются до 20 Hz.
5. Сервер хранит один `holder` и рассчитывает движение камня.
6. Клиентский `createWindowObstacleController` считает высоту центра камня, управляет popup lifecycle и блокирует только input при наличии активных obstacle-окон; preclick-окна картин живут независимо и по первому настоящему клику получают повторную геометрию и `focus()`. `createRockEchoTrailController` сцены 1 событийно семплирует движение DOM-камня и управляет ограниченным набором затухающих копий без собственного rAF. Серверный fixed-step цикл продолжает работать.
7. Trail-дельты личных сессий агрегируются отдельным root trail hub и подтверждаются независимо от физики камня. Session trail и hub после каждого append обрезаются по FIFO до `min(trailMaxPoints, 10 000)`; `trail.history` является каноническим начальным источником и не дублируется из первого snapshot.
8. `sceneFlow` фиксирует `completed`, `completionReason` и `finalFallStarted`. Сцена 1 после N фейковых кликов вызывает `completeScene("first-real-rock-press")` непосредственно на следующем pointerdown; сцена 2 стартует suspended в центре viewport и вызывает `completeScene("rock-touched-imprint")` при первом пересечении отпечатка; сцена 3 на первом пересечении вызывает `sceneThree.lock`, центрирует камень по imprint и блокирует повторный захват. Только trusted wheel/touch/key scroll вниз отправляет `sceneThree.release` и запускает final fall; завершение наступает после нижнего camera-follow и активного дождя.
9. `completeScene()` останавливает animation/render loop, сбрасывает скорости, блокирует дальнейший input и выставляет стабильные `data-scene-complete`/`data-scene-completion-reason`, но не меняет URL. `restartExperience()` сбрасывает только текущий `sceneFlow` и возвращает её собственное начальное состояние.
10. Dev/debug `Toolbar` и production-вариант выводят «Начать сначала» и обычную ссылку `nextPath` под кнопкой. Цикл маршрутов задан декларативно в `sceneRoutes.mjs`: `1 → 2 → 3 → 1`; автоматической навигации нет.
11. `SettingsPanel` монтируется inline внутри текущего `ScenePage`. `settingsGroupsForScene(sceneId)` создаёт новые control-объекты с `ownerSceneId`; controller использует scene-specific settings/version/import keys. Fixed-панель имеет левый pointer/keyboard resize-handle, ограниченные `min/max-width` и высоту viewport; вложенный `.settings-panel__scroll` задаёт `overflow-y: auto`, `overscroll-behavior: contain` и `scrollbar-gutter: stable`, поэтому handle не уезжает вместе с контентом. Media query до `36rem` скрывает handle. `scrollToSceneStart()` открывает сцены 1/2 у нижнего экрана, а сцену 3 — у вершины.

`POST /api/sessions/root` сохранён для trail hub и совместимости, но пользовательский runtime к root-комнате не подключается.

## Доменная модель

### Session

- `id`, `persistent`, `singleClient`, TTL и empty-grace metadata;
- `state`: phase, x/y, vx/vy, dragging, controllerId, suspended;
- `physics`, `physicsVersion=11`;
- `roomSettings`, `roomSettingsVersion=54`, `settingsRevision`;
- `clients: Map<clientId, client>`;
- `holder: null | {clientId,x,y,vx,vy,acquiredAt,lastMoveAt,slipAt,jumpAt}`;
- trail, imprint, summit timer, ground touch sequence, `sceneThreeLocked`, final-fall, stationary и height-gate metadata.

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

## Стеклянные препятствия сцены 2

- `sceneTwoGlassStrips` хранит не более 12 записей `{id, enabled, heightPercent, xPercent, widthPercent, heightVh}`. `sanitizeSceneTwoGlassStrips()` нормализует ID, диапазоны, дубликаты и ограничивает `xPercent` значением `100 - widthPercent`.
- `sceneTwoGlassCanonicalRects()` переводит видимую геометрию в canonical world `1000×2000`. Процент высоты задаёт центр полосы от низа сцены, `heightVh` пересчитывается относительно `sceneHeightScreens × 100vh`; отключённые полосы исключаются.
- `shared/physics.js` выполняет swept segment/AABB-проверку между предыдущей и новой canonical-позицией, поэтому тонкое препятствие не туннелируется на одном fixed step. Один resolver используется свободным `stepState()`, drag `stepDragState()`, серверным tick и локальным preview движения.
- При свободном столкновении нормальная скорость отражается с `sceneTwoGlassBounce`; при drag нормальная скорость обнуляется, позиция фиксируется с contact epsilon, но `dragging/controllerId` не сбрасываются. Движение вне прямоугольника сохраняется.
- `GlassStripsControl` хранит структурированное значение в hidden versioned input и даёт add/remove/enable плюс четыре геометрических поля на полосу. Общие UI-контролы задают z-index `7–17`, opacity, blur, refraction, border radius и bounce.
- `.scene-two-glass-strips` рисует прозрачные partial-width слои с `backdrop-filter`; runtime обновляет CSS-переменные и дочерние элементы без React animation state. Z-index всегда выше `.rock` (`6`) и ниже `.fold-layer` (`18`) и `.hand-cursor` (`20`). `FoldLayer` клонирует дочерние полосы при событийной синхронизации.
- Финальный rain-scroll очищает `touchY` и окно пользовательского intent при arm. Intent отмечают только wheel вниз, swipe вверх по экрану и клавиши `ArrowDown/PageDown/End/Space`; программный scroll и движения вверх дождь не запускают.

## UI и схемы

- На предыдущем этапе SVG-курсора использовались `ROOM_SETTINGS_VERSION=30`, `SETTINGS_SCHEMA_VERSION=32` и localStorage-ключ `sisyphus-czar-settings-v32`; текущая миграция читает этот ключ как legacy. Та миграция добавляла `customCursorEnabled=false` и `customCursorSizePx=32`, санитайзер ограничивает размер диапазоном `8–128`.
- Группа `Курсор` использует декларативную зависимость `customCursorSizePx.enabledWhen="customCursorEnabled"`, поэтому выключенный ползунок остаётся видимым и сохраняет значение.
- SVG реализован псевдоэлементом единого `.hand-cursor`: `handopen.svg` меняется на `handgrabbing.svg` по классу `is-grabbing`, а body-класс и CSS-переменная применяют общий флаг и размер. Локальные и remote-руки используют один DOM/CSS-путь, отдельный animation loop не создаётся.
- Псевдоэлемент активен только при `(pointer: fine)`, имеет `pointer-events: none` и наследует скрытие родительской руки в intro/fall, settings-panel и `.session-panel--toolbar`.

- Shared room settings schema и settings schema — `54`, localStorage настроек — `sisyphus-czar-settings-v54`; цепочка legacy-ключей начинается с `v53` и сохраняет поддержку более ранних версий. Миграция `v53 → v54` добавляет безопасный Brandon Mercer lens preset; миграция `v52 → v53` по-прежнему добавляет `preclickPopupArtworkMode="shuffle"` и `preclickPopupArtworkId="01.png"`.
- Категория единственной руки называется «Рука» и содержит `handVisibilityMode` (`always|hover|hidden`, default `always`), `handImageChangeDelayMs` (`0–1000`, integer, default `0`), `rockGrabRadiusVh`, `handAudioEnabled` и новый UI-контрол `stationaryAutoSlipEnabled`. Звук руки материализуется во всех сценах, stationary-автовыскальзывание — только в `turnip|juices`. Категория «Камера» содержит `cameraFollowUpEnabled`, `cameraFollowUpLerp`, `cameraFollowDownEnabled`, `cameraFollowDownLerp`, статически выключенный `rockAccelerationEnabled` и `sceneTwoOverflowYVisible`; обе пары follow относятся к `turnip|juices`, а overflow — только к `turnip`. Оба lerp имеют диапазон `0.01–1` и default `0.1`; каждый использует `enabledWhen` собственного тумблера. «Препятствия → Окна» содержит девять versioned controls и `WindowObstaclePermissionControl` со статусом и test action.
- В группе «Камень» находятся независимые select-контролы основного и fold-изображения, отдельные проценты уменьшения при нажатии и пульсе, `rockWallPenetrationPercent`, настройки автоматического прыжка и двенадцать scene-1 контролов: `preclickHopGuardClickCount`, `preclickPopupDelayMs`, `preclickPopupWidthViewportFraction`, `preclickPopupArtworkMode`, `preclickPopupArtworkId`, `birchBackgroundEnabled`, `birchScalePercent`, `preclickHopActivationRadiusPercent`, `preclickHopMaxDistancePercent`, `preclickHopMissProbabilityPercent`, `preclickHopSpeedPxPerSecond` и `preclickHopSpeedEasing`. Ширина popup санитизируется как finite `0.01–1` с default `0.2` и шагом UI `0.01`; высота не имеет отдельного параметра. `preclickPopupArtworkId` зависит от режима `single`. Масштаб берёз — integer `100–400` с шагом UI `10`; `birchScalePercent` использует `enabledWhen: "birchBackgroundEnabled"`. В UI сцены 1 скрыты `sceneHeightScreens`, вся группа `3D Fold`, `foldRockImageId`, `rockWallPenetrationPercent`, `rockActivatedWidthVw` и `rockMaxWidthVw`; shared schema и runtime-механика не удаляются. Три per-scene контрола масштаба в остальных сценах расположены как `rockMinWidthVw → rockActivatedWidthVw → rockMaxWidthVw`; `rockPulseShrinkPercent` использует `enabledWhen: "rockPulseEnabled"`.
- Отдельная scene-1 группа «След камня» содержит `rockEchoTrailEnabled`, `rockEchoTrailCopies` (`1–40`, default `16`), `rockEchoTrailIntervalMs` (`16–500`, default `50`), `rockEchoTrailOpacity` (`0.05–1`, default `0.55`) и `rockEchoTrailLifetimeMs` (`100–5000`, default `900`). Четыре числовых контрола зависят от toggle. Слой `.rock-echo-trail` находится между задними берёзами и основным камнем, не принимает pointer events; каждая `.rock-echo` клонирует текущий `src` камня, фиксирует геометрию образца и удаляется по lifetime или при превышении count-limit.
- `settings.mjs` декларативно определяет допустимость шаблонов контролов для каждой страницы, а `settingsGroupsForScene()` материализует независимые экземпляры с единственным `ownerSceneId`; реальные Gogh options инъецируются из browser-каталога при материализации. Актуальная матрица содержит `37 / 103 / 105` контролов. Scene 1 владеет preclick/берёзами/эхо-следом; scene 2 — overflow, height gates, барьером, окнами и стеклом; scene 3 — final fall, дождём, секундомером и `RockLensControl`. Камера вверх/вниз, hold/auto-release, траектория и морось материализуются отдельно в сценах 2 и 3; визуальные параметры и звук руки — отдельно во всех трёх. Runtime дополнительно ограждает foreign birch/echo/overflow/glass/gate/barrier/rain effects, поэтому старый localStorage или preset не активирует скрытую настройку.
- `createRockLensController` оставляет исходный `<img class="rock">` геометрическим и pointer-источником, скрывает только его пиксели и размещает синхронный WebGL canvas поверх. Два RGBA8 ping-pong framebuffer размером `512×512` хранят flow/lifetime; display shader реализует пять независимых UV-функций. Brandon Mercer preset работает при DPR `2` с aspect correction, falloff `0.3`, alpha `1`, dissipation `0.96`, UV strength `0.49` и velocity lerp `0.15/0.10`. После порога энергии оба framebuffer жёстко очищаются, поэтому остаточная деформация невозможна.
- В сцене 3 фото-рука заменена CSS-вариантом существующего `.hand-cursor`: фиксированные `32 px`, `handopen.svg` и `handgrabbing.svg`, без псевдоэлемента и без дополнительных pointer listeners. Для остальных сцен прежняя настройка фото-руки/SVG не меняется.
- Контролы используют декларативный `enabledWhen`: строка означает checkbox-зависимость, объект `{name, values}` — допустимые значения select. Постоянный `disabled: true` имеет приоритет над зависимостями. Controller синхронизирует native `disabled`, `.is-disabled`, `aria-disabled` и пояснение после input/change, загрузки и remote settings.
- `trailRenderProfile`, `glowOptimizationMode`, `glowTargetFps`, `glowBufferScalePercent`, `glowUpdateFps`, `glowMaxPoints` и `glowDecimation` имеют `scope: "local"`: сохраняются в `v45`, но фильтруются из version snapshots, server templates и broadcast.
- `scene.css` регистрирует `@font-face` `Comico`, `Droid 1997`, `Aksent` и `SF Pro Display Bold` из локальных ассетов. `Comico` остаётся у `.title/.title2`, а runtime задаёт секундомеру `--summit-timer-font-family` и `--summit-timer-font-size`; таблица рекордов сохраняет свой шрифт.
- `SessionManager` использует глобальный `czarSequence` только для уникальных `czar-N` и tie-break рейтинга. Базовое имя выбирает отдельный `identityRandom`, а `czarNameCounts` ведёт независимые номера имён. `restoreLeaderboard()` принимает `ЦарьИмяN` и `Царь <Имя> <N>`, сортирует записи по `sequence`, перенумеровывает каждое имя с `1` и сохраняет `bestMs`/timestamps; следующий номер восстанавливается из нормализованного набора.
- `leaderboardSnapshot()` ранжирует только записи с `bestMs > 0`, возвращает top-10, положительный `current`, `last` и число квалифицированных участников. Клиентский `composeSummitLeaderboardRows()` повторно отбрасывает нули, дедуплицирует ID в порядке top-10 → current → last и назначает роли `first`, `top-ten`, `current`, `last`; CSS задаёт им красный, кислотно-розовый, серый и белый цвета в том же порядке приоритета.
- `BirchLayer` импортирует девять прозрачных PNG, полученных разделением `assets/background/background_01.png` по alpha-компонентам, и равномерно раскладывает их по нижним `100 svh`. Два неинтерактивных абсолютных слоя имеют `z-index: 5` и `7` вокруг камня с `z-index: 6`; берёзы `5` и `6` входят в передний слой, а `pointer-events: none` сохраняет hit-test камня. Слои скрыты без body-класса `birch-background-enabled`; runtime применяет его live и задаёт `--birch-scale=birchScalePercent/100`. Каждое дерево позиционируется по `top: 50%` и `translateY(-50%)`, поэтому изменение высоты сохраняет вертикальный центр; отдельный animation loop не создаётся.
- `rockImages.mjs` сопоставляет разрешённые ID с Vite asset URL. Runtime синхронно меняет `src` основного `.rock` и `.rock-imprint`; после загрузки нового основного файла пересчитывает bounds/scale/imprint. При событийной синхронизации `FoldLayer` копирует presentation source и явно переопределяет `src` зеркального `.rock` по `foldRockImageId`, поэтому clone и Fast Refresh не возвращают устаревший asset.
- Пульс рассчитывает `rockPulseScaleFactor` из `rockPulseShrinkPercent`. `visualShrinkScaleFactor()` возвращает press-factor, пока `rockPressActive`, иначе pulse-factor; проценты не складываются и не перемножаются.
- На нижней границе `bounds.maxY` увеличивается на `visualRockHeight × rockWallPenetrationPercent / 100`. Для боковых стен `rockHorizontalWallCompensation` добавляет линейное смещение от отрицательной глубины слева до положительной справа; центр остаётся без смещения. Canonical диапазон `0…WORLD_*` не меняется, поэтому серверная физика, след и resize продолжают использовать единое положение.
- Каждый вход мыши в радиус `preclickHopActivationRadiusPercent / 100 × getBoundingClientRect().width` проходит через `preclickRadiusHopDecision()`: первые два успешных radius-hop обязательны, следующая попытка получает единственный `forced-miss`, затем решение использует `preclickHopMissProbabilityPercent / 100`. Выход из радиуса взводит следующую проверку; restart сбрасывает `radiusHopCount` и `forcedRadiusMissConsumed`. `preclickDirectionalViewportSpan()` выбирает единицу пути по вектору и пропорциям viewport, а скорость указателя `0–2000 px/s` линейно отображается в `0.28–1.0` от UI-максимума. Перед анимацией `preclickHopPathIsSafe()` непрерывно проверяет отрезок против повторяющихся на торе копий зоны руки, а `preclickToroidalDistance()` исключает визуальный возврат в старт. Кандидаты перебираются по ближайшим углам и уменьшениям дистанции, не превышая UI cap. Длительность вычисляет `preclickHopDurationMs(pathLength, preclickHopSpeedPxPerSecond)`, прогресс использует `preclickHopSpeedEasing`; покадровый wrap, reduced motion и resize сохраняются, а каждый реально начатый radius-hop запускает независимый `Смех.mp3`.
- `goghArtworks.mjs` через Vite `import.meta.glob` строит каталог всех поддерживаемых raster-файлов `assets/gogh`, а `goghArtworkSelection.mjs` стабильно сортирует basename-ID, удаляет дубли и реализует `random`, shuffle-bag без повторов внутри цикла и `single` с fallback на первый элемент каталога. Пока `preclickRockGuidance.completed=false`, физика остаётся suspended, hop активен, `html/body.is-manual-scroll-disabled` блокируют ручной vertical scroll. `consumePreclickGuardClick()` перехватывает первые `preclickHopGuardClickCount` валидных pointerdown после проверки фазы и obstacle-window, увеличивает только `guardClicksUsed`, выбирает картину через selector, ставит `openPreclickWindow()` в timeout `preclickPopupDelayMs` и выполняет hop без `playGachiClickSound()`. Каждый выполненный hop независимо запускает `Смех.mp3` и передаёт изменившуюся DOM-геометрию в эхо-контроллер. Popup центрируется относительно screen-position pointer, вычисляет ширину как `innerWidth × preclickPopupWidthViewportFraction`, высоту — по natural aspect ratio выбранного файла, затем пропорционально clamp-ит пару по доступной рабочей области. После `window.open()` контроллер измеряет browser chrome, повторно корректирует outer size/position через `resizeTo()`/`moveTo()` и растягивает `<img>` на всю клиентскую область без пустых полей. Preclick-окно не получает auto-close/click-close, не входит в `activeObstacleCount()` и после открытия не закрывается dispose; pending timeout при dispose отменяется. `revealPreclickWindows()` помечает reveal-состояние, повторно подгоняет и фокусирует все живые окна; окно из ранее поставленного timeout тоже фокусируется сразу после появления. Закрытые окна удаляются poll-контроллером и не восстанавливаются. Первый настоящий клик N+1 без смеха/gachi материализует wrapped-центр, вызывает reveal и `completeScene("first-real-rock-press")`; обычная траектория сцены 1 не включается, а restart сбрасывает shuffle-bag.
- Scene-2 scale lifecycle хранит `sceneTwoSizeState` и `sceneTwoSizeCycleArmed`. Успешный захват взводит новый цикл и вызывает `beginSceneTwoGrabScale()`, освобождение до приземления переводит камень в `airborne` и включает пульс, а `settleSceneTwoRockScaleOnGround()` на первом ground-touch ставит `ground`, снимает флаг и фиксирует начальный размер. Повторные отскоки при снятом флаге больше не вызывают airborne-scale и не возвращают конечный размер; следующий цикл начинается только с нового успешного захвата. Remote snapshot использует тот же `beginSceneTwoGrabScale()`, включая transition и задержку сжатия. Camera-follow независимо применяет пары up/down enabled+lerp; немедленное центрирование восстановленной активной сессии остаётся служебным путём.
- `handVisibilityMode=always` показывает локальную фото-руку по всей сцене, `hover` — только над камнем и во время захвата, `hidden` удаляет локальные и remote-руки из представления и возвращает нативный курсор над камнем. Primary pointer немедленно запускает захват, но `is-alternate/is-grabbing` применяются через отменяемый timeout `handImageChangeDelayMs`; pointerup, reset, смена в `hidden` и dispose очищают pending timeout. Над `.settings-toggle`, `.settings-panel.is-open` и `.session-panel--toolbar` фото-рука скрывается и используется нативный `pointer/auto`.
- Частые range/color/cubic-bezier input объединяются через `requestAnimationFrame`; сетевой update выполняется на `change` или после debounce `180 ms`. Inline-controller пишет полный санитизированный `params` в scene-specific localStorage после `settings.applied`; следующая страница читает только собственный ключ.
- `FoldLayer` входит в общий `ScenePage`, один раз создаёт неинтерактивную копию world и синхронизирует динамику по scroll/resize и событиям frame-coordinator с ограничением 30 FPS. Слой имеет `position:absolute` внутри относительного `#root`, полную ширину и высоту `foldPanelHeightVh`; fixed/sticky режим не используется. Каждый из трёх trail-canvas копируется только при изменении `data-canvas-revision`; hidden document, выключенный Fold и полный idle не держат rAF.
- Документный `top` Fold вычисляется как `(sceneHeightPx − panelHeightPx) × foldPositionPercent / 100`. Разность не опускается ниже нуля, поэтому при `100%` панель заканчивается ровно у нижней границы сцены и не увеличивает `scrollHeight`. Внутренний clone-track компенсирует этот document offset; `window.scrollY` используется только для синхронизации клонированных fixed-элементов.
- Fold-layer использует `z-index: 18`, ниже удалённых (`19`) и локального (`20`) курсоров. Курсоры внутри Fold-зеркала скрыты, поэтому 3D surface не создаёт деформированную копию руки.
- Для точного `foldAngle=0` CSS-селектор по `data-fold-angle` задаёт `--fold-seam-scale: 0` и прозрачный background зоны/source-window. Mirror DOM и покадровая синхронизация сохраняются; для любого ненулевого угла используется прежний seam-scale.
- Группа `3D Fold` хранит `foldPositionPercent`, `foldPanelHeightVh`, `foldAngle`, `foldZoneSize`, `foldBlendEnabled`, `foldBlendCurve` в общем `roomSettings`; положение (`0–100%`) и высота панели (`1–100 vh`) независимы от угла, размера линзы и смешивания. Диапазоны санитизируются сервером и клиентом, legacy `draftFold*` после миграции не сохраняется и не передаётся.
- Vite использует `appType: "mpa"` и переписывает `/scene-1[/]`, `/scene-2[/]`, `/scene-3[/]` на `/index.html`. Express отдаёт тот же entrypoint для трёх canonical URL, перенаправляет trailing slash на вариант без него и удалённый `/settings[/]` — на `/scene-1`. Legacy route и asset alias не регистрируются, поэтому неизвестные `/drafts*` не получают `index.html`.
- Production без debug UI не включает settings controller; preset всё равно задаёт baseline новой сессии.

## Протокол

Оболочка: `{v,type,seq,payload}`.

- `session.snapshot` и `presence.update` содержат `holderId`, а не массив держателей.
- `control.granted` возвращает единственный `holderId`.
- Второй `control.acquire` получает `control.denied {reason:"already_controlled"}`.
- `control.slipped` использует причины `slipped`, `jumped` или `stationary`; для `jumped` добавляются `angleDegrees`, `inertiaFactor`, `speed`.
- `settings.update` использует schema `54` и optimistic `settingsRevision`.
- `sceneThree.lock {x,y}` принимается только от текущего holder внутри imprint, сбрасывает holder/скорости и публикует `sceneThreeLocked=true`; новый `control.acquire` получает `scene_three_locked`. `sceneThree.release` переводит авторитетное состояние в `fallingToBottom`, а snapshot сохраняет флаг для reload/restore.
- Trail-протокол остаётся v1: `trail.history`, `trail.batch`, `trail.append`, `trail.ack`, `trail.resync`. Client append отправляется пакетами до 16 точек или через 50 ms, аварийный flush режет payload максимум по 64.

## HTTP

- `GET /healthz` — статус сервиса.
- `POST /api/sessions` — новая личная single-client-сессия.
- `GET /scene-1`, `GET /scene-2`, `GET /scene-3` — самостоятельные scene page через общий frontend entrypoint; trailing slash канонизируется `308`.
- `GET /settings` и `GET /settings/` — устаревший адрес, `308` на `/scene-1`.
- `GET /drafts`, `GET /drafts/` и `GET /drafts/assets/*` — удалённые адреса, ожидаемый ответ `404`.
- `POST /api/sessions/root` — внутренний persistent root/trail hub и compatibility API.
- `POST /api/sessions/:sessionId/leave` — явное завершение личной сессии.
- `/shared/physics.js`, `/shared/room-settings.js`, `/shared/production-preset.js` — общие contracts.

## Хранилища

- Session store: `/app/data/sessions.json`, atomic temporary file + rename.
- Debug templates: `config/settings-templates.json` → `/app/repository-config/settings-templates.json`, максимум 50 записей. Frontend префиксует ID как `scene-N--...` и отфильтровывает entries/broadcast других сцен, сохраняя логически независимые каталоги в одном Git-файле.
- Production preset: `config/production-preset.json` → `/app/repository-config/production-preset.json`; файл создаётся при явном выборе сохранённой версии и синхронизируется через Git.
- Browser session keys получают namespace `sisyphus-room-session-v1:scene-N`. Runtime страницы стартует её lifecycle заново и не подмешивает состояние другой сцены; namespace исключает межсценовое удаление или перезапись служебной session-записи.
- После disconnect последнего клиента личная single-client-сессия сохраняется на grace-период и удаляется, только если клиент не переподключился; явный `leave` завершает её сразу. Persistent root trail hub сохраняется.
- Формат session store не меняется: при восстановлении trail обрезается до 10 000, а нормализованное состояние попадает в следующее штатное сохранение.

## Безопасность и производительность

- Origin проверяется для HTTP и WebSocket.
- Числа проходят общие sanitizers; ширина углового сектора ограничивается `0–180°`, а итоговый угол импульса — верхней полуплоскостью `±90°`.
- Min/max пары препятствия нормализуются после clamp, поэтому нижняя граница никогда не превышает верхнюю даже для старого или вручную изменённого payload.
- Fold-зеркало имеет `inert`, `aria-hidden` и `role=presentation`; у клона удаляются `id` и `data-testid`.
- Production CSP разрешает scripts только своего origin.
- Container работает от непривилегированного пользователя с read-only root filesystem.
- Snapshots не повторяют неизменный config; MP3 загружаются лениво.

### Рендер траектории

- `.trail-history` содержит подтверждённую историю, `.trail-session` — новые точки после checkpoint, `.trail-glow` — sampled-свечение. Общий retained canonical state всегда ограничен 10 000 точек.
- History-canvas — абсолютный sliding buffer высотой до трёх viewport с квантизованной верхней границей; session/glow имеют размер одного viewport. Невидимые разрывы формируют отдельные runs и не соединяются линией.
- History рисуется батчами до 256 quadratic-сегментов на `stroke()`, использует градиент `lineColorTail → lineColor`; session продолжает линию постоянным `lineColor` одним проходом за display frame.
- Checkpoint объединяет последние 10 000 точек и очищает закоммиченную session-часть при 128/192/256 точках для low/mobile/desktop-high. Resize, смена DPR, профиля или стиля выполняют тот же checkpoint.
- Render-профили: low `3000 / 128 / DPR 1 / glow 200@24`, mobile `5000 / 192 / 1.25 / 350@30`, desktop `10000 / 256 / 1.5 / 700@30`, high `10000 / 256 / 2 / 1200@60`. Auto выбирает профиль по Save-Data, памяти, числу потоков и coarse pointer; бюджет физических пикселей может дополнительно снизить DPR.
- Физическая и preclick-сцены передают anchor в `recordTrailAnchorPoint()`. Frame-coordinator coalesce-ит history/session/glow invalidation, а обычный scroll перестраивает history только при смене sliding window.
- При `glow=0`, выключенном следе или пустом пути pending timer/rAF отменяется. Каждый слой увеличивает revision только после фактического прохода; Fold сравнивает revision и размеры перед `drawImage`.
- Dev debug API публикует profile, stored/rendered/history/session counts, revisions, render passes, stroke batches, window top, effective DPR и WebSocket queue; User Timing получает `sisyphus.trail.history/session/glow` и `sisyphus.fold`.

## Проверки

- `npm run lint` — syntax checks и ESLint.
- `npm run build` — production Vite bundle.
- `npm test` — unit и integration.
- Production smoke открывает все три прямых URL без debug API, проверяет единственный mounted world, циклические ссылки, restart сцены 1, подвешенный центр и захват сцены 2, а также старт вершины сцены 3 с камнем в руке.
- Scene-pages smoke проверяет точные `37 / 103 / 104` контрола, режим и условный select Gogh, отсутствие скрытых scene-1 полей и чужого клиентского влияния, независимое восстановление одинакового визуального параметра, миграцию scene-1 storage `v52 → v53`, desktop resize, отдельный wheel-scroll без изменения `window.scrollY`, отсутствие обрезания `5%`, narrow viewport и завершение сцен 2/3.
- UI/Fold smoke проверяет legacy-миграции, редактор и visual controls стеклянных полос, порядок z-index, canonical hitbox, Fold-клон, а также то, что дождь сцены 3 игнорирует программное движение и пользовательский scroll вверх, но запускается scroll вниз.
- Dev smoke проверяет три canvas, загрузку 10 000 точек, отсутствие revisions/rAF в idle, session-only проход до checkpoint, history batching не более 50 `stroke()` и WebSocket-пакеты 16 точек/50 ms.
- Постоянный preclick-hop smoke проверяет guidance, scroll lock, reload/restart, радиус от текущей ширины камня, два обязательных radius-hop со смехом, третий forced miss, поведение `0%`, скорость/кривую, дискретный эхо-след, отложенный popup с картинами `01–03`, viewport-долю ширины и natural aspect ratio, отсутствие auto-close, отсутствие обычной траектории в сцене 1, направленный максимум, безопасный X/Y/corner wrap, resize, reduced motion и кликабельность. Отдельный сценарий задаёт N=3: auto-hop не расходует счётчик и не отправляет `control.acquire`, первые три клика не воспроизводят gachi-звук, последовательно открывают картины `01`, `02`, `03` и отталкивают камень со смехом, а четвёртый клик фокусирует все три живых окна и завершает сцену с причиной `first-real-rock-press`.
- Collaboration smoke разделяет «Капель», gachi и impact-аудио: pointerdown взводит impact-разрешение, первый физический контакт запускает `СимуляцияОргазма.mov`, дальнейшие отскоки без касания молчат, а новое касание разрешает ровно один следующий play. Та же семантика проверяется для скачка shared `groundTouchSeq`. Также smoke проверяет primary/right/middle, наложение gachi без остановки при release/`FALLING`, доступную с клавиатуры кнопку «Начать сначала», нижний viewport suspended-сессии и восстановление активной сессии с видимым камнем после reload.
- Unit-тест оконного контроллера использует виртуальные timeout/interval и fake popup: проверяет отсутствие дублирующего schedule, одновременные obstacle-окна, независимый click/2s close, выход/возврат в диапазон, паузу при блокировке, а также задержку, геометрию, image-разметку, фокус живых/отложенных preclick-окон и ручной lifecycle. Unit-тест эхо-контроллера проверяет sanitization, порог движения, интервал, count-limit, live-sync opacity/lifetime и немедленную очистку при выключении.
- Unit/integration regression проверяет scene route/nextPath, отдельные ключи параметров, версий и session namespace, принадлежность materialized control единственной сцене, сохранение server `sceneId`, матрицу server-side областей действия, сообщения production preset, полную замену canonical preset и physics/room-settings contracts.

Изменения `config/settings-templates.json` и `config/production-preset.json`, полученные через Git, перечитываются при следующем запуске сервера. Выбор флага через inline debug UI обновляет серверный preset для новых сессий. Scene-specific browser snapshot затем применяется только к соответствующей странице; `shared/production-preset.js` задаёт безопасный fallback, если canonical JSON отсутствует или повреждён.

## Ход разработки

- **2026-08-20:** schema/localStorage `52/v52` заменили множитель ширины preclick-popup на viewport-долю `0.01–1`, добавили восстановление всех живых окон первым настоящим кликом и событийный эхо-след сцены 1 с отдельной UI-группой. Unit, build и целевые scene/UI/hop smoke актуализированы.
- **2026-08-20:** schema/localStorage `53/v53` добавили каталог Gogh, режимы `random|shuffle|single` и условный select конкретной картины; из UI сцены 1 удалены нерелевантные Fold/page-height/wall/post-physics-size контролы без удаления shared-механики. Unit, build и целевые scene/hop smoke актуализированы.
- **2026-08-20:** schema/localStorage `54/v54` добавили структурированный выбор пяти WebGL-линз для `rock-03`, точный Brandon Mercer preset, полный recovery, scene-3 SVG-курсор и авторитетный magnetic lock до trusted scroll вниз. Unit/integration, build и scene-pages smoke актуализированы.
- **2026-08-19:** frontend разделён на три scene route и три корневых модуля. Runtime получил `sceneId`/`sceneFlow`, независимые storage/session namespaces, scene-specific start/reset/complete и стабильные финальные состояния. `/settings` удалён из основного сценария; lint, build, unit, production smoke и scene-pages smoke актуализированы.
- **2026-08-19:** аудит параметров добавил недостающие `handAudioEnabled`/`stationaryAutoSlipEnabled` и 39 контролов сцены 3, зафиксировал матрицу `41 / 103 / 104`, перенёс `sceneId` в server session/persistence и оградил foreign effects. Панель получила горизонтальный resize, viewport-height scroll container и устойчивую раскладку label/value.
- **2026-08-17:** `background_01.png` разделён на девять alpha-спрайтов берёз; сцена получила два декоративных слоя вокруг камня. Preclick-popup переведён с `rock.webp` на циклические картины `gogh/01–03`, а отдельный вызов `Camen.mp3` для фейковых кликов удалён. Затронутые lint, build, unit и N-click smoke пройдены в Docker; ручная desktop/mobile-проверка подтвердила высоту `100 svh`, глубину слоёв, кликабельность камня и отсутствие console errors.

## Технический долг

- Заменить настраиваемое кинематическое следование моделью constraint spring-damper с ограничением силы.
- Разделить массу камня, силу захвата, время контакта и коэффициент восстановления для автоматического прыжка.
- Добавить распределение вероятности выпрыгивания с seed для воспроизводимых replay.
- Добавить метрики personal sessions/shared trail hub для soak-наблюдения.
