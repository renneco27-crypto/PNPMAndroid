import { registerPlugin } from '@capacitor/core';

export interface OneSignalBridgePlugin {
  login(options: { externalId: string }): Promise<void>;
  logout(): Promise<void>;
  setEmail(options: { email: string }): Promise<void>;
  setTag(options: { key: string; value: string }): Promise<void>;
  getSubscriptionId(): Promise<{ subscriptionId: string }>;
}

const OneSignalBridge = registerPlugin<OneSignalBridgePlugin>('OneSignalBridge');

export { OneSignalBridge };
