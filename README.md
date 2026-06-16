# VPN Probe

Веб-инструмент диагностики сети: проверка блокировок, DNS-подмены, DPI, throttling и VPN-транспортов. Запускается в браузере, без установки и регистрации.

[![Deploy GitHub Pages](https://github.com/milkycloud-dev/vpn-probe/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/milkycloud-dev/vpn-probe/actions/workflows/deploy-pages.yml)

**Демо:** https://milkycloud-dev.github.io/vpn-probe/

---

## Назначение

VPN Probe выполняет около 110 проб с устройства пользователя на публичные endpoints. Результат — оценка доступности сети и типичных обходных транспортов в текущих условиях подключения.

Инструмент не тестирует конкретный VPN-аккаунт или сервер. Используется для диагностики и анализа, без гарантий применимости к вашей инфраструктуре.

---

## Состав проверок

| Направление | Содержание |
|-------------|------------|
| Базовая доступность | HTTPS к Cloudflare, Google, GitHub, Яндекс, VK и др. |
| Реестр РКН (27) | X, Instagram, Reddit, Meduza, ProtonVPN, Tor и др. |
| Контроль РФ (10) | VK, Яндекс, Госуслуги, Ozon, Rutube и др. |
| DNS | DoH-резолверы, сверка ответов, poison по реестру, IPv6 vs IPv4 |
| Транспорты | WSS, долгие сессии, типовые path, параллельные WSS, UDP/STUN, WebTransport |
| Специфика РФ | IMG-пробы, throttling, стабильность DPI, каскад из 12 узлов |

Вердикты по протоколам (VLESS, VMess, Trojan, Shadowsocks, WireGuard, OpenVPN, Hysteria, IKEv2, Reality) формируются по косвенным признакам; где браузер не может проверить handshake, ставится `inconclusive`.

---

## Метрики отчёта

| Метрика | Описание |
|---------|----------|
| Индекс блокировок РФ | Доля недоступных сервисов из реестра |
| Цензура % | Реестр, DNS poison, IMG, throttling |
| VPN-транспорт | WSS, UDP/QUIC, WebTransport, стабильность |
| Интернет | Baseline HTTPS и DNS |

Контрольные сервисы РФ должны быть доступны. Их недоступность указывает на проблему сети, а не на цензуру.

Недоступность сервисов реестра в РФ без обхода — ожидаемый результат.

После сканирования доступны экспорт в текстовый файл и копирование полного отчёта в буфер обмена.

---

## Ограничения

- Проверка выполняется с клиентского устройства; трафик не проходит через серверы проекта.
- Браузер не выполняет реальные handshake WireGuard, OpenVPN, VLESS Reality.
- Оценки poison, throttling и блокировок носят эвристический характер.
- Результаты зависят от провайдера, геолокации, CDN и момента проверки.
- Встроенный терминал — эмуляция shell для интерфейса, не удалённая система.

---

## Разработка

```bash
git clone https://github.com/milkycloud-dev/vpn-probe.git
cd vpn-probe
npm install
npm run dev
```

```bash
npm run build
npm run preview
```

**Стек:** Vite, TypeScript, GitHub Actions, GitHub Pages.

### Деплой

1. Fork или clone репозитория.
2. В настройках репозитория: **Settings → Pages → Source: GitHub Actions**.
3. Push в ветку `master` — workflow соберёт и опубликует `dist/`.

Для репрезентативных результатов по РФ рекомендуется запуск из российской сети (домашний ISP или мобильный оператор).

### Структура проекта

```
src/
├── main.ts, runner.ts, report.ts, narrative.ts
├── ui.ts, terminal.ts, export.ts, locale.ts, sync.ts
├── probes/       # https, dns, websocket, udp, webtransport, ipv6, russia…
└── shell*.ts     # интерактивный терминал
```

---

## Лицензия

MIT. Проект разработан на базе MilkyCloud.

Вопросы и предложения: https://github.com/milkycloud-dev/vpn-probe/issues
