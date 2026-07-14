# Sisyphus The Czar

Стадия: POC B

Интерактивная веб-миниатюра с общей realtime-сессией: участники открывают одну ссылку, видят один падающий камень и по очереди управляют им.

## Локальный запуск

Нужны Docker Engine и Docker Compose v2. Первая команда собирает и запускает Node.js-сервер:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Приложение откроется на `http://127.0.0.1:18082/`. Изменения `index.html`, `assets/`, `server/` и `shared/` подхватываются через bind mounts: серверный код автоматически перезапускается polling-наблюдателем, а открытая страница обновляется сама. Пересобирать или переподнимать контейнер после обычных правок не нужно; `--build` снова требуется только после изменения зависимостей или Dockerfile. Остановить: `docker compose -f docker-compose.dev.yml down`.

## Совместная сессия

1. Откройте приложение: сервер автоматически создаст уникальную комнату и переведёт браузер на `/?session=<id>`.
2. Нажмите верхнюю кнопку с иконкой ссылки рядом с настройками.
3. Отправьте скопированный текущий URL второму участнику.

Один участник держит камень, остальные наблюдают и могут взять его после отпускания. Физика общая, оформление следа остаётся локальным. Reload/reconnect и перезапуск контейнера сохраняют ID и серверное состояние комнаты в Docker volume. После выхода последнего участника комната ждёт 10 секунд и удаляется, если никто не вернулся.

## Настройки

Создайте `.env` по `.env.example` только для production:

| Переменная | Назначение |
|---|---|
| `DEBUG` | `true` для dev-послаблений, `false` для production hardening |
| `ALLOWED_ORIGIN` | публичный HTTPS origin; несколько значений через запятую |
| `SESSION_TTL_SECONDS` | время жизни комнаты после последней активности, по умолчанию `86400` |
| `EMPTY_SESSION_GRACE_SECONDS` | задержка удаления пустой комнаты для reload/reconnect, по умолчанию `10` |
| `SESSION_STORE_PATH` | файл постоянного состояния в Docker volume, по умолчанию `/app/data/sessions.json` |
| `SESSION_PERSIST_INTERVAL_MS` | интервал фонового сохранения движущихся комнат, по умолчанию `250` мс |

Секретов приложение не использует. Файл `.env` не коммитится.

## Проверки

Все исполняемые проверки запускаются в Docker:

```bash
docker run --rm -v "$(pwd):/app" -v /app/node_modules -w /app node:24.18.0-alpine3.23 sh -c "npm ci && npm run lint && npm test"
docker run --rm --ipc=host -v "$(pwd):/app" -v /app/node_modules -w /app mcr.microsoft.com/playwright:v1.61.1-noble sh -c "npm ci && npm run test:smoke"
```

Перед крупным релизом длительную проверку двух браузеров можно запустить той же Playwright-командой, заменив `npm run test:smoke` на `npm run test:soak`. Она занимает не менее 10 минут.

## Деплой

На Linux-сервере:

```bash
cp .env.example .env
# Укажите ALLOWED_ORIGIN и оставьте DEBUG=false
bash deploy.sh
```

Контейнер слушает только `127.0.0.1:18082`. Внешний nginx хоста должен публиковать приложение через HTTPS, поддерживать WebSocket Upgrade и иметь `proxy_read_timeout` не менее 75 секунд. Порт приложения наружу не открывается.

Named volume с комнатами сохраняется при обычном `deploy.sh`, `docker compose restart` и `docker compose down`. Команда `docker compose down -v` удаляет его вместе со всеми сессиями.

Минимум для двух участников: Ubuntu Server 24.04 LTS, 1 vCPU, 512 МБ RAM и 2 ГБ свободного диска. Рекомендуется 1 ГБ RAM и канал от 10 Мбит/с.
