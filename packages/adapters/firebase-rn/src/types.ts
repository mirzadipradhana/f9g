import {FeatureFlagInitStrategy, FeatureFlagPollStrategy} from '@f9g/core';
import {FirebaseRemoteConfigTypes} from '@react-native-firebase/remote-config';

export interface IConfig extends FirebaseRemoteConfigTypes.ConfigSettings {
  strategy: FeatureFlagInitStrategy | FeatureFlagPollStrategy;
  defaultValue?: Record<string, string | number | boolean>;
  retryInterval?: number;
}

export type Strategy = {
  name: string;
  parameters: Record<string, string | number | boolean>;
};

export interface Metadata extends FirebaseRemoteConfigTypes.ConfigValue {
}
