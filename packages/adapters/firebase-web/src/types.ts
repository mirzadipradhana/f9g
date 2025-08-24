import { FeatureFlagInitStrategy, FeatureFlagPollStrategy } from '@f9g/core';
import { Value, RemoteConfigSettings } from "firebase/remote-config";

export interface IConfig extends RemoteConfigSettings {
  apiKey: string,
  authDomain: string,
  projectId: string,
  storageBucket: string,
  messagingSenderId: string,
  appId: string,
  measurementId: string,
  strategy: FeatureFlagInitStrategy | FeatureFlagPollStrategy;
  defaultValue?: Record<string, string | number | boolean>;
  retryInterval?: number;
}

export type Strategy = {
  name: string;
  parameters: Record<string, string | number | boolean>;
};

export type Metadata = Value;
