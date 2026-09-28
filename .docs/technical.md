# Technical — Sisyphus The Czar

## Паспорт

- **Стадия:** POC B
- **Последнее обновление:** 2026-09-28
- **Runtime:** Node.js 24, Express 5, WebSocket `ws`, React 19, Vite 8
- **Развёртывание:** один Docker-контейнер приложения; nginx/HTTPS находятся на хосте

## Архитектура

React отвечает за структуру UI, imperative runtime — за refs, animation loop, canvas, аудио и WebSocket. Express раздаёт API/shared modules/production assets. `SessionManager` авторитетно рассчитывает личные камни фиксированным шагом.

При `DEBUG=false` Express до раздачи frontend и API включает единый password gate. При `DEBUG=true` непустой `ACCESS_PASSWORD` также включает gate, оставляя доступным production UI параметров только после входа. `GET/POST /access` проверяет пароль, ограничивает попытки по IP и выдаёт случайную серверную `HttpOnly` cookie на 24 часа; тот же токен требуется HTTP middleware и обработчику WebSocket upgrade.

Поток данных:

1. `main.jsx` нормализует pathname и монтирует ровно один из корневых модулей `SceneOnePage`, `SceneTwoPage`, `SceneThreePage` на `/scene-1`, `/scene-2`, `/scene-3`. `/` и неизвестный frontend path заменяются на `/scene-1`; Express отдельно перенаправляет `/settings[/]` на `/scene-1`. Удалённые `/drafts*` не получают SPA fallback и возвращают `404`.
2. Каждый корневой модуль передаёт собственный `sceneId` в общий `ScenePage`/`createSisyphusRuntime`. Runtime вызывает `POST /api/sessions` с scene-specific initial state и не восстанавливает игровое состояние другой страницы. Уникальные параметры читаются из `sisyphus-czar-settings-v56:<scene-id>`, а применимые общие поля перекрываются значениями `sisyphus-czar-shared-scene-settings-v1`. `SessionManager` нормализует, хранит, сериализует и возвращает `sceneId`; server-side стекло/барьер/height gates разрешены только для `turnip`, hold-таймеры — для `turnip|juices`, а секундомер, magnetic lock и final fall — только для `juices`.
3. Клиент соединяется с `WS /realtime?session=<id>&client=<id>`.
4. Input отправляется не чаще 30 Hz; snapshots публикуются до 20 Hz.
5. Сервер хранит один `holder` и рассчитывает движение камня.
6. Клиентский `createWindowObstacleController` считает высоту центра камня, управляет popup lifecycle и блокирует только input при наличии активных obstacle-окон; preclick-окна картин живут независимо, используют общий размер последовательности и остаются открытыми до ручного закрытия. На третьем fake-click runtime вызывает `revealPreclickWindows()` для всех незакрытых окон и запускает существующий background-таймер; задержанный третий popup наследует состояние reveal после фактического открытия. `createRockEchoTrailController` сцены 1 событийно семплирует движение DOM-камня и управляет ограниченным набором затухающих копий без собственного rAF. Серверный fixed-step цикл продолжает работать.
7. Trail-дельты личных сессий агрегируются отдельным root trail hub и подтверждаются независимо от физики камня. Новые visual-точки используют формат v3 `[x_vw, y_vh, 3]`; сервер читает старый v2 `[canonicalX, canonicalY, 2]`, но принимает новые append только в v3. Session trail и hub после каждого append обрезаются по FIFO до `min(trailMaxPoints, 10 000)`; `trail.history` является каноническим начальным источником и не дублируется из первого snapshot.
8. `sceneFlow` фиксирует `completed`, `completionReason` и `finalFallStarted`. Сцена 1 сначала перехватывает отдельный pointerdown как начальный клик, затем два разрешённых pointerdown как нумерованные fake-click. После второго клика hover использует `0%` подпускания, а следующий достигший камня pointerdown выполняет третий fake-hop, материализует его безопасную конечную позицию, поднимает все незакрытые popup-окна и завершает сцену с причиной `third-fake-click`. Сцена 2 при первом пересечении отпечатка вызывает `completeSceneTwoAtImprint()`, плавно выставляет камень точно в центр imprint и завершает сцену с причиной `rock-touched-imprint`; сцена 3 на первом пересечении синхронно скрывает локальную и shared-pointer руку, вызывает `sceneThree.lock`, центрирует камень по imprint и блокирует повторный захват. Только trusted wheel/touch/key scroll вниз отправляет `sceneThree.release` и запускает final fall; viewport остаётся неподвижным, а завершение наступает при приземлении камня после затухания дождя и его громкости.
9. `completeScene()` останавливает основной animation/render loop, сбрасывает скорости, блокирует дальнейший input и выставляет стабильные `data-scene-complete`/`data-scene-completion-reason`, но не меняет URL. После финала сцены 2 отдельный ограниченный RAF продолжает существующий upward camera-follow до точного `scrollY = 0`, принудительно закрывая остаток при browser rounding; он не зависит от обычного тумблера follow-up и очищается при restart/dispose. `restartExperience()` сбрасывает только текущий `sceneFlow` и возвращает её собственное начальное состояние.
10. Dev/debug `Toolbar` и production-вариант выводят «Начать сначала» и обычную ссылку `nextPath` под кнопкой. Цикл маршрутов задан декларативно в `sceneRoutes.mjs`: `1 → 2 → 3 → 1`; автоматической навигации нет.
11. `SettingsPanel` монтируется inline внутри текущего `ScenePage`. `settingsGroupsForScene(sceneId)` создаёт control-объекты с `ownerSceneId`, `sharedSceneIds` и `sharedSceneLabel`; общий badge показывает область `1–3` или `2–3`. Controller сохраняет scene-specific settings/version/import keys и отдельно merge-ит только общие имена текущей страницы. Fixed-панель имеет левый pointer/keyboard resize-handle, ограниченные `min/max-width` и высоту viewport; вложенный `.settings-panel__scroll` задаёт `overflow-y: auto`, `overscroll-behavior: contain` и `scrollbar-gutter: stable`, поэтому handle не уезжает вместе с контентом. Media query до `36rem` скрывает handle. `scrollToSceneStart()` открывает сцены 1/2 у нижнего экрана, а сцену 3 — у вершины.

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
| `rockJumpInertiaSpreadPercent` | `0–1`, step `0.01`, default `0.25` | Разброс множителя импульса в процентах |
| `wallImpactSoundFilename` | `none`, orgasm или gachi; default orgasm | Отдельный звук нового контакта с боковой стеной |

Только для сцены 3 сервер при захвате создаёт два независимых deadline: `slipAt` и `jumpAt`. Изменение toggle во время удержания очищает или запускает соответствующий deadline; изменение интервала перезапускает только `jumpAt`. В `tick` сначала проверяется `jumpAt`, затем `slipAt`, поэтому совпадение заканчивается событием `reason="jumped"`. Для сцены 2 `slipAt` и `jumpAt` всегда равны `null`, а stationary-release не запускается даже при устаревших включённых флагах.

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

- Shared room settings schema и controller settings schema — `64`, scene localStorage настроек — `sisyphus-czar-settings-v56:<scene-id>`. Миграция `63` добавляет `sceneTwoHandScrollSpeedVhPerSecond=1`, а `64` сохраняет отдельный звук fake-click сцены 1. Общий browser snapshot хранится в `sisyphus-czar-shared-scene-settings-v1`: при его отсутствии 20 полей сцен 1–3 берутся из сцены 1, а остальные общие поля сцен 2–3 — из сцены 2; fallback идёт к следующей сцене и затем к default. После первого сохранения миграция идемпотентна и старые scene-specific общие значения больше не перекрывают snapshot.
- Категория единственной руки называется «Рука» и содержит `handVisibilityMode` (`always|hover|hidden`, default `always`), `handImageChangeDelayMs` (`0–1000`, integer, default `0`), `rockGrabRadiusVh`, `handAudioEnabled` и новый UI-контрол `stationaryAutoSlipEnabled`. Звук руки материализуется во всех сценах, stationary-автовыскальзывание — только в `turnip|juices`. Категория «Камера» содержит `cameraFollowUpEnabled`, `cameraFollowUpLerp`, `cameraFollowDownEnabled`, `cameraFollowDownLerp`, статически выключенный `rockAccelerationEnabled` и `sceneTwoOverflowYVisible`; обе пары follow относятся к `turnip|juices`, а overflow — только к `turnip`. Оба lerp имеют диапазон `0.01–1` и default `0.1`; каждый использует `enabledWhen` собственного тумблера. «Препятствия → Окна» содержит девять versioned controls и `WindowObstaclePermissionControl` со статусом и test action.
- В группе «Камень» находятся select-контролы основного и fold-изображения, отдельные проценты уменьшения при нажатии и пульсе, `rockWallPenetrationPercent`, настройки автоматического прыжка и тринадцать scene-1 контролов: `preclickPopupDelayMs`, `preclickPopupBackgroundDelaySeconds`, `preclickPopupWidthViewportFraction`, `preclickPopupArtworkMode`, `preclickPopupArtworkId`, `birchBackgroundEnabled`, `birchScalePercent`, `preclickHopActivationRadiusPercent`, `preclickHopMaxDistancePercent`, `preclickFakeClickHopDistancePercent`, `preclickHopMissProbabilityPercent`, `preclickHopSpeedPxPerSecond` и `preclickHopSpeedEasing`. Legacy-поля `preclickPopupOnAnySceneClickEnabled` и `preclickFirstHopOnClick` остаются в sanitizer/migration для чтения старых snapshot, но не выводятся в UI и не управляют runtime. `preclickHopGuardClickCount` остаётся canonical room setting, но schema 59 жёстко санитизирует и мигрирует его в `2`, а UI-контрола для него нет. Задержка возврата фокуса санитизируется как finite `0–5` с default `1`, UI-шагом `0.1` и сохраняется во всех versioned snapshot. Ширина popup санитизируется как finite `0.01–1` с default `0.2` и шагом UI `0.01`; высота не имеет отдельного параметра. `preclickPopupArtworkId` зависит от режима `single`. Масштаб берёз — integer `100–400` с шагом UI `10`; `birchScalePercent` использует `enabledWhen: "birchBackgroundEnabled"`. В UI сцены 1 скрыты `sceneHeightScreens`, вся группа `3D Fold`, `foldRockImageId`, `rockWallPenetrationPercent`, `rockActivatedWidthVw` и `rockMaxWidthVw`; shared schema и runtime-механика не удаляются. `rockPulseShrinkPercent` общий для трёх сцен и везде использует диапазон `0–10`, шаг `0.1` и `enabledWhen: "rockPulseEnabled"`. `preclickFakeClickHopDistancePercent` имеет диапазон `0–150`, шаг `1` и default `50`; начальный, два нумерованных и финальный третий fake-click передают фиксированный distance factor `1`, не затрагивая скоростную формулу hover. Начальный click-hop вызывает тот же эхо-контроллер, но передаёт `soundEnabled=false` и не планирует popup.
- Отдельная scene-1 группа «След камня» содержит `rockEchoTrailEnabled`, `rockEchoTrailCopies` (`1–40`, default `16`), `rockEchoTrailIntervalMs` (`16–500`, default `50`), `rockEchoTrailOpacity` (`0.05–1`, default `0.55`) и `rockEchoTrailLifetimeMs` (`100–5000`, default `900`). Четыре числовых контрола зависят от toggle. Слой `.rock-echo-trail` находится между задними берёзами и основным камнем, не принимает pointer events; каждая `.rock-echo` клонирует текущий `src` камня, фиксирует геометрию образца и удаляется по lifetime или при превышении count-limit.
- `settings.mjs` декларативно определяет допустимость и общую область контролов, а `settingsGroupsForScene()` материализует экземпляры с `ownerSceneId` и метаданными общего состояния; реальные Gogh options инъецируются из browser-каталога при материализации. Актуальная матрица содержит `40 / 105 / 106` контролов и `20 / 84 / 84` общих маркера. Scene 1 владеет preclick/берёзами/эхо-следом; scene 2 — фиксированной скоростью скролла вверх, overflow, height gates, барьером, окнами и стеклом; scene 3 — final fall, дождём, тремя настройками секундомера и `RockLensControl`. Камера вверх/вниз, hold/auto-release, траектория и морось используют общий слой сцен 2–3; 20 визуальных параметров/руки/камня используют общий слой сцен 1–3. Runtime дополнительно ограждает foreign birch/echo/overflow/glass/gate/barrier/rain effects, поэтому общий snapshot не активирует скрытую настройку.
- `createRockLensController` оставляет исходный `<img class="rock">` геометрическим и pointer-источником, скрывает только его пиксели и размещает синхронный WebGL canvas поверх. Два RGBA8 ping-pong framebuffer размером `512×512` хранят flow/lifetime; display shader реализует пять независимых UV-функций. Brandon Mercer preset работает при DPR `2` с aspect correction, falloff `0.3`, alpha `1`, dissipation `0.96`, UV strength `0.49` и velocity lerp `0.15/0.10`. После порога энергии оба framebuffer жёстко очищаются, поэтому остаточная деформация невозможна.
- В сцене 3 фото-рука заменена CSS-вариантом существующего `.hand-cursor`: фиксированные `32 px`, `handopen.svg` и `handgrabbing.svg`, без псевдоэлемента и без дополнительных pointer listeners. Для остальных сцен прежняя настройка фото-руки/SVG не меняется.
- Контролы используют декларативный `enabledWhen`: строка означает checkbox-зависимость, объект `{name, values}` — допустимые значения select. Постоянный `disabled: true` имеет приоритет над зависимостями. Controller синхронизирует native `disabled`, `.is-disabled`, `aria-disabled` и пояснение после input/change, загрузки и remote settings.
- `trailRenderProfile`, `glowOptimizationMode`, `glowTargetFps`, `glowBufferScalePercent`, `glowUpdateFps`, `glowMaxPoints` и `glowDecimation` имеют `scope: "local"`: сохраняются в browser snapshot и не входят в live broadcast, но кнопка сохранения включает их в полный version snapshot, server Git-template и production preset.
- `scene.css` регистрирует `@font-face` `Comico`, `Droid 1997`, `Aksent` и `SF Pro Display Bold` из локальных ассетов. `Comico` остаётся у `.title/.title2`, а runtime задаёт секундомеру family, size и горизонтальный scale через CSS-переменные. Селектор `body[data-scene="scene-3"].theme-dark .summit-timer` меняет только `visibility`, поэтому таблица рекордов сохраняет собственный шрифт, видимость и геометрию.
- `SessionManager` использует глобальный `czarSequence` только для уникальных `czar-N` и tie-break рейтинга. Базовое имя выбирает отдельный `identityRandom`, а `czarNameCounts` ведёт независимые номера имён. `restoreLeaderboard()` принимает `ЦарьИмяN` и `Царь <Имя> <N>`, сортирует записи по `sequence`, перенумеровывает каждое имя с `1` и сохраняет `bestMs`/timestamps; следующий номер восстанавливается из нормализованного набора.
- `leaderboardSnapshot()` ранжирует только записи с `bestMs > 0`, возвращает top-10, положительный `current`, `last` и число квалифицированных участников. Клиентский `composeSummitLeaderboardRows()` повторно отбрасывает нули, дедуплицирует ID в порядке top-10 → current → last и назначает роли `first`, `top-ten`, `current`, `last`; CSS задаёт им красный, кислотно-розовый, серый и белый цвета в том же порядке приоритета.
- `BirchLayer` импортирует девять прозрачных PNG, полученных разделением `assets/background/background_01.png` по alpha-компонентам, и равномерно раскладывает их по нижним `100 svh`. Два неинтерактивных абсолютных слоя имеют `z-index: 5` и `7` вокруг камня с `z-index: 6`; берёзы `5` и `6` входят в передний слой, а `pointer-events: none` сохраняет hit-test камня. Слои скрыты без body-класса `birch-background-enabled`; runtime применяет его live и задаёт `--birch-scale=birchScalePercent/100`. Каждое дерево позиционируется по `top: 50%` и `translateY(-50%)`, поэтому изменение высоты сохраняет вертикальный центр; отдельный animation loop не создаётся.
- `rockImages.mjs` сопоставляет разрешённые ID с Vite asset URL. Runtime синхронно меняет `src` основного `.rock` и `.rock-imprint`; после загрузки нового основного файла пересчитывает bounds/scale/imprint. При событийной синхронизации `FoldLayer` копирует presentation source и явно переопределяет `src` зеркального `.rock` по `foldRockImageId`, поэтому clone и Fast Refresh не возвращают устаревший asset.
- Пульс рассчитывает `rockPulseScaleFactor` из `rockPulseShrinkPercent`. `visualShrinkScaleFactor()` возвращает press-factor, пока `rockPressActive`, иначе pulse-factor; проценты не складываются и не перемножаются. `rockPulseShouldRun()` сохраняет постоянный пульс сцены 1, в сцене 2 разрешает его для `ground|airborne` и останавливает для `held`, а контракт сцены 3 оставляет прежним.
- На нижней границе `bounds.maxY` увеличивается на `visualRockHeight × rockWallPenetrationPercent / 100`. Для боковых стен `rockHorizontalWallCompensation` добавляет линейное смещение от отрицательной глубины слева до положительной справа; центр остаётся без смещения. Canonical диапазон `0…WORLD_*` не меняется, поэтому серверная физика, след и resize продолжают использовать единое положение.
- `updatePreclickRockHop()` всегда обновляет координаты и скорость указателя, но пока `initialClickConsumed=false` не вычисляет radius-hop. Первый валидный pointerdown проходит через `activatePreclickInitialClick()` раньше `consumePreclickGuardClick()`: выставляет `initialClickConsumed=true`, выполняет hop с `preclickFakeClickHopDistancePercent` и fixed factor `1` без popup и звука, не меняет `radiusHopCount`, `initialHoverAllowConsumed` и `guardClicksUsed`, а решение помечает `initial-click`. После активации каждый новый вход мыши в радиус `preclickHopActivationRadiusPercent / 100 × getBoundingClientRect().width` проходит через `preclickRadiusHopDecision()`: первые три hover-hop обязательны, четвёртый вход один раз возвращает `initial-allow`. Каждый из двух нумерованных fake-click взводит `requiredHoverHopPending`; следующий валидный radius-entry возвращает `post-guard-required-hop`, снимает барьер только выполненным hover-hop и не вызывает случайную выборку. До второго fake-click следующие полные выходы и входы используют `preclickHopMissProbabilityPercent / 100`. Когда `guardClicksUsed >= preclickHopGuardClickCount`, `isPersistentPreclickFakeStage()` принудительно передаёт в решение `0%`, удерживает `clickAllowed=false` и маркирует обычный hover-результат как `persistent-fake-hop`. Следующий достигший камня pointerdown проходит через `consumePersistentPreclickFakeClick()`: открывает третий popup, выполняет fixed-distance hop с trigger `persistent-fake-click`, материализует его конечную позицию, вызывает reveal/background lifecycle окон и `completeScene("third-fake-click")`. Делегированный `pointerdown` на `.world` без отдельного флага работает только после `initialClickConsumed=true` и до завершения сцены, открывает один popup для primary-кликов вне `.rock` и интерактивных элементов и не меняет прогресс; клики камня остаются у state-machine и не дублируются. Restart сбрасывает `initialClickConsumed`, счётчики и остальные флаги. `preclickDirectionalViewportSpan()` выбирает единицу пути по вектору и пропорциям viewport, а скорость указателя `0–2000 px/s` линейно отображается в `0.5–1.0` от UI-максимума. Перед анимацией `preclickHopPathIsSafe()` непрерывно проверяет отрезок против повторяющихся на торе копий зоны руки, а `preclickToroidalDistance()` исключает визуальный возврат в старт. Кандидаты перебираются по полному набору отклонений, сохраняют фактическую дистанцию не меньше рассчитанной и предпочитают endpoint вне зоны руки. Длительность вычисляет `preclickHopDurationMs(pathLength, preclickHopSpeedPxPerSecond)`, прогресс использует `preclickHopSpeedEasing`; покадровый wrap, reduced motion и resize сохраняются, а каждый реально начатый hop, кроме начального click-hop, запускает выбранный preclick-звук.
- `goghArtworks.mjs` через Vite `import.meta.glob` строит каталог всех поддерживаемых raster-файлов `assets/gogh`, а `goghArtworkSelection.mjs` стабильно сортирует basename-ID, удаляет дубли и реализует `random`, shuffle-bag без повторов внутри цикла и `single` с fallback на первый элемент каталога. Пока `preclickRockGuidance.completed=false`, физика остаётся suspended, hop активен, `html/body.is-manual-scroll-disabled` блокируют ручной vertical scroll. `activatePreclickInitialClick()` выполняет click-hop с параметрами фейкового и эхо, но с `soundEnabled=false`, не выбирает картину и не планирует popup. `consumePreclickGuardClick()` перехватывает первые два разрешённых pointerdown после проверки фазы и obstacle-window, увеличивает только `guardClicksUsed`, взводит `requiredHoverHopPending`, сбрасывает `clickAllowed`, выбирает картину через selector, ставит `openPreclickWindow()` в timeout `preclickPopupDelayMs` и выполняет hop без `playGachiClickSound()`. Третий fake-click использует тот же popup-контракт и fake-distance, сохраняет `guardClicksUsed=2`, завершает guidance и вызывает `completeScene("third-fake-click")`. Каждый выполненный после начального клика hop независимо запускает `Смех.mp3` и передаёт изменившуюся DOM-геометрию в эхо-контроллер. `activeHop` хранит конечную точку и функцию применения прогресса; события `focus`, `pageshow` и возврат `visibilityState=visible` завершают прерванную popup или сменой вкладки анимацию в рассчитанной конечной позиции. Первый успешно открытый popup вычисляет запрошенную ширину как `innerWidth × preclickPopupWidthViewportFraction`, высоту — по aspect ratio первой картины и фиксирует `sharedPreclickPopupSize`; все следующие окна игнорируют собственные width/aspect-ratio при выборе габарита и растягивают `<img>` на общий клиентский прямоугольник. После `window.open()` контроллер измеряет browser chrome, повторно вычисляет outer-safe геометрию и вызывает `resizeTo()`/`moveTo()`. Preclick-окно не получает auto-close/click-close, не входит в `activeObstacleCount()` и после открытия не закрывается dispose; pending timeout при dispose отменяется. Обычная траектория сцены 1 не включается, а restart/dispose очищает таймеры и сбрасывает shuffle-bag.
- Scene-2 scale lifecycle хранит `sceneTwoSizeState` и `sceneTwoSizeCycleArmed`. Успешный захват взводит новый цикл и вызывает `beginSceneTwoGrabScale()`, останавливая пульс. `pointerup`, `pointercancel`, `lostpointercapture`, blur, stationary-release, `randomDropEnabled` и `rockJumpEnabled` не освобождают камень в сцене 2. `updateSceneTwoHandScroll()` принимает только движение подтверждённого holder, переводит `sceneTwoHandScrollSpeedVhPerSecond` через `viewportHeight / 100` в px/s и уменьшает `scrollY`; знак и амплитуда pointer delta в формулу не входят, а после последнего pointermove скорость плавно затухает. Обычный camera-follow для сцены 2 отключён, но отдельный финальный `startSceneTwoSummitCameraScroll()` после магнитного попадания в imprint сохранён. Ground-impact audio в сцене 2 не запускается, а `wallImpactSoundFilename` принимает любой общий вариант, включая `СимуляцияОргазма.mov`; только `none` отключает звук стены.
- `handVisibilityMode=always` показывает локальную фото-руку по всей сцене, `hover` — только над камнем и во время захвата, `hidden` удаляет локальные и remote-руки из представления и возвращает нативный курсор над камнем. Primary pointer немедленно запускает захват, но `is-alternate/is-grabbing` применяются через отменяемый timeout `handImageChangeDelayMs`; pointerup, reset, смена в `hidden` и dispose очищают pending timeout. Над `.settings-toggle`, `.settings-panel.is-open` и `.session-panel--toolbar` фото-рука скрывается и используется нативный `pointer/auto`.
- Частые range/color/cubic-bezier input объединяются через `requestAnimationFrame`; сетевой update выполняется на `change` или после debounce `180 ms`. Inline-controller пишет полный санитизированный `params` в scene-specific localStorage и merge-ит только применимые общие имена в shared snapshot. Выбор именованной версии проходит через тот же commit-путь: её общие поля становятся последними, уникальные остаются в текущей сцене.
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
- `GET /access`, `POST /access` — production-only форма и проверка общего пароля; успешный вход возвращает на исходный локальный путь.
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
- Контейнер session store не меняется: при восстановлении trail обрезается до 10 000, v2/v3-точки нормализуются совместимым санитайзером, а новые клиентские точки записываются в v3.

## Безопасность и производительность

- Production fail-closed: при `DEBUG=false` без непустого `ACCESS_PASSWORD` сервер не запускается; при `DEBUG=true` непустой пароль включает ту же защиту. `BASE_PATH` нормализуется один раз и применяется к форме входа, сценам, static assets, API, WebSocket и cookie path; `/healthz` остаётся доступен без префикса для Docker healthcheck.
- Cookie не содержит пароль, имеет `HttpOnly`, `SameSite=Strict`, срок 24 часа и `Secure` на публичном хосте. После рестарта сервера токен меняется, поэтому требуется повторный вход.
- Сравнение пароля и cookie выполняется через `crypto.timingSafeEqual`; форма ограничена 2 KiB, число неудачных попыток — пять в минуту на IP, в логи не попадает введённое значение.
- Origin проверяется для HTTP и WebSocket.
- Числа проходят общие sanitizers; ширина углового сектора ограничивается `0–180°`, а итоговый угол импульса — верхней полуплоскостью `±90°`.
- Min/max пары препятствия нормализуются после clamp, поэтому нижняя граница никогда не превышает верхнюю даже для старого или вручную изменённого payload.
- Fold-зеркало имеет `inert`, `aria-hidden` и `role=presentation`; у клона удаляются `id` и `data-testid`.
- Production CSP разрешает scripts только своего origin.
- Container работает от непривилегированного пользователя с read-only root filesystem.
- Snapshots не повторяют неизменный config; MP3 загружаются лениво.

### Рендер траектории

- `.trail-history` содержит подтверждённую историю, `.trail-session` — новые точки после checkpoint, `.trail-glow` — sampled-свечение. Общий retained state всегда ограничен 10 000 точек. V3 хранит X в `vw`, Y в `vh`; проекция использует фактическую высоту отрисованной `.world` и повторяется после стабилизации layout и изменения `visualViewport`.
- History-canvas — абсолютный sliding buffer высотой до трёх viewport с квантизованной верхней границей; session/glow имеют размер одного viewport. Невидимые разрывы формируют отдельные runs и не соединяются линией.
- History рисуется батчами до 256 quadratic-сегментов на `stroke()`, использует градиент `lineColorTail → lineColor`; session продолжает линию постоянным `lineColor`. Оба слоя выделяют видимые runs и применяют одинаковый профиль sampling, поэтому reload не меняет геометрию линии из-за перехода session-точек в history.
- Checkpoint объединяет последние 10 000 точек и очищает закоммиченную session-часть при 128/192/256 точках для low/mobile/desktop-high. Resize, смена DPR, профиля или стиля выполняют тот же checkpoint.
- Render-профили: low `3000 / 128 / DPR 1 / glow 200@24`, mobile `5000 / 192 / 1.25 / 350@30`, desktop `10000 / 256 / 1.5 / 700@30`, high `10000 / 256 / 2 / 1200@60`. Auto выбирает профиль по Save-Data, памяти, числу потоков и coarse pointer; бюджет физических пикселей может дополнительно снизить DPR.
- Физическая и preclick-сцены передают anchor в `recordTrailAnchorPoint()`. Frame-coordinator coalesce-ит history/session/glow invalidation, а обычный scroll перестраивает history только при смене sliding window.
- При `glow=0`, выключенном следе или пустом пути pending timer/rAF отменяется. Каждый слой увеличивает revision только после фактического прохода; Fold сравнивает revision и размеры перед `drawImage`.
- Dev debug API публикует profile, stored/rendered/history/session counts, revisions, render passes, stroke batches, window top, effective DPR и WebSocket queue; User Timing получает `sisyphus.trail.history/session/glow` и `sisyphus.fold`.

## Проверки

- `npm run lint` — syntax checks и ESLint.
- `npm run build` — production Vite bundle.
- `npm test` — unit и integration.
- Production smoke сначала проверяет редирект всех сцен на password gate, отказ неверного пароля и API без cookie, затем входит через настоящую форму и открывает все три прямых URL без debug API. После входа проверяются единственный mounted world, циклические ссылки, restart сцены 1, подвешенный центр и захват сцены 2, а также старт вершины сцены 3 с камнем в руке.
- Scene-pages smoke проверяет точные `41 / 105 / 106` контролов и `20 / 84 / 84` общих маркера, диапазон скорости Scene 2, скролл вверх только после захвата и только во время движения руки, каскадную миграцию, восстановление общих значений, desktop resize, narrow viewport и завершение сцен 2/3.
- UI/Fold smoke проверяет legacy-миграции, редактор и visual controls стеклянных полос, порядок z-index, canonical hitbox, Fold-клон, а также тёмный старт сцены 3, фиксированный viewport, запуск дождя только настоящим scroll вниз и синхронный пик/спад rain opacity и громкости по прогрессу падающего камня.
- Dev smoke проверяет три canvas, загрузку 10 000 точек, отсутствие revisions/rAF в idle, session-only проход до checkpoint, history batching не более 50 `stroke()`, WebSocket-пакеты 16 точек/50 ms и неизменность v3-геометрии после серверного round-trip с настоящим reload.
- Preclick-hop smoke проверяет guidance, scroll lock, reload/restart, радиус от текущей ширины камня, три стартовых обязательных radius-hop, первое гарантированное подпускание, обязательный hover-hop после первого fake-click, поздний вероятностный допуск, hover-hop с `0%` подпускания после второго fake-click, финальный настоящий клик без нового hop, скорость/кривую, дискретный эхо-след, отсутствие popup и звука у начального клика, popup по свободному полю только после старта без checkbox, отсутствие дубля окна камня, отсутствие обычной траектории в сцене 1, фактическую дальность не меньше рассчитанной, безопасную конечную точку вне контура курсора, завершение active-hop после возврата фокуса, безопасный X/Y/corner wrap, resize, reduced motion и кликабельность. Popup-сценарий подтверждает единый размер окон, вызов focus у ранее открытых popup, отдельный терминальный звук, захват в точке клика и вечный pointer-down с `sceneFlow.completed=true` и причиной `final-real-click`.
- Collaboration smoke разделяет «Капель», gachi и impact-аудио: pointerdown взводит impact-разрешение, первый физический контакт запускает `СимуляцияОргазма.mov`, дальнейшие отскоки без касания молчат, а новое касание разрешает ровно один следующий play. Та же семантика проверяется для скачка shared `groundTouchSeq`. Также smoke проверяет primary/right/middle, наложение gachi без остановки при release/`FALLING`, доступную с клавиатуры кнопку «Начать сначала», нижний viewport suspended-сессии и восстановление активной сессии с видимым камнем после reload.
- Unit-тест оконного контроллера использует виртуальные timeout/interval и fake popup: проверяет отсутствие дублирующего schedule, одновременные obstacle-окна, независимый click/2s close, выход/возврат в диапазон, паузу при блокировке, а также задержку, общий размер всех preclick-popup, уменьшение полноэкранного запроса, краевую геометрию с учётом browser chrome, image-разметку, фокус живых/отложенных окон и ручной lifecycle. Unit-тест эхо-контроллера проверяет sanitization, порог движения, интервал, count-limit, live-sync opacity/lifetime и немедленную очистку при выключении.
- Unit/integration regression проверяет scene route/nextPath, отдельные ключи уникальных параметров, версий и session namespace, `ownerSceneId` и shared scope materialized-контролов, состав `20 / 84 / 84`, каскад/идемпотентность/last-write общего snapshot, сохранение server `sceneId`, матрицу server-side областей действия, сообщения production preset, полную замену canonical preset и physics/room-settings contracts.
- Smoke-наборы, которые сохраняют именованные версии, всегда запускают собственный сервер с `reuseExistingServer=false` и уникальными файлами в системной временной директории. Unit-гейт запрещает путь settings-template store внутри репозиторного `config/`; занятый порт завершает тест ошибкой вместо подключения к рабочему dev-серверу. Изменённое имя создаёт новый ID версии, неизменное имя обновляет выбранный снимок.
- При подключении браузера серверный снимок комнаты имеет приоритет над устаревшими параметрами из `localStorage`: из browser-кэша восстанавливаются только local-scoped визуальные параметры, а versioned/shared настройки не загружаются и не публикуются в общую сессию автоматически.
- Устаревший фоновый импорт локальных версий через `settingsTemplates.import` удалён из клиента и отклоняется сервером. Git-каталог изменяется только явными действиями debug UI: сохранением или удалением версии.

Изменения `config/settings-templates.json` и `config/production-preset.json`, полученные через Git, перечитываются при следующем запуске сервера. Выбор флага через inline debug UI обновляет серверный preset для новых сессий. Scene-specific browser snapshot затем применяется только к соответствующей странице; `shared/production-preset.js` задаёт безопасный fallback, если canonical JSON отсутствует или повреждён.

## Ход разработки

- **2026-09-28:** Добавлен production password gate с обязательным `ACCESS_PASSWORD`, защищённой cookie, rate limit и общей проверкой страниц/API/WebSocket. Следующее изменение разрешило включать тот же gate при `DEBUG=true` и добавило единый `BASE_PATH` для публикации на `/daemon`; unit-тест покрывает debug UI, пароль, префикс и API.

- **2026-09-27:** сцена 1 завершает последовательность третьим настоящим кликом без hop: камень сохраняет точку контакта с управляемой курсором grabbing-рукой до рестарта. Независимый `preclickFinalClickSoundFilename` по умолчанию равен `СимуляцияОргазма.mov`; перед ним останавливаются остальные каналы, а после него аудио сцены блокируется. Room/settings schema поднята до `65`.
- **2026-09-27:** сцена 2 получила фиксированный скролл вверх `0.1–25 vh/s` с default `1`, активный после захвата и плавно затухающий после остановки руки. Сервер отключает для `turnip` случайное, прыжковое и stationary-освобождение; `СимуляцияОргазма.mov` заблокирован для земли, но доступен в общем выборе звука боковой стены. Room/settings migration `63` добавила новый параметр; параллельная функция Scene 1 подняла объединённую schema до `64`.

- **2026-08-24:** room settings schema `58` добавила `preclickFirstHopOnClick=false`. Runtime блокирует radius-hop до отдельного активационного клика в click-режиме, обрабатывает его перед guard-click и сохраняет `guardClicksUsed=0`; Chromium smoke проходит цепочку активации, двух фейковых и настоящего кликов через реальный UI-toggle.
- **2026-09-25:** после начального клика делегированный обработчик игрового поля без отдельного переключателя открывает одно окно около каждого свободного primary-клика и не меняет прогресс. После двух нумерованных fake-click runtime сохраняет `0%` подпускания для hover, а следующий pointerdown по камню открывает третье окно и возвращает все незакрытые окна на передний план. Актуальная семантика этого события — настоящий клик без hop с причиной завершения `final-real-click`. Legacy-поле `preclickPopupOnAnySceneClickEnabled` сохранено только для чтения старых snapshot.
- **2026-09-25:** Восстановлен Git-шаблон Сцены 1 после случайной записи smoke-теста. Scene-pages, UI, dev и prod-debug smoke используют изолированные временные stores и не переиспользуют запущенный сервер; новое имя версии создаёт отдельный снимок, а unit/smoke regression защищает оба режима сохранения. Дополнительно отключены фоновый импорт browser-версий и стартовая публикация localStorage-параметров: серверный снимок больше не может быть перезаписан простым открытием старого браузера.
- **2026-08-24:** preclick-popup сцены 1 получили единый размер, зафиксированный первым успешно открытым окном; слишком крупный запрос уменьшается до краевого габарита, а второе финальное окно размещается целиком вне центральных 50% и внутри видимой области приложения. Добавлены unit-проверки browser chrome/bounds и Chromium smoke единого размера.
- **2026-08-25:** room/controller schema `59` и localStorage `v56` зафиксировали два фейковых клика сцены 1 и добавили versioned задержку возврата фокуса `0–5 с` с шагом `0.1`. После настоящего клика один таймер оставляет popup открытыми, переводит их назад и фокусирует главное окно; повторные клики таймер не меняют.
- **2026-09-24:** После каждого из двух fake click runtime взводит отдельный `requiredHoverHopPending`: первый повторный hover-вход гарантированно отталкивает камень, а вероятность подпускания начинает применяться только со следующего входа. Click-hop с UI-длиной `50%` не снимает барьер; `clickAllowed` не даёт быстрому pointerdown перескочить обязательный отскок или вероятностный допуск.
- **2026-09-25:** Нижний скоростной коэффициент автоматического preclick-hop сцены 1 поднят с `0.28` до `0.5`. При `0 / 1000 / 2000 px/s` запрашивается `50 / 75 / 100%` UI-максимума; фиксированный fake-click hop остаётся `50%`. Защитное сокращение пути удалено: подбор направления и при необходимости увеличение дистанции сохраняют фактический путь не меньше рассчитанного, конечную точку — вне контура камня под курсором, а `activeHop` доводится до неё при возврате фокуса или видимости страницы.
- **2026-08-24:** room settings schema `57` добавила `wallImpactSoundFilename`, сжала `rockJumpInertiaSpreadPercent` до `0–1` с шагом `0.01` и мигрирует legacy-проценты делением на `100`. Scene 2 игнорирует ручное отпускание и снимает sticky-захват только после серверного случайного выпадения или выпрыгивания; unit и целевые scene/UI smoke пройдены в Docker.
- **2026-08-23:** сцена 2 получила пульс во всех состояниях без удержания, вариант `Без звука` для клика и повторный захват после фактического выпадения. Sticky-защёлка теперь живёт один цикл drag; unit, frontend lint, build и целевые scene-pages smoke пройдены в Docker.
- **2026-08-23:** сцена 3 получила тёмный старт, неподвижный viewport во время финального падения, единую огибающую дождя и громкости по прогрессу камня, центральное масштабирование секундомера и отдельную настройку ширины `25–300%`. Room/settings schema поднята до `56`.
- **2026-08-24:** `sharedSnapshotTheme()`, `syncReturnTheme()`, `enterPlayPhase()` и завершение сцены 3 удерживают светлую тему после final-fall; CSS скрывает секундомер только в тёмном состоянии, не затрагивая leaderboard.
- **2026-08-24:** 20 одинаковых параметров сцен 1–3 и 64 дополнительных параметра сцен 2–3 получили общий browser snapshot и badge области действия. Первая миграция каскадно использует сцену 1, затем сцену 2; текущие Git-шаблоны нормализованы тем же правилом, а уникальные значения и игровые состояния остаются scene-specific.
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
