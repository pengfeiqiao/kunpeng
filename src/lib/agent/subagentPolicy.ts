export function isSubagentEntryView(activeView: string): boolean {
  return activeView === 'chat';
}

export function isOrdinarySubagentRun(
  isPrimary: boolean,
  hasWorkspaceSurface: boolean,
  activeView: string,
): boolean {
  return isPrimary && !hasWorkspaceSurface && isSubagentEntryView(activeView);
}
