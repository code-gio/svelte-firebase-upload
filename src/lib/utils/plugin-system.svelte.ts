import type { UploadItem, UploadStatus, ValidationResult } from '../types.js';

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
	instance: any;
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
	private plugins: Map<string, PluginRegistryEntry> = new Map();
	private eventListeners: Map<PluginEventType, Array<{ plugin: UploadPlugin; handler: Function }>> =
		new Map();
	private manager: any;

	constructor(manager: any) {
		this.manager = manager;
		this.initializeEventListeners();
	}

	// Register a plugin
	async registerPlugin(plugin: UploadPlugin, config: Partial<PluginConfig> = {}): Promise<void> {
		const pluginConfig: PluginConfig = {
			enabled: true,
			priority: 0,
			...config
		};

		// Check if plugin is already registered
		if (this.plugins.has(plugin.name)) {
			throw new Error(`Plugin '${plugin.name}' is already registered`);
		}

		// Create plugin instance
		const instance = this.createPluginInstance(plugin);

		// Register plugin
		this.plugins.set(plugin.name, {
			plugin,
			config: pluginConfig,
			instance
		});

		// Register event handlers
		this.registerEventHandlers(plugin);

		// Initialize plugin if enabled
		if (pluginConfig.enabled && plugin.onInitialize) {
			try {
				await this.callPluginMethod(plugin, 'onInitialize', [this.manager]);
			} catch (error) {
				console.error(`Failed to initialize plugin '${plugin.name}':`, error);
			}
		}

		console.log(`Plugin '${plugin.name}' registered successfully`);
	}

	// Unregister a plugin
	async unregisterPlugin(pluginName: string): Promise<void> {
		const entry = this.plugins.get(pluginName);
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

		// Remove event handlers
		this.unregisterEventHandlers(plugin);

		// Remove from registry
		this.plugins.delete(pluginName);

		console.log(`Plugin '${pluginName}' unregistered successfully`);
	}

	// Enable/disable a plugin
	async setPluginEnabled(pluginName: string, enabled: boolean): Promise<void> {
		const entry = this.plugins.get(pluginName);
		if (!entry) {
			throw new Error(`Plugin '${pluginName}' is not registered`);
		}

		entry.config.enabled = enabled;

		if (enabled && entry.plugin.onInitialize) {
			try {
				await this.callPluginMethod(entry.plugin, 'onInitialize', [this.manager]);
			} catch (error) {
				console.error(`Failed to initialize plugin '${pluginName}':`, error);
			}
		}
	}

	// Get plugin by name
	getPlugin(pluginName: string): UploadPlugin | null {
		const entry = this.plugins.get(pluginName);
		return entry ? entry.plugin : null;
	}

	// Get all registered plugins
	getAllPlugins(): Array<{ name: string; plugin: UploadPlugin; config: PluginConfig }> {
		return Array.from(this.plugins.entries()).map(([name, entry]) => ({
			name,
			plugin: entry.plugin,
			config: entry.config
		}));
	}

	// Get enabled plugins
	getEnabledPlugins(): Array<{ name: string; plugin: UploadPlugin; config: PluginConfig }> {
		return this.getAllPlugins().filter(({ config }) => config.enabled);
	}

	// Call a plugin method
	async callPluginMethod(plugin: UploadPlugin, methodName: string, args: any[]): Promise<any> {
		const method = plugin[methodName];
		if (typeof method === 'function') {
			return await method.apply(plugin, args);
		}
		return undefined;
	}

	// Emit an event to all plugins
	async emitEvent(eventType: PluginEventType, ...args: any[]): Promise<void> {
		const listeners = this.eventListeners.get(eventType) || [];

		// Sort by priority (higher priority first)
		const sortedListeners = listeners.sort((a, b) => {
			const aEntry = Array.from(this.plugins.values()).find((entry) => entry.plugin === a.plugin);
			const bEntry = Array.from(this.plugins.values()).find((entry) => entry.plugin === b.plugin);
			return (bEntry?.config.priority || 0) - (aEntry?.config.priority || 0);
		});

		for (const { plugin, handler } of sortedListeners) {
			const entry = this.plugins.get(plugin.name);
			if (entry?.config.enabled) {
				try {
					await handler.apply(plugin, args);
				} catch (error) {
					console.error(
						`Error in plugin '${plugin.name}' event handler for '${eventType}':`,
						error
					);

					// Call error handler if available
					if (plugin.onError) {
						try {
							await this.callPluginMethod(plugin, 'onError', [error, { eventType, args }]);
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
		const listeners = this.eventListeners.get(eventType) || [];

		// Sort by priority (higher priority first)
		const sortedListeners = listeners.sort((a, b) => {
			const aEntry = Array.from(this.plugins.values()).find((entry) => entry.plugin === a.plugin);
			const bEntry = Array.from(this.plugins.values()).find((entry) => entry.plugin === b.plugin);
			return (bEntry?.config.priority || 0) - (aEntry?.config.priority || 0);
		});

		let result = initialValue;

		for (const { plugin, handler } of sortedListeners) {
			const entry = this.plugins.get(plugin.name);
			if (entry?.config.enabled) {
				try {
					const pluginResult = await handler.apply(plugin, [result, ...args]);
					if (pluginResult !== undefined) {
						result = pluginResult;
					}
				} catch (error) {
					console.error(`Error in plugin '${plugin.name}' pipeline for '${eventType}':`, error);

					if (plugin.onError) {
						try {
							await this.callPluginMethod(plugin, 'onError', [
								error,
								{ eventType, initialValue, args }
							]);
						} catch (errorHandlerError) {
							console.error(`Error in plugin '${plugin.name}' error handler:`, errorHandlerError);
						}
					}
				}
			}
		}

		return result;
	}

	// Private methods
	private createPluginInstance(plugin: UploadPlugin): any {
		// Create a proxy to intercept method calls
		return new Proxy(plugin, {
			get(target, prop) {
				if (typeof prop === 'string' && typeof (target as any)[prop] === 'function') {
					return (target as any)[prop].bind(target);
				}
				return (target as any)[prop];
			}
		});
	}

	private initializeEventListeners(): void {
		const eventTypes: PluginEventType[] = [
			'initialize',
			'destroy',
			'beforeFileAdd',
			'afterFileAdd',
			'beforeValidation',
			'afterValidation',
			'beforeUpload',
			'onUploadStart',
			'onUploadProgress',
			'onUploadComplete',
			'onUploadError',
			'beforeQueueProcess',
			'afterQueueProcess',
			'onStatusChange',
			'onManagerStateChange',
			'onError'
		];

		eventTypes.forEach((eventType) => {
			this.eventListeners.set(eventType, []);
		});
	}

	private registerEventHandlers(plugin: UploadPlugin): void {
		const eventHandlers: Array<{ event: PluginEventType; method: string }> = [
			{ event: 'beforeFileAdd', method: 'beforeFileAdd' },
			{ event: 'afterFileAdd', method: 'afterFileAdd' },
			{ event: 'beforeValidation', method: 'beforeValidation' },
			{ event: 'afterValidation', method: 'afterValidation' },
			{ event: 'beforeUpload', method: 'beforeUpload' },
			{ event: 'onUploadStart', method: 'onUploadStart' },
			{ event: 'onUploadProgress', method: 'onUploadProgress' },
			{ event: 'onUploadComplete', method: 'onUploadComplete' },
			{ event: 'onUploadError', method: 'onUploadError' },
			{ event: 'beforeQueueProcess', method: 'beforeQueueProcess' },
			{ event: 'afterQueueProcess', method: 'afterQueueProcess' },
			{ event: 'onStatusChange', method: 'onStatusChange' },
			{ event: 'onManagerStateChange', method: 'onManagerStateChange' },
			{ event: 'onError', method: 'onError' }
		];

		eventHandlers.forEach(({ event, method }) => {
			if (plugin[method]) {
				const listeners = this.eventListeners.get(event) || [];
				listeners.push({
					plugin,
					handler: plugin[method]
				});
				this.eventListeners.set(event, listeners);
			}
		});
	}

	private unregisterEventHandlers(plugin: UploadPlugin): void {
		for (const [eventType, listeners] of this.eventListeners.entries()) {
			const filteredListeners = listeners.filter((listener) => listener.plugin !== plugin);
			this.eventListeners.set(eventType, filteredListeners);
		}
	}
}
