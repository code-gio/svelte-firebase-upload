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
	PermissionStatus
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

class FirebaseUploadManager {
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
	private _lastHealthCheck: HealthCheckResult | null = null;

	// Performance optimization managers
	private memoryManager: MemoryManager;
	private networkManager: NetworkManager;
	private bandwidthManager: BandwidthManager;

	// Enterprise feature managers
	private fileValidator: FileValidator;
	private uploadResumer: UploadResumer;

	private _lastBandwidthUpdate: number = Date.now();
	private _pausedByHealth: boolean = false;
	// Plugin system
	public pluginSystem: PluginSystem;

	// Initialize Firebase storage reference
	public storage: FirebaseStorage | null = null; // To be set via setStorage method

	constructor(options: UploadManagerOptions = {}) {
		// Configuration
		this.config = {
			maxConcurrentUploads: options.maxConcurrentUploads || 5,
			chunkSize: options.chunkSize || 1024 * 1024 * 5, // 5MB chunks
			retryAttempts: options.retryAttempts || 3,
			retryDelay: options.retryDelay || 1000,
			autoStart: options.autoStart || false,
			enableSmartScheduling: options.enableSmartScheduling || false,
			...options
		};

		// Initialize performance managers
		this.memoryManager = new MemoryManager({
			maxMemoryItems: options.maxMemoryItems || 1000,
			batchSize: 100,
			persistenceKey: options.enablePersistence ? 'upload-manager-state' : undefined
		});

		this.networkManager = new NetworkManager({
			maxAttempts: this.config.retryAttempts,
			baseDelay: this.config.retryDelay
		});

		this.bandwidthManager = new BandwidthManager({
			maxBandwidthMbps: options.maxBandwidthMbps || 10,
			adaptiveBandwidth: options.adaptiveBandwidth || true
		});

		// Initialize enterprise feature managers
		this.fileValidator = new FileValidator();
		this.uploadResumer = new UploadResumer({
			chunkSize: this.config.chunkSize,
			verifyChunks: true,
			parallelChunks: Math.min(this.config.maxConcurrentUploads, 3)
		});

		// Initialize plugin system
		this.pluginSystem = new PluginSystem(this);

		// Set up network monitoring
		this.networkManager.onOffline(() => this.pause());
		this.networkManager.onOnline(() => this.resume());

		// Start periodic health checks if enabled
		if (options.enableHealthChecks !== false) {
			this._startPeriodicHealthCheck();
		}
	}

	// Getters for computed values (works great with $derived())
	get totalProgress(): number {
		return this.totalSize > 0 ? (this.uploadedSize / this.totalSize) * 100 : 0;
	}

	get isActive(): boolean {
		return this.active.size > 0;
	}

	get hasQueuedFiles(): boolean {
		return this.queue.length > 0;
	}

	get hasCompletedFiles(): boolean {
		return this.completed.size > 0;
	}

	get hasFailedFiles(): boolean {
		return this.failed.size > 0;
	}

	get isIdle(): boolean {
		return !this.isProcessing && this.active.size === 0 && this.queue.length === 0;
	}

	get averageSpeed(): number {
		if (this._speedSamples.length < 2) return 0;

		const first = this._speedSamples[0];
		const last = this._speedSamples[this._speedSamples.length - 1];
		const timeSpan = last.time - first.time;
		const bytesSpan = last.uploaded - first.uploaded;

		return timeSpan > 0 ? (bytesSpan / timeSpan) * 1000 : 0;
	}

	// Get bandwidth statistics
	getBandwidthStats() {
		return this.bandwidthManager.getBandwidthStats();
	}

	// Get network quality
	getNetworkQuality() {
		return this.networkManager.getNetworkQuality();
	}

	// Get recommended upload settings based on network
	getRecommendedSettings() {
		return this.networkManager.getRecommendedSettings();
	}

	// Smart Scheduling Control
	setSmartScheduling(enabled: boolean): void {
		this.config.enableSmartScheduling = enabled;

		// If enabling smart scheduling, optimize the current queue
		if (enabled && this.queue.length > 0) {
			this._optimizeQueue();
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
			const networkQuality = this.networkManager.getNetworkQuality();
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
			const bandwidthStats = this.bandwidthManager.getBandwidthStats();
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
				networkStatus: this.networkManager.isOnline ? 'online' : 'offline',
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
			networkStatus: this.networkManager.isOnline ? 'online' : 'offline',
			permissionsValid: true // Would need to be tracked
		};
	}

	// Initialize Firebase storage
	setStorage(storageInstance: FirebaseStorage): void {
		this.storage = storageInstance;
	}

	// Add files to upload queue
	async addFiles(fileList: FileList | File[], options: UploadManagerOptions = {}): Promise<number> {
		const files = Array.from(fileList);

		// Use memory manager for large file sets
		if (files.length > 100) {
			const batchIds = await this.memoryManager.addFilesLazy(files);

			// Include pending totals in overall totals
			this.totalFiles += this.memoryManager.getPendingTotalFiles();
			this.totalSize += this.memoryManager.getPendingTotalSize();

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

	// Start processing the upload queue
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

		// Cancel all active uploads
		const cancelPromises = Array.from(this._uploadTasks.entries()).map(async ([fileId, task]) => {
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

		// Disconnect network manager
		this.networkManager.disconnect();

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
		if (this.memoryManager) {
			try {
				await this.memoryManager.destroy();
			} catch (error) {
				console.warn('Failed to destroy memory manager:', error);
			}
		}

		// Clean up all files from storage if requested
		if (this.storage) {
			await this._cleanupAllStorageFiles();
		}

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
		return this.fileValidator.validateFiles(files, rules);
	}

	async validateFile(file: File, rules?: Partial<ValidationRule>): Promise<ValidationResult> {
		return this.fileValidator.validateFile(file, rules);
	}

	// Duplicate Detection
	async detectDuplicates(files: File[]): Promise<Map<string, File[]>> {
		return this.fileValidator.detectDuplicates(files);
	}

	async getFileMetadata(file: File): Promise<{
		size: number;
		type: string;
		lastModified: number;
		hash: string;
		dimensions?: { width: number; height: number };
		duration?: number;
	}> {
		return this.fileValidator.getFileMetadata(file);
	}

	// Upload Resumption
	async checkForResumableUpload(file: File): Promise<ResumableUploadState | null> {
		return this.uploadResumer.canResume(file);
	}

	async resumeIncompleteUploads(): Promise<void> {
		const states = await this.uploadResumer.getAllUploadStates();
		const incompleteStates = states.filter((state) => !this.uploadResumer.isUploadComplete(state));

		for (const state of incompleteStates) {
			// Find the file in the current queue or completed list
			const existingFile = this.getFile(state.fileId);
			if (!existingFile) {
				// File not found, clean up the state
				await this.uploadResumer.removeUploadState(state.fileId);
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
			const validationResults = await this.fileValidator.validateFiles(
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
			const duplicates = await this.fileValidator.detectDuplicates(validFiles);
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
				const resumableState = await this.uploadResumer.canResume(file);
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
	async registerPlugin(plugin: any, config: any = {}): Promise<void> {
		return this.pluginSystem.registerPlugin(plugin, config);
	}

	// Unregister a plugin
	async unregisterPlugin(pluginName: string): Promise<void> {
		return this.pluginSystem.unregisterPlugin(pluginName);
	}

	// Get all plugins
	getAllPlugins(): Array<{ name: string; plugin: any; config: any }> {
		return this.pluginSystem.getAllPlugins();
	}

	// Get enabled plugins
	getEnabledPlugins(): Array<{ name: string; plugin: any; config: any }> {
		return this.pluginSystem.getEnabledPlugins();
	}

	// Enable/disable a plugin
	async setPluginEnabled(pluginName: string, enabled: boolean): Promise<void> {
		return this.pluginSystem.setPluginEnabled(pluginName, enabled);
	}

	// Internal methods
	private async _processQueue(): Promise<void> {
		if (this.isPaused || !this.isProcessing) {
			return;
		}

		// Process memory manager batches if needed
		try {
			const nextBatch = this.memoryManager.getNextBatch();

			// Process batches more aggressively - if we have no active uploads or queue is small
			if (nextBatch && (this.queue.length < 50 || this.active.size === 0)) {
				const uploadItems = await this.memoryManager.processBatch(nextBatch.id);
				this.queue.push(...uploadItems);
				this.totalFiles += uploadItems.length;
				this.totalSize += uploadItems.reduce((sum, item) => sum + item.totalBytes, 0);
			}

			// Clean up processed batches
			await this.memoryManager.cleanupProcessedBatches();
		} catch (error) {
			console.error('Error processing memory manager batches:', error);
			// Continue processing even if batch processing fails
		}

		// Fill up to max concurrent uploads
		while (this.active.size < this.config.maxConcurrentUploads && this.queue.length > 0) {
			// Optimize queue if smart scheduling is enabled
			if (this.config.enableSmartScheduling) {
				this._optimizeQueue();
			} else {
				// Sort queue by priority (higher numbers first)
				this.queue.sort((a: UploadItem, b: UploadItem) => b.priority - a.priority);
			}

			const item = this.queue.shift();
			if (item) {
				// Add to active immediately to prevent over-concurrency
				item.status = 'uploading';
				item.startedAt = Date.now();
				this.active.set(item.id, item);

				// Start the upload without awaiting
				this._startUpload(item).catch((error) => {
					console.error('Error in upload task:', error);
				});
			}
		}

		// Check if we're done
		if (this.queue.length === 0 && this.active.size === 0 && !this.memoryManager.getNextBatch()) {
			this.isProcessing = false;
		} else {
			// If we still have batches to process, schedule another run
			if (this.memoryManager.getNextBatch() && this.queue.length === 0) {
				setTimeout(() => this._processQueue(), 100);
			}
		}
	}

	private async _startUpload(item: UploadItem): Promise<void> {
		if (!this.storage) {
			const error = 'Firebase storage not initialized. Call setStorage() first.';
			console.error(error);
			throw new Error(error);
		}

		// Check bandwidth limits before starting
		// await this.bandwidthManager.throttleUpload(item.totalBytes); // Temporarily disabled for testing

		try {
			// Create Firebase storage reference
			const storageRef = ref(this.storage, item.path);

			// Start the upload with Firebase
			const firebaseUploadTask = uploadBytesResumable(storageRef, item.file, item.metadata);

			// Create our upload task wrapper
			const uploadTask = this._createUploadTaskWrapper(item, firebaseUploadTask);
			this._uploadTasks.set(item.id, uploadTask);

			// Set a timeout to catch hanging uploads - longer timeout for large files
			const timeoutMs = item.totalBytes > 10 * 1024 * 1024 ? 900000 : 300000; // 15 min for >10MB, 5 min for smaller
			const uploadTimeout = setTimeout(() => {
				console.error(
					'Upload timeout for item:',
					item.id,
					item.file.name,
					'after',
					timeoutMs / 1000,
					'seconds'
				);
				firebaseUploadTask.cancel();
			}, timeoutMs);

			// Wait for upload to complete
			await firebaseUploadTask;
			clearTimeout(uploadTimeout);

			// Get download URL
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
		} catch (error: unknown) {
			console.error('Upload failed for item:', item.id, item.file.name, error);

			// Handle failure with network manager
			item.status = 'failed';
			item.error = error instanceof Error ? error.message : 'Unknown error';
			item.attempts++;

			// Use network manager for retry logic
			const shouldRetry = this.networkManager.shouldRetry(item.attempts, error as Error);
			if (shouldRetry) {
				const delay = this.networkManager.calculateRetryDelay(item.attempts);
				const timeoutId = setTimeout(() => {
					item.status = 'queued';
					this.queue.unshift(item); // Add to front for retry
					this._processQueue();
				}, delay);
			} else {
				this.failed.set(item.id, item);
				this.failureCount++;
			}

			// Emit error event
			if (this.pluginSystem) {
				this.pluginSystem.emitEvent('onUploadError', item, error as Error);
			}
		} finally {
			this.active.delete(item.id);
			this._uploadTasks.delete(item.id);
			this._processQueue();
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
				this.bandwidthManager.updateBandwidthUsage(progressDiff, timeDiff);
				this._lastBandwidthUpdate = now;
			}

			// Calculate speed
			this._calculateSpeed();
		}
	}

	private _calculateSpeed(): void {
		const now = Date.now();
		const timeDiff = now - this._lastProgressUpdate;

		if (timeDiff > 1000) {
			// Update speed every second
			this._speedSamples.push({
				time: now,
				uploaded: this.uploadedSize
			});

			// Keep only last 10 samples
			if (this._speedSamples.length > 10) {
				this._speedSamples.shift();
			}

			// Calculate speed from samples
			if (this._speedSamples.length >= 2) {
				const first = this._speedSamples[0];
				const last = this._speedSamples[this._speedSamples.length - 1];
				const timeSpan = last.time - first.time;
				const bytesSpan = last.uploaded - first.uploaded;

				this.currentSpeed = timeSpan > 0 ? (bytesSpan / timeSpan) * 1000 : 0;

				// Estimate time remaining
				const remainingBytes = this.totalSize - this.uploadedSize;
				this.estimatedTimeRemaining =
					this.currentSpeed > 0 ? remainingBytes / this.currentSpeed : null;
			}

			this._lastProgressUpdate = now;
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
			const testRef = ref(this.storage, 'health-check-test');
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

		if (!this.networkManager.isOnline) {
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
					console.log('Cleaned up file from storage:', item.id);
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
		this._healthCheckInterval = setInterval(
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
		); // 5 minutes
	}

	// Stop periodic health checks
	private _stopPeriodicHealthCheck(): void {
		if (this._healthCheckInterval) {
			clearInterval(this._healthCheckInterval);
			this._healthCheckInterval = undefined;
		}
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
		const ONE_MB = 1024 * 1024;
		const FIVE_MB = 5 * 1024 * 1024;
		const TEN_MB = 10 * 1024 * 1024;

		this.queue.sort((a: UploadItem, b: UploadItem) => {
			// 1. Small files first for quick wins (under 1MB)
			if (a.totalBytes < ONE_MB && b.totalBytes >= ONE_MB) return -1;
			if (a.totalBytes >= ONE_MB && b.totalBytes < ONE_MB) return 1;

			// 2. Medium files next (1MB to 5MB)
			if (a.totalBytes < FIVE_MB && b.totalBytes >= FIVE_MB) return -1;
			if (a.totalBytes >= FIVE_MB && b.totalBytes < FIVE_MB) return 1;

			// 3. Large files last (over 10MB)
			if (a.totalBytes >= TEN_MB && b.totalBytes < TEN_MB) return 1;
			if (a.totalBytes < TEN_MB && b.totalBytes >= TEN_MB) return -1;

			// 4. Within same size category, sort by priority (higher priority first)
			if (b.priority !== a.priority) {
				return b.priority - a.priority;
			}

			// 5. If same priority, sort by creation time (older files first)
			return a.createdAt - b.createdAt;
		});
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
		const ONE_MB = 1024 * 1024;
		const FIVE_MB = 5 * 1024 * 1024;
		const TEN_MB = 10 * 1024 * 1024;

		const stats = {
			totalFiles: this.queue.length,
			totalSize: this.queue.reduce((sum, item) => sum + item.totalBytes, 0),
			sizeDistribution: {
				small: 0,
				medium: 0,
				large: 0,
				veryLarge: 0
			},
			estimatedCompletionTime: 0,
			quickWinsAvailable: 0
		};

		// Calculate size distribution
		this.queue.forEach((item) => {
			if (item.totalBytes < ONE_MB) {
				stats.sizeDistribution.small++;
			} else if (item.totalBytes < FIVE_MB) {
				stats.sizeDistribution.medium++;
			} else if (item.totalBytes < TEN_MB) {
				stats.sizeDistribution.large++;
			} else {
				stats.sizeDistribution.veryLarge++;
			}
		});

		// Estimate completion time based on current speed
		if (this.currentSpeed > 0) {
			stats.estimatedCompletionTime = stats.totalSize / this.currentSpeed;
		}

		// Count quick wins (small files that can be uploaded quickly)
		stats.quickWinsAvailable = stats.sizeDistribution.small;

		return stats;
	}

	private _startHealthMonitoring(): void {
		// Monitor upload progress every 30 seconds
		const healthInterval = setInterval(() => {
			if (!this.isProcessing) {
				clearInterval(healthInterval);
				return;
			}

			// Check for stuck uploads (uploads that have been active for more than 10 minutes)
			const now = Date.now();
			for (const [id, item] of this.active) {
				const uploadDuration = now - (item.startedAt || now);
				if (uploadDuration > 600000) {
					// 10 minutes
					console.warn('Upload stuck for more than 10 minutes:', id, item.file.name);
				}
			}
		}, 30000); // Every 30 seconds

		// Store the interval ID for cleanup
		this._healthCheckInterval = healthInterval;
	}
}

export default FirebaseUploadManager;
