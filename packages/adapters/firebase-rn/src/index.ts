import {EVENTS} from '@f9g/core';
import type {
  IFeatureFlagAdapterClient,
  FeatureFlagValue,
  FeatureFlagPollStrategy,
} from '@f9g/core';
import type {IConfig as IFirebaseRemoteConfigConfig, Metadata} from './types';
import Client from '@react-native-firebase/remote-config';
import type {FirebaseRemoteConfigTypes} from '@react-native-firebase/remote-config';
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
  client: FirebaseRemoteConfigTypes.Module;
  opts: IFirebaseRemoteConfigConfig;
  isReady: boolean;
  isInit: boolean;
  pollInterval?: ReturnType<typeof setInterval> 

  SUPPORTED_STRATEGY_TYPES = {
    init: 'init',
    poll: 'poll'
  };

  constructor(opts: IFirebaseRemoteConfigConfig) {
    super();
    this._checkValidStrategy(opts.strategy?.type);

    this.opts = opts;
    this.client = Client();
    this.isInit = false;
    this.isReady = false;

    this.pollInterval = null;
  }
  
  _values = []

  public start = async (): Promise<boolean> => {
    if (!this.client) {
      return undefined
    }

    if (this.client.lastFetchStatus) {
      this.emit(EVENTS.INIT);
      await this.client.fetchAndActivate()
      return Promise.resolve(true)
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
    })
  };

  private _handleStartInit = async (): Promise<void> => {
    if (!this.client.lastFetchStatus) {
      await this.client.setDefaults(this.opts.defaultValue || {});
    }

    this._handleStartFetch();
  };

  private _handleStartPolling = async (): Promise<void> => {
    const strategy = this.opts.strategy as FeatureFlagPollStrategy;
    const interval = strategy.pollInterval || DEFAULT_POLL_INTERVAL;
    if (!this.client.lastFetchStatus) {

      await this.client.setDefaults(this.opts.defaultValue || {});
      await this.client.setConfigSettings({
        minimumFetchIntervalMillis: interval - 1000
      });
    }

    this._handleStartFetch()

    this.pollInterval = setInterval(() => {
      if (!this.isReady) {
        return
      }

      this._handleStartFetch()
    }, interval)
  };

  private _handleStopFetch = (): Promise<void> => {
    return this.client.ensureInitialized().then(() => this.client.reset());
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
    const flag = this.client.getValue(flagName);
    return asBoolean(flag);
  };

  public getFlag = (flagName, parser) => {
    const flag = this.client.getValue(flagName);
    return flag ? this._massageData(parser)([flagName, flag]) : undefined;
  };

  private fetchFlags = (): Promise<FeatureFlagValue<Metadata>[]> => {
    return new Promise(async (resolve, reject) => {
      try {
        const newLocalValuesWereActivated = await this.client.fetchAndActivate()
        const flags = this.client.getAll();
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
