let currentSessionID: string | undefined;

export function setCurrentSessionID(id: string | undefined): void {
  currentSessionID = id;
}

export function getCurrentSessionID(): string | undefined {
  return currentSessionID;
}
