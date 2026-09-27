import { apData, pulseProgress } from "./model.js";
import { setting, pulseLabel } from "./settings.js";
export const CONTROL_OPTIONS = [
  { key: "runner", group: "reveal", label: "Показать нетраннеру" },
  { key: "all", group: "reveal", label: "Показать всем" },
  { key: "five", group: "pulse", get label() { return pulseLabel(); } },
  { key: "loop", group: "pulse", label: "Повторять импульсы" },
  { key: "showName", group: "showName", label: "Показать название" },
];
export const visibleControls = () => CONTROL_OPTIONS.filter(option => option.key !== "all" || setting("showRevealAll") !== false);

export function controlState(doc, now, runnerUuid = undefined) {
  const { discovery, pulse } = apData(doc);
  const active = discovery?.revealed && pulseProgress(pulse, now) !== null;
  return { runner: Boolean(discovery?.revealed && !discovery.public && (runnerUuid === undefined || (runnerUuid && discovery.runners?.includes(runnerUuid)))), all: Boolean(discovery?.revealed && discovery.public),
    five: Boolean(active && !pulse.loop), loop: Boolean(active && pulse.loop), showName: Boolean(apData(doc).showName ?? setting("showLabels")) };
}
export function bulkControls(documents, changes, now, runnerUuid = undefined) {
  const states = documents.map(doc => controlState(doc, now, runnerUuid));
  return visibleControls().map(option => {
    const count = states.filter(state => state[option.key]).length;
    const dirty = changes[option.group] !== undefined;
    return { ...option, checked: dirty ? (option.group === "showName" ? changes.showName : changes[option.group] === option.key) : states.length > 0 && count === states.length,
      mixed: !dirty && count > 0 && count < states.length };
  });
}
export function controlChange(group, key, checked) {
  if (group === "showName") return { showName: checked };
  if (group === "reveal" && key === "runner" && !checked) return { reveal: "removeRunner" };
  return { [group]: checked ? key : group === "reveal" ? "hidden" : "off" };
}
