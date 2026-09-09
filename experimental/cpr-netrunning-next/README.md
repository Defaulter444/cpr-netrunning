# Cyberpunk RED: Netrunning Lab

Экспериментальный **sidecar-модуль** для `cpr-netrunning`.

Он намеренно не заменяет основной модуль и не использует его namespace.
ID лаборатории: `cpr-netrunning-next`.

## Зачем он существует

Здесь проверяются идеи, которые опасно сразу внедрять в рабочий нетраннинг:

- progressive disclosure вместо постоянного нагромождения кнопок;
- отдельные режимы **GM / Player projection**;
- приватная копия архитектуры вместо записи в `cpr-netrunning.netArchs`;
- безопасная публичная проекция без скрытых DV, содержимого и GM notes;
- Foundry Journal / Item как вложения узла;
- Control Node → реальные объекты Scene;
- единый набор собственных SVG-иконок;
- контекстный инспектор узла вместо расширения постоянной action bar.

## Изоляция

Лаборатория **никогда не вызывает `game.settings.set("cpr-netrunning", ...)`**.

Кнопка **IMPORT COPY** читает `cpr-netrunning.netArchs`, преобразует архитектуры и
кладёт копии в скрытый JournalEntry лаборатории:

`[CRNS LAB] Private Store`

Полные копии читаются только GM. Игрокам доступна только настройка
`publicProjection`, в которую GM публикует уже очищенное представление.

Это экспериментальная модель будущей границы данных:

`GM private state -> sanitize -> public player projection`

## Установка

В ветке `experiment/netrunning-next` скопируйте каталог:

`experimental/cpr-netrunning-next`

в:

`Data/modules/cpr-netrunning-next`

После перезапуска Foundry включите **Cyberpunk RED: Netrunning Lab**.

Основной `cpr-netrunning` можно оставить включённым.

## Первый тест

1. Откройте Token Controls → **NET Lab**.
2. Нажмите **IMPORT COPY**.
3. Выберите архитектуру.
4. Нажимайте узлы карты. Справа открывается контекстный инспектор.
5. В блоке Runtime можно раскрывать/скрывать узлы и менять текущую позицию.
6. Переключитесь в **PLAYER PROJECTION** и убедитесь, что скрытые узлы не содержат
   имени, DV, содержимого, вложений или GM notes.
7. Перетащите JournalEntry / JournalEntryPage / Item на узел в GM-режиме.
8. Выберите дверь/Token/Tile/Light/Sound на Scene и нажмите **BIND SELECTED**.
   Связь существует только в лабораторной копии.

## Что НЕ делает 0.1.0

Это не замена боевого runtime `cpr-netrunning`.

Версия 0.1.0 намеренно не переносит:

- NET Combat;
- Black ICE state machine;
- Interface rolls;
- Program rolls;
- action economy;
- player movement requests.

Эти механики остаются в основном модуле. Смысл первого прототипа — проверить
**UX, private/public split и Foundry document integration**, не переписывая
работающий combat engine.

## Иконки

`assets/icons.svg` — собственный монохромный SVG sprite. Иконки используют
`currentColor`, поэтому перекрашиваются темой без отдельных PNG.
