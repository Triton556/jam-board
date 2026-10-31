let bridge: import("./mock-bridge").MockBridge | undefined;
export function installMockBridge(value: import("./mock-bridge").MockBridge) {
  bridge = value;
}
export function currentMockBridge() {
  if (!bridge) throw new Error("The mock bridge is not initialized");
  return bridge;
}

/** Lazy access avoids a singleton import cycle; every property belongs to the bridge instance. */
export function mockAdapter<T extends object>(source: () => T): T {
  return new Proxy({} as T, {
    get: (_target, key) => Reflect.get(source(), key),
    set: (_target, key, value) => Reflect.set(source(), key, value),
    defineProperty: (_target, key, descriptor) =>
      Reflect.defineProperty(source(), key, descriptor),
    deleteProperty: (_target, key) => Reflect.deleteProperty(source(), key),
    getOwnPropertyDescriptor: (_target, key) =>
      Reflect.getOwnPropertyDescriptor(source(), key),
    getPrototypeOf: () => Reflect.getPrototypeOf(source()),
    ownKeys: () => Reflect.ownKeys(source()),
  });
}
