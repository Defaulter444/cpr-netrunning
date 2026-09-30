/** Local observations of the already filtered view-model. Never reads world stores. */
export const CONSOLE_LOG_LIMIT = 40;

export function consoleSnapshot(data) {
  const action = data.actions ?? {};
  const floors = (data.canvas?.empty ? [] : data.canvas?.floors) ?? [];
  return {
    scope: `${data.canvas?.archId ?? ''}|${action.pid ?? ''}`,
    runner: action.variant === 'runner', connected: !!action.jackedIn,
    floor: action.floorIndex, actions: action.actionsValue,
    floors: floors.filter(f => !f.encrypted).map(f => ({
      index: f.index, label: String(f.label ?? ''), breached: !!f.markers?.breached,
    })),
    programs: (action.programs ?? []).map(p => ({id:p.id, name:p.name, rezzed:!!p.rezzed})),
    nodes: (action.controlNodes ?? []).map(n => ({id:n.floorId, label:n.label})),
  };
}

export function consoleChanges(before, after) {
  if (!before || before.scope !== after.scope) return [];
  const events = [];
  const add = (key, tone, values = {}, floor = null) => events.push({key, tone, values, floor});
  if (after.runner && before.connected !== after.connected)
    add(after.connected ? 'Connected' : 'Disconnected', after.connected ? 'success' : 'neutral');
  if (after.runner && before.connected && after.connected && before.floor !== after.floor) {
    const floor = after.floors.find(f => f.index === after.floor);
    // No indices or labels from undiscovered floors go into the local journal.
    add('Moved', 'success', {floor: floor?.label || '—'}, floor?.index ?? null);
  }
  if (after.runner && before.connected && after.connected && Number.isFinite(before.actions)
      && Number.isFinite(after.actions) && before.actions !== after.actions)
    add('ActionsChanged', after.actions > before.actions ? 'success' : 'neutral', {value:after.actions});
  const oldFloors = new Map(before.floors.map(f => [f.index, f]));
  for (const floor of after.floors) {
    const old = oldFloors.get(floor.index);
    if (!old) add('Discovered', 'success', {floor:floor.label}, floor.index);
    else if (!old.breached && floor.breached) add('Breached', 'success', {floor:floor.label}, floor.index);
  }
  const oldPrograms = new Map(before.programs.map(p => [p.id, p]));
  for (const program of after.programs) {
    const old = oldPrograms.get(program.id);
    if (old && old.rezzed !== program.rezzed)
      add(program.rezzed ? 'ProgramOn' : 'ProgramOff', program.rezzed ? 'success' : 'neutral', {name:program.name});
  }
  const oldNodes = new Map(before.nodes.map(n => [n.id,n]));
  const newNodes = new Set(after.nodes.map(n => n.id));
  for (const node of after.nodes) if (!oldNodes.has(node.id)) add('ControlTaken','success',{name:node.label});
  for (const node of before.nodes) if (!newNodes.has(node.id)) add('ControlReleased','neutral',{name:node.label});
  return events;
}

export function appendConsoleEvents(events, added, stamp = new Date().toISOString()) {
  return [...events, ...added.map(event => ({...event, stamp}))].slice(-CONSOLE_LOG_LIMIT);
}

export function consoleFloorSummary(canvas, index) {
  const floor = !canvas?.empty && canvas?.floors?.find(f => f.index === index);
  if (!floor) return null;
  if (floor.encrypted) return {encrypted:true};
  return {
    encrypted:false, label:floor.label, number:floor.number,
    breached:!!floor.markers?.breached, controlled:!!floor.markers?.control,
    checkLabel:floor.checkLabel || '', showDv:!!floor.showDv, dv:floor.showDv ? floor.dv : null,
    entities:(floor.entities ?? []).map(e => ({name:e.name,img:e.img})),
  };
}
