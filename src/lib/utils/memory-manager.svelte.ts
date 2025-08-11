import type { VirtualQueueConfig, FileBatch, UploadItem } from '../types.js';

export class MemoryManager {
	private config: VirtualQueueConfig;
	private pendingFiles: File[] = [];
	private batches: Map<string, FileBatch> = new Map();
	private db: IDBDatabase | null = null;
	private pendingTotalFiles: number = 0;
	private pendingTotalSize: number = 0;
	private dbInitializationAttempts: number = 0;
	private readonly maxDbInitAttempts: number = 3;
	private dbInitializationPromise: Promise<void> | null = null;

	constructor(config: Partial<VirtualQueueConfig> = {}) {
		// Validate and sanitize configuration
		this.config = this._validateConfig({
			maxMemoryItems: 1000,
			batchSize: 100,
			...config
		});

		// Initialize persistence if enabled
		if (this.config.persistenceKey) {
			this._initializePersistenceWithRetry();
		}
	}

	private _validateConfig(config: VirtualQueueConfig): VirtualQueueConfig {
		const warnings: string[] = [];
		
		// Validate maxMemoryItems
		if (typeof config.maxMemoryItems !== 'number' || config.maxMemoryItems < 10) {
			warnings.push('maxMemoryItems must be at least 10');
			config.maxMemoryItems = Math.max(10, config.maxMemoryItems || 1000);
		} else if (config.maxMemoryItems > 100000) {
			warnings.push('maxMemoryItems exceeds recommended maximum (100000), may cause memory issues');
			config.maxMemoryItems = 100000;
		}

		// Validate batchSize
		if (typeof config.batchSize !== 'number' || config.batchSize < 1) {
			warnings.push('batchSize must be at least 1');
			config.batchSize = Math.max(1, config.batchSize || 100);
		} else if (config.batchSize > config.maxMemoryItems) {
			warnings.push('batchSize cannot exceed maxMemoryItems');
			config.batchSize = Math.min(config.batchSize, config.maxMemoryItems);
		}

		// Log warnings
		if (warnings.length > 0) {
			console.warn('[MemoryManager] Configuration warnings:', warnings);
		}

		return config;
	}

	// Add files in batches to avoid memory spikes
	async addFilesLazy(files: File[], batchSize = this.config.batchSize): Promise<string[]> {
		const batchIds: string[] = [];
		this.pendingTotalFiles += files.length;
		this.pendingTotalSize += files.reduce((sum, file) => sum + file.size, 0);

		for (let i = 0; i < files.length; i += batchSize) {
			const batch = files.slice(i, i + batchSize);
			const batchId = this._generateBatchId();

			const fileBatch: FileBatch = {
				id: batchId,
				files: batch,
				processed: false,
				createdAt: Date.now()
			};

			this.batches.set(batchId, fileBatch);
			batchIds.push(batchId);

			// Store in IndexedDB if persistence is enabled
			if (this.config.persistenceKey) {
				await this._persistBatchWithRetry(fileBatch);
			}
		}

		return batchIds;
	}

	// Process a batch and return upload items
	async processBatch(batchId: string): Promise<UploadItem[]> {
		const batch = this.batches.get(batchId);
		if (!batch || batch.processed) {
			console.warn(`[MemoryManager] Batch ${batchId} not found or already processed`);
			return [];
		}

		const uploadItems: UploadItem[] = [];

		for (const file of batch.files) {
			const fileId = this._generateFileId(file);
			const filePath = `uploads/${file.name}`;
			const uploadItem: UploadItem = {
				id: fileId,
				file: file,
				path: filePath,
				metadata: {},
				priority: 0,
				status: 'queued',
				progress: 0,
				uploadedBytes: 0,
				totalBytes: file.size,
				error: null,
				attempts: 0,
				createdAt: Date.now()
			};

			uploadItems.push(uploadItem);
		}

		batch.processed = true;

		// Subtract from pending totals when loading
		this.pendingTotalFiles -= batch.files.length;
		this.pendingTotalSize -= batch.files.reduce((sum, file) => sum + file.size, 0);

		return uploadItems;
	}

	// Get next batch to process
	getNextBatch(): FileBatch | null {
		for (const [batchId, batch] of this.batches) {
			if (!batch.processed) {
				return batch;
			}
		}
		return null;
	}

	// Clean up processed batches
	async cleanupProcessedBatches(): Promise<void> {
		const processedBatches = Array.from(this.batches.entries()).filter(
			([_, batch]) => batch.processed
		);

		for (const [batchId, _] of processedBatches) {
			this.batches.delete(batchId);

			// Also remove from IndexedDB if persistence is enabled
			if (this.db && this.config.persistenceKey) {
				try {
					const transaction = this.db.transaction(['fileBatches'], 'readwrite');
					const store = transaction.objectStore('fileBatches');
					await store.delete(batchId);
				} catch (error) {
					console.warn(`[MemoryManager] Failed to remove batch ${batchId} from IndexedDB:`, error);
				}
			}
		}
	}

	// Complete cleanup and destroy
	async destroy(): Promise<void> {
		// Clear all batches
		this.batches.clear();
		this.pendingFiles = [];

		// Close IndexedDB connection
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}

	// Memory usage monitoring
	getMemoryUsage(): { batches: number; pendingFiles: number; totalSize: number } {
		let totalSize = 0;
		for (const batch of this.batches.values()) {
			for (const file of batch.files) {
				totalSize += file.size;
			}
		}

		return {
			batches: this.batches.size,
			pendingFiles: this.pendingFiles.length,
			totalSize
		};
	}

	// Get pending totals
	getPendingTotalFiles(): number {
		return this.pendingTotalFiles;
	}

	getPendingTotalSize(): number {
		return this.pendingTotalSize;
	}

	// IndexedDB Persistence with enhanced error recovery
	async initializePersistence(): Promise<void> {
		if (!this.config.persistenceKey) return;

		try {
			this.db = await this._openDatabase();
			this.dbInitializationAttempts = 0; // Reset attempts on success
		} catch (error) {
			console.warn('Failed to initialize IndexedDB persistence:', error);
			throw error; // Re-throw for retry mechanism
		}
	}

	// Initialize persistence with retry mechanism
	private async _initializePersistenceWithRetry(): Promise<void> {
		if (this.dbInitializationPromise) {
			return this.dbInitializationPromise;
		}

		this.dbInitializationPromise = this._attemptInitialization();
		return this.dbInitializationPromise;
	}

	private async _attemptInitialization(): Promise<void> {
		while (this.dbInitializationAttempts < this.maxDbInitAttempts) {
			try {
				await this.initializePersistence();
				return; // Success
			} catch (error) {
				this.dbInitializationAttempts++;
				console.warn(`[MemoryManager] DB initialization attempt ${this.dbInitializationAttempts} failed:`, error);
				
				if (this.dbInitializationAttempts >= this.maxDbInitAttempts) {
					console.error(`[MemoryManager] Failed to initialize DB after ${this.maxDbInitAttempts} attempts. Persistence disabled.`);
					this.config.persistenceKey = undefined; // Disable persistence
					return;
				}

				// Exponential backoff
				const delay = Math.min(1000 * Math.pow(2, this.dbInitializationAttempts - 1), 10000);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}

	async saveState(state: any): Promise<void> {
		if (!this.db || !this.config.persistenceKey) return;

		try {
			const transaction = this.db.transaction(['uploadState'], 'readwrite');
			const store = transaction.objectStore('uploadState');
			await store.put({
				key: this.config.persistenceKey,
				state: JSON.stringify(state),
				timestamp: Date.now()
			});
		} catch (error) {
			console.warn('Failed to save state:', error);
		}
	}

	async loadState(): Promise<any | null> {
		if (!this.db || !this.config.persistenceKey) return null;

		try {
			const transaction = this.db.transaction(['uploadState'], 'readonly');
			const store = transaction.objectStore('uploadState');
			const result = await store.get(this.config.persistenceKey);
			return result ? JSON.parse((result as any).state) : null;
		} catch (error) {
			console.warn('Failed to load state:', error);
			return null;
		}
	}

	// Private methods
	private _generateBatchId(): string {
		const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
		return batchId;
	}

	private _generateFileId(file: File): string {
		const fileId = `${file.name}_${file.size}_${file.lastModified}_${Math.random().toString(36).substring(2, 11)}`;
		return fileId;
	}

	private async _openDatabase(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open('UploadManagerDB', 1);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Create object stores
				if (!db.objectStoreNames.contains('uploadState')) {
					db.createObjectStore('uploadState', { keyPath: 'key' });
				}

				if (!db.objectStoreNames.contains('fileBatches')) {
					db.createObjectStore('fileBatches', { keyPath: 'id' });
				}
			};
		});
	}

	private async _persistBatch(batch: FileBatch): Promise<void> {
		if (!this.db) return;

		try {
			const transaction = this.db.transaction(['fileBatches'], 'readwrite');
			const store = transaction.objectStore('fileBatches');
			await store.put(batch);
		} catch (error) {
			console.warn('Failed to persist batch:', error);
			throw error;
		}
	}

	// Persist batch with retry mechanism
	private async _persistBatchWithRetry(batch: FileBatch, maxAttempts: number = 3): Promise<void> {
		// Ensure DB is initialized
		if (this.config.persistenceKey && !this.db) {
			await this._initializePersistenceWithRetry();
		}

		if (!this.db || !this.config.persistenceKey) {
			return; // Persistence disabled or failed
		}

		let attempts = 0;
		while (attempts < maxAttempts) {
			try {
				await this._persistBatch(batch);
				return; // Success
			} catch (error) {
				attempts++;
				console.warn(`[MemoryManager] Batch persistence attempt ${attempts} failed:`, error);
				
				if (attempts >= maxAttempts) {
					console.error(`[MemoryManager] Failed to persist batch ${batch.id} after ${maxAttempts} attempts`);
					return; // Give up but don't crash
				}

				// Exponential backoff for retries
				const delay = Math.min(200 * Math.pow(2, attempts - 1), 2000);
				await new Promise(resolve => setTimeout(resolve, delay));

				// Try to reinitialize DB connection if it seems broken
				if (attempts === maxAttempts - 1 && this.config.persistenceKey) {
					try {
						this.db = await this._openDatabase();
					} catch (reinitError) {
						console.warn('[MemoryManager] Failed to reinitialize DB:', reinitError);
					}
				}
			}
		}
	}
}
