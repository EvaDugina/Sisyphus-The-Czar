# Sisyphus The Czar

Стадия: POC B

Интерактивная веб-миниатюра с общей realtime-сессией: участники открывают одну ссылку, видят один падающий камень и поднимают его общей физикой; для движения достаточно одной активной руки. Клиент собран на React + Vite, API и WebSocket обслуживает Node.js.

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
- **Отладочный production:** `DEBUG=true docker compose up -d --build --force-recreate`. Это production-сборка Vite без HMR и test API, но с полной панелью настроек у root-master.
- **Настоящий production:** `DEBUG=false docker compose up -d --build --force-recreate`. Панель и controller настроек не входят в frontend bundle.

Dev и production используют один локальный origin `http://127.0.0.1:18082/`, поэтому режимы запускаются последовательно. Перед переключением остановите текущий Compose-проект. `DEBUG` одновременно является build argument frontend и runtime-переменной сервера: одной перезагрузки страницы или restart контейнера недостаточно, после смены значения обязательны rebuild и recreate.

## Совместная сессия

1. Откройте приложение по `/`: сервер подключит браузер к единой общей комнате.
2. Нажмите верхнюю кнопку с иконкой ссылки.
3. Отправьте скопированный корневой URL второму участнику.

Один участник держит камень, остальные наблюдают и могут взять его после отпускания. Физика общая. В dev и отладочном production root-master автоматически загружает наиболее позднюю сохранённую версию по `updatedAt`, затем `createdAt` и `id`; полный snapshot отправляется в root-комнату и повторяется после reconnect до подтверждения сервером. Slave настройки не меняет. Reload/reconnect и пересоздание контейнера сохраняют серверное состояние общей комнаты в Docker volume. Настоящий production применяет явно выбранный флагом preset только к physics и room settings root-комнаты, не сбрасывая фазу, положение, trail, роли или общий таймер. После выхода последнего участника root-комната остаётся жить, поэтому общее время и состояние не начинаются заново при следующем открытии `/`.

Production frontend использует существующий `rock.webp`, уже сжатые PNG-курсоры и lazy-загрузку MP3. Регулярные multiplayer snapshots отправляются lean без неизменных `physics`, `roomSettings`, `masterViewport`, `imprint` и `expiresAt`; `pointer.update` не эхо-рассылается отправителю. Частоты остаются прежними: до 30 Hz input и до 20 Hz snapshots.

В slim production dev-controller настроек и KaTeX-подсказки не входят в bundle. Production build с `DEBUG=true` включает их для временной отладки, но test API остаётся доступен только в Vite dev. Production smoke проверяет комнату и движение камня через реальные действия браузера.

## Версии настроек и production preset

Локальные изменения выбранной версии или её имени создают черновик: изменённые контролы и общий индикатор подсвечиваются синим, а при закрытии или reload вкладки браузер показывает стандартный confirm. Точный возврат к исходным значениям или сохранение очищает dirty-состояние. Сохранение черновика, основанного на версии, обновляет эту версию; явный выбор «Черновик» создаёт новую.

Флаг в строке сохранённой версии назначает её preset’ом следующего настоящего production и не применяет её к текущей комнате. Новый флаг атомарно заменяет прежний. Помеченную версию нельзя удалить до выбора другой; её последующее сохранение автоматически публикует обновлённый snapshot. Назначение хранится в `/app/config/production-preset.json` в named volume `sisyphus-the-czar-production-preset`.

## Настройки

Создайте `.env` по `.env.example` только для production:

| Переменная | Назначение |
|---|---|
| `DEBUG` | `true` для dev-послаблений, `false` для production hardening |
| `ALLOWED_ORIGIN` | публичный HTTPS origin; несколько значений через запятую |
| `SESSION_TTL_SECONDS` | время жизни комнаты после последней активности, по умолчанию `86400` |
| `EMPTY_SESSION_GRACE_SECONDS` | задержка удаления пустой legacy-комнаты; root-комната по `/` не удаляется, по умолчанию `10` |
| `SESSION_STORE_PATH` | файл состояния в Docker volume, по умолчанию `/app/data/sessions.json` |
| `PRODUCTION_PRESET_PATH` | canonical production preset, по умолчанию `/app/config/production-preset.json` |
| `SESSION_PERSIST_INTERVAL_MS` | интервал фонового сохранения, по умолчанию `250` мс |

Секретов приложение не использует. Файл `.env` не коммитится.

## Проверки

Все исполняемые проверки запускаются в Docker:

```bash
docker run --rm -v "$(pwd):/app" -v /app/node_modules -w /app node:24.18.0-alpine3.23 sh -c "npm ci && npm run lint && npm run build && npm test"
docker run --rm --ipc=host -v "$(pwd):/app" -v /app/node_modules -w /app mcr.microsoft.com/playwright:v1.61.1-noble sh -c "npm ci && npm run test:smoke"
```

Перед крупным релизом замените `npm run test:smoke` на `npm run test:soak`: два браузера проверяются не менее 10 минут.

## Деплой

На Linux-сервере:

```bash
cp .env.example .env
# Укажите ALLOWED_ORIGIN и оставьте DEBUG=false
bash deploy.sh
```

Multi-stage Docker build собирает React-клиент в `dist`, а production-образ запускает только Express/WebSocket и раздаёт hashed assets. Контейнер слушает `127.0.0.1:18082`; внешний nginx хоста публикует HTTPS, поддерживает WebSocket Upgrade и использует `proxy_read_timeout` не менее 75 секунд.

Named volumes с комнатами и production preset сохраняются при `deploy.sh`, `docker compose restart`, rebuild/recreate и обычном `docker compose down`. Preset теряется только при повреждении volume или его явном удалении, например `docker compose down -v` либо `docker volume rm sisyphus-the-czar-production-preset`.

Минимум для комнаты на двух участников: Ubuntu Server 24.04 LTS, 1 vCPU, 512 МБ RAM, 2 ГБ диска и канал от 1 Мбит/с. Рекомендуется 1 ГБ RAM, 10 Мбит/с, RTT до 100 мс и jitter до 30 мс.
