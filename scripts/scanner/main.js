/* Optional adaptation of GMPneuma's NetArch Scanner 0.9.0; see NOTICE-SCANNER.md. */
import { MODULE_ID } from './constants.js';
import { registerSettings } from './settings.js';
import { ensureTemplates, registerTokenGuards } from './templates.js';
import { APPresentation } from './presentation.js';
import { editAccessPoint, openScanner, refreshPanels, registerUI } from './ui.js';
import { hideAPs, pulseAPs, requireGM, revealAPs, stopPulses } from './actions.js';
import { installScannerIntegration, registerScannerHooks } from './scanner.js';
import { APTypeManager } from './type-manager.js';
import { scannerAvailability } from './availability.js';
import { CameraVision } from './camera-vision.js';
let presentation;
let cameras;
let active = false;
Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'scannerEnabled', {
    name: 'Сканер: точки доступа на карте', scope: 'world', config: true,
    hint: 'Необязательное оформление обнаружения. Обычное подключение и забеги работают без него. Для включения нужен libWrapper; после изменения перезагрузите мир.',
    type: Boolean, default: false, requiresReload: true,
  });
  registerSettings(() => { if (active) { presentation.queueRefresh(); refreshPanels(); } });
  active = scannerAvailability(game).active;
  const host = game.modules.get(MODULE_ID);
  host.api ??= {};
  host.api.scanner = Object.freeze({
    get enabled() { return active; },
    open: (...args) => { if (!active) return ui.notifications.info('Включите «Сканер: точки доступа на карте» в настройках нетраннинга и перезагрузите мир.'); return openScanner(...args); },
    ...(active ? { reveal: revealAPs, hide: hideAPs, pulse: pulseAPs, stopPulses, ensureTemplates,
      cameras: () => cameras?.openPanel(),
      edit: doc => { requireGM(); return editAccessPoint(doc); } } : {}),
  });
  if (!active) return;
  game.settings.registerMenu(MODULE_ID, 'scannerManageTypes', {
    name: 'Сканер: типы точек доступа', label: 'Настроить типы точек',
    hint: 'Названия и изображения точек доступа. Существующие точки сохраняются.',
    icon: 'fas fa-list', type: APTypeManager, restricted: true,
  });
  presentation = new APPresentation();
  cameras = new CameraVision();
  cameras.registerHooks();
  registerTokenGuards();
  registerUI();
  presentation.registerHooks();
  registerScannerHooks(openScanner);

});
Hooks.once('ready', async () => {
  const status = scannerAvailability(game);
  if (!active) {
    if (status.reason && game.user.isGM) ui.notifications.warn(status.reason);
    return;
  }
  try { await installScannerIntegration(); }
  catch (error) {
    console.error(`${MODULE_ID} | Сканер`, error);
    if (game.user.isGM) ui.notifications.warn('Не удалось связать сканер с бросками. Точки доступа можно открыть вручную с левой панели.');
  }
  try { await ensureTemplates(); }
  catch (error) { console.error(`${MODULE_ID} | Шаблоны точек`, error); if (game.user.isGM) ui.notifications.error('Не удалось создать шаблоны точек доступа. Проверьте журнал ошибок.'); }
  if (canvas.ready) { presentation.queueRefresh(); cameras.queueRefresh(); }
});
