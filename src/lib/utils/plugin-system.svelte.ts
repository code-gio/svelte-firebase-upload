import type { UploadItem, UploadStatus, ValidationResult, UploadManagerInterface } from '../types.js';

// Plugin lifecycle hooks
export interface UploadPlugin {
	// Plugin metadata
	name: string;
	version: string;
	description?: string;

	// Lifecycle hooks
	onInitialize?: (manager: any) => Promise<void> | void;
	onDestroy?: () => Promise<void> | void;

	// File processing hooks
	beforeFileAdd?: (
		file: File,
		options: any
	) => Promise<{ file: File; options: any }> | { file: File; options: any };
	afterFileAdd?: (item: UploadItem) => Promise<void> | void;

	// Validation hooks
	beforeValidation?: (
		file: File,
		rules: any
	) => Promise<{ file: File; rules: any }> | { file: File; rules: any };
	afterValidation?: (file: File, result: ValidationResult) => Promise<void> | void;

	// Upload lifecycle hooks
	beforeUpload?: (item: UploadItem) => Promise<UploadItem> | UploadItem;
	onUploadStart?: (item: UploadItem) => Promise<void> | void;
	onUploadProgress?: (item: UploadItem, progress: number) => Promise<void> | void;
	onUploadComplete?: (item: UploadItem, result: any) => Promise<void> | void;
	onUploadError?: (item: UploadItem, error: Error) => Promise<void> | void;

	// Queue management hooks
	beforeQueueProcess?: (queue: UploadItem[]) => Promise<UploadItem[]> | UploadItem[];
	afterQueueProcess?: (queue: UploadItem[]) => Promise<void> | void;

	// State change hooks
	onStatusChange?: (
		item: UploadItem,
		oldStatus: UploadStatus,
		newStatus: UploadStatus
	) => Promise<void> | void;
	onManagerStateChange?: (state: any) => Promise<void> | void;

	// Error handling hooks
	onError?: (error: Error, context: any) => Promise<void> | void;

	// Custom methods that can be called by other plugins or the manager
	[key: string]: any;
}

// Plugin configuration
export interface PluginConfig {
	enabled: boolean;
	priority: number; // Higher priority plugins run first
	options?: Record<string, any>;
}

// Plugin registry entry
export interface PluginRegistryEntry {
	plugin: UploadPlugin;
	config: PluginConfig;
}

// Plugin event types
export type PluginEventType =
	| 'initialize'
	| 'destroy'
	| 'beforeFileAdd'
	| 'afterFileAdd'
	| 'beforeValidation'
	| 'afterValidation'
	| 'beforeUpload'
	| 'onUploadStart'
	| 'onUploadProgress'
	| 'onUploadComplete'
	| 'onUploadError'
	| 'beforeQueueProcess'
	| 'afterQueueProcess'
	| 'onStatusChange'
	| 'onManagerStateChange'
	| 'onError';

export class PluginSystem {
	private _plugins: Map<string, PluginRegistryEntry> = new Map();
	private _manager: UploadManagerInterface;
	private readonly _PLUGIN_TIMEOUT = 30000; // 30 seconds default timeout

	constructor(manager: UploadManagerInterface) {
		this._manager = manager;
	}

	// Register a plugin
	async registerPlugin(plugin: UploadPlugin, config: Partial<PluginConfig> = {}): Promise<void> {
		const pluginConfig: PluginConfig = {
			enabled: true,
			priority: 0,
			...config
		};

		// Check if plugin is already registered
		if (this._plugins.has(plugin.name)) {
			throw new Error(`Plugin '${plugin.name}' is already registered`);
		}

		// Register plugin
		this._plugins.set(plugin.name, {
			plugin,
			config: pluginConfig
		});

		// Initialize plugin if enabled
		if (pluginConfig.enabled && plugin.onInitialize) {
			try {
				await this.callPluginMethod(plugin, 'onInitialize', [this._manager]);
			} catch (error) {
				console.error(`Failed to initialize plugin '${plugin.name}':`, error);
			}
		}
	}

	// Unregister a plugin
	async unregisterPlugin(pluginName: string): Promise<void> {
		const entry = this._plugins.get(pluginName);
		if (!entry) {
			throw new Error(`Plugin '${pluginName}' is not registered`);
		}

		const { plugin } = entry;

		// Call destroy hook
		if (plugin.onDestroy) {
			try {
				await this.callPluginMethod(plugin, 'onDestroy', []);
			} catch (error) {
				console.error(`Failed to destroy plugin '${pluginName}':`, error);
			}
		}

		// Remove from registry
		this._plugins.delete(pluginName);
	}

	// Enable/disable a plugin
	async setPluginEnabled(pluginName: string, enabled: boolean): Promise<void> {
		const entry = this._plugins.get(pluginName);
		if (!entry) {
			throw new Error(`Plugin '${pluginName}' is not registered`);
		}

		entry.config.enabled = enabled;

		if (enabled && entry.plugin.onInitialize) {
			try {
				await this.callPluginMethod(entry.plugin, 'onInitialize', [this._manager]);
			} catch (error) {
				console.error(`Failed to initialize plugin '${pluginName}':`, error);
			}
		}
	}

	// Get plugin by name
	getPlugin(pluginName: string): UploadPlugin | null {
		const entry = this._plugins.get(pluginName);
		return entry ? entry.plugin : null;
	}

	// Get all registered plugins
	getAllPlugins(): Array<{ name: string; plugin: UploadPlugin; config: PluginConfig }> {
		const result = Array.from(this._plugins.entries()).map(([name, entry]) => ({
			name,
			plugin: entry.plugin,
			config: entry.config
		}));
		return result;
	}

	// Get enabled plugins
	getEnabledPlugins(): Array<{ name: string; plugin: UploadPlugin; config: PluginConfig }> {
		const result = this.getAllPlugins().filter(({ config }) => config.enabled);
		return result;
	}

	/**
	 * Execute a plugin method with timeout protection.
	 * 
	 * @param operation - The async operation to execute
	 * @param timeoutMs - Timeout in milliseconds
	 * @param context - Context for error messages
	 * @returns Promise that resolves with the operation result or rejects on timeout
	 */
	private async _withTimeout<T>(
		operation: () => Promise<T>,
		timeoutMs: number,
		context: string
	): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`Plugin operation '${context}' timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			operation()
				.then(result => {
					clearTimeout(timer);
					resolve(result);
				})
				.catch(error => {
					clearTimeout(timer);
					reject(error);
				});
		});
	}

	// Call a plugin method with timeout protection
	async callPluginMethod(plugin: UploadPlugin, methodName: string, args: any[]): Promise<any> {
		const method = plugin[methodName];
		if (typeof method === 'function') {
			try {
				const result = await this._withTimeout(
					() => Promise.resolve(method.apply(plugin, args)),
					this._PLUGIN_TIMEOUT,
					`${plugin.name}.${methodName}`
				);
				return result;
			} catch (error) {
				console.error(
					'[PluginSystem] callPluginMethod error:',
					plugin.name,
					methodName,
					args,
					error
				);
				if (plugin.onError && methodName !== 'onError') {
					try {
						await this._withTimeout(
							() => Promise.resolve(plugin.onError!(error as Error, { methodName, args })),
							5000, // Shorter timeout for error handlers
							`${plugin.name}.onError`
						);
					} catch (errorHandlerError) {
						console.error(`Error in plugin '${plugin.name}' error handler:`, errorHandlerError);
					}
				}
				throw error;
			}
		}
		return undefined;
	}

	// Emit an event to all plugins
	async emitEvent(eventType: PluginEventType, ...args: any[]): Promise<void> {
		const enabledPlugins = this.getEnabledPlugins();

		// Sort by priority (higher priority first)
		const sortedPlugins = enabledPlugins.sort((a, b) => b.config.priority - a.config.priority);

		for (const { plugin } of sortedPlugins) {
			const method = plugin[eventType];
			if (typeof method === 'function') {
				try {
					await this._withTimeout(
						() => Promise.resolve(method.apply(plugin, args)),
						this._PLUGIN_TIMEOUT,
						`${plugin.name}.${eventType}`
					);
				} catch (error) {
					console.error(
						`[PluginSystem] Error in plugin '${plugin.name}' event handler for '${eventType}':`,
						error
					);

					// Call error handler if available
					if (plugin.onError) {
						try {
							await this._withTimeout(
								() => Promise.resolve(plugin.onError!(error as Error, { eventType, args })),
								5000,
								`${plugin.name}.onError`
							);
						} catch (errorHandlerError) {
							console.error(`Error in plugin '${plugin.name}' error handler:`, errorHandlerError);
						}
					}
				}
			}
		}
	}

	// Execute a pipeline of plugins (for hooks that can modify data)
	async executePipeline<T>(
		eventType: PluginEventType,
		initialValue: T,
		...args: any[]
	): Promise<T> {
		const enabledPlugins = this.getEnabledPlugins();

		// Sort by priority (higher priority first)
		const sortedPlugins = enabledPlugins.sort((a, b) => b.config.priority - a.config.priority);

		let result = initialValue;

		for (const { plugin } of sortedPlugins) {
			const method = plugin[eventType];
			if (typeof method === 'function') {
				try {
					const pluginResult = await this._withTimeout(
						() => method.apply(plugin, [result, ...args]),
						this._PLUGIN_TIMEOUT,
						`${plugin.name}.${eventType}`
					);
					if (pluginResult !== undefined) {
						result = pluginResult as T;
					}
				} catch (error) {
					console.error(
						`[PluginSystem] Error in plugin '${plugin.name}' pipeline for '${eventType}':`,
						error
					);

					if (plugin.onError) {
						try {
							await this._withTimeout(
								() => Promise.resolve(plugin.onError!(error as Error, { eventType, initialValue, args })),
								5000,
								`${plugin.name}.onError`
							);
						} catch (errorHandlerError) {
							console.error(`Error in plugin '${plugin.name}' error handler:`, errorHandlerError);
						}
					}
				}
			}
		}
		return result;
	}
}
