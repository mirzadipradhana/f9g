import { TinyEmitter } from 'tiny-emitter';
import {EVENTS} from './constants';
import {
  IFeatureFlagAdapterClient,
  IFeatureFlag,
  IFeatureFlagConfig,
  IMetadata,
  FeatureFlagValue,
  FeatureFlagContext,
} from './types';

export * from './types';
export {EVENTS} from './constants';

export const asBoolean = (raw: IMetadata): boolean => raw?.asBoolean();

export const asString = (raw: IMetadata): string => raw?.asString();

export const asNumber = (raw: IMetadata): number => raw?.asNumber();

class FeatureFlagValidator {
  static validateFlagValue<T>(value: any): value is FeatureFlagValue<T> {
    if (!value || typeof value !== 'object') {
      return false;
    }

    // Check required properties
    if (!value.name || typeof value.name !== 'string' || value.name.trim().length === 0) {
      return false;
    }

    // Value can be string, number, or boolean
    const valueType = typeof value.value;
    if (valueType !== 'string' && valueType !== 'number' && valueType !== 'boolean') {
      return false;
    }

    // Metadata is required but can be any type
    if (value.metadata === undefined) {
      return false;
    }

    return true;
  }

  static validateFlagArray<T>(values: any): FeatureFlagValue<T>[] {
    if (!Array.isArray(values)) {
      console.warn('[FeatureFlagValidator] Expected array, got:', typeof values);
      return [];
    }

    const validFlags: FeatureFlagValue<T>[] = [];
    const invalidFlags: any[] = [];

    values.forEach((value, index) => {
      if (this.validateFlagValue<T>(value)) {
        validFlags.push(value);
      } else {
        invalidFlags.push({ index, value });
      }
    });

    // Log warnings for invalid flags
    if (invalidFlags.length > 0) {
      console.warn('[FeatureFlagValidator] Invalid flag values ignored:', invalidFlags);
    }

    return validFlags;
  }

  static validateFlagName(name: any): name is string {
    return typeof name === 'string' && name.trim().length > 0;
  }

  static validateParser<T>(parser: any): parser is (rawValue: T) => string | boolean | number {
    return typeof parser === 'function';
  }

  static sanitizeFlagName(name: string): string {
    if (typeof name !== 'string') {
      return '';
    }
    
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-zA-Z0-9_-]/g, '_') // Replace invalid chars with underscore
      .replace(/_{2,}/g, '_') // Replace multiple underscores with single
      .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
  }

  static validateConfig<T>(config: any): config is IFeatureFlagConfig<T> {
    if (!config || typeof config !== 'object') {
      return false;
    }

    if (!config.adapter || typeof config.adapter !== 'object') {
      return false;
    }

    // Check if adapter has required methods
    const requiredMethods = ['start', 'stop', 'init', 'ready', 'isEnabled', 'getFlag'];
    const hasAllMethods = requiredMethods.every(method => 
      typeof config.adapter[method] === 'function'
    );

    if (!hasAllMethods) {
      console.error('[FeatureFlagValidator] Adapter missing required methods:', 
        requiredMethods.filter(method => typeof config.adapter[method] !== 'function')
      );
      return false;
    }

    return true;
  }
}

class FeatureFlagStateManager<T> {
  private _flags: Map<string, FeatureFlagValue<T>> = new Map();
  private _isReady: boolean = false;

  setFlags(flags: FeatureFlagValue<T>[]): void {
    this._flags.clear();
    
    const validatedFlags = FeatureFlagValidator.validateFlagArray<T>(flags);
    
    validatedFlags.forEach(flag => {
      const sanitizedName = FeatureFlagValidator.sanitizeFlagName(flag.name);
      if (sanitizedName) {
        this._flags.set(sanitizedName, {
          ...flag,
          name: sanitizedName
        });
      }
    });
    
    this._isReady = true;
  }

  getFlag(name: string): FeatureFlagValue<T> | undefined {
    if (!FeatureFlagValidator.validateFlagName(name)) {
      return undefined;
    }
    
    const sanitizedName = FeatureFlagValidator.sanitizeFlagName(name);
    return this._flags.get(sanitizedName);
  }

  isEnabled(name: string): boolean {
    if (!FeatureFlagValidator.validateFlagName(name)) {
      return false;
    }
    
    const sanitizedName = FeatureFlagValidator.sanitizeFlagName(name);
    const flag = this._flags.get(sanitizedName);
    return flag ? Boolean(flag.value) : false;
  }

  getAllFlags(): FeatureFlagValue<T>[] {
    return Array.from(this._flags.values());
  }

  getAllFlagsAsRecord(): Record<string, FeatureFlagValue<T>> {
    const result: Record<string, FeatureFlagValue<T>> = {};
    this._flags.forEach((flag, name) => {
      result[name] = flag;
    });
    return result;
  }

  isReady(): boolean {
    return this._isReady;
  }

  getFlagCount(): number {
    return this._flags.size;
  }

  clear(): void {
    this._flags.clear();
    this._isReady = false;
  }
}

export class FeatureFlag<T> extends TinyEmitter implements IFeatureFlag<T> {
  adapter: IFeatureFlagAdapterClient<T>;
  isInit: boolean;
  isReady: boolean;
  private stateManager = new FeatureFlagStateManager<T>();
  private errorCount: number = 0;
  private maxRetries: number = 3;

  constructor(opts: IFeatureFlagConfig<T>) {
    super();
    
    // Validate configuration
    if (!FeatureFlagValidator.validateConfig(opts)) {
      throw new Error('Invalid FeatureFlag configuration provided');
    }
    
    this.adapter = opts.adapter;
    this.isReady = false;
    this.isInit = false;

    this.adapter.once(EVENTS.INIT, () => {
      this.isInit = true;
    });

    this.adapter.once(EVENTS.READY, (values: FeatureFlagValue<T>[]) => {
      try {
        this.isReady = true;
        this.errorCount = 0; // Reset error count on successful ready
        this._handleReady(values);
      } catch (error) {
        this._handleError('READY event processing failed', error);
      }
    });

    this.adapter.on(EVENTS.UPDATE, (values: FeatureFlagValue<T>[]) => {
      try {
        this._handleUpdate(values);
      } catch (error) {
        this._handleError('UPDATE event processing failed', error);
      }
    });
  }

  public getContext = (): FeatureFlagContext<T> => ({
    adapter: this.adapter,
    isInit: this.isInit,
    isReady: this.isReady,
    flags: this.stateManager.getAllFlagsAsRecord()
  });

  public init = (): Promise<void> => {
    if (this.isInit) {
      return Promise.resolve();
    }

    return this.adapter.init();
  };

  public ready = async (): Promise<FeatureFlagValue<T>[] | void> => {
    if (this.stateManager.isReady()) {
      return this.stateManager.getAllFlags();
    }

    try {
      const values = await this.adapter.ready();
      if (values) {
        this._handleReady(values);
        this.errorCount = 0; // Reset on success
        return this.stateManager.getAllFlags();
      }
      return [];
    } catch (error) {
      this.errorCount++;
      this.emit('error', error);
      
      if (this.errorCount <= this.maxRetries) {
        console.warn(`Feature flag retry ${this.errorCount}/${this.maxRetries}:`, error);
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, this.errorCount) * 1000));
        return this.ready(); // Retry
      }
      
      console.error('Feature flag initialization failed after retries:', error);
      this._handleError('ready() failed after retries', error);
      return []; // Graceful degradation
    }
  };

  public isEnabled(flagName: string): boolean {
    try {
      // Validate flag name
      if (!FeatureFlagValidator.validateFlagName(flagName)) {
        this._handleError(`Invalid flag name: ${flagName}`, new Error('Flag name must be a non-empty string'));
        return false;
      }

      if (!this.stateManager.isReady()) {
        // Fallback to adapter if state manager not ready
        return this.adapter.isEnabled(flagName) || false;
      }
      return this.stateManager.isEnabled(flagName);
    } catch (error) {
      this._handleError(`Error checking flag ${flagName}`, error);
      return false; // Safe default
    }
  }

  public getFlag(flagName: string, parser?: (rawValue: T) => string | boolean | number): FeatureFlagValue<T> | undefined {
    try {
      // Validate inputs
      if (!FeatureFlagValidator.validateFlagName(flagName)) {
        this._handleError(`Invalid flag name: ${flagName}`, new Error('Flag name must be a non-empty string'));
        return undefined;
      }

      if (parser && !FeatureFlagValidator.validateParser(parser)) {
        this._handleError(`Invalid parser for flag ${flagName}`, new Error('Parser must be a function'));
        return undefined;
      }

      if (!this.stateManager.isReady()) {
        // Fallback to adapter if state manager not ready
        return this.adapter.getFlag(flagName, parser);
      }
      
      const flag = this.stateManager.getFlag(flagName);
      if (flag && parser) {
        try {
          // Apply parser to transform the value if provided
          const parsedValue = parser(flag.metadata);
          return {
            ...flag,
            value: parsedValue
          };
        } catch (parserError) {
          this._handleError(`Parser error for flag ${flagName}`, parserError);
          return flag; // Return original flag if parser fails
        }
      }
      return flag;
    } catch (error) {
      this._handleError(`Error getting flag ${flagName}`, error);
      return undefined; // Safe default
    }
  }

  public async start(): Promise<boolean | void> {
    try {
      const result = await this.adapter.start();
      this.errorCount = 0; // Reset error count on successful start
      return result;
    } catch (error) {
      this._handleError('start() failed', error);
      throw error; // Re-throw to allow caller to handle
    }
  }

  public async stop(): Promise<void> {
    try {
      await this.adapter.stop();
      this.stateManager.clear(); // Clear state on stop
    } catch (error) {
      this._handleError('stop() failed', error);
      throw error; // Re-throw to allow caller to handle
    }
  }

  private _handleReady(values: FeatureFlagValue<T>[]): void {
    if (!Array.isArray(values)) {
      throw new Error('Invalid values provided to _handleReady: expected array');
    }

    // Additional validation happens in stateManager.setFlags()
    this.stateManager.setFlags(values);
    const flags = this.stateManager.getAllFlagsAsRecord();
    
    // Log successful initialization stats
    const flagCount = this.stateManager.getFlagCount();
    console.info(`[FeatureFlag] Ready: ${flagCount} flags loaded successfully`);
    
    this.emit(EVENTS.READY, flags);
  }

  private _handleUpdate(values: FeatureFlagValue<T>[]): void {
    if (!Array.isArray(values)) {
      console.warn('Invalid values provided to _handleUpdate: expected array');
      return;
    }

    this.stateManager.setFlags(values);
    const flags = this.stateManager.getAllFlagsAsRecord();
    this.emit(EVENTS.UPDATE, flags);
  }

  private _handleError(context: string, error: any): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[FeatureFlag] ${context}: ${errorMessage}`);
    
    // Emit error event for external error handling
    this.emit('error', {
      context,
      error,
      timestamp: new Date().toISOString(),
      errorCount: this.errorCount,
      maxRetries: this.maxRetries
    });
  }
}

export class FeatureFlagExecutor<T> {
  constructor(private adapter: IFeatureFlag<T>) {}

  when(flagName: string) {
    return new FeatureFlagCondition(this.adapter, flagName);
  }

  getFlag(flagName: string, parser?: (rawValue: T) => string | boolean | number) {
    return this.adapter.getFlag(flagName, parser);
  }

  isEnabled(flagName: string): boolean {
    return this.adapter.isEnabled(flagName);
  }

  getContext() {
    return this.adapter.getContext?.() || { isInit: false, isReady: false };
  }
}

class FeatureFlagCondition<T> {
  constructor(
    private adapter: IFeatureFlag<T>,
    private flagName: string
  ) {}

  enabled<R>(fn: () => R) {
    return {
      otherwise: (fallbackFn: () => R): R => {
        try {
          if (!this.adapter) {
            console.warn('[FeatureFlagExecutor] Adapter not available, using fallback');
            return fallbackFn();
          }

          if (this.adapter.isEnabled(this.flagName)) {
            return fn();
          }

          return fallbackFn();
        } catch (error) {
          console.error(`[FeatureFlagExecutor] Error executing flag '${this.flagName}':`, error);
          return fallbackFn(); // Safe fallback on error
        }
      },

      orNothing: (): R | undefined => {
        try {
          if (!this.adapter) {
            console.warn('[FeatureFlagExecutor] Adapter not available');
            return undefined;
          }

          if (this.adapter.isEnabled(this.flagName)) {
            return fn();
          }

          return undefined;
        } catch (error) {
          console.error(`[FeatureFlagExecutor] Error executing flag '${this.flagName}':`, error);
          return undefined;
        }
      }
    };
  }

  disabled<R>(fn: () => R) {
    return {
      otherwise: (fallbackFn: () => R): R => {
        try {
          if (!this.adapter) {
            console.warn('[FeatureFlagExecutor] Adapter not available, using fallback');
            return fallbackFn();
          }

          if (!this.adapter.isEnabled(this.flagName)) {
            return fn();
          }

          return fallbackFn();
        } catch (error) {
          console.error(`[FeatureFlagExecutor] Error executing flag '${this.flagName}':`, error);
          return fallbackFn();
        }
      }
    };
  }
}

export const createFeatureFlagFn =
  <T1, T2>(adapter: IFeatureFlag<T1>) =>
  (name: string) =>
  (fallbackFn: (a?: T1) => T2 | undefined) =>
  (fn: (a?: T1) => T2 | undefined) =>
  (a?: T1) => {
    console.warn('[createFeatureFlagFn] This function is deprecated. Use FeatureFlagExecutor instead.');
    
    if (!adapter) {
      console.warn('undefined context, make sure instance FeatureFlag has been initiated');
      return fallbackFn(a);
    }

    if (adapter.isEnabled(name)) {
      return fn(a);
    }

    return fallbackFn(a);
  };

export default FeatureFlag;
