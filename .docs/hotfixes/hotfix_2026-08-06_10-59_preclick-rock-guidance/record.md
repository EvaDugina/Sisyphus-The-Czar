# Hotfix — Подсказка взаимодействия до первого клика

## Паспорт

- **ID:** `hotfix_2026-08-06_10-59_preclick-rock-guidance`
- **Статус:** ready-for-demo
- **Стадия:** POC B
- **Создано:** 2026-08-06 10:59 +03:00
- **TTL:** до решения `promote` / `reject`, предварительно не позднее 2026-08-13
- **Base commit:** `a861e32fd07f0e47958536887d76c07984804655`
- **Feature flag:** `EXPERIMENT_PRECLICK_ROCK_GUIDANCE` (default off)

## Approved-карточка

<!-- Этот раздел после аппрува не переписывать. -->

- **Гипотеза:** если до первого primary-click по камню добавить лёгкий parallax, а фото-руку показывать по всей сцене, первое взаимодействие с камнем станет визуально понятнее.
- **Аудитория / окружение:** пользователи с мышью или другим fine pointer на `/` и `/drafts/`.
- **Пользовательский процесс:** первое знакомство с камнем → визуальная реакция → клик → обычное управление.
- **Затрагиваемый модуль:** локальный runtime и стили сцены.
- **Предполагаемые области кода:** `vite.config.mjs`, `src/runtime/createSisyphusRuntime.js`, `src/styles/scene.css`.
- **Acceptance examples:** при flag off сохраняется baseline; при flag on рука видна и следует за указателем по всей сцене, камень до первого primary `pointerdown` получает ограниченный parallax, первый клик по камню обнуляет parallax до reload, а рука после отпускания остаётся видимой вне камня.
- **Метрика / evidence:** отдельный Playwright-сценарий, computed styles и скриншоты до/после клика; продуктовая метрика не задана.
- **Запрещено менять:** серверную физику, сессии, протокол, Fold, настройки, ресурсы камня и препятствие «Окна».
- **Blast radius:** низкий, локальная UI-логика fine-pointer устройств.
- **Отключение / rollback:** выключить flag; полный откат — через guard только для файлов change set.
- **Предположения:** «всегда» означает активную вкладку с fine pointer; при blur и на touch фото-рука скрывается. «Первый клик» означает первый primary `pointerdown` именно по камню. Максимальный визуальный сдвиг предположительно `12px`, наклон `±4°`; при `prefers-reduced-motion` parallax отключён.

## Визуализация

- Mermaid: `visualization/preclick-rock-guidance.mmd`
- HTML: `visualization/preclick-rock-guidance.html`

## Impact analysis

- **Минимальные файлы:** `vite.config.mjs`, `src/runtime/createSisyphusRuntime.js`, `src/styles/scene.css`, новый `tests/smoke/preclick-rock-guidance.spec.js`.
- **Затронутые сценарии:** первое движение указателя, первый primary-click по камню, захват/отпускание, blur, baseline при flag off.
- **Контракты и данные:** сервер, WebSocket, сессии, физика и persisted settings не меняются; flag встраивается Vite на этапе сборки.
- **Скрытые зависимости / регрессии:** существующий `prod.spec.js` закрепляет baseline «рука только над камнем» и должен проходить при flag off; CSS transform камня уже содержит позицию и scale, поэтому parallax добавляется отдельными custom properties без перезаписи runtime-координат; пользовательские правки в runtime около obstacle height сохраняются.
- **Риск-класс:** низкий — локальная UI-логика POC B; обязательны lint, build, существующие тесты, baseline production smoke, отдельный Playwright-сценарий с flag on, ручной smoke и проверка отключения.

## Реализация эксперимента

- **Изоляция:** текущий worktree, отдельная ветка не создаётся.
- **Что временно:** build-time flag, экспериментальные DOM-классы и CSS custom properties, отдельный smoke-сценарий.
- **Guard ID:** `hotfix_2026-08-06_10-59_preclick-rock-guidance`
- **Проверка после синхронизации:** после merge `origin/main@73afc26` повторно выполнены lint, build, полный набор тестов и browser smoke; удалённые изменения в общих runtime/CSS-файлах разрешены вручную, аварийное отключение эксперимента остаётся доступно через default-off flag или revert коммита `c192a7c`.
- **Уточнение по обратной связи:** perspective и вращения удалены — parallax меняет только позицию и направлен противоположно указателю. Максимальное смещение (`0–1000 px`, default `12`), круговой радиус от визуального центра камня (`0–200 vw`, default `50`), duration возврата (`0–2000 мс`, default `400`) и его cubic-bezier-график вынесены в versioned UI-настройки. Старые px-значения радиуса мигрируют по соотношению `20 px = 1 vw`. После выхода указателя за радиус камень плавно возвращается к исходной позиции, а рука остаётся под указателем. Над settings-toggle и открытой settings-panel фото-рука скрывается и отображается нативный курсор. Любой primary `pointerdown` на fine pointer показывает захвативший спрайт руки до `pointerup`/`pointercancel`, включая клики вне камня.
- **Rollback проверен:** да — `verify-all` подтверждает чистый вычисляемый rollback, а baseline smoke проходит при выключенном flag.

## Evidence

| Проверка | Команда / источник | Результат | Примечание |
|---|---|---|---|
| Guard snapshot / capture | `hotfix_guard.py snapshot`, `capture`, `status`, `verify-all` | PASS | Четыре целевых файла, `identity_matches=true`, rollback `clean`. |
| Diff hygiene | `git diff --check` | PASS | Ошибок whitespace нет; сообщения CRLF являются предупреждениями Git для существующего Windows worktree. |
| Lint, build, unit/integration | `docker run --rm -v "C:\Users\Benedict\Work\Sisyphus-The-Czar:/app" -v /app/node_modules -w /app node:24.18.0-alpine3.23 sh -c "npm ci && npm run lint && npm run build && npm test"` | PASS | Lint и production build зелёные; `166/166` тестов прошли. `npm ci` сообщает о 5 известных audit findings зависимостей, их исправление не входит в UI-гипотезу. |
| Flag off / baseline | `docker run --rm --ipc=host -v "C:\Users\Benedict\Work\Sisyphus-The-Czar:/app" -v /app/node_modules -w /app mcr.microsoft.com/playwright:v1.61.1-noble sh -c "npm ci && npm run test:smoke"` | PASS | `2/2`; старый контракт «рука только над камнем» сохранён при default-off. |
| Flag on / эксперимент | `docker run --rm --ipc=host -v "C:\Users\Benedict\Work\Sisyphus-The-Czar:/app" -v /app/node_modules -w /app mcr.microsoft.com/playwright:v1.61.1-noble sh -c "export EXPERIMENT_PRECLICK_ROCK_GUIDANCE=true; npm ci && npx playwright test tests/smoke/preclick-rock-guidance.spec.js"` | PASS | `1/1`; X parallax меняет знак против направления указателя, первый click удаляет parallax и обнуляет offset, рука остаётся visible вне камня. |
| Совместимость после merge | Docker Node `24.18.0`: `npm ci && npm run lint && npm run build && npm test` | PASS | Merge с `origin/main@73afc26`: lint и production build зелёные; `178/178` тестов прошли. |
| Browser regression после merge | Playwright `1.61.1`: production smoke, draft smoke и отдельный сценарий с flag on | PASS | Production `2/2`, draft `6/6`, эксперимент `1/1`. |
| Исправление деформации | Live dev browser: сравнение `getBoundingClientRect()` слева и справа | PASS | После инверсии X offset `+11.55 → −11.55 px`; изменение ширины `0 px`, высоты `0 px`; transform не содержит perspective/rotation. |
| Настраиваемые radius/max/return | Unit/integration + Playwright draft, experiment и prod-debug | PASS | `178/178`; draft `8/8`, включая legacy-миграцию `1000 px → 50 vw`, UI `12→36 px` и `50→70 vw`; experiment `1/1` проверяет half-radius, плавный выход, неизменность размеров и первый click; prod-debug `2/2`. UI-диапазон maximum расширен до `0–1000 px`, radius — до `0–200 vw`. |
| Плавный возврат камня | Experiment smoke + live dev browser | PASS | Через `50 мс` после выхода offset ещё ненулевой, затем достигает `0`; координаты руки остаются координатами указателя. В UI визуально проверены range `400 мс` и график `cubic-bezier(0.22, 1, 0.36, 1)`. |
| Курсор над настройками | Experiment draft smoke | PASS | `.settings-toggle` показывает `cursor: pointer`, `.settings-panel.is-open` — нативный `auto`; `is-settings-pointer-active` гасит локальную фото-руку до pointerleave. |
| Глобальное состояние руки | Experiment smoke: primary click вне камня до и после первого захвата | PASS | На `pointerdown` локальная рука получает `is-grabbing` и `cursor-grabbing.png`, на `pointerup` возвращается к `cursor-grab.png`; parallax отключается только кликом по камню. |
| Default-off regression после настройки | Production smoke | PASS | `2/2`; baseline без экспериментального flag сохранён после settings schema `27` / room schema `23`. |
| Полный collaboration smoke | `npm run test:smoke:dev` | WARN | `12/18` PASS, `2` skipped, `4` failure в старых сценариях: обращения к уже переименованной группе «Руки», отсутствующему UI-полю `stationaryAutoSlipEnabled` и нестабильной проверке отпечатка. Новые parallax-сценарии и затронутые контракты проходят. |
| Визуальная проверка | `test-results/preclick-rock-guidance-fla-4dde1-ого-клика-и-постоянную-руку/*.png` | PASS | На обоих кадрах фото-рука видима отдельно от камня; после click камень отображается без экспериментального parallax-класса. |

### Ручная демонстрация

- **Шаги:** включить `EXPERIMENT_PRECLICK_ROCK_GUIDANCE=true`; до клика прокрутить к камню, провести указатель внутри и снаружи настроенного радиуса, изменить maximum/radius/duration/cubic-bezier в группе «Камень»; нажать камень; затем собрать без flag и повторить baseline.
- **Наблюдение:** при flag on рука следует за указателем по всей сцене; внутри радиуса камень до click получает только ограниченный позиционный offset против направления указателя, снаружи offset плавно возвращается к нулю по выбранной кривой, при этом рука остаётся под указателем; после первого primary `pointerdown` parallax сбрасывается, а рука остаётся видимой. При flag off рука по-прежнему появляется только над камнем.
- **Метрика:** поведенческие assertions и визуальные артефакты PASS; продуктовая полезность не измерена и требует решения пользователя.

## Решение

- **Гипотеза полезна:** недостаточно данных
- **Экспериментальная реализация пригодна:** недостаточно данных
- **Outcome:** ожидает решения
- **Дата и основание:** 2026-08-06 11:07 +03:00; техническое evidence собрано, ожидаются два независимых ответа пользователя.

## Promotion и rollout

- **Что переписать:** определить после проверки гипотезы.
- **Постоянные тесты / контракты:** определить после решения `promote`.
- **Совместимость / миграции:** миграции не ожидаются.
- **Наблюдаемость:** browser smoke и визуальные артефакты.
- **Условие rollout:** явное решение пользователя после демонстрации.
- **Срок / условие удаления flag:** после подтверждённого rollout отдельным шагом либо немедленно при `reject`.
