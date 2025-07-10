// Type definitions
export type UploadStatus = 'queued' | 'uploading' | 'completed' | 'failed' | 'paused';

export interface UploadManagerConfig {
	maxConcurrentUploads: number;
	chunkSize: number;
	retryAttempts: number;
	retryDelay: number;
	autoStart: boolean;
	maxBandwidthMbps?: number;
	adaptiveBandwidth?: boolean;
	maxMemoryItems?: number;
	enablePersistence?: boolean;
	enableSmartScheduling: boolean;
	[key: string]: any;
}

export interface UploadItem {
	id: string;
	file: File;
	path: string;
	metadata: Record<string, any>;
	priority: number;
	status: UploadStatus;
	progress: number;
	uploadedBytes: number;
	totalBytes: number;
	error: string | null;
	attempts: number;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	downloadURL?: string;
	_interval?: any; // Can be number (browser) or Timeout (Node.js)
	hash?: string;
	validationResult?: ValidationResult;
	[key: string]: any;
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
	[key: string]: any;
}

// Firebase Storage type - re-export from Firebase
export type { FirebaseStorage } from 'firebase/storage';

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
	maxSize?: number;
	allowedTypes?: string[];
	customValidator?: (file: File) => Promise<boolean>;
}

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
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
