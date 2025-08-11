/**
 * Example Plugins for Firebase Upload Manager
 * 
 * This file contains fully-featured example plugins that demonstrate the plugin system capabilities.
 * Each plugin is production-ready and can be used as-is or customized for your needs.
 * 
 * Quick Start:
 * ```typescript
 * import { FirebaseUploadManager } from 'svelte-firebase-upload';
 * import { LoggingPlugin, AnalyticsPlugin } from 'svelte-firebase-upload/plugins/example-plugins';
 * 
 * const manager = new FirebaseUploadManager();
 * 
 * // Add logging
 * await manager.registerPlugin(new LoggingPlugin({ logLevel: 'debug' }));
 * 
 * // Add analytics
 * await manager.registerPlugin(new AnalyticsPlugin());
 * ```
 * 
 * Plugin Development Tips:
 * 1. Always implement proper error handling
 * 2. Use descriptive logging with your plugin name prefix
 * 3. Clean up resources in onDestroy() if needed
 * 4. Make configuration optional with sensible defaults
 * 5. Use TypeScript for better developer experience
 * 6. Test both success and failure scenarios
 * 
 * Available Plugin Hooks:
 * - onInitialize, onDestroy: Plugin lifecycle
 * - beforeFileAdd, afterFileAdd: File addition
 * - beforeValidation, afterValidation: File validation
 * - beforeUpload, onUploadStart, onUploadProgress, onUploadComplete, onUploadError: Upload lifecycle
 * - beforeQueueProcess, afterQueueProcess: Queue processing
 * - onStatusChange, onManagerStateChange: State changes
 * - onError: Error handling
 */

import type { UploadPlugin, PluginConfig, UploadItem, UploadStatus, ValidationResult, UploadManagerInterface } from '../types.js';

/**
 * Example: Logging Plugin
 * 
 * This plugin demonstrates how to log all upload events for debugging and monitoring.
 * 
 * Usage:
 * ```typescript
 * const manager = new FirebaseUploadManager();
 * const loggingPlugin = new LoggingPlugin({
 *   logLevel: 'debug',
 *   logToConsole: true,
 *   logToStorage: true
 * });
 * 
 * await manager.registerPlugin(loggingPlugin);
 * ```
 * 
 * Key Features:
 * - Configurable log levels (debug, info, warn, error)
 * - Optional console logging
 * - Optional localStorage persistence
 * - Automatic log rotation (keeps last 1000 entries)
 */
export class LoggingPlugin implements UploadPlugin {
	name = 'logging';
	version = '1.0.0';
	description = 'Logs all upload events for debugging and monitoring';

	// Plugin configuration - customize these based on your needs
	private logLevel: 'debug' | 'info' | 'warn' | 'error';
	private logToConsole: boolean;
	private logToStorage: boolean;

	/**
	 * Constructor - Configure the plugin behavior
	 * @param config Configuration options for the logging plugin
	 */
	constructor(
		config: {
			logLevel?: 'debug' | 'info' | 'warn' | 'error';  // Minimum log level to output
			logToConsole?: boolean;                          // Whether to log to browser console
			logToStorage?: boolean;                          // Whether to persist logs to localStorage
		} = {}
	) {
		this.logLevel = config.logLevel || 'info';
		this.logToConsole = config.logToConsole !== false;  // Default to true
		this.logToStorage = config.logToStorage || false;   // Default to false
	}

	/**
	 * Called when the plugin is registered with the upload manager
	 * Use this hook to set up any initial state or connections
	 */
	async onInitialize(manager: UploadManagerInterface): Promise<void> {
		this.log('info', 'LoggingPlugin initialized', { manager: manager.constructor.name });
	}

	/**
	 * Called before a file is added to the upload queue
	 * Use this to modify files or upload options before processing
	 * Return the modified file and options, or original values unchanged
	 */
	async beforeFileAdd(file: File, options: any): Promise<{ file: File; options: any }> {
		this.log('info', 'File being added', { fileName: file.name, fileSize: file.size, options });
		// You can modify the file or options here before they're processed
		return { file, options };
	}

	/**
	 * Called after a file has been successfully added to the upload queue
	 * Use this for notifications, analytics, or triggering other processes
	 */
	async afterFileAdd(item: UploadItem): Promise<void> {
		this.log('info', 'File added to queue', { fileId: item.id, fileName: item.file.name });
	}

	/**
	 * Called when an upload starts for a specific file
	 * Perfect for tracking upload start times or updating UI
	 */
	async onUploadStart(item: UploadItem): Promise<void> {
		this.log('info', 'Upload started', { fileId: item.id, fileName: item.file.name });
	}

	/**
	 * Called during upload progress updates
	 * Be careful not to log too frequently to avoid performance issues
	 */
	async onUploadProgress(item: UploadItem, progress: number): Promise<void> {
		if (progress % 10 === 0) {
			// Log every 10% to avoid spam - adjust as needed
			this.log('debug', 'Upload progress', { fileId: item.id, progress: `${progress}%` });
		}
	}

	/**
	 * Called when an upload completes successfully
	 * Use this for success notifications, cleanup, or triggering post-processing
	 */
	async onUploadComplete(item: UploadItem, result: any): Promise<void> {
		this.log('info', 'Upload completed', { 
			fileId: item.id, 
			fileName: item.file.name, 
			downloadURL: result?.downloadURL 
		});
	}

	/**
	 * Called when an upload fails with an error
	 * Essential for error tracking and debugging failed uploads
	 */
	async onUploadError(item: UploadItem, error: Error): Promise<void> {
		this.log('error', 'Upload failed', {
			fileId: item.id,
			fileName: item.file.name,
			error: error.message,
			stack: error.stack
		});
	}

	/**
	 * Called whenever an upload item's status changes
	 * Useful for detailed state tracking and debugging
	 */
	async onStatusChange(
		item: UploadItem,
		oldStatus: UploadStatus,
		newStatus: UploadStatus
	): Promise<void> {
		this.log('debug', 'Status changed', { 
			fileId: item.id, 
			fileName: item.file.name,
			transition: `${oldStatus} → ${newStatus}` 
		});
	}

	/**
	 * Called when any plugin-related error occurs
	 * Use this as a fallback error handler for your plugin
	 */
	async onError(error: Error, context: any): Promise<void> {
		this.log('error', 'Plugin error', { error: error.message, context });
	}

	/**
	 * Internal logging method - handles both console and storage logging
	 * You can customize this to send logs to your preferred logging service
	 */
	private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void {
		// Create structured log entry
		const logEntry = {
			timestamp: new Date().toISOString(),
			plugin: this.name,
			level,
			message,
			data
		};

		// Log to console if enabled
		if (this.logToConsole) {
			console[level](`[${this.name}] ${message}`, data || '');
		}

		// Save to localStorage if enabled
		if (this.logToStorage) {
			this.saveToStorage(logEntry);
		}

		// TODO: Add your custom logging integrations here
		// Examples: send to analytics service, remote logging API, etc.
	}

	/**
	 * Saves logs to localStorage with automatic rotation
	 * Modify this to integrate with your preferred storage solution
	 */
	private saveToStorage(logEntry: any): void {
		try {
			const logs = JSON.parse(localStorage.getItem('upload-logs') || '[]');
			logs.push(logEntry);

			// Keep only last 1000 logs to prevent localStorage bloat
			if (logs.length > 1000) {
				logs.splice(0, logs.length - 1000);
			}

			localStorage.setItem('upload-logs', JSON.stringify(logs));
		} catch (error) {
			console.error('Failed to save log to storage:', error);
		}
	}

	/**
	 * Public method to retrieve stored logs
	 * Useful for debugging or displaying logs in your UI
	 */
	public getLogs(): any[] {
		try {
			return JSON.parse(localStorage.getItem('upload-logs') || '[]');
		} catch (error) {
			console.error('Failed to retrieve logs:', error);
			return [];
		}
	}

	/**
	 * Clear all stored logs
	 * Call this when you want to reset the log history
	 */
	public clearLogs(): void {
		try {
			localStorage.removeItem('upload-logs');
		} catch (error) {
			console.error('Failed to clear logs:', error);
		}
	}
}

/**
 * Example: Analytics Plugin
 * 
 * This plugin tracks comprehensive upload analytics and performance metrics.
 * Perfect for monitoring upload success rates, performance, and identifying issues.
 * 
 * Usage:
 * ```typescript
 * const manager = new FirebaseUploadManager();
 * const analyticsPlugin = new AnalyticsPlugin();
 * 
 * await manager.registerPlugin(analyticsPlugin);
 * 
 * // Later, get metrics
 * const metrics = analyticsPlugin.getMetrics();
 * console.log('Success rate:', metrics.successRate);
 * console.log('Average upload time:', metrics.averageUploadTime);
 * ```
 * 
 * Key Features:
 * - Upload success/failure tracking
 * - Performance metrics (upload times, average speed)
 * - Error categorization and counting
 * - Persistent storage with automatic loading
 * - Easy metric retrieval and reset functionality
 */
export class AnalyticsPlugin implements UploadPlugin {
	name = 'analytics';
	version = '1.0.0';
	description = 'Tracks upload analytics and performance metrics';

	// Metrics storage - all data persisted to localStorage
	private metrics = {
		totalFiles: 0,                              // Total files added to queue
		totalSize: 0,                              // Total bytes of all files
		successfulUploads: 0,                      // Count of successful uploads
		failedUploads: 0,                         // Count of failed uploads
		averageUploadTime: 0,                     // Average time per upload (ms)
		uploadTimes: [] as number[],              // Individual upload times
		errors: new Map<string, number>()         // Error types and their counts
	};

	/**
	 * Initialize the plugin and load any existing metrics from storage
	 */
	async onInitialize(manager: UploadManagerInterface): Promise<void> {
		this.loadMetrics();
		console.log('[Analytics] Plugin initialized with existing metrics:', this.getMetrics());
	}

	/**
	 * Track when files are added - update file count and total size metrics
	 */
	async afterFileAdd(item: UploadItem): Promise<void> {
		this.metrics.totalFiles++;
		this.metrics.totalSize += item.totalBytes;
		this.saveMetrics();
	}

	/**
	 * Mark the start time for performance tracking
	 * We add a custom property to the upload item for timing
	 */
	async onUploadStart(item: UploadItem): Promise<void> {
		// Add custom property to track start time
		(item as any).startedAt = Date.now();
	}

	/**
	 * Track successful uploads and calculate performance metrics
	 */
	async onUploadComplete(item: UploadItem, result: any): Promise<void> {
		this.metrics.successfulUploads++;

		// Calculate upload time if we tracked the start
		const startTime = (item as any).startedAt;
		if (startTime) {
			const uploadTime = Date.now() - startTime;
			this.metrics.uploadTimes.push(uploadTime);
			
			// Update average upload time
			this.metrics.averageUploadTime =
				this.metrics.uploadTimes.reduce((a, b) => a + b, 0) / this.metrics.uploadTimes.length;
		}

		this.saveMetrics();
	}

	/**
	 * Track failed uploads and categorize error types
	 */
	async onUploadError(item: UploadItem, error: Error): Promise<void> {
		this.metrics.failedUploads++;

		// Categorize errors by type for better debugging
		const errorType = error.constructor.name || 'UnknownError';
		this.metrics.errors.set(errorType, (this.metrics.errors.get(errorType) || 0) + 1);

		this.saveMetrics();
	}

	/**
	 * Get current metrics with calculated success rate
	 * Returns a plain object (not a Map) for easy serialization
	 */
	public getMetrics(): {
		totalFiles: number;
		totalSize: number;
		successfulUploads: number;
		failedUploads: number;
		successRate: number;
		averageUploadTime: number;
		errorBreakdown: Record<string, number>;
		totalUploadsAttempted: number;
	} {
		const totalUploadsAttempted = this.metrics.successfulUploads + this.metrics.failedUploads;
		const successRate = totalUploadsAttempted > 0 ? 
			(this.metrics.successfulUploads / totalUploadsAttempted) * 100 : 0;

		return {
			...this.metrics,
			successRate,
			errorBreakdown: Object.fromEntries(this.metrics.errors),
			totalUploadsAttempted
		};
	}

	/**
	 * Reset all metrics - useful for testing or periodic cleanup
	 */
	public resetMetrics(): void {
		this.metrics = {
			totalFiles: 0,
			totalSize: 0,
			successfulUploads: 0,
			failedUploads: 0,
			averageUploadTime: 0,
			uploadTimes: [],
			errors: new Map()
		};
		this.saveMetrics();
		console.log('[Analytics] Metrics reset');
	}

	/**
	 * Save metrics to localStorage for persistence across sessions
	 * Convert Map to Array for JSON serialization
	 */
	private saveMetrics(): void {
		try {
			localStorage.setItem(
				'upload-analytics',
				JSON.stringify({
					...this.metrics,
					errors: Array.from(this.metrics.errors.entries()) // Convert Map to Array
				})
			);
		} catch (error) {
			console.error('Failed to save analytics:', error);
		}
	}

	/**
	 * Load metrics from localStorage on initialization
	 * Convert Array back to Map for error tracking
	 */
	private loadMetrics(): void {
		try {
			const stored = localStorage.getItem('upload-analytics');
			if (stored) {
				const data = JSON.parse(stored);
				this.metrics = {
					...data,
					errors: new Map(data.errors || []) // Convert Array back to Map
				};
			}
		} catch (error) {
			console.error('Failed to load analytics:', error);
		}
	}
}

/**
 * Example: File Processing Plugin
 * 
 * This plugin demonstrates how to process files before upload.
 * Includes image compression, resizing, and quality optimization.
 * 
 * Usage:
 * ```typescript
 * const manager = new FirebaseUploadManager();
 * const processingPlugin = new FileProcessingPlugin({
 *   compressImages: true,
 *   maxImageWidth: 1920,
 *   maxImageHeight: 1080,
 *   imageQuality: 0.8  // 80% quality
 * });
 * 
 * await manager.registerPlugin(processingPlugin);
 * ```
 * 
 * Key Features:
 * - Automatic image compression and resizing
 * - Maintains aspect ratios when resizing
 * - Configurable quality settings
 * - Preserves original file metadata
 * - Graceful fallback if processing fails
 * 
 * Extend this plugin to add:
 * - Video compression
 * - Document conversion
 * - Watermarking
 * - Format conversion (e.g., HEIC to JPEG)
 */
export class FileProcessingPlugin implements UploadPlugin {
	name = 'file-processing';
	version = '1.0.0';
	description = 'Processes files before upload (compression, resizing, etc.)';

	// Processing configuration
	private options: {
		compressImages: boolean;      // Whether to compress image files
		maxImageWidth: number;        // Maximum width in pixels
		maxImageHeight: number;       // Maximum height in pixels
		imageQuality: number;         // JPEG quality (0.0 - 1.0)
	};

	/**
	 * Configure the file processing options
	 * @param options Processing configuration
	 */
	constructor(
		options: {
			compressImages?: boolean;      // Default: false
			maxImageWidth?: number;        // Default: 1920px
			maxImageHeight?: number;       // Default: 1080px
			imageQuality?: number;         // Default: 0.8 (80%)
		} = {}
	) {
		this.options = {
			compressImages: options.compressImages || false,
			maxImageWidth: options.maxImageWidth || 1920,
			maxImageHeight: options.maxImageHeight || 1080,
			imageQuality: options.imageQuality || 0.8
		};

		console.log('[FileProcessing] Plugin configured:', this.options);
	}

	/**
	 * Process files before they're added to the upload queue
	 * This is the main hook where file transformations happen
	 */
	async beforeFileAdd(file: File, options: any): Promise<{ file: File; options: any }> {
		// Only process images if compression is enabled
		if (this.options.compressImages && file.type.startsWith('image/')) {
			try {
				console.log(`[FileProcessing] Compressing ${file.name} (${this.formatBytes(file.size)})`);
				const processedFile = await this.compressImage(file);
				const savedBytes = file.size - processedFile.size;
				const percentSaved = ((savedBytes / file.size) * 100).toFixed(1);
				
				console.log(`[FileProcessing] Compressed ${file.name}: ${this.formatBytes(savedBytes)} saved (${percentSaved}%)`);
				return { file: processedFile, options };
			} catch (error) {
				console.warn(`[FileProcessing] Failed to compress ${file.name}:`, error);
				// Gracefully fall back to original file if compression fails
			}
		}
		
		// Return original file if no processing needed or processing failed
		return { file, options };
	}

	/**
	 * Compress and resize an image file
	 * Uses HTML5 Canvas to perform client-side image processing
	 */
	private async compressImage(file: File): Promise<File> {
		return new Promise((resolve, reject) => {
			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d');
			const img = new Image();
			const objectUrl = URL.createObjectURL(file);

			img.onload = () => {
				try {
					// Calculate new dimensions while maintaining aspect ratio
					let { width, height } = img;
					const maxWidth = this.options.maxImageWidth;
					const maxHeight = this.options.maxImageHeight;

					if (width > maxWidth || height > maxHeight) {
						const ratio = Math.min(maxWidth / width, maxHeight / height);
						width = Math.round(width * ratio);
						height = Math.round(height * ratio);
					}

					// Set canvas dimensions
					canvas.width = width;
					canvas.height = height;

					// Draw image with high quality scaling
					if (ctx) {
						ctx.imageSmoothingEnabled = true;
						ctx.imageSmoothingQuality = 'high';
						ctx.drawImage(img, 0, 0, width, height);
					}

					// Convert to blob with specified quality
					canvas.toBlob(
						(blob) => {
							URL.revokeObjectURL(objectUrl); // Clean up memory
							
							if (blob) {
								// Create new File with original metadata
								const compressedFile = new File([blob], file.name, {
									type: file.type,
									lastModified: file.lastModified
								});
								resolve(compressedFile);
							} else {
								reject(new Error('Failed to create compressed image blob'));
							}
						},
						file.type,
						this.options.imageQuality
					);
				} catch (error) {
					URL.revokeObjectURL(objectUrl);
					reject(error);
				}
			};

			img.onerror = () => {
				URL.revokeObjectURL(objectUrl);
				reject(new Error(`Failed to load image: ${file.name}`));
			};

			img.src = objectUrl;
		});
	}

	/**
	 * Utility method to format byte sizes for logging
	 */
	private formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
	}
}

/**
 * Example: Validation Enhancement Plugin
 * 
 * This plugin demonstrates how to add custom validation logic to files.
 * It includes file signature verification to prevent file type spoofing.
 * 
 * Usage:
 * ```typescript
 * const manager = new FirebaseUploadManager();
 * const validationPlugin = new ValidationEnhancementPlugin();
 * 
 * await manager.registerPlugin(validationPlugin);
 * ```
 * 
 * Key Features:
 * - File signature (magic bytes) validation
 * - Prevents malicious file uploads disguised as safe types
 * - Extends existing validation rules seamlessly
 * - Detailed validation failure logging
 * 
 * Security Note:
 * This plugin provides an additional security layer but should not be
 * the only security measure. Always validate files server-side as well.
 */
export class ValidationEnhancementPlugin implements UploadPlugin {
	name = 'validation-enhancement';
	version = '1.0.0';
	description = 'Enhances file validation with additional security checks';

	/**
	 * Enhance validation rules before they're applied to files
	 * This adds file signature checking to prevent file type spoofing
	 */
	async beforeValidation(file: File, rules: any): Promise<{ file: File; rules: any }> {
		// Add custom validation rules to the existing ones
		const enhancedRules = {
			...rules,
			customValidator: async (file: File) => {
				// Check file signature (magic bytes) to verify file type
				const isValid = await this.checkFileSignature(file);
				if (!isValid) {
					console.warn(`[ValidationEnhancement] File signature mismatch: ${file.name} (claimed: ${file.type})`);
				}
				return isValid;
			}
		};

		return { file, rules: enhancedRules };
	}

	/**
	 * Log validation results for monitoring and debugging
	 */
	async afterValidation(file: File, result: ValidationResult): Promise<void> {
		if (!result.valid) {
			console.warn(`[ValidationEnhancement] File validation failed for ${file.name}:`, result.errors);
		} else {
			console.log(`[ValidationEnhancement] File ${file.name} passed enhanced validation`);
		}
	}

	/**
	 * Check if the file's actual content matches its claimed MIME type
	 * This prevents malicious files from being disguised as safe file types
	 */
	private async checkFileSignature(file: File): Promise<boolean> {
		try {
			// Read the first few bytes of the file
			const headerSize = Math.min(file.size, 16); // Read up to 16 bytes
			const buffer = await file.slice(0, headerSize).arrayBuffer();
			const bytes = new Uint8Array(buffer);

			// Common file signatures (magic bytes)
			const signatures = {
				'image/jpeg': [0xff, 0xd8, 0xff],                    // JPEG
				'image/png': [0x89, 0x50, 0x4e, 0x47],               // PNG
				'image/gif': [0x47, 0x49, 0x46],                     // GIF
				'image/webp': [0x52, 0x49, 0x46, 0x46],              // WebP (RIFF header)
				'application/pdf': [0x25, 0x50, 0x44, 0x46],         // PDF
				'text/plain': null,                                   // Text files - no signature needed
				'text/html': null,                                    // HTML files - no signature needed
				'text/css': null,                                     // CSS files - no signature needed
				'application/json': null,                             // JSON files - no signature needed
			};

			const expectedSignature = signatures[file.type as keyof typeof signatures];
			
			// If we don't know the signature, assume it's valid (but log it)
			if (expectedSignature === undefined) {
				console.log(`[ValidationEnhancement] Unknown file type ${file.type}, skipping signature check`);
				return true;
			}

			// If signature is null, no check needed (like text files)
			if (expectedSignature === null) {
				return true;
			}

			// Check if file starts with expected signature
			const matches = expectedSignature.every((expectedByte, index) => 
				index < bytes.length && bytes[index] === expectedByte
			);

			return matches;
		} catch (error) {
			console.error(`[ValidationEnhancement] Error checking file signature for ${file.name}:`, error);
			return true; // If we can't check, assume valid to avoid blocking uploads
		}
	}
}

/**
 * Example: Queue Optimization Plugin
 * 
 * This plugin optimizes the upload queue order for better user experience.
 * It implements a "quick wins" strategy by prioritizing smaller files first.
 * 
 * Usage:
 * ```typescript
 * const manager = new FirebaseUploadManager();
 * const optimizationPlugin = new QueueOptimizationPlugin();
 * 
 * await manager.registerPlugin(optimizationPlugin);
 * ```
 * 
 * Key Features:
 * - Priority-based sorting (higher priority first)
 * - Size-based optimization (smaller files first for quick wins)
 * - Queue statistics logging
 * - Improved perceived performance
 * 
 * Strategy:
 * 1. Sort by priority (high to low)
 * 2. Within same priority, sort by size (small to large)
 * 3. This gives users quick feedback with completed small files
 *    while larger files upload in the background
 */
export class QueueOptimizationPlugin implements UploadPlugin {
	name = 'queue-optimization';
	version = '1.0.0';
	description = 'Optimizes upload queue for better user experience';

	/**
	 * Reorder the queue for optimal user experience
	 * Smaller files upload first to provide quick feedback
	 */
	async beforeQueueProcess(queue: UploadItem[]): Promise<UploadItem[]> {
		console.log(`[QueueOptimization] Optimizing queue of ${queue.length} files`);

		// Sort by priority first, then by size
		const optimizedQueue = queue.sort((a, b) => {
			// First by priority (higher priority first)
			if (a.priority !== b.priority) {
				return b.priority - a.priority;
			}

			// Then by size (smaller files first for "quick wins")
			return a.totalBytes - b.totalBytes;
		});

		// Log optimization results
		const sizeBuckets = this.categorizeBySizes(optimizedQueue);
		console.log(`[QueueOptimization] Queue optimized:`, sizeBuckets);

		return optimizedQueue;
	}

	/**
	 * Log queue processing statistics
	 */
	async afterQueueProcess(queue: UploadItem[]): Promise<void> {
		if (queue.length === 0) return;

		// Calculate and log queue statistics
		const stats = {
			totalFiles: queue.length,
			totalSize: queue.reduce((sum, item) => sum + item.totalBytes, 0),
			averageSize: queue.reduce((sum, item) => sum + item.totalBytes, 0) / queue.length,
			averagePriority: queue.reduce((sum, item) => sum + item.priority, 0) / queue.length
		};

		console.log(`[QueueOptimization] Processing ${stats.totalFiles} files, total: ${this.formatBytes(stats.totalSize)}`);
	}

	/**
	 * Categorize files by size for optimization insights
	 */
	private categorizeBySizes(queue: UploadItem[]): Record<string, number> {
		const categories = {
			'small (< 1MB)': 0,
			'medium (1-10MB)': 0,
			'large (10-100MB)': 0,
			'very large (> 100MB)': 0
		};

		queue.forEach(item => {
			const sizeMB = item.totalBytes / (1024 * 1024);
			if (sizeMB < 1) categories['small (< 1MB)']++;
			else if (sizeMB < 10) categories['medium (1-10MB)']++;
			else if (sizeMB < 100) categories['large (10-100MB)']++;
			else categories['very large (> 100MB)']++;
		});

		return categories;
	}

	/**
	 * Utility method to format byte sizes
	 */
	private formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
	}
}
