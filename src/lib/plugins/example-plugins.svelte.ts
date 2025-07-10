import type { UploadPlugin, PluginConfig } from '../utils/plugin-system.svelte.js';
import type { UploadItem, UploadStatus, ValidationResult } from '../types.js';

// Example: Logging Plugin
export class LoggingPlugin implements UploadPlugin {
	name = 'logging';
	version = '1.0.0';
	description = 'Logs all upload events for debugging and monitoring';

	private logLevel: 'debug' | 'info' | 'warn' | 'error';
	private logToConsole: boolean;
	private logToStorage: boolean;

	constructor(
		config: {
			logLevel?: 'debug' | 'info' | 'warn' | 'error';
			logToConsole?: boolean;
			logToStorage?: boolean;
		} = {}
	) {
		this.logLevel = config.logLevel || 'info';
		this.logToConsole = config.logToConsole !== false;
		this.logToStorage = config.logToStorage || false;
	}

	async onInitialize(manager: any): Promise<void> {
		this.log('info', 'LoggingPlugin initialized', { manager: manager.constructor.name });
	}

	async beforeFileAdd(file: File, options: any): Promise<{ file: File; options: any }> {
		this.log('info', 'File being added', { fileName: file.name, fileSize: file.size, options });
		return { file, options };
	}

	async afterFileAdd(item: UploadItem): Promise<void> {
		this.log('info', 'File added to queue', { fileId: item.id, fileName: item.file.name });
	}

	async onUploadStart(item: UploadItem): Promise<void> {
		this.log('info', 'Upload started', { fileId: item.id, fileName: item.file.name });
	}

	async onUploadProgress(item: UploadItem, progress: number): Promise<void> {
		if (progress % 10 === 0) {
			// Log every 10%
			this.log('debug', 'Upload progress', { fileId: item.id, progress });
		}
	}

	async onUploadComplete(item: UploadItem, result: any): Promise<void> {
		this.log('info', 'Upload completed', { fileId: item.id, fileName: item.file.name, result });
	}

	async onUploadError(item: UploadItem, error: Error): Promise<void> {
		this.log('error', 'Upload failed', {
			fileId: item.id,
			fileName: item.file.name,
			error: error.message
		});
	}

	async onStatusChange(
		item: UploadItem,
		oldStatus: UploadStatus,
		newStatus: UploadStatus
	): Promise<void> {
		this.log('debug', 'Status changed', { fileId: item.id, oldStatus, newStatus });
	}

	async onError(error: Error, context: any): Promise<void> {
		this.log('error', 'Plugin error', { error: error.message, context });
	}

	private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void {
		const logEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			data
		};

		if (this.logToConsole) {
			console[level](`[${this.name}] ${message}`, data);
		}

		if (this.logToStorage) {
			this.saveToStorage(logEntry);
		}
	}

	private saveToStorage(logEntry: any): void {
		try {
			const logs = JSON.parse(localStorage.getItem('upload-logs') || '[]');
			logs.push(logEntry);

			// Keep only last 1000 logs
			if (logs.length > 1000) {
				logs.splice(0, logs.length - 1000);
			}

			localStorage.setItem('upload-logs', JSON.stringify(logs));
		} catch (error) {
			console.error('Failed to save log to storage:', error);
		}
	}
}

// Example: Analytics Plugin
export class AnalyticsPlugin implements UploadPlugin {
	name = 'analytics';
	version = '1.0.0';
	description = 'Tracks upload analytics and performance metrics';

	private metrics = {
		totalFiles: 0,
		totalSize: 0,
		successfulUploads: 0,
		failedUploads: 0,
		averageUploadTime: 0,
		uploadTimes: [] as number[],
		errors: new Map<string, number>()
	};

	async onInitialize(manager: any): Promise<void> {
		this.loadMetrics();
	}

	async afterFileAdd(item: UploadItem): Promise<void> {
		this.metrics.totalFiles++;
		this.metrics.totalSize += item.totalBytes;
		this.saveMetrics();
	}

	async onUploadStart(item: UploadItem): Promise<void> {
		item.startedAt = Date.now();
	}

	async onUploadComplete(item: UploadItem, result: any): Promise<void> {
		this.metrics.successfulUploads++;

		if (item.startedAt) {
			const uploadTime = Date.now() - item.startedAt;
			this.metrics.uploadTimes.push(uploadTime);
			this.metrics.averageUploadTime =
				this.metrics.uploadTimes.reduce((a, b) => a + b, 0) / this.metrics.uploadTimes.length;
		}

		this.saveMetrics();
	}

	async onUploadError(item: UploadItem, error: Error): Promise<void> {
		this.metrics.failedUploads++;

		const errorType = error.constructor.name;
		this.metrics.errors.set(errorType, (this.metrics.errors.get(errorType) || 0) + 1);

		this.saveMetrics();
	}

	getMetrics(): any {
		return { ...this.metrics };
	}

	resetMetrics(): void {
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
	}

	private saveMetrics(): void {
		try {
			localStorage.setItem(
				'upload-analytics',
				JSON.stringify({
					...this.metrics,
					errors: Array.from(this.metrics.errors.entries())
				})
			);
		} catch (error) {
			console.error('Failed to save analytics:', error);
		}
	}

	private loadMetrics(): void {
		try {
			const stored = localStorage.getItem('upload-analytics');
			if (stored) {
				const data = JSON.parse(stored);
				this.metrics = {
					...data,
					errors: new Map(data.errors || [])
				};
			}
		} catch (error) {
			console.error('Failed to load analytics:', error);
		}
	}
}

// Example: File Processing Plugin
export class FileProcessingPlugin implements UploadPlugin {
	name = 'file-processing';
	version = '1.0.0';
	description = 'Processes files before upload (compression, resizing, etc.)';

	private options: {
		compressImages: boolean;
		maxImageWidth: number;
		maxImageHeight: number;
		imageQuality: number;
	};

	constructor(
		options: {
			compressImages?: boolean;
			maxImageWidth?: number;
			maxImageHeight?: number;
			imageQuality?: number;
		} = {}
	) {
		this.options = {
			compressImages: options.compressImages || false,
			maxImageWidth: options.maxImageWidth || 1920,
			maxImageHeight: options.maxImageHeight || 1080,
			imageQuality: options.imageQuality || 0.8
		};
	}

	async beforeFileAdd(file: File, options: any): Promise<{ file: File; options: any }> {
		if (this.options.compressImages && file.type.startsWith('image/')) {
			try {
				const processedFile = await this.compressImage(file);
				return { file: processedFile, options };
			} catch (error) {
				console.warn('Failed to compress image:', error);
			}
		}
		return { file, options };
	}

	private async compressImage(file: File): Promise<File> {
		return new Promise((resolve, reject) => {
			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d');
			const img = new Image();

			img.onload = () => {
				// Calculate new dimensions
				let { width, height } = img;
				const maxWidth = this.options.maxImageWidth;
				const maxHeight = this.options.maxImageHeight;

				if (width > maxWidth || height > maxHeight) {
					const ratio = Math.min(maxWidth / width, maxHeight / height);
					width *= ratio;
					height *= ratio;
				}

				// Set canvas dimensions
				canvas.width = width;
				canvas.height = height;

				// Draw and compress
				ctx?.drawImage(img, 0, 0, width, height);

				canvas.toBlob(
					(blob) => {
						if (blob) {
							const compressedFile = new File([blob], file.name, {
								type: file.type,
								lastModified: file.lastModified
							});
							resolve(compressedFile);
						} else {
							reject(new Error('Failed to compress image'));
						}
					},
					file.type,
					this.options.imageQuality
				);
			};

			img.onerror = () => reject(new Error('Failed to load image'));
			img.src = URL.createObjectURL(file);
		});
	}
}

// Example: Validation Enhancement Plugin
export class ValidationEnhancementPlugin implements UploadPlugin {
	name = 'validation-enhancement';
	version = '1.0.0';
	description = 'Enhances file validation with additional checks';

	async beforeValidation(file: File, rules: any): Promise<{ file: File; rules: any }> {
		// Add custom validation rules
		const enhancedRules = {
			...rules,
			customValidator: async (file: File) => {
				// Check file signature (magic bytes)
				const isValid = await this.checkFileSignature(file);
				return isValid;
			}
		};

		return { file, rules: enhancedRules };
	}

	async afterValidation(file: File, result: ValidationResult): Promise<void> {
		if (!result.valid) {
			console.warn(`File validation failed for ${file.name}:`, result.errors);
		}
	}

	private async checkFileSignature(file: File): Promise<boolean> {
		const buffer = await file.arrayBuffer();
		const bytes = new Uint8Array(buffer);

		// Check common file signatures
		const signatures = {
			'image/jpeg': [0xff, 0xd8, 0xff],
			'image/png': [0x89, 0x50, 0x4e, 0x47],
			'image/gif': [0x47, 0x49, 0x46],
			'application/pdf': [0x25, 0x50, 0x44, 0x46]
		};

		const expectedSignature = signatures[file.type as keyof typeof signatures];
		if (!expectedSignature) return true; // Unknown type, assume valid

		return expectedSignature.every((byte, index) => bytes[index] === byte);
	}
}

// Example: Queue Optimization Plugin
export class QueueOptimizationPlugin implements UploadPlugin {
	name = 'queue-optimization';
	version = '1.0.0';
	description = 'Optimizes upload queue for better performance';

	async beforeQueueProcess(queue: UploadItem[]): Promise<UploadItem[]> {
		// Sort by priority and size (smaller files first for quick wins)
		return queue.sort((a, b) => {
			// First by priority (higher first)
			if (a.priority !== b.priority) {
				return b.priority - a.priority;
			}

			// Then by size (smaller first)
			return a.totalBytes - b.totalBytes;
		});
	}

	async afterQueueProcess(queue: UploadItem[]): Promise<void> {
		// Log queue statistics
		const stats = {
			totalFiles: queue.length,
			totalSize: queue.reduce((sum, item) => sum + item.totalBytes, 0),
			averagePriority: queue.reduce((sum, item) => sum + item.priority, 0) / queue.length
		};

		console.log('Queue processed:', stats);
	}
}
