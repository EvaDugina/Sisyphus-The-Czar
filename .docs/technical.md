# Technical — Sisyphus The Czar

## Паспорт

- **Стадия:** POC B
- **Последнее обновление:** 2026-08-09
- **Runtime:** Node.js 24, Express 5, WebSocket `ws`, React 19, Vite 8
- **Развёртывание:** один Docker-контейнер приложения; nginx/HTTPS находятся на хосте

## Архитектура

React отвечает за структуру UI, imperative runtime — за refs, animation loop, canvas, аудио и WebSocket. Express раздаёт API/shared modules/production assets. `SessionManager` авторитетно рассчитывает личные камни фиксированным шагом.

Поток данных:

1. `/` обслуживается `index.html`, запускает общий `App` runtime и рендерит один `FoldLayer`; известный `/settings/` тем же entrypoint запускает отдельный `SettingsPage`, а удалённые `/drafts`, `/drafts/` и `/drafts/assets/*` не имеют SPA fallback и возвращают `404`.
2. Runtime вызывает `POST /api/sessions` без локального room/physics preset; сервер во всех режимах применяет единственный помеченный production preset. При WebSocket reconnect single-client-сессии, когда нет подключённого другого `clientId`, preset повторно применяется до первого snapshot даже при overlapping-сокетах быстрого reload: игровое состояние сохраняется, physics/room settings обновляются. Если canonical файл отсутствует или повреждён, используется встроенный fallback, но не последний debug template. Импорт legacy/localStorage-версий пополняет только каталог и не меняет настройки комнаты.
3. Клиент соединяется с `WS /realtime?session=<id>&client=<id>`.
4. Input отправляется не чаще 30 Hz; snapshots публикуются до 20 Hz.
5. Сервер хранит один `holder` и рассчитывает движение камня.
6. Клиентский `createWindowObstacleController` считает высоту центра камня, управляет popup lifecycle и блокирует только input при наличии активных окон; серверный fixed-step цикл продолжает работать.
7. Trail-дельты личных сессий агрегируются отдельным root trail hub и подтверждаются независимо от физики камня.
8. Runtime выбирает click-gachi только из совпадения shared-манифеста с Vite audio glob, создаёт независимый `Audio` для каждого primary click/tap и при переходе в `FALLING` останавливает весь набор активных экземпляров. Успешный новый захват выставляет одноразовый `groundImpactAudio.armed`; первый следующий локальный `touchedGround` или рост серверного `groundTouchSeq` погашает флаг и запускает `СимуляцияОргазма.mov`. Последующие отскоки и sequence jumps без нового захвата не воспроизводят звук; restart и dispose сбрасывают разрешение.
9. Dev/debug `Toolbar` показывает кнопку рядом со статусом сессии, а production `Toolbar` — ту же пользовательскую кнопку без debug-настроек. React ref передаёт `restart-session` в общий runtime, который регистрирует доступный click/keyboard action и вызывает существующий `restartExperience`. Reload не вызывает этот обработчик и независимо восстанавливает серверный snapshot.
10. `settings-version-save` запускает существующие `settingsTemplates.save` и `settings.update` одним пользовательским действием. Settings-page runtime держит два pending-флага, не показывает промежуточный успех и завершает единый статус только после `settingsTemplates.saved` и `settings.applied`; конфликт или ошибка одного запроса сохраняет итоговое состояние `error`. Сообщения `productionPreset.current/selected` отдельно обновляют доступность и отображение единственного флага.
11. На navigation type `reload` runtime запрещает browser scroll restoration. После первого серверного snapshot и синхронного применения `sceneHeightScreens` suspended-сессия один раз вызывает `scrollToSceneBottom()` на следующем animation frame; активная сессия не получает эту прокрутку и немедленно центрируется существующим camera-follow.

`POST /api/sessions/root` сохранён для trail hub и совместимости, но пользовательский runtime к root-комнате не подключается.

## Доменная модель

### Session

- `id`, `persistent`, `singleClient`, TTL и empty-grace metadata;
- `state`: phase, x/y, vx/vy, dragging, controllerId, suspended;
- `physics`, `physicsVersion=11`;
- `roomSettings`, `roomSettingsVersion=33`, `settingsRevision`;
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

- На предыдущем этапе SVG-курсора использовались `ROOM_SETTINGS_VERSION=30`, `SETTINGS_SCHEMA_VERSION=32` и localStorage-ключ `sisyphus-czar-settings-v32`; текущая миграция читает этот ключ как legacy. Та миграция добавляла `customCursorEnabled=false` и `customCursorSizePx=32`, санитайзер ограничивает размер диапазоном `8–128`.
- Группа `Курсор` использует декларативную зависимость `customCursorSizePx.enabledWhen="customCursorEnabled"`, поэтому выключенный ползунок остаётся видимым и сохраняет значение.
- SVG реализован псевдоэлементом единого `.hand-cursor`: `handopen.svg` меняется на `handgrabbing.svg` по классу `is-grabbing`, а body-класс и CSS-переменная применяют общий флаг и размер. Локальные и remote-руки используют один DOM/CSS-путь, отдельный animation loop не создаётся.
- Псевдоэлемент активен только при `(pointer: fine)`, имеет `pointer-events: none` и наследует скрытие родительской руки в intro/fall, settings-panel и `.session-panel--toolbar`.

- Shared room settings schema — `33`, settings schema — `35`, localStorage — `sisyphus-czar-settings-v35`. `rockImageId` и `foldRockImageId` принимают только `rock-03`, `rock` или `rock2`; fallback — `rock-03`. `rockPulseShrinkPercent` имеет диапазон `0–50`, default `5` и при миграции schema `<35` наследует прежний `rockPressShrinkPercent`, чтобы сохранить видимую амплитуду. Room payload `<33` и settings payload `<35` получают новые поля через `migrateRockVisualSettings`; `v34` читается как legacy localStorage. Прежние миграции px→vw, `draftFold*` и `preclickHopMaxDistanceVw` сохраняются.
- Категория единственной руки называется «Рука» и содержит `handAlwaysVisible` (default `true`) и `rockGrabRadiusVh`. Категория «Камера» содержит `cameraFollowLerp` (`0.01–1`, default `0.1`). «Препятствия → Окна» содержит девять versioned controls и `WindowObstaclePermissionControl` со статусом и test action.
- В группе «Камень» находятся независимые select-контролы основного и fold-изображения, отдельные проценты уменьшения при нажатии и пульсе, настройки автоматического прыжка, baseline-parallax и «Максимальная длина отскока, vw» для экспериментального hop. `rockPulseShrinkPercent` использует `enabledWhen: "rockPulseEnabled"`.
- Контролы используют декларативный `enabledWhen`: строка означает checkbox-зависимость, объект `{name, values}` — допустимые значения select. Controller синхронизирует native `disabled`, `.is-disabled`, `aria-disabled` и пояснение после input/change, загрузки и remote settings.
- `glowOptimizationMode`, `glowTargetFps`, `glowBufferScalePercent`, `glowUpdateFps`, `glowMaxPoints` и `glowDecimation` имеют `scope: "local"`: сохраняются в v35, но фильтруются из version snapshots, server templates и broadcast.
- `rockImages.mjs` сопоставляет разрешённые ID с Vite asset URL. Runtime синхронно меняет `src` основного `.rock` и `.rock-imprint`; после загрузки нового основного файла пересчитывает bounds/scale/imprint. `FoldLayer` каждый кадр копирует presentation source, затем явно переопределяет `src` зеркального `.rock` по `foldRockImageId`, поэтому clone и Fast Refresh не возвращают устаревший asset.
- Пульс рассчитывает `rockPulseScaleFactor` из `rockPulseShrinkPercent`. `visualShrinkScaleFactor()` возвращает press-factor, пока `rockPressActive`, иначе pulse-factor; проценты не складываются и не перемножаются.
- При выключенном `EXPERIMENT_PRECLICK_ROCK_HOP` preclick guidance использует прежний parallax. Он вычисляет базовый визуальный центр без уже применённого offset. Радиус и текущий динамический максимум переводятся из `vw` в пиксели как `valueVw / 100 · window.innerWidth`; длина смещения равна `maxOffsetPx · clamp(1 − distance / radius, 0, 1)`. Один вход хранит `activeMovementTimeMs`: sample учитывается при скорости не ниже `12 px/s` и gap не больше `120 ms`, поэтому статичная пауза не добавляет время. Нормализованный прогресс применяется к независимым delay/max cubic-bezier. Выход сбрасывает progress и samples; остановка внутри радиуса только ставит прогресс на паузу. Вход запускает отменяемый delay; пока он не завершён, рост текущей задержки пересчитывает остаток timeout. Успешный захват, нулевой начальный max/radius, смена настроек и dispose отменяют timeout. `prefers-reduced-motion` делает возврат мгновенным, но не отключает прямой parallax.
- По умолчанию `EXPERIMENT_PRECLICK_ROCK_HOP` включён: каждый новый вход мыши в радиус выполняет один накопительный hop от текущего визуального центра. Скорость входа `0–2000 px/s` линейно отображается в `0.28–1.0 × preclickHopMaxDistanceVw`; радиус отвечает только за срабатывание. Runtime за `400 ms` применяет `cubic-bezier(0.22, 1, 0.36, 1)` покадрово, каждый кадр нормализует центр по модулю `innerWidth/innerHeight` и поэтому сохраняет overshoot без полёта через центр. Reduced motion сразу применяет конечный wrapped-центр; resize отменяет активный frame и нормализует текущий центр. Первый захват отменяет frame, материализует видимый wrapped-центр в physical/server coordinates и завершает guidance. Каждый hop создаёт независимый `Audio` из `assets/audio/Смех.mp3`; dispose/restart очищают animation и оставшиеся элементы. Явное build-time значение `false` включает baseline-ветку прежнего parallax.
- До первого допустимого mouse-захвата `preclickRockGuidance.completed=false`: физика остаётся suspended, parallax активен, `html/body.is-manual-scroll-disabled` блокируют колесо и ручной vertical scroll. Прямой `pointerdown` по камню или круг курсора радиуса `rockGrabRadiusVh / 100 · innerHeight`, пересекающий `getBoundingClientRect()` камня, проходит через единый `startDrag`. Расширение применяется только к primary mouse, не перехватывает settings/interactive UI, wrong phase, obstacle или touch. Успешный захват завершает guidance, обнуляет offset, включает физику и camera-follow. Начальная загрузка и `resetLocalExperience()` используют единый `resetPreclickRockGuidance()`, а первый несuspended snapshot восстановленной сессии повторно завершает guidance и немедленно центрирует camera-follow на камне.
- `handAlwaysVisible=true` показывает локальную фото-руку по всей сцене и переключает `grab/grabbing` на global primary pointer. При `false` рука видима и реагирует на захват только во время hover камня. В обоих режимах интерактивная зона `.settings-toggle` / `.settings-panel.is-open` скрывает фото-руку и возвращает нативный `pointer/auto`.
- Частые range/color/cubic-bezier input объединяются через `requestAnimationFrame`; запись localStorage и сетевой update выполняются на `change` или после debounce `180 ms`.
- `FoldLayer` входит в основной `<App />`, читает живой `params` runtime через ref и синхронизирует неинтерактивную копию сцены, canvas-следа и дождя. Для trail-canvas копирование выполняется только при изменении `data-canvas-revision`; rain-canvas сохраняют покадровую синхронизацию.
- Fold-layer использует `z-index: 18`, ниже удалённых (`19`) и локального (`20`) курсоров. Курсоры внутри Fold-зеркала скрыты, поэтому 3D surface не создаёт деформированную копию руки.
- Группа `3D Fold` хранит `foldAngle`, `foldZoneSize`, `foldBlendEnabled`, `foldBlendCurve` в общем `roomSettings`; диапазоны санитизируются сервером и клиентом, legacy `draftFold*` после миграции не сохраняется и не передаётся.
- Vite использует `appType: "mpa"` и узко переписывает только известный `/settings[/]` на `/index.html`; Express явно отдаёт entrypoint для `/`, `/index.html` и `/settings`, а `/settings/` перенаправляет с `308` на `/settings`, чтобы относительные production-assets загружались из `/assets`. Legacy route и asset alias не регистрируются, поэтому неизвестные `/drafts*` не получают `index.html`.
- Production без debug UI не включает settings controller; preset всё равно задаёт baseline новой сессии.

## Протокол

Оболочка: `{v,type,seq,payload}`.

- `session.snapshot` и `presence.update` содержат `holderId`, а не массив держателей.
- `control.granted` возвращает единственный `holderId`.
- Второй `control.acquire` получает `control.denied {reason:"already_controlled"}`.
- `control.slipped` использует причины `slipped`, `jumped` или `stationary`; для `jumped` добавляются `angleDegrees`, `inertiaFactor`, `speed`.
- `settings.update` использует schema `35` и optimistic `settingsRevision`.

## HTTP

- `GET /healthz` — статус сервиса.
- `POST /api/sessions` — новая личная single-client-сессия.
- `GET /settings` и `GET /settings/` — отдельная debug-страница настроек через общий frontend entrypoint.
- `GET /drafts`, `GET /drafts/` и `GET /drafts/assets/*` — удалённые адреса, ожидаемый ответ `404`.
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
- Production smoke проверяет видимость и полный preclick-reset кнопки «Начать сначала», разные session ID двух браузеров, отсутствие взаимного управления и default-видимость руки.
- UI/Fold smoke проверяет миграции `v32 draftFold* → v35 fold*`, `v33 → v35` для длины отскока и `v34 → v35` для изображений/pulse shrink. Отдельный сценарий проверяет основной камень `rock2`, синхронный отпечаток, независимый fold `rock.webp`, disabled-состояние pulse-контрола и приоритет press.
- Dev smoke проверяет объединённое сохранение именованной версии и комнаты, отсутствие дубликатов в общем каталоге и миграцию legacy-настроек в v35, включая px→vw, Fold, SVG-курсор, `preclickHopMaxDistanceVw` и новые visual rock settings.
- Отдельный preclick-guidance smoke является постоянным regression-тестом и проверяет статичную камеру до активации, руку сразу после загрузки, рост смещения при приближении к центру, обычное радиальное направление, неизменность размеров камня, две временные bezier-оси, уменьшение max только при активном движении, статичную паузу, сброс при выходе, отключение parallax первым кликом и движение камеры вслед за drag камня.
- Отдельный preclick-hop smoke запускает dev с включённым build-флагом и проверяет один hop на вход, отсутствие повторов внутри радиуса, `28–100%` максимума, накопление, X/Y/corner wrap с overshoot, resize-нормализацию, reduced motion, один смех на hop, кликабельность перенесённого камня и materialize первого захвата. Отдельный `hop-off` smoke фиксирует прежний непрерывный parallax при выключенном флаге.
- Collaboration smoke разделяет «Капель», gachi и impact-аудио: pointerdown взводит impact-разрешение, первый физический контакт запускает `СимуляцияОргазма.mov`, дальнейшие отскоки без касания молчат, а новое касание разрешает ровно один следующий play. Та же семантика проверяется для скачка shared `groundTouchSeq`. Также smoke проверяет primary/right/middle, наложение gachi, остановку всего набора именно при `FALLING`, доступную с клавиатуры кнопку «Начать сначала», нижний viewport suspended-сессии и восстановление активной сессии с видимым камнем после reload.
- Unit-тест контроллера использует виртуальные timeout/interval и fake popup: проверяет отсутствие дублирующего schedule, одновременные окна, независимый click/2s close, выход/возврат в диапазон и паузу при блокировке.
- Unit/integration regression проверяет сообщения флага в settings-page, игнорирование последнего непомеченного шаблона, повторное сохранение уже помеченной версии, полную замену canonical production preset и применение последних physics/room settings в новой сессии и при overlapping-reconnect. Settings-page после snapshot синхронизирует с сервером не только room/local, но и все physics-контролы, чтобы следующее сохранение не возвращало дефолты.

Изменения `config/settings-templates.json` и `config/production-preset.json`, полученные через Git, перечитываются при следующем запуске сервера. Выбор флага через debug UI обновляет серверный preset сразу и применяется к следующим новым сессиям и при reload той же персональной сессии; другие уже открытые сессии live не сбрасываются. `shared/production-preset.js` задаёт безопасный fallback, если canonical JSON отсутствует или повреждён.

## Технический долг

- Заменить настраиваемое кинематическое следование моделью constraint spring-damper с ограничением силы.
- Разделить массу камня, силу захвата, время контакта и коэффициент восстановления для автоматического прыжка.
- Добавить распределение вероятности выпрыгивания с seed для воспроизводимых replay.
- Добавить метрики personal sessions/shared trail hub для soak-наблюдения.
