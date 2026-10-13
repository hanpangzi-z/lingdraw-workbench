export const PPT_ACTIVATE_EVENT = "ppt:activate";

interface ActivationTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export function listenForPptActivation(target: ActivationTarget, callback: () => void) {
  const listener: EventListener = () => callback();
  target.addEventListener(PPT_ACTIVATE_EVENT, listener);
  return () => target.removeEventListener(PPT_ACTIVATE_EVENT, listener);
}
