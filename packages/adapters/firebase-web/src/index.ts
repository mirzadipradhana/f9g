import {EVENTS} from '@f9g/core';
import type {
  IFeatureFlagAdapterClient,
  FeatureFlagValue,
  FeatureFlagPollStrategy,
} from '@f9g/core';
import type {IConfig as IFirebaseRemoteConfigConfig, Metadata} from './types';
import { FirebaseApp, initializeApp } from "firebase/app";
import { activate, ensureInitialized, fetchAndActivate, getAll, getRemoteConfig, getValue, isSupported as isRemoteConfigSupproted, RemoteConfig } from "firebase/remote-config";
import {TinyEmitter} from 'tiny-emitter';

export * from './types';

const DEFAULT_RETRY_INTERVAL = 1 * 60000;
const DEFAULT_POLL_INTERVAL = 15 * 60000;
const SUPPORTED_STRATEGY_TYPES = ['init', 'poll'];

type Pair<T, K> = [T, K];

const asString = (raw: Metadata): string => raw?.asString();

const asBoolean = (raw: Metadata): boolean => raw?.asBoolean();

export default class FirebaseRemoteConfig
  extends TinyEmitter
  implements IFeatureFlagAdapterClient<Metadata>
{
  app: FirebaseApp;
  client: RemoteConfig;
  opts: IFirebaseRemoteConfigConfig;
  isSupported: boolean;
  isReady: boolean;
  isInit: boolean;
  pollInterval?: ReturnType<typeof setInterval>;

  SUPPORTED_STRATEGY_TYPES = {
    init: 'init',
    poll: 'poll'
  };

  constructor(opts: IFirebaseRemoteConfigConfig) {
    super();
    this._checkValidStrategy(opts.strategy?.type);

    this.opts = opts;
    
    isRemoteConfigSupproted().then((isSupported) => {
      if (isSupported) {
        this.app = initializeApp({
          apiKey: opts.apiKey,
          authDomain: opts.authDomain,
          projectId: opts.projectId,
          storageBucket: opts.storageBucket,
          messagingSenderId: opts.messagingSenderId,
          appId: opts.appId,
          measurementId: opts.measurementId,
        });
        
        this.client = getRemoteConfig(this.app);
        this.isSupported = true;

        this.emit(EVENTS.INIT);
      }
    })
    
    this.once(EVENTS.INIT, () => {
      this.isInit = true;
    });
    
    this.opts = opts;
    this.isSupported = false;
    this.isInit = false;
    this.isReady = false;

    this.pollInterval = null;
  }

  _values = []
  
  public start = async (): Promise<boolean> => {
    return this.init().then(async () => {
      if (!this.client) {
        return undefined
      }
  
      const {strategy} = this.opts;
      switch (strategy.type) {
        case this.SUPPORTED_STRATEGY_TYPES.init:
          this._handleStartInit()
          return Promise.resolve(true)
        case this.SUPPORTED_STRATEGY_TYPES.poll:
          this._handleStartPolling()
          return Promise.resolve(true)
        default:
          throw new Error(
            `Strategy is unrecognize! Gitlab adapter only support ${Object.keys(
              this.SUPPORTED_STRATEGY_TYPES
            ).join(', ')}`
          );
      }
    })
  };

  public stop = (): Promise<void> => {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
    }

    return this._handleStopFetch();
  };

  public init = (): Promise<void> => {
    return new Promise(resolve => {
      if (this.isInit) {
        return resolve();
      }

      this.once(EVENTS.INIT, () => {
        this.isInit = true
        return resolve()
      });
    });
  };

  public ready = (): Promise<FeatureFlagValue<Metadata>[]> => {
    return new Promise(resolve => {
      if (this.isReady) {
        return resolve(this._values);
      }
      
      this.once(EVENTS.READY, (values) => {
        this.isReady = true
        return resolve(values)
      });
    })
  };

  private _handleStartFetch = async (): Promise<void | FeatureFlagValue<Metadata>[]> => {
    this.isInit = true;
    this.emit(EVENTS.INIT);

    return this.fetchFlags().then((values: FeatureFlagValue<Metadata>[]) => {
      if (!this.isReady) {
        this.isReady = true;
        this.emit(EVENTS.READY, values);
      }
      return values
    }).catch(e => {
      if (!this.isReady) {
        setTimeout(() => {
          return this._handleStartFetch()
        }, this.opts.retryInterval || DEFAULT_RETRY_INTERVAL)
      }
    });
  };

  private _handleStartInit = async (): Promise<void> => {
    if (!this.client.lastFetchStatus) {
      this.client.defaultConfig = this.opts.defaultValue || {};
      this.client.settings = {
        ...this.client.settings,
        minimumFetchIntervalMillis: this.opts.minimumFetchIntervalMillis || 43200000
      };
    }

    this._handleStartFetch();
  };

  private _handleStartPolling = async (): Promise<void> => {
    const strategy = this.opts.strategy as FeatureFlagPollStrategy;
    const interval = strategy.pollInterval || DEFAULT_POLL_INTERVAL;

    if (!this.client.lastFetchStatus || this.client.lastFetchStatus !== 'success') {
      this.client.defaultConfig = this.opts.defaultValue || {};
      this.client.settings = {
        ...this.client.settings,
        minimumFetchIntervalMillis: this.opts.minimumFetchIntervalMillis || (interval - 1000)
      };
    }

    this._handleStartFetch()

    this.pollInterval = setInterval(() => {
      if (!this.isReady) {
        return
      }

      this._handleStartFetch()
    }, interval);
  };

  private _handleStopFetch = (): Promise<void> => {
    return ensureInitialized(this.client);
  };

  private _checkValidStrategy(type: string) {
    if (!SUPPORTED_STRATEGY_TYPES.includes(type)) {
      throw Error('[f9g] No type provided or type is not supported!');
    }
  }

  private _massageData =
    (parser: (rawValue: Metadata) => string | boolean | number) =>
    (original: Pair<string, Metadata>): FeatureFlagValue<Metadata> => {
      const [key, entry] = original;
      return {
        value: parser ? parser(entry) : asString(entry),
        name: key,
        metadata: entry
      };
    };

  public isEnabled = (flagName: string) => {
    if (!this.client) {
      return undefined
    }
    
    const flag = getValue(this.client, flagName);
    return asBoolean(flag);
  };

  public getFlag = (flagName, parser) => {
    if (!this.client) {
      return undefined
    }

    const flag = getValue(this.client, flagName);
    return flag ? this._massageData(parser)([flagName, flag]) : undefined;
  };

  private fetchFlags = (): Promise<FeatureFlagValue<Metadata>[]> => {
    return new Promise(async (resolve, reject) => {
      try {
        const newLocalValuesWereActivated = await fetchAndActivate(this.client)
        const flags = getAll(this.client);
        const massagedFlags = Object.entries(flags)
          .map(this._massageData(asString)) as FeatureFlagValue<Metadata>[];
        
        this._values = massagedFlags
        if (newLocalValuesWereActivated) {
          this.emit(EVENTS.UPDATE, massagedFlags);
          return resolve(massagedFlags);
        }
        return resolve(massagedFlags);
      } catch (e) {
        return reject(e)
      }
    });
  };
}

export * from './types';
