import { useContext } from 'react';
import type { FeatureFlagValue } from '@f9g/core';
import type {Metadata} from '@f9g/adapter-firebase-rn';
import { FeatureFlagContext } from './Context';
import useConfig from './useConfig';

export const UNSAFE_useFeatureFlag = (flagName: string, parser?: (rawValue: Metadata) => string | boolean | number): FeatureFlagValue<Metadata> => {
  const {adapter} = useContext(FeatureFlagContext);
  const valFromUseConfig = useConfig(flagName, parser)

  if (!adapter) {
    throw new Error('featureFlag Provider is missing');
  }
  
  return valFromUseConfig
  // return val
};
