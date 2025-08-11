// Firebase Storage type - re-export from Firebase
export type { FirebaseStorage } from 'firebase/storage';

// Import the FirebaseStorage type for internal use
import type { FirebaseStorage } from 'firebase/storage';

// Type definitions

/**
 * Status of an individual upload item.
 * 
 * - `queued`: File is waiting to be uploaded
 * - `uploading`: File is currently being uploaded
 * - `completed`: File upload completed successfully
 * - `failed`: File upload failed (may be retried)
 * - `paused`: File upload is temporarily paused
 */
export type UploadStatus = 'queued' | 'uploading' | 'completed' | 'failed' | 'paused';

// Upload Manager Interface for plugins
export interface UploadManagerInterface {
	config: UploadManagerConfig;
	queue: UploadItem[];
	active: Map<string, UploadItem>;
	completed: Map<string, UploadItem>;
	failed: Map<string, UploadItem>;
	paused: Set<string>;
	isProcessing: boolean;
	isPaused: boolean;
	totalFiles: number;
	totalSize: number;
	uploadedSize: number;
	startTime: number | null;
	estimatedTimeRemaining: number | null;
	currentSpeed: number;
	successCount: number;
	failureCount: number;
	totalProgress: number;
	isActive: boolean;
	hasQueuedFiles: boolean;
	hasCompletedFiles: boolean;
	hasFailedFiles: boolean;
	isIdle: boolean;
	averageSpeed: number;
	queueStats: {
		totalFiles: number;
		totalSize: number;
		sizeDistribution: {
			small: number;
			medium: number;
			large: number;
			veryLarge: number;
		};
		estimatedCompletionTime: number;
		quickWinsAvailable: number;
	};
	
	// Methods
	addFiles(fileList: FileList | File[], options?: UploadManagerOptions): Promise<number>;
	start(): Promise<void>;
	pause(): Promise<void>;
	resume(): Promise<void>;
	stop(): Promise<void>;
	destroy(): Promise<void>;
	removeFile(fileId: string): Promise<void>;
	retryFailed(): void;
	clearCompleted(): Promise<void>;
	clearFailed(): void;
	getFile(fileId: string): UploadItem | undefined;
	getAllFiles(statusFilter?: UploadStatus | null): UploadItem[];
	
	// Validation methods
	validateFiles(files: File[], rules?: Partial<ValidationRule>): Promise<Map<File, ValidationResult>>;
	validateFile(file: File, rules?: Partial<ValidationRule>): Promise<ValidationResult>;
	detectDuplicates(files: File[]): Promise<Map<string, File[]>>;
	getFileMetadata(file: File): Promise<{
		size: number;
		type: string;
		lastModified: number;
		hash: string;
		dimensions?: { width: number; height: number };
		duration?: number;
	}>;
	
	// Resumable upload methods
	checkForResumableUpload(file: File): Promise<ResumableUploadState | null>;
	resumeIncompleteUploads(): Promise<void>;
	addFilesWithValidation(files: File[], options?: UploadManagerOptions & {
		validate?: boolean;
		validationRules?: Partial<ValidationRule>;
		skipDuplicates?: boolean;
		checkResume?: boolean;
	}): Promise<{
		added: number;
		validated: number;
		duplicates: number;
		resumed: number;
		errors: string[];
	}>;
	
	// Plugin system methods
	registerPlugin(plugin: UploadPlugin, config?: Partial<PluginConfig>): Promise<void>;
	unregisterPlugin(pluginName: string): Promise<void>;
	getAllPlugins(): Array<{ name: string; plugin: UploadPlugin; config: PluginConfig }>;
	getEnabledPlugins(): Array<{ name: string; plugin: UploadPlugin; config: PluginConfig }>;
	setPluginEnabled(pluginName: string, enabled: boolean): Promise<void>;
	
	// Health check methods
	performHealthCheck(): Promise<HealthCheckResult>;
	startWithHealthCheck(): Promise<{ canStart: boolean; healthResult: HealthCheckResult }>;
	getHealthStatus(): HealthStatus;
	getLastHealthCheck(): HealthCheckResult | null;
	forceHealthCheck(): Promise<HealthCheckResult>;
	
	// Configuration and utility methods
	setStorage(storageInstance: FirebaseStorage): void;
	getBandwidthStats(): {
		current: number;
		average: number;
		peak: number;
		limit: number;
		utilization: number;
	};
	getNetworkQuality(): 'excellent' | 'good' | 'poor' | 'unknown';
	getRecommendedSettings(): {
		maxConcurrent: number;
		chunkSize: number;
		timeout: number;
	};
	setSmartScheduling(enabled: boolean): void;
	isSmartSchedulingEnabled(): boolean;
	optimizeQueue(): void;
	getQueueStats(): {
		totalFiles: number;
		totalSize: number;
		sizeDistribution: {
			small: number;
			medium: number;
			large: number;
			veryLarge: number;
		};
		estimatedCompletionTime: number;
		quickWinsAvailable: number;
	};
}

/**
 * Core configuration for the Firebase Upload Manager.
 * 
 * Most properties are readonly after initialization to prevent
 * accidental modification. Use updateConfig() method for safe runtime changes.
 */
export interface UploadManagerConfig {
	readonly maxConcurrentUploads: number;
	readonly chunkSize: number;
	readonly retryAttempts: number;
	readonly retryDelay: number;
	readonly autoStart: boolean;
	readonly maxBandwidthMbps?: number;
	readonly adaptiveBandwidth?: boolean;
	readonly maxMemoryItems?: number;
	readonly enablePersistence?: boolean;
	enableSmartScheduling: boolean;
}

/**
 * Represents a single file in the upload queue with all metadata and status information.
 * 
 * Contains both file information and upload progress tracking.
 */
export interface UploadItem {
	readonly id: string;
	readonly file: File;
	readonly path: string;
	readonly metadata: Readonly<Record<string, any>>;
	readonly priority: number;
	status: UploadStatus;
	progress: number; // 0-100 percentage
	uploadedBytes: number;
	readonly totalBytes: number;
	error: string | null;
	attempts: number;
	readonly createdAt: number;
	startedAt?: number;
	completedAt?: number;
	downloadURL?: string;
	_interval?: number | NodeJS.Timeout; // Timer reference
	hash?: string;
	validationResult?: ValidationResult;
}

export interface SpeedSample {
	time: number;
	uploaded: number;
}

export interface UploadTask {
	pause?: () => void;
	resume?: () => void;
	cancel?: () => void;
}

/**
 * Configuration options for initializing the Firebase Upload Manager.
 * 
 * All properties are optional with sensible defaults.
 * Can also be used for per-file upload options in addFiles().
 */
export interface UploadManagerOptions {
	maxConcurrentUploads?: number;
	chunkSize?: number;
	retryAttempts?: number;
	retryDelay?: number;
	autoStart?: boolean;
	path?: string;
	metadata?: Record<string, any>;
	priority?: number;
	enableSmartScheduling?: boolean;
	enableHealthChecks?: boolean;
	maxBandwidthMbps?: number;
	adaptiveBandwidth?: boolean;
	maxMemoryItems?: number;
	enablePersistence?: boolean;
	resumeState?: ResumableUploadState;
	[key: string]: any;
}

// Plugin System Types - Comprehensive plugin interface matching plugin-system implementation
export interface UploadPlugin {
	// Plugin metadata
	name: string;
	version: string;
	description?: string;

	// Lifecycle hooks
	onInitialize?: (manager: UploadManagerInterface) => Promise<void> | void;
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

// Memory Management & Virtual Queue
export interface VirtualQueueConfig {
	maxMemoryItems: number;
	batchSize: number;
	persistenceKey?: string;
}

export interface FileBatch {
	id: string;
	files: File[];
	processed: boolean;
	createdAt: number;
}

// Network Resilience
export interface NetworkMonitor {
	isOnline: boolean;
	connectionType?: string;
	effectiveType?: string;
	downlink?: number;
	onOnline: (callback: () => void) => void;
	onOffline: (callback: () => void) => void;
	disconnect: () => void;
}

export interface RetryConfig {
	maxAttempts: number;
	baseDelay: number;
	maxDelay: number;
	backoffMultiplier: number;
	jitter: boolean;
}

// Bandwidth Control
export interface BandwidthConfig {
	maxBandwidthMbps: number;
	adaptiveBandwidth: boolean;
	throttleInterval: number;
}

export interface ThrottleInfo {
	bytesPerSecond: number;
	lastUpdate: number;
	queue: Array<() => void>;
}

// File Validation
export interface ValidationRule {
	maxSize?: number; // in bytes
	allowedTypes?: readonly string[]; // MIME types or extensions
	customValidator?: (file: File) => Promise<boolean>;
}

export interface ValidationResult {
	readonly valid: boolean;
	readonly errors: readonly string[];
	readonly warnings: readonly string[];
}

// Performance Metrics
export interface UploadMetrics {
	averageSpeed: number;
	successRate: number;
	commonErrors: Map<string, number>;
	peakConcurrency: number;
	totalBandwidthUsed: number;
	uploadCount: number;
	failureCount: number;
	startTime: number;
	endTime?: number;
}

// Health Status
export interface HealthStatus {
	healthy: boolean;
	issues: string[];
	storageQuota?: number;
	networkStatus: 'online' | 'offline' | 'unknown';
	permissionsValid: boolean;
}

export interface HealthCheckResult {
	status: HealthStatus;
	timestamp: number;
	duration: number;
	checks: {
		connection: boolean;
		storage: boolean;
		permissions: boolean;
		network: boolean;
		memory: boolean;
		bandwidth: boolean;
	};
	details: {
		connectionLatency?: number;
		storageQuota?: StorageQuota;
		permissionStatus?: PermissionStatus;
		networkQuality?: string;
		memoryUsage?: number;
		bandwidthStats?: any;
	};
}

export interface StorageQuota {
	usage: number;
	quota: number;
	percentage: number;
	available: number;
}

export interface PermissionStatus {
	storage: boolean;
	network: boolean;
	notifications?: boolean;
	details: string[];
}

// Upload Resumption
export interface ResumableUploadState {
	fileId: string;
	fileName: string;
	fileSize: number;
	uploadedBytes: number;
	chunks: ChunkState[];
	metadata: Record<string, any>;
	createdAt: number;
	lastUpdated: number;
}

export interface ChunkState {
	index: number;
	start: number;
	end: number;
	uploaded: boolean;
	hash?: string;
}

export interface ResumeOptions {
	chunkSize?: number;
	verifyChunks?: boolean;
	parallelChunks?: number;
}

// Duplicate Detection
export interface DuplicateInfo {
	hash: string;
	files: File[];
	count: number;
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

