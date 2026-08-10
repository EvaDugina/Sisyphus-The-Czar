# Hotfix — Камень ускакивает от курсора прыжками

## Паспорт

- **ID:** hotfix_2026-08-08_00-17_preclick-rock-hop
- **Статус:** promoted
- **Стадия:** POC B
- **Создано:** 2026-08-08 00:17
- **Закрыто:** 2026-08-10 решением `promote`
- **Base commit:** `0b5d5469393aba1c7d534d0d19f79452a7b4b07b`
- **Основной режим:** preclick-hop включён безусловно как единственный preclick runtime

## Зафиксированное поведение

- До первого захвата вход мыши в радиус камня вызывает дискретный отскок от курсора.
- Скорость входа определяет дальность; следующий отскок начинается от предыдущей посадки.
- Позиция бесшовно переносится через границы viewport, а камень остаётся доступным для захвата.
- Каждый новый вход запускает один звук «Смех»; пребывание внутри радиуса не создаёт повторов.
- Первый успешный захват материализует видимую hop-позицию в физические координаты, снимает guidance и scroll lock.
- Анимация длится `400 ms` с кривой `cubic-bezier(0.22, 1, 0.36, 1)`; reduced motion выполняет мгновенную посадку.
- Основные параметры: `preclickHopActivationRadiusVw` и `preclickHopMaxDistanceVw`.

## Визуализация

- Mermaid: `visualization/preclick-rock-hop.mmd`
- HTML: `visualization/preclick-rock-hop.html`

## Impact analysis

- **Основные файлы:** `src/lib/preclickHop.mjs`, `src/runtime/createSisyphusRuntime.js`, `src/styles/scene.css`, `shared/room-settings.js`, `src/config/settings.mjs`, `tests/unit/frontend-model.test.mjs`, `tests/smoke/preclick-rock-hop.spec.js`, `playwright.hop.config.js`.
- **Затронутые сценарии:** pointermove до первого захвата, вход/выход из радиуса, reset/reload, wrap, первый захват, camera-follow и локальное аудио отскока.
- **Контракты и данные:** room settings schema `34`, settings/localStorage schema `36`; старые radius-ключи мигрируют, остальные удалённые parallax-поля игнорируются и не попадают в новые payload/preset.
- **Скрытые зависимости:** CSS-offset материализуется до `control.acquire`; resize/reset/dispose отменяют активную анимацию; reduced motion сохраняет ту же конечную геометрию.
- **Риск-класс:** локальный UI/runtime до первого захвата; серверная физика после materialization не меняется.

## Evidence

| Проверка | Команда / источник | Результат | Примечание |
|---|---|---|---|
| Lint и production build | `npm run lint`, `npm run build` | pass | Выполнено в существующем dev Docker-образе |
| Unit/integration | `npm test` | pass, `193/193` | Геометрия, скорость/дальность, wrap, миграции и очистка payload/preset |
| Production smoke | `npm run test:smoke:prod` | pass, `4/4` | Production-маршрут, reset и сессия |
| UI smoke | `npm run test:smoke:ui` | pass, `16/16` | Два hop-контрола, миграции, reload/reset, scroll lock и first grab |
| Hop smoke | `npm run test:smoke:hop` | pass, `2/2` | Накопительные отскоки, fast > slow, wrap, аудио, materialization и camera-follow |
| Ручная dev-проверка | Chromium на локальном dev | pass | `11 vw`, `184.3 vw`, повторный вход, wrap/hit-test и первый захват без скачка |

## Решение

- **Outcome:** promote
- **Дата и основание:** 2026-08-10, пользователь явно одобрил перенос поведения в основную версию.
- Отдельная ветка непрерывного parallax и её отдельные проверки удалены.
- Unit и browser hop-проверки входят в постоянный набор регрессии.
- Production preset и шаблон нормализованы без удаления остальных пользовательских настроек.
