# Cyberpunk RED: Netrunning Lab 0.2

Экспериментальный **sidecar-модуль** для `cpr-netrunning`. Он существует, чтобы
проверять новый интерфейс и сетевую архитектуру, не ломая рабочий модуль и не
переписывая его сохранения.

- module id: `cpr-netrunning-next`
- Foundry VTT: 12.343
- Cyberpunk RED - CORE: 0.92.4
- production `cpr-netrunning`: только источник безопасной **копии** архитектуры

## Что изменилось в 0.2

Версия 0.1 была в основном UX-лабораторией. В 0.2 интерфейс перестроен в
**контекстный cockpit Нетраннера** и получил отдельную rules-aware runtime-модель.

Главное правило UI: функция не занимает постоянное место на экране только
потому, что она существует. Основная карта показывает состояние СЕТИ, нижний dock
показывает только действия, которые имеют смысл сейчас, а редкие функции уходят
в контекстные вкладки и сворачиваемую панель Программ.

### Три режима

**RUN** — оперативный интерфейс GM и Нетраннера. Карта, текущий этаж, NET Actions,
контекстные Interface Abilities, кибердека, Программы и Control Nodes.

**BUILD** — подготовка лабораторной копии: Foundry Documents и привязки к
физической Scene. Эти настройки не торчат в игровом интерфейсе.

**PLAYER VIEW** — GM видит именно ту очищенную проекцию, которая предназначена
игроку: без скрытых DV, GM notes и неразведанного содержимого.

## Правила Cyberpunk RED

Лаборатория не вводит собственную математику бросков. Interface и Program rolls
проходят через нативный pipeline `cyberpunk-red-core`, включая его диалог,
модификаторы, LUCK, критические результаты и chat cards.

В чистом rules-layer зафиксированы и тестируются:

- NET Actions от ранга Interface: 1–3 → 2, 4–6 → 3, 7–9 → 4, 10 → 5;
- ничья не побеждает DV;
- Jack In и безопасный Jack Out стоят по одному NET Action;
- виртуальное движение между соседними этажами бесплатно;
- невскрытое препятствие не даёт пройти глубже, но не мешает отступить;
- Backdoor, Eye-Dee и Control используют строгую проверку `total > DV/opposed`;
- Control Node можно активировать снова, каждый раз за отдельный NET Action;
- Pathfinder проходит каждую ветку независимо и останавливает только конкретный
  путь на первом Пароле, который результат не способен превзойти;
- Virus оставляется только на дне ветки, а его DV равен результату установки;
- Slide остаётся действием один раз за Turn и относится только к Black ICE;
- автоматический reset NET Actions привязан к Turn в Foundry Combat; ручной reset
  оставлен GM как резерв для сцен без Combat.

### Going Quiet

В 0.2 заложены правила официального DLC **Going Quiet v1.1**:

- Quiet Jack In стоит дополнительный NET Action, то есть два суммарно;
- исходный Check идёт против всех Watchers;
- захват Control Node ломает stealth;
- атака/прямое взаимодействие с Black ICE или Watcher ломает stealth;
- Virus и кража File сами по себе stealth не ломают;
- при скрытном столкновении с Black ICE используется Cloak против PER вместо
  обычного Speed Check;
- при скрытном столкновении с Watcher используется Cloak против Pathfinder;
- после потери stealth вернуть его можно только Jack Out → Quiet Jack In.

Низкоуровневые primitives для этих проверок уже находятся в `scripts/rules.js`.
Полная автоматизация очереди Black ICE/Watcher combat остаётся следующим этапом;
до этого неподдержанный боевой эффект не должен подменяться выдуманным правилом.

## Приватность и multiplayer

Полная архитектура и runtime находятся в GM-only JournalEntry:

`[CRNS LAB] Private Store`

Игроку создаётся отдельный JournalEntry-проектор с ownership только этому
пользователю. Unknown node содержит лишь минимальную топологию. Скрытые DV,
GM notes, содержимое, невидимые attachments и конфигурация Scene controls туда не
попадают.

Изменения игрока отправляются authoritative GM через module socket. Когда
доступен WebCrypto, транспорт использует ECDH P-256 + AES-GCM, timestamp и replay
protection. В отличие от старого прототипа, отсутствие HTTPS не убивает весь
модуль: GM продолжает работать локально, а небезопасные player mutations просто
не разрешаются.

## Foundry integration

В BUILD mode можно перетащить на этаж:

- JournalEntry;
- JournalEntryPage;
- Item.

Также можно привязать выбранный объект Scene:

- Wall door: open / close / lock / unlock;
- Token: show / hide;
- Tile: show / hide;
- AmbientLight: enable / disable;
- AmbientSound: enable / disable.

В RUN mode эти команды появляются только когда конкретный Netrunner уже взял
соответствующий Control Node. Выполнение команды стоит отдельный NET Action.

## Иконки и темы

`assets/icons.svg` — собственный SVG sprite. Он не копирует графику RTG/CDPR и
использует `currentColor`, поэтому один набор работает во всех темах.

Темы:

- REDLINE — основная чёрно-красная;
- NEON — холодная cyan/magenta;
- MONO — нейтральная высококонтрастная.

Есть `prefers-reduced-motion`, отдельная настройка Reduce Motion, видимый keyboard
focus и responsive layout.

## Установка

Из ветки `experiment/netrunning-next` скопируйте:

`experimental/cpr-netrunning-next`

в:

`Data/modules/cpr-netrunning-next`

После перезапуска Foundry включите **Cyberpunk RED: Netrunning Lab**. Основной
`cpr-netrunning` можно оставить включённым — id и хранилища различаются.

## Первый тест

1. Откройте Token Controls → **Netrunning Lab**.
2. BUILD → **IMPORT COPY** или **DEMO**.
3. Добавьте подходящего Netrunner Actor.
4. Переключитесь RUN и сделайте Jack In.
5. Проверьте бесплатное движение по соседним этажам и блокировку глубины
   невскрытым Password.
6. Выполните Backdoor / Eye-Dee / Pathfinder и сравните native CPR chat cards.
7. Переключите PLAYER VIEW и проверьте отсутствие секретных данных.
8. В BUILD добавьте Journal/Item и Scene binding к Control Node; в RUN возьмите
   Control и выполните действие.
9. При активном Foundry Combat переключите Turn на Netrunner: NET Actions должны
   обновиться автоматически.

## Проверки

```bash
node experimental/cpr-netrunning-next/tools/check.mjs
```

Checker проверяет:

- JS syntax;
- отдельный module id и отсутствие записи в production namespace;
- отсутствие секретного runtime в world settings;
- EN/RU parity;
- SVG references;
- наличие secure transport;
- accessibility hooks CSS;
- чистые тесты правил (action bands, strict DV, movement, Pathfinder,
  Going Quiet, Slide limit, Virus leaf).

## Что ещё НЕ считаю готовым

Эксперимент 0.2 уже намного ближе к реальному модулю, но я не буду выдавать
незавершённую механику за корректную автоматизацию. До кандидата на перенос в
production нужно закончить и live-test:

- полный Black ICE encounter lifecycle и Speed/free-effect handling;
- follow/initiative lifecycle Black ICE;
- Slide с выбором соседнего этажа и opposed PER;
- Zap + damage и все варианты Program combat;
- unsafe Jack Out effects;
- Watcher search once per Turn из Going Quiet;
- live multiplayer acceptance test на Foundry 12.343.

Пока эти пункты не закрыты, `master` не трогаем и draft PR не сливаем.
