import React, {useState, useRef, useEffect, useCallback} from 'react';
import type {Metadata as FirebaseMetadata} from '@f9g/adapter-firebase-rn';
import { EVENTS } from '@f9g/core';
import equal from 'fast-deep-equal/es6';
import {ProviderProps} from './types';
import {FeatureFlagContext} from './Context';

export const FeatureFlagProvider: React.FC<ProviderProps<FirebaseMetadata>> = ({
  children,
  client
}) => {
  const [isInit, setInit] = useState(false);
  const [isReady, setReady] = useState(false);

  const subscribers = useRef(new Set<() => void>());
  const configsState = useRef({});

  const getAll = useCallback(() => configsState.current, []);
  const get = useCallback((key) => {
    return configsState.current && configsState.current[key]
  }, []);
  const set = useCallback((values) => {
    configsState.current = { ...configsState.current, ...values };
    subscribers.current.forEach((callback) => callback());
  }, []);
  
  const subscribe = useCallback((callback: () => void) => {
    subscribers.current.add(callback);
    return () => subscribers.current.delete(callback);
  }, []);

  // initialize the client instance
  const initState = () => {
    client
      .init()
      .then(() => {
        if (!isInit) {
          setInit(true);
          readyState();
        }
      })
      .catch((e) => console.log('ERR[init]', e));
  }

  // initialize the client instance
  const readyState = () => {
    client
      .ready()
      .then((values) => {
        if (!isReady) {
          const isValueChanged = !equal(configsState.current, values)

          if (isValueChanged) {
            const prevValues = getAll()
            set({...prevValues, ...values})
          }
          setReady(true);
        }
      })
      .catch((e) => console.log('ERR[ready]', e));
  }

  // call start adapter
  useEffect(() => {
    client.start().then(() => {
      initState();
    });

    return () => {
      client
        .stop()
        .catch((e) => console.error(e));
    };
  }, []);
  
  useEffect(() => {
    client.on(EVENTS.UPDATE, (values) => {
      const isValueChanged = !equal(getAll(), values)

      if (!isReady) {
        setReady(true)
      }

      if (isValueChanged) {
        const prevValues = getAll()
        set({ ...prevValues, ...values })
      }
    });
  }, [])

  return (
    <FeatureFlagContext.Provider value={{adapter: client, isInit, isReady, subscribe, getAll, get}}>
      {children}
    </FeatureFlagContext.Provider>
  );
};
