# Sisyphus The Czar

Стадия: POC B

Интерактивная веб-миниатюра с серверной физикой: каждый пользователь получает отдельную single-client-сессию, один камень и одну руку. Между сессиями общими остаются история следов и debug-каталог шаблонов. Клиент собран на React + Vite, API и WebSocket обслуживает Node.js.

## Локальный запуск

Нужны Docker Engine и Docker Compose v2:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

Приложение откроется на `http://127.0.0.1:18082/`. После первого запуска контейнер оставляют работающим: изменения в `src/`, `index.html` и `assets/` применяются React Fast Refresh/Vite HMR обычно за 50–150 мс, изменения в `shared/physics.js` вызывают полный reload страницы примерно через 250 мс, а Nodemon автоматически перезапускает Express при изменениях `server/` и `shared/`. Dev-контейнер запускает `npm run dev:container`, поэтому Vite также перезапускается внутри контейнера при изменении `vite.config.mjs`, `index.html`, `package.json` и `package-lock.json`. Исходники и dev-конфиги подключены bind mounts, поэтому ручные `restart`, `up` и пересборка после изменения кода не нужны.

После остановки контейнер обычно поднимают без сборки:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Пересборка нужна только после изменения зависимостей в `package.json`/`package-lock.json` или development-stage в `Dockerfile`. Изменение Compose-конфигурации требует повторного `docker compose -f docker-compose.dev.yml up -d`, но не требует `--build`, если образ не менялся.

Остановить локальный контейнер:

```bash
docker compose -f docker-compose.dev.yml down
```

## Три режима запуска

- **Dev:** `docker compose -f docker-compose.dev.yml up -d --build`. Панель настроек, Vite HMR и test API доступны.
- **Отладочный production:** `DEBUG=true docker compose up -d --build --force-recreate`. Это production-сборка Vite без HMR и test API, но с полной панелью настроек личной сессии.
- **Настоящий production:** `DEBUG=false docker compose up -d --build --force-recreate`. Панель и controller настроек не входят в frontend bundle.

Dev и production используют один локальный origin `http://127.0.0.1:18082/`, поэтому режимы запускаются последовательно. Перед переключением остановите текущий Compose-проект. `DEBUG` одновременно является build argument frontend и runtime-переменной сервера: одной перезагрузки страницы или restart контейнера недостаточно, после смены значения обязательны rebuild и recreate.

## Личные сессии и общий след

1. Откройте приложение по `/`: сервер создаст браузеру новую single-client-сессию.
2. Откройте тот же URL в другом браузере: второй пользователь получит другой session ID и свой камень.
3. Движение камня и захват изолированы; shared trail агрегируется сервером отдельно.

В каждой сессии есть единственная роль `master`, единственная рука и не более одного holder. Сила не суммируется между пользователями. Во всех режимах новая или перезагруженная личная сессия получает настройки только из выбранного production preset; последняя или локально выбранная непомеченная версия не подменяет его. Reload сохраняет игровое состояние и положение камня, но заново применяет помеченные physics/room settings. Чужие открытые сессии live не сбрасываются. Каталог шаблонов общий, но текущие положение камня, настройки сессии и таймеры автоматического поведения не рассылаются другим пользователям.

Основная сцена доступна только по `/`. Удалённые compatibility-адреса `/drafts`, `/drafts/` и `/drafts/assets/*` возвращают `404` и в dev, и в production; 3D Fold остаётся частью основной страницы.

Preclick-эксперимент включён по умолчанию: каждый новый вход мыши в радиус заставляет камень ускакивать от курсора без возврата в центр и запускает независимый `Смех.mp3`. В общей группе «Камень» поле «Максимальная длина отскока, vw» задаёт дальность; скорость входа `0–2000 px/s` даёт `28–100%` выбранного максимума. Во время этой сцены центр камня бесшовно переносится между левым/правым и верхним/нижним краями с сохранением остатка пути. Build-time значение `EXPERIMENT_PRECLICK_ROCK_HOP=false` возвращает прежний непрерывный parallax.

Если `Fhand < m · g`, рука не отпускает камень: он плавно отстаёт со скоростью, зависящей от `Fhand / Fg`. В группе «Камень» независимо включаются случайное выпадение через `0.5–2 s` и выпрыгивание вверх. Для выпрыгивания задаются интервал `1–10 s` (default `5`), полная ширина симметричного углового сектора `0–180°` (default `90°`) и разброс силы `0–100%` (default `25%`). Значение угла `0°` направляет камень строго вверх, `180°` разрешает всю верхнюю полуплоскость.

Свечение траектории вынесено из базовой линии в отдельный canvas и рисуется одним ограниченным blur-проходом. В UI доступны локальные профили `Авто`, `Производительность`, `Баланс`, `Качество` и `Ручной`; ручной режим задаёт масштаб glow-буфера, частоту обновления, лимит точек и прореживание. Эти параметры сохраняются только в текущем браузере и не входят в серверные шаблоны/production preset. Неактуальные поля настроек автоматически получают `disabled` в зависимости от выбранного режима линии, темы или glow-профиля.

Production frontend использует `rock-03.png`, PNG-курсоры `cursor-grab-02.png`/`cursor-grabbing-02.png` единственной руки и lazy-загрузку MP3. Регулярные snapshots отправляются без неизменных `physics`, `roomSettings`, `imprint` и `expiresAt`. Частоты: до 30 Hz input и до 20 Hz snapshots.

В slim production dev-controller настроек и KaTeX-подсказки не входят в bundle. Production build с `DEBUG=true` включает их для временной отладки, но test API остаётся доступен только в Vite dev. Production smoke проверяет комнату и движение камня через реальные действия браузера.

## Версии настроек и production preset

В `DEBUG=true` каталог до 50 полноценных шаблонов хранится на сервере и одинаков для всех пользователей. Старые версии из `localStorage` импортируются один раз пакетами с дедупликацией по `id + updatedAt`; импорт пополняет только каталог и не применяет последнюю версию к комнате. Расхождение одного id сохраняется отдельной веткой. Локальные изменения выбранной версии или её имени создают черновик: изменённые контролы и общий индикатор подсвечиваются синим, а при закрытии или reload вкладки браузер показывает стандартный confirm. Точный возврат к исходным значениям или сохранение очищает dirty-состояние. Сохранение черновика, основанного на версии, обновляет эту версию; concurrent mismatch по `updatedAt` создаёт новую ветку вместо перезаписи, а явный выбор «Черновик» создаёт новую.

Любой пользователь в `DEBUG=true` может поставить флаг в строке сохранённой версии: это назначает её единственным baseline’ом новых сессий во всех режимах и не применяет немедленно к уже работающей личной сессии. Новый флаг атомарно заменяет прежний и начинает использоваться новыми сессиями без рестарта сервера. Каталог шаблонов хранится в отслеживаемом файле [`config/settings-templates.json`](config/settings-templates.json), а выбранный canonical production preset — в `config/production-preset.json`. Оба файла подключены через writable bind mount `/app/repository-config` и синхронизируются через Git после обычных `git add`, `commit`, `push` и `pull`. Несохранённый черновик и локальные параметры производительности остаются в `localStorage` текущего браузера и в Git не попадают.

## Настройки

Создайте `.env` по `.env.example` только для production:

| Переменная | Назначение |
|---|---|
| `DEBUG` | `true` для dev-послаблений, `false` для production hardening |
| `ALLOWED_ORIGIN` | публичный HTTPS origin; несколько значений через запятую |
| `SESSION_TTL_SECONDS` | время жизни комнаты после последней активности, по умолчанию `86400` |
| `EMPTY_SESSION_GRACE_SECONDS` | задержка удаления пустой совместимой комнаты; persistent trail hub не удаляется, по умолчанию `10` |
| `SESSION_STORE_PATH` | файл состояния в Docker volume, по умолчанию `/app/data/sessions.json` |
| `PRODUCTION_PRESET_PATH` | отслеживаемый canonical production preset, по умолчанию `/app/repository-config/production-preset.json` |
| `SETTINGS_TEMPLATE_STORE_PATH` | отслеживаемый каталог debug-шаблонов, по умолчанию `/app/repository-config/settings-templates.json` |
| `SESSION_PERSIST_INTERVAL_MS` | интервал фонового сохранения, по умолчанию `250` мс |
| `EXPERIMENT_PRECLICK_ROCK_HOP` | build-time флаг экспериментального preclick-отскока; по умолчанию `true`, `false` возвращает прежний parallax |

Секретов приложение не использует. Файл `.env` не коммитится.

## Проверки

Все исполняемые проверки запускаются в Docker:

```bash
docker run --rm -v "$(pwd):/app" -v /app/node_modules -w /app node:24.18.0-alpine3.23 sh -c "npm ci && npm run lint && npm run build && npm test"
docker run --rm --ipc=host -v "$(pwd):/app" -v /app/node_modules -w /app mcr.microsoft.com/playwright:v1.61.1-noble sh -c "npm ci && npm run test:smoke"
docker run --rm --ipc=host -v "$(pwd):/app" -v /app/node_modules -w /app mcr.microsoft.com/playwright:v1.61.1-noble sh -c "npm ci && npm run test:smoke:ui && npm run test:smoke:hop"
```

Перед крупным релизом замените `npm run test:smoke` на `npm run test:soak`: две независимые пользовательские сессии проверяются не менее 10 минут.

## Деплой

На Linux-сервере:

```bash
cp .env.example .env
# Укажите ALLOWED_ORIGIN и оставьте DEBUG=false
bash deploy.sh
```

Multi-stage Docker build собирает React-клиент в `dist`, а production-образ запускает только Express/WebSocket и раздаёт hashed assets. Контейнер слушает `127.0.0.1:18082`; внешний nginx хоста публикует HTTPS, поддерживает WebSocket Upgrade и использует `proxy_read_timeout` не менее 75 секунд.

Named volume с комнатами сохраняется при `deploy.sh`, `docker compose restart`, rebuild/recreate и обычном `docker compose down`. Каталог шаблонов и production preset синхронизируются вместе с репозиторием через `config/settings-templates.json` и `config/production-preset.json`. После `git pull` перезапустите приложение через `bash deploy.sh` или `docker compose restart`, чтобы сервер перечитал выбранный preset.

Минимум для двух одновременных личных сессий: Ubuntu Server 24.04 LTS, 1 vCPU, 512 МБ RAM, 2 ГБ диска и канал от 1 Мбит/с. Рекомендуется 1 ГБ RAM, 10 Мбит/с, RTT до 100 мс и jitter до 30 мс.
