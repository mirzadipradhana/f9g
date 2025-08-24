import {ReactNode} from 'react';
import {IFeatureFlag, IFeatureFlagAdapterClient} from '@f9g/core';
import { FeatureFlagValue } from '@f9g/core';

interface IFeatureFlagStatus {
  isInit: boolean;
  isReady: boolean;
}

type SerializedFeatureFlagValue<T> = {
  value: string
  name: string
  metadata: FeatureFlagValue<T>
}

export interface IFeatureFlagContextValues<T> extends IFeatureFlagStatus {
  adapter?: IFeatureFlagAdapterClient<T>;
  subscribe: (callback: () => void) => void;
  getAll: () => {
    [key: string]: SerializedFeatureFlagValue<T>
  };
  get: (key: string) => SerializedFeatureFlagValue<T>;
}

export interface ProviderProps<T> {
  client: IFeatureFlagAdapterClient<T>;
  children: ReactNode;
}
