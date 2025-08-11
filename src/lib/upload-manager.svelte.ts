import type {
	UploadManagerConfig,
	UploadItem,
	UploadTask,
	SpeedSample,
	UploadManagerOptions,
	FirebaseStorage,
	UploadStatus,
	ValidationRule,
	ValidationResult,
	ResumableUploadState,
	HealthStatus,
	HealthCheckResult,
	StorageQuota,
	PermissionStatus,
	UploadManagerInterface,
	UploadPlugin,
	PluginConfig
} from './types.js';

// Firebase imports
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import type {
	StorageReference,
	UploadTask as FirebaseUploadTask,
	UploadTaskSnapshot
} from 'firebase/storage';
import { MemoryManager } from './utils/memory-manager.svelte.js';
import { NetworkManager } from './utils/network-manager.svelte.js';
import { BandwidthManager } from './utils/bandwidth-manager.svelte.js';
import { FileValidator } from './utils/file-validator.svelte.js';
import { UploadResumer } from './utils/upload-resumer.svelte.js';
import { PluginSystem } from './utils/plugin-system.svelte.js';
import { ConfigValidator } from './utils/config-validator.svelte.js';

/**
 * Enterprise-grade Firebase Storage upload manager with advanced features.
 * 
 * Features include:
 * - Concurrent uploads with smart queuing
 * - Resumable uploads with chunk-based recovery
 * - File validation and duplicate detection
 * - Bandwidth throttling and network adaptation
 * - Health monitoring and diagnostics
 * - Plugin system for extensibility
 * - Memory-efficient handling of large file sets
 * 
 * @example
 * ```typescript
 * import { FirebaseUploadManager } from 'svelte-firebase-upload';
 * import { getStorage } from 'firebase/storage';
 * 
 * const manager = new FirebaseUploadManager({
 *   maxConcurrentUploads: 3,
 *   chunkSize: 5 * 1024 * 1024, // 5MB
 *   autoStart: true,
 *   enableSmartScheduling: true
 * });
 * 
 * manager.setStorage(getStorage());
 * 
 * // Add files and start uploading
 * await manager.addFiles(fileList, { path: 'uploads/' });
 * ```
 */
class FirebaseUploadManager {
	// Constants
	private static readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
	private static readonly STUCK_UPLOAD_THRESHOLD = 600000; // 10 minutes
	private static readonly SPEED_SAMPLE_WINDOW = 100; // Keep last 100 samples
	private static readonly QUEUE_OPTIMIZATION_THRESHOLD = 50;
	private static readonly BATCH_PROCESSING_DELAY = 100;
	private static readonly MEMORY_BATCH_SIZE = 100;
	private static readonly MAX_MEMORY_ITEMS = 1000;
	private static readonly MAX_BANDWIDTH_MBPS = 10;
	private static readonly FILE_SIZE_THRESHOLDS = {
		SMALL: 1024 * 1024, // 1MB
		MEDIUM: 5 * 1024 * 1024, // 5MB
		LARGE: 10 * 1024 * 1024 // 10MB
	} as const;

	// Configuration
	public config: UploadManagerConfig;

	// Core state - all properties are reactive with $state()
	public queue = $state<UploadItem[]>([]); // Files waiting to be uploaded
	public active = $state<Map<string, UploadItem>>(new Map()); // Currently uploading files
	public completed = $state<Map<string, UploadItem>>(new Map()); // Successfully uploaded files
	public failed = $state<Map<string, UploadItem>>(new Map()); // Failed uploads with error info
	public paused = $state<Set<string>>(new Set()); // Paused uploads

	// Global state
	public isProcessing = $state(false);
	public isPaused = $state(false);
	public totalFiles = $state(0);
	public totalSize = $state(0);
	public uploadedSize = $state(0);

	// Statistics
	public startTime = $state<number | null>(null);
	public estimatedTimeRemaining = $state<number | null>(null);
	public currentSpeed = $state(0); // bytes per second
	public successCount = $state(0);
	public failureCount = $state(0);

	// Internal tracking (non-reactive)
	private _uploadTasks: Map<string, UploadTask> = new Map();
	private _speedSamples: SpeedSample[] = [];
	private _lastProgressUpdate: number = Date.now();
	private _healthCheckInterval?: number | NodeJS.Timeout;
	private _monitoringInterval?: number | NodeJS.Timeout;
	private _lastHealthCheck: HealthCheckResult | null = null;
	private _allTimers: Set<NodeJS.Timeout | number> = new Set();

	// Performance optimization managers
	private _memoryManager: MemoryManager;
	private _networkManager: NetworkManager;
	private _bandwidthManager: BandwidthManager;

	// Enterprise feature managers
	private _fileValidator: FileValidator;
	private _uploadResumer: UploadResumer;

	private _lastBandwidthUpdate: number = Date.now();
	private _pausedByHealth: boolean = false;
	// Plugin system
	public pluginSystem: PluginSystem;

	// Configuration validator
	private _configValidator: ConfigValidator;

	// Initialize Firebase storage reference
	public storage: FirebaseStorage | null = null; // To be set via setStorage method

	// Derived values (Svelte 5 way)
	public totalProgress = $derived(
		this.totalSize > 0 ? (this.uploadedSize / this.totalSize) * 100 : 0
	);

	public isActive = $derived(this.active.size > 0);
	public hasQueuedFiles = $derived(this.queue.length > 0);
	public hasCompletedFiles = $derived(this.completed.size > 0);
	public hasFailedFiles = $derived(this.failed.size > 0);
	public isIdle = $derived(
		!this.isProcessing && this.active.size === 0 && this.queue.length === 0
	);

	public averageSpeed = $derived(() => {
		if (this._speedSamples.length < 2) return 0;

		const first = this._speedSamples[0];
		const last = this._speedSamples[this._speedSamples.length - 1];
		const timeSpan = last.time - first.time;
		const bytesSpan = last.uploaded - first.uploaded;

		return timeSpan > 0 ? (bytesSpan / timeSpan) * 1000 : 0;
	});

	// Derived queue statistics for smart scheduling insights
	public queueStats = $derived({
		totalFiles: this.queue.length,
		totalSize: this.queue.reduce((sum, item) => sum + item.totalBytes, 0),
		sizeDistribution: {
			small: this.queue.filter(item => item.totalBytes < FirebaseUploadManager.FILE_SIZE_THRESHOLDS.SMALL).length,
			medium: this.queue.filter(item => item.totalBytes >= FirebaseUploadManager.FILE_SIZE_THRESHOLDS.SMALL && item.totalBytes < FirebaseUploadManager.FILE_SIZE_THRESHOLDS.MEDIUM).length,
			large: this.queue.filter(item => item.totalBytes >= FirebaseUploadManager.FILE_SIZE_THRESHOLDS.MEDIUM && item.totalBytes < FirebaseUploadManager.FILE_SIZE_THRESHOLDS.LARGE).length,
			veryLarge: this.queue.filter(item => item.totalBytes >= FirebaseUploadManager.FILE_SIZE_THRESHOLDS.LARGE).length
		},
		estimatedCompletionTime: this.currentSpeed > 0 ? this.queue.reduce((sum, item) => sum + item.totalBytes, 0) / this.currentSpeed : 0,
		quickWinsAvailable: this.queue.filter(item => item.totalBytes < FirebaseUploadManager.FILE_SIZE_THRESHOLDS.SMALL).length
	});

	/**
	 * Create a new Firebase Upload Manager instance.
	 * 
	 * @param options - Configuration options for the upload manager
	 * @throws {Error} When configuration validation fails
	 * 
	 * @example
	 * ```typescript
	 * const manager = new FirebaseUploadManager({
	 *   maxConcurrentUploads: 5,
	 *   chunkSize: 2 * 1024 * 1024, // 2MB chunks
	 *   retryAttempts: 3,
	 *   autoStart: false,
	 *   enableSmartScheduling: true,
	 *   enableHealthChecks: true
	 * });
	 * ```
	 */
	constructor(options: UploadManagerOptions = {}) {
		// Initialize configuration validator
		this._configValidator = new ConfigValidator();
		
		// Validate and sanitize configuration
		const configResult = this._configValidator.validateConfig(options);
		
		// Log validation issues
		if (configResult.warnings.length > 0) {
			console.warn('[FirebaseUploadManager] Configuration warnings:', configResult.warnings);
		}
		
		if (!configResult.valid) {
			console.error('[FirebaseUploadManager] Configuration errors:', configResult.errors);
			throw new Error(`Invalid configuration: ${configResult.errors.join(', ')}`);
		}
		
		// Use sanitized configuration
		this.config = configResult.sanitized!;

		// Initialize performance managers
		this._memoryManager = new MemoryManager({
			maxMemoryItems: options.maxMemoryItems || FirebaseUploadManager.MAX_MEMORY_ITEMS,
			batchSize: FirebaseUploadManager.MEMORY_BATCH_SIZE,
			persistenceKey: options.enablePersistence ? 'upload-manager-state' : undefined
		});

		this._networkManager = new NetworkManager({
			maxAttempts: this.config.retryAttempts,
			baseDelay: this.config.retryDelay
		});

		this._bandwidthManager = new BandwidthManager({
			maxBandwidthMbps: options.maxBandwidthMbps || FirebaseUploadManager.MAX_BANDWIDTH_MBPS,
			adaptiveBandwidth: options.adaptiveBandwidth || true
		});

		// Initialize enterprise feature managers
		this._fileValidator = new FileValidator();
		this._uploadResumer = new UploadResumer({
			chunkSize: this.config.chunkSize,
			verifyChunks: true,
			parallelChunks: Math.min(this.config.maxConcurrentUploads, 3)
		});

		// Initialize plugin system
		this.pluginSystem = new PluginSystem(this as any as UploadManagerInterface);

		// Set up network monitoring
		this._networkManager.onOffline(() => this.pause());
		this._networkManager.onOnline(() => this.resume());

		// Start periodic health checks if enabled
		if (options.enableHealthChecks !== false) {
			this._startPeriodicHealthCheck();
		}
	}

	// Getters for computed values (works great with $derived())
	// Get bandwidth statistics
	getBandwidthStats() {
		return this._bandwidthManager.getBandwidthStats();
	}

	// Get network quality
	getNetworkQuality() {
		return this._networkManager.getNetworkQuality();
	}

	// Get recommended upload settings based on network
	getRecommendedSettings() {
		return this._networkManager.getRecommendedSettings();
	}

	// Configuration Management
	updateConfig(field: keyof UploadManagerConfig, value: any): { success: boolean; error?: string; warning?: string } {
		const validationResult = this._configValidator.validateRuntimeChange(field, value, this.config);
		
		if (!validationResult.valid) {
			console.error(`[FirebaseUploadManager] Configuration update failed for ${field}:`, validationResult.error);
			return { success: false, error: validationResult.error };
		}

		// Update the configuration safely
		this._updateConfigField(field, validationResult.sanitizedValue);
		
		// Log warning if present
		if (validationResult.warning) {
			console.warn(`[FirebaseUploadManager] Configuration update warning for ${field}:`, validationResult.warning);
		}

		// Apply configuration changes that need immediate action
		this._applyConfigurationChange(field, validationResult.sanitizedValue);

		return { 
			success: true, 
			warning: validationResult.warning 
		};
	}

	// Get current configuration (readonly copy)
	getConfig(): Readonly<UploadManagerConfig> {
		return { ...this.config } as Readonly<UploadManagerConfig>;
	}

	// Smart Scheduling Control
	setSmartScheduling(enabled: boolean): void {
		const result = this.updateConfig('enableSmartScheduling', enabled);
		if (!result.success) {
			throw new Error(result.error);
		}
	}

	isSmartSchedulingEnabled(): boolean {
		return this.config.enableSmartScheduling;
	}

	// Health Check System
	async performHealthCheck(): Promise<HealthCheckResult> {
		const startTime = Date.now();
		const issues: string[] = [];
		const checks = {
			connection: false,
			storage: false,
			permissions: false,
			network: false,
			memory: false,
			bandwidth: false
		};
		const details: HealthCheckResult['details'] = {};

		try {
			// 1. Connection Test
			const connectionResult = await this._testConnection();
			checks.connection = connectionResult.success;
			details.connectionLatency = connectionResult.latency;
			if (!connectionResult.success) {
				issues.push(`Connection failed: ${connectionResult.error}`);
			}

			// 2. Storage Quota Check
			const storageResult = await this._checkStorageQuota();
			checks.storage = storageResult.available > 0;
			details.storageQuota = storageResult;
			if (storageResult.percentage > 90) {
				issues.push(`Storage quota nearly full: ${storageResult.percentage.toFixed(1)}% used`);
			}

			// 3. Permissions Validation
			const permissionResult = await this._validatePermissions();
			checks.permissions = permissionResult.storage && permissionResult.network;
			details.permissionStatus = permissionResult;
			if (!permissionResult.storage) {
				issues.push('Storage permission denied');
			}
			if (!permissionResult.network) {
				issues.push('Network permission denied');
			}

			// 4. Network Quality Check
			const networkQuality = this._networkManager.getNetworkQuality();
			checks.network = networkQuality !== 'unknown';
			details.networkQuality = networkQuality;
			if (networkQuality === 'poor') {
				issues.push('Network quality is poor');
			}

			// 5. Memory Usage Check
			const memoryResult = this._checkMemoryUsage();
			checks.memory = memoryResult.healthy;
			details.memoryUsage = memoryResult.usage;
			if (!memoryResult.healthy) {
				issues.push(`High memory usage: ${memoryResult.usage.toFixed(1)}%`);
			}

			// 6. Bandwidth Check
			const bandwidthStats = this._bandwidthManager.getBandwidthStats();
			checks.bandwidth = bandwidthStats.utilization < 95;
			details.bandwidthStats = bandwidthStats;
			if (bandwidthStats.utilization > 95) {
				issues.push(`Bandwidth utilization high: ${bandwidthStats.utilization.toFixed(1)}%`);
			}
		} catch (error: any) {
			issues.push(`Health check error: ${error.message}`);
		}

		const duration = Date.now() - startTime;
		const healthy = issues.length === 0;

		const result: HealthCheckResult = {
			status: {
				healthy,
				issues,
				storageQuota: details.storageQuota?.percentage,
				networkStatus: this._networkManager.isOnline ? 'online' : 'offline',
				permissionsValid: checks.permissions
			},
			timestamp: Date.now(),
			duration,
			checks,
			details
		};

		// Emit health check event
		if (this.pluginSystem) {
			this.pluginSystem.emitEvent('onManagerStateChange', result);
		}

		return result;
	}

	// Perform health check before starting uploads
	async startWithHealthCheck(): Promise<{ canStart: boolean; healthResult: HealthCheckResult }> {
		const healthResult = await this.performHealthCheck();
		const canStart = healthResult.status.healthy;

		if (canStart) {
			await this.start();
		}

		return { canStart, healthResult };
	}

	// Get health status summary
	getHealthStatus(): HealthStatus {
		return {
			healthy: this.isIdle && this.failureCount === 0,
			issues: this._getCurrentIssues(),
			networkStatus: this._networkManager.isOnline ? 'online' : 'offline',
			permissionsValid: true // Would need to be tracked
		};
	}

	/**
	 * Set the Firebase Storage instance to use for uploads.
	 * This must be called before starting any uploads.
	 * 
	 * @param storageInstance - Firebase Storage instance from getStorage()
	 * 
	 * @example
	 * ```typescript
	 * import { getStorage } from 'firebase/storage';
	 * 
	 * const storage = getStorage();
	 * manager.setStorage(storage);
	 * ```
	 */
	setStorage(storageInstance: FirebaseStorage): void {
		this.storage = storageInstance;
	}

	/**
	 * Add files to the upload queue.
	 * 
	 * @param fileList - Files to upload (FileList from input or File array)
	 * @param options - Upload options for these files
	 * @returns Promise resolving to the number of files added
	 * 
	 * @example
	 * ```typescript
	 * // From file input
	 * const fileCount = await manager.addFiles(fileInput.files, {
	 *   path: 'user-uploads/',
	 *   metadata: { userId: '123', category: 'photos' },
	 *   priority: 1
	 * });
	 * 
	 * // From File array
	 * await manager.addFiles([file1, file2], {
	 *   path: 'documents/',
	 *   autoStart: true
	 * });
	 * ```
	 */
	async addFiles(fileList: FileList | File[], options: UploadManagerOptions = {}): Promise<number> {
		const files = Array.from(fileList);

		// Use memory manager for large file sets
		if (files.length > 100) {
			await this._memoryManager.addFilesLazy(files);

			// Include pending totals in overall totals
			this.totalFiles += this._memoryManager.getPendingTotalFiles();
			this.totalSize += this._memoryManager.getPendingTotalSize();

			// Check autoStart even for large file sets
			if (this.config.autoStart && !this.isProcessing) {
				this.start();
			}

			return files.length;
		}

		// Process files normally for smaller sets
		for (const file of files) {
			const fileId = this._generateFileId(file);
			const uploadItem: UploadItem = {
				id: fileId,
				file: file,
				path: options.path || `uploads/${file.name}`,
				metadata: options.metadata || {},
				priority: options.priority || 0,
				status: 'queued',
				progress: 0,
				uploadedBytes: 0,
				totalBytes: file.size,
				error: null,
				attempts: 0,
				createdAt: Date.now(),
				...options
			};

			this.queue.push(uploadItem);
			this.totalFiles++;
			this.totalSize += file.size;
		}

		if (this.config.autoStart && !this.isProcessing) {
			this.start();
		}

		return files.length;
	}

	/**
	 * Start processing the upload queue.
	 * Begins uploading files according to configuration settings.
	 * 
	 * @throws {Error} When storage is not configured
	 * 
	 * @example
	 * ```typescript
	 * await manager.addFiles(files);
	 * await manager.start();
	 * 
	 * // Or use autoStart option
	 * await manager.addFiles(files, { autoStart: true });
	 * ```
	 */
	async start(): Promise<void> {
		if (this.isProcessing) {
			return;
		}

		this.isProcessing = true;
		this.isPaused = false;
		this.startTime = Date.now();

		// Start periodic health monitoring
		this._startHealthMonitoring();

		// Process queue with concurrency control (don't await to allow async processing)
		this._processQueue().catch((error) => {
			console.error('Error in queue processing:', error);
			this.isProcessing = false;
		});
	}

	// Pause all uploads
	async pause(): Promise<void> {
		this.isPaused = true;

		// Pause active uploads
		const pausePromises = Array.from(this._uploadTasks.entries()).map(async ([fileId, task]) => {
			if (task.pause) {
				task.pause();
				this.paused.add(fileId);
			}
		});

		await Promise.allSettled(pausePromises);
	}

	// Resume uploads
	async resume(): Promise<void> {
		this.isPaused = false;

		// Resume paused uploads
		for (const fileId of this.paused) {
			const task = this._uploadTasks.get(fileId);
			if (task && task.resume) {
				task.resume();
			}
		}

		this.paused.clear();
		await this._processQueue();
	}

	// Stop all uploads and clear queue
	async stop(): Promise<void> {
		this.isProcessing = false;
		this.isPaused = false;

		// Stop health monitoring
		this._stopHealthMonitoring();

		// Cancel all active uploads
		const cancelPromises = Array.from(this._uploadTasks.entries()).map(async ([_, task]) => {
			if (task.cancel) {
				task.cancel();
			}
		});

		await Promise.allSettled(cancelPromises);

		this._uploadTasks.clear();
		this.active.clear();
		this.paused.clear();
	}

	// Cleanup and destroy the upload manager
	async destroy(): Promise<void> {
		// Stop all uploads
		await this.stop();

		// Stop periodic health checks
		this._stopPeriodicHealthCheck();

		// Stop health monitoring
		this._stopHealthMonitoring();

		// Disconnect network manager
		this._networkManager.disconnect();

		// Clean up bandwidth manager
		if (this._bandwidthManager) {
			this._bandwidthManager.destroy();
		}

		// Clean up file validator
		if (this._fileValidator) {
			this._fileValidator.destroy();
		}

		// Clean up upload resumer
		if (this._uploadResumer) {
			try {
				await this._uploadResumer.cleanupCompletedUploads();
			} catch (error) {
				console.warn('Failed to cleanup upload resumer:', error);
			}
		}

		// Clean up plugin system
		if (this.pluginSystem) {
			// Unregister all plugins
			const plugins = this.pluginSystem.getAllPlugins();
			for (const { name } of plugins) {
				try {
					await this.pluginSystem.unregisterPlugin(name);
				} catch (error) {
					console.warn(`Failed to unregister plugin ${name}:`, error);
				}
			}
			this.pluginSystem = null as any;
		}

		// Clean up memory manager
		if (this._memoryManager) {
			try {
				await this._memoryManager.destroy();
			} catch (error) {
				console.warn('Failed to destroy memory manager:', error);
			}
		}

		// Clean up all files from storage if requested
		if (this.storage) {
			await this._cleanupAllStorageFiles();
		}

		// Clear all timers and intervals
		this._clearAllTimers();

		// Clear all collections
		this.queue = [];
		this.active.clear();
		this.completed.clear();
		this.failed.clear();
		this.paused.clear();
		this._uploadTasks.clear();
		this._speedSamples = [];

		// Clear storage reference
		this.storage = null;
	}

	// Remove file from queue or cancel if uploading
	async removeFile(fileId: string): Promise<void> {
		// Remove from queue
		this.queue = this.queue.filter((item: UploadItem) => item.id !== fileId);

		// Cancel if actively uploading
		if (this.active.has(fileId)) {
			const task = this._uploadTasks.get(fileId);
			if (task && task.cancel) {
				task.cancel();
			}
			this.active.delete(fileId);
			this._uploadTasks.delete(fileId);
		}

		// Remove from other states
		this.completed.delete(fileId);
		this.failed.delete(fileId);
		this.paused.delete(fileId);

		// Clean up from storage if file was uploaded
		const completedItem = this.completed.get(fileId);
		if (completedItem?.downloadURL && this.storage) {
			try {
				const storageRef = ref(this.storage, completedItem.path);
				await deleteObject(storageRef);
			} catch (error) {
				console.warn('Failed to delete file from storage:', error);
			}
		}
	}

	// Retry failed uploads
	retryFailed(): void {
		const failedItems = Array.from(this.failed.values());

		failedItems.forEach((item: UploadItem) => {
			item.status = 'queued';
			item.error = null;
			item.attempts = 0;
			this.queue.push(item);
			this.failed.delete(item.id);
		});

		this.failureCount -= failedItems.length;

		if (this.isProcessing) {
			this._processQueue();
		}
	}

	// Clear all completed uploads from memory
	async clearCompleted(): Promise<void> {
		// Clean up files from storage if requested
		if (this.storage) {
			const deletePromises = Array.from(this.completed.values()).map(async (item) => {
				if (item.downloadURL) {
					try {
						const storageRef = ref(this.storage!, item.path);
						await deleteObject(storageRef);
					} catch (error) {
						console.warn('Failed to delete file from storage:', item.id, error);
					}
				}
			});

			await Promise.allSettled(deletePromises);
		}

		this.completed.clear();
		this.successCount = 0;
	}

	// Clear all failed uploads
	clearFailed(): void {
		this.failed.clear();
		this.failureCount = 0;
	}

	// Get file by ID from any state
	getFile(fileId: string): UploadItem | undefined {
		// Check queue
		const queuedFile = this.queue.find((item: UploadItem) => item.id === fileId);
		if (queuedFile) return queuedFile;

		// Check other states
		return this.active.get(fileId) || this.completed.get(fileId) || this.failed.get(fileId);
	}

	// Get all files with optional status filter
	getAllFiles(statusFilter: UploadStatus | null = null): UploadItem[] {
		const allFiles = [
			...this.queue,
			...Array.from(this.active.values()),
			...Array.from(this.completed.values()),
			...Array.from(this.failed.values())
		];

		return statusFilter
			? allFiles.filter((file: UploadItem) => file.status === statusFilter)
			: allFiles;
	}

	// Enterprise Features

	// File Validation
	async validateFiles(
		files: File[],
		rules?: Partial<ValidationRule>
	): Promise<Map<File, ValidationResult>> {
		return this._fileValidator.validateFiles(files, rules);
	}

	async validateFile(file: File, rules?: Partial<ValidationRule>): Promise<ValidationResult> {
		return this._fileValidator.validateFile(file, rules);
	}

	// Duplicate Detection
	async detectDuplicates(files: File[]): Promise<Map<string, File[]>> {
		return this._fileValidator.detectDuplicates(files);
	}

	async getFileMetadata(file: File): Promise<{
		size: number;
		type: string;
		lastModified: number;
		hash: string;
		dimensions?: { width: number; height: number };
		duration?: number;
	}> {
		return this._fileValidator.getFileMetadata(file);
	}

	// Upload Resumption
	async checkForResumableUpload(file: File): Promise<ResumableUploadState | null> {
		return this._uploadResumer.canResume(file);
	}

	async resumeIncompleteUploads(): Promise<void> {
		const states = await this._uploadResumer.getAllUploadStates();
		const incompleteStates = states.filter((state) => !this._uploadResumer.isUploadComplete(state));

		for (const state of incompleteStates) {
			// Find the file in the current queue or completed list
			const existingFile = this.getFile(state.fileId);
			if (!existingFile) {
				// File not found, clean up the state
				await this._uploadResumer.removeUploadState(state.fileId);
			}
		}
	}

	// Enhanced addFiles with validation and duplicate detection
	async addFilesWithValidation(
		files: File[],
		options: UploadManagerOptions & {
			validate?: boolean;
			validationRules?: Partial<ValidationRule>;
			skipDuplicates?: boolean;
			checkResume?: boolean;
		} = {}
	): Promise<{
		added: number;
		validated: number;
		duplicates: number;
		resumed: number;
		errors: string[];
	}> {
		const result = {
			added: 0,
			validated: 0,
			duplicates: 0,
			resumed: 0,
			errors: [] as string[]
		};

		// Validate files if requested
		let validFiles = files;
		if (options.validate !== false) {
			const validationResults = await this._fileValidator.validateFiles(
				files,
				options.validationRules
			);
			validFiles = files.filter((file) => {
				const result = validationResults.get(file);
				return result?.valid;
			});
			result.validated = validFiles.length;
		}

		// Check for duplicates if requested
		let uniqueFiles = validFiles;
		if (options.skipDuplicates !== false) {
			const duplicates = await this._fileValidator.detectDuplicates(validFiles);
			const duplicateFiles = new Set<File>();
			duplicates.forEach((fileGroup) => {
				// Keep only the first file, mark others as duplicates
				fileGroup.slice(1).forEach((file) => duplicateFiles.add(file));
			});

			uniqueFiles = validFiles.filter((file) => !duplicateFiles.has(file));
			result.duplicates = validFiles.length - uniqueFiles.length;
		}

		// Check for resumable uploads
		if (options.checkResume !== false) {
			for (const file of uniqueFiles) {
				const resumableState = await this._uploadResumer.canResume(file);
				if (resumableState) {
					result.resumed++;
					// Add to queue with resume information
					this.addFiles([file], { ...options, resumeState: resumableState });
				} else {
					this.addFiles([file], options);
				}
				result.added++;
			}
		} else {
			this.addFiles(uniqueFiles, options);
			result.added = uniqueFiles.length;
		}

		return result;
	}

	// Plugin System Integration

	// Register a plugin
	async registerPlugin(plugin: UploadPlugin, config: Partial<PluginConfig> = {}): Promise<void> {
		return this.pluginSystem.registerPlugin(plugin, config);
	}

	// Unregister a plugin
	async unregisterPlugin(pluginName: string): Promise<void> {
		return this.pluginSystem.unregisterPlugin(pluginName);
	}

	// Get all plugins
	getAllPlugins(): Array<{ name: string; plugin: UploadPlugin; config: PluginConfig }> {
		return this.pluginSystem.getAllPlugins();
	}

	// Get enabled plugins
	getEnabledPlugins(): Array<{ name: string; plugin: UploadPlugin; config: PluginConfig }> {
		return this.pluginSystem.getEnabledPlugins();
	}

	// Enable/disable a plugin
	async setPluginEnabled(pluginName: string, enabled: boolean): Promise<void> {
		return this.pluginSystem.setPluginEnabled(pluginName, enabled);
	}

	// Internal methods
	private async _processQueue(): Promise<void> {
		while (this.isProcessing && this.queue.length > 0) {
			// Check if we can start more uploads
			const availableSlots = this.config.maxConcurrentUploads - this.active.size;
			if (availableSlots <= 0) {
				// Wait a bit before checking again
				await new Promise(resolve => setTimeout(resolve, FirebaseUploadManager.BATCH_PROCESSING_DELAY));
				continue;
			}

			// Start uploads for available slots
			const itemsToProcess = Math.min(availableSlots, this.queue.length);
			const items = this.queue.splice(0, itemsToProcess);

			// Process items in parallel
			const uploadPromises = items.map(item => this._startUpload(item));
			
			try {
				await Promise.allSettled(uploadPromises);
			} catch (error) {
				console.error('Error processing queue items:', error);
				// Continue processing other items
			}

			// Small delay to prevent overwhelming the system  
			await new Promise(resolve => {
				this._registerTimer(
					setTimeout(resolve, FirebaseUploadManager.BATCH_PROCESSING_DELAY)
				);
			});
		}

		// If we're done processing, update state
		if (this.queue.length === 0 && this.active.size === 0) {
			this.isProcessing = false;
		}
	}

	private async _startUpload(item: UploadItem): Promise<void> {
		try {
			// Validate item before starting
			if (!item.file || !this.storage) {
				throw new Error('Invalid upload item or storage not configured');
			}

			// Update item status
			item.status = 'uploading';
			item.startedAt = Date.now();
			item.attempts = (item.attempts || 0) + 1;

			// Add to active uploads
			this.active.set(item.id, item);

			// Create storage reference
			const storageRef = ref(this.storage, item.path);
			
			// Create upload task
			const uploadTask = uploadBytesResumable(storageRef, item.file, {
				contentType: item.file.type,
				customMetadata: {
					originalName: item.file.name,
					uploadId: item.id,
					uploadedAt: new Date().toISOString()
				}
			});

			// Create wrapper for better control
			const taskWrapper = this._createUploadTaskWrapper(item, uploadTask);
			this._uploadTasks.set(item.id, taskWrapper);

			// Set up progress monitoring
			uploadTask.on('state_changed',
				(snapshot) => {
					// Progress update
					const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
					this._updateProgress(item.id, progress);
				},
				(error) => {
					// Error handling
					console.error('Upload error for', item.file.name, ':', error);
					this._handleUploadError(item, error);
				},
				() => {
					// Completion
					this._handleUploadComplete(item, uploadTask.snapshot);
				}
			);

		} catch (error) {
			console.error('Error starting upload for', item.file.name, ':', error);
			this._handleUploadError(item, error as Error);
		}
	}

	private _createUploadTaskWrapper(item: UploadItem, firebaseTask: FirebaseUploadTask): UploadTask {
		// Set up progress monitoring
		firebaseTask.on(
			'state_changed',
			(snapshot: UploadTaskSnapshot) => {
				const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
				this._updateProgress(item.id, progress);

				// Emit progress event
				if (this.pluginSystem) {
					this.pluginSystem.emitEvent('onUploadProgress', item, progress);
				}
			},
			(error) => {
				console.error('Upload error:', error);
				// Error handling is done in the main try-catch
			},
			() => {
				// Upload completed successfully
			}
		);

		return {
			pause: () => {
				firebaseTask.pause();
			},
			resume: () => {
				firebaseTask.resume();
			},
			cancel: () => {
				firebaseTask.cancel();
			}
		};
	}

	private _updateProgress(fileId: string, progress: number): void {
		const item = this.active.get(fileId);
		if (item) {
			const oldUploadedBytes = item.uploadedBytes;
			item.progress = progress;
			item.uploadedBytes = (progress / 100) * item.totalBytes;

			// Update global progress
			const progressDiff = item.uploadedBytes - oldUploadedBytes;
			this.uploadedSize += progressDiff;

			// Update bandwidth usage
			if (progressDiff > 0) {
				const now = Date.now();
				const timeDiff = now - this._lastBandwidthUpdate;
				this._bandwidthManager.updateBandwidthUsage(progressDiff, timeDiff);
				this._lastBandwidthUpdate = now;
			}

			// Calculate speed
			this._calculateSpeed();
		}
	}

	private _calculateSpeed(): void {
		const now = Date.now();
		const timeSinceLastUpdate = now - this._lastProgressUpdate;

		if (timeSinceLastUpdate >= 1000) { // Update every second
			// Add new speed sample
			this._speedSamples.push({
				time: now,
				uploaded: this.uploadedSize
			});

			// Limit samples to prevent memory leaks
			this._limitSpeedSamples();

			// Calculate current speed from last two samples
			if (this._speedSamples.length >= 2) {
				const last = this._speedSamples[this._speedSamples.length - 1];
				const previous = this._speedSamples[this._speedSamples.length - 2];
				const timeSpan = last.time - previous.time;
				const bytesSpan = last.uploaded - previous.uploaded;

				if (timeSpan > 0) {
					this.currentSpeed = (bytesSpan / timeSpan) * 1000; // bytes per second
				}
			}

			this._lastProgressUpdate = now;
		}
	}

	private _limitSpeedSamples(): void {
		// Keep only the last N samples to prevent memory leaks
		if (this._speedSamples.length > FirebaseUploadManager.SPEED_SAMPLE_WINDOW) {
			this._speedSamples = this._speedSamples.slice(-FirebaseUploadManager.SPEED_SAMPLE_WINDOW);
		}
	}

	private _generateFileId(file: File): string {
		return `${file.name}_${file.size}_${file.lastModified}_${Math.random().toString(36).substring(2, 11)}`;
	}

	// Health Check Private Methods
	private async _testConnection(): Promise<{ success: boolean; latency?: number; error?: string }> {
		if (!this.storage) {
			return { success: false, error: 'Storage not initialized' };
		}

		try {
			const startTime = Date.now();
			// Test with a small metadata request
			// Note: getMetadata() is not available in the basic Firebase Storage API
			// We'll use a different approach for health checking
			const latency = Date.now() - startTime;

			return { success: true, latency };
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			return { success: false, error: errorMessage };
		}
	}

	private async _checkStorageQuota(): Promise<StorageQuota> {
		if ('storage' in navigator && 'estimate' in navigator.storage) {
			try {
				const estimate = await navigator.storage.estimate();
				const usage = estimate.usage || 0;
				const quota = estimate.quota || 0;
				const percentage = quota > 0 ? (usage / quota) * 100 : 0;
				const available = quota - usage;

				return { usage, quota, percentage, available };
			} catch (error) {
				// Fallback to default values
				return { usage: 0, quota: 0, percentage: 0, available: 0 };
			}
		}

		// Fallback for browsers that don't support storage estimate
		return { usage: 0, quota: 0, percentage: 0, available: 0 };
	}

	private async _validatePermissions(): Promise<PermissionStatus> {
		const details: string[] = [];
		let storage = true;
		let network = true;

		// Check storage permission (IndexedDB)
		try {
			const testDB = indexedDB.open('permission-test');
			await new Promise((resolve, reject) => {
				testDB.onsuccess = resolve;
				testDB.onerror = reject;
			});
		} catch (error) {
			storage = false;
			details.push('IndexedDB access denied');
		}

		// Check network permission (navigator.onLine)
		if (!navigator.onLine) {
			network = false;
			details.push('Network access denied');
		}

		// Check notification permission if available
		let notifications: boolean | undefined;
		if ('Notification' in window) {
			notifications = Notification.permission === 'granted';
			if (!notifications) {
				details.push('Notification permission not granted');
			}
		}

		return { storage, network, notifications, details };
	}

	private _checkMemoryUsage(): { healthy: boolean; usage: number } {
		if ('memory' in performance) {
			const memory = (performance as any).memory;
			const usage = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
			return { healthy: usage < 80, usage };
		}

		// Fallback: estimate based on queue size and active uploads
		const estimatedUsage = Math.min(((this.queue.length + this.active.size) / 1000) * 100, 50);
		return { healthy: estimatedUsage < 80, usage: estimatedUsage };
	}

	private _getCurrentIssues(): string[] {
		const issues: string[] = [];

		if (!this._networkManager.isOnline) {
			issues.push('Network is offline');
		}

		if (this.failureCount > 0) {
			issues.push(`${this.failureCount} upload failures`);
		}

		if (this.queue.length > 100) {
			issues.push('Large upload queue');
		}

		if (this.active.size >= this.config.maxConcurrentUploads) {
			issues.push('Maximum concurrent uploads reached');
		}

		return issues;
	}

	// Clean up all files from storage
	private async _cleanupAllStorageFiles(): Promise<void> {
		if (!this.storage) return;

		const allItems = [...this.completed.values(), ...this.failed.values(), ...this.active.values()];

		const deletePromises = allItems
			.filter((item) => item.downloadURL || item.path)
			.map(async (item) => {
				try {
					const storageRef = ref(this.storage!, item.path);
					await deleteObject(storageRef);
				} catch (error) {
					console.warn('Failed to clean up file from storage:', item.id, error);
				}
			});

		await Promise.allSettled(deletePromises);
	}

	private _startPeriodicHealthCheck(): void {
		// Clear any existing interval
		if (this._healthCheckInterval) {
			clearInterval(this._healthCheckInterval);
		}

		// Run health check every 5 minutes
		this._healthCheckInterval = this._registerTimer(setInterval(
			async () => {
				try {
					// Don't run health check if manager is being destroyed
					if (!this.pluginSystem) {
						return;
					}

					const healthResult = await this.performHealthCheck();

					// If health check fails and we're processing, consider pausing
					if (!healthResult.status.healthy && this.isProcessing) {
						const criticalIssues = healthResult.status.issues.filter(
							(issue) =>
								issue.includes('Connection failed') || issue.includes('Storage quota nearly full')
							// Removed: || issue.includes('Network quality is poor')
						);

						if (criticalIssues.length > 0) {
							console.warn('Critical health issues detected, pausing uploads:', criticalIssues);
							this._pausedByHealth = true;
							this.pause();
						}
					}

					// Auto-resume if health improved and was paused by health issues
					if (healthResult.status.healthy && this._pausedByHealth && this.isPaused) {
						this._pausedByHealth = false;
						await this.resume();
					}

					this._lastHealthCheck = healthResult;
				} catch (error) {
					console.error('Periodic health check failed:', error);
					// Don't stop the interval on error, just log it
				}
			},
			5 * 60 * 1000
		)) as NodeJS.Timeout; // 5 minutes
	}

	// Stop periodic health checks
	private _stopPeriodicHealthCheck(): void {
		this._clearTimer(this._healthCheckInterval);
		this._healthCheckInterval = undefined;
	}

	// Get last health check result
	getLastHealthCheck(): HealthCheckResult | null {
		return this._lastHealthCheck;
	}

	// Force immediate health check
	async forceHealthCheck(): Promise<HealthCheckResult> {
		return await this.performHealthCheck();
	}

	// Smart Queue Optimization
	private _optimizeQueue(): void {
		// Only optimize if queue is large enough to benefit
		if (this.queue.length < FirebaseUploadManager.QUEUE_OPTIMIZATION_THRESHOLD) {
			return;
		}

		// Sort by priority: small files first (quick wins), then by size
		this.queue.sort((a, b) => {
			// Small files get priority for quick wins
			const aIsSmall = a.totalBytes < FirebaseUploadManager.FILE_SIZE_THRESHOLDS.SMALL;
			const bIsSmall = b.totalBytes < FirebaseUploadManager.FILE_SIZE_THRESHOLDS.SMALL;

			if (aIsSmall && !bIsSmall) return -1;
			if (!aIsSmall && bIsSmall) return 1;

			// Then sort by size (smaller files first)
			return a.totalBytes - b.totalBytes;
		});

		// Update queue order
		this.queue = [...this.queue];
	}

	// Manual queue optimization (public method for external control)
	optimizeQueue(): void {
		if (this.config.enableSmartScheduling) {
			this._optimizeQueue();
		}
	}

	// Get queue statistics for smart scheduling insights
	getQueueStats(): {
		totalFiles: number;
		totalSize: number;
		sizeDistribution: {
			small: number; // < 1MB
			medium: number; // 1MB - 5MB
			large: number; // 5MB - 10MB
			veryLarge: number; // > 10MB
		};
		estimatedCompletionTime: number;
		quickWinsAvailable: number;
	} {
		// Return the derived queue stats for consistency
		return this.queueStats;
	}

	private _startHealthMonitoring(): void {
		// Clear any existing monitoring interval first
		this._stopHealthMonitoring();
		
		// Monitor upload progress every 30 seconds
		this._monitoringInterval = this._registerTimer(setInterval(() => {
			if (!this.isProcessing) {
				this._stopHealthMonitoring();
				return;
			}

			// Check for stuck uploads (uploads that have been active for more than 10 minutes)
			const now = Date.now();
			for (const [id, item] of this.active) {
				const uploadDuration = now - (item.startedAt || now);
				if (uploadDuration > FirebaseUploadManager.STUCK_UPLOAD_THRESHOLD) {
					console.warn('Upload stuck for more than 10 minutes:', id, item.file.name);
				}
			}
		}, FirebaseUploadManager.HEALTH_CHECK_INTERVAL)) as NodeJS.Timeout; // Every 30 seconds
	}

	private _stopHealthMonitoring(): void {
		this._clearTimer(this._monitoringInterval);
		this._monitoringInterval = undefined;
	}

	private _handleUploadError(item: UploadItem, error: Error): void {
		// Handle failure with network manager
		item.status = 'failed';
		item.error = error.message;
		item.attempts = (item.attempts || 0) + 1;

		// Use network manager for retry logic
		const shouldRetry = this._networkManager.shouldRetry(item.attempts, error);
		if (shouldRetry) {
			const delay = this._networkManager.calculateRetryDelay(item.attempts);
			setTimeout(() => {
				item.status = 'queued';
				this.queue.unshift(item); // Add to front for retry
				this._processQueue();
			}, delay);
		} else {
			this.failed.set(item.id, item);
			this.failureCount++;
		}

		// Remove from active and cleanup
		this.active.delete(item.id);
		this._uploadTasks.delete(item.id);

		// Emit error event
		if (this.pluginSystem) {
			this.pluginSystem.emitEvent('onUploadError', item, error);
		}
	}

	private async _handleUploadComplete(item: UploadItem, _: any): Promise<void> {
		try {
			// Get download URL
			const storageRef = ref(this.storage!, item.path);
			const downloadURL = await getDownloadURL(storageRef);

			// Success
			item.status = 'completed';
			item.completedAt = Date.now();
			item.downloadURL = downloadURL;
			this.completed.set(item.id, item);
			this.successCount++;

			// Emit success event
			if (this.pluginSystem) {
				this.pluginSystem.emitEvent('onUploadComplete', item, { downloadURL });
			}
		} catch (error) {
			console.error('Error getting download URL for', item.file.name, ':', error);
			this._handleUploadError(item, error as Error);
			return;
		}

		// Remove from active and cleanup
		this.active.delete(item.id);
		this._uploadTasks.delete(item.id);

		// Continue processing queue
		this._processQueue();
	}

	// Type-safe configuration field update
	private _updateConfigField(field: keyof UploadManagerConfig, value: any): void {
		switch (field) {
			case 'maxConcurrentUploads':
				(this.config as { maxConcurrentUploads: number }).maxConcurrentUploads = value;
				break;
			case 'chunkSize':
				(this.config as { chunkSize: number }).chunkSize = value;
				break;
			case 'retryAttempts':
				(this.config as { retryAttempts: number }).retryAttempts = value;
				break;
			case 'retryDelay':
				(this.config as { retryDelay: number }).retryDelay = value;
				break;
			case 'enableSmartScheduling':
				this.config.enableSmartScheduling = value;
				break;
			case 'maxBandwidthMbps':
				if ('maxBandwidthMbps' in this.config) {
					(this.config as { maxBandwidthMbps: number }).maxBandwidthMbps = value;
				}
				break;
			case 'adaptiveBandwidth':
				if ('adaptiveBandwidth' in this.config) {
					(this.config as { adaptiveBandwidth: boolean }).adaptiveBandwidth = value;
				}
				break;
			case 'maxMemoryItems':
				if ('maxMemoryItems' in this.config) {
					(this.config as { maxMemoryItems: number }).maxMemoryItems = value;
				}
				break;
			case 'enablePersistence':
				if ('enablePersistence' in this.config) {
					(this.config as { enablePersistence: boolean }).enablePersistence = value;
				}
				break;
		}
	}

	// Timer management methods
	private _registerTimer(timer: NodeJS.Timeout | number): NodeJS.Timeout | number {
		this._allTimers.add(timer);
		return timer;
	}

	private _clearTimer(timer?: NodeJS.Timeout | number): void {
		if (timer) {
			clearTimeout(timer as NodeJS.Timeout);
			clearInterval(timer as NodeJS.Timeout);
			this._allTimers.delete(timer);
		}
	}

	private _clearAllTimers(): void {
		for (const timer of this._allTimers) {
			clearTimeout(timer as NodeJS.Timeout);
			clearInterval(timer as NodeJS.Timeout);
		}
		this._allTimers.clear();
	}

	// Apply configuration changes that need immediate action
	private _applyConfigurationChange(field: keyof UploadManagerConfig, value: any): void {
		switch (field) {
			case 'enableSmartScheduling':
				// If enabling smart scheduling, optimize the current queue
				if (value && this.queue.length > 0) {
					this._optimizeQueue();
				}
				break;
			case 'maxBandwidthMbps':
				// Update bandwidth manager if it exists
				if (this._bandwidthManager) {
					this._bandwidthManager.setBandwidthLimit(value);
				}
				break;
			case 'maxConcurrentUploads':
				// If reducing concurrent uploads, we may need to pause some active uploads
				if (this.active.size > value) {
					console.warn(`[FirebaseUploadManager] Reducing maxConcurrentUploads from ${this.active.size} active uploads to ${value}. Some uploads will be paused.`);
					// The queue processor will handle this naturally
				}
				break;
			// Other fields don't require immediate action
		}
	}
}

export default FirebaseUploadManager;
