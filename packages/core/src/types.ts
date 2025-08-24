import {TinyEmitter} from 'tiny-emitter';

export type EVENTS = {
  READY: string;
  UPDATE: string;
};
export interface FeatureFlagContext<T> {
  adapter: IFeatureFlagAdapterClient<T>;
  isInit: boolean;
  isReady: boolean;
  flags?: Record<string, FeatureFlagValue<T>>;
}

export type FeatureFlagValue<T> = {
  name: string;
  value: string | number | boolean;
  metadata: T;
};

export type FeatureFlagInitStrategy = {
  type: 'init';
};

export type FeatureFlagPollStrategy = {
  type: 'poll';
  pollInterval: number;
};

export type FeatureFlagSseStrategy = {
  type: 'sse';
  pollInterval: number;
  ttl: number;
  reconnectInterval: number;
};

export interface IFeatureFlagAdapterClient<T> extends TinyEmitter, IFeatureFlag<T> {}
export interface IFeatureFlag<T> {
  start: () => Promise<boolean | void>;
  stop: () => Promise<void>;
  init: () => Promise<void>;
  ready: () => Promise<FeatureFlagValue<T>[] | void>;
  isEnabled: (flagName: string) => boolean;
  getFlag: (flagName: string, parser?: (rawValue: T) => string | boolean | number) => FeatureFlagValue<T> | undefined;
  getContext?: () => FeatureFlagContext<T>;
}

export interface IFeatureFlagConfig<T> {
  adapter: IFeatureFlagAdapterClient<T>;
}

export interface IMetadata {
  getSource(): 'remote' | 'default' | 'static';
  asBoolean(): true | false;
  asNumber(): number;
  asString(): string;
}