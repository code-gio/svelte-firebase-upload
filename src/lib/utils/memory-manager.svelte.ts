import type { VirtualQueueConfig, FileBatch, UploadItem } from '../types.js';

export class MemoryManager {
	private config: VirtualQueueConfig;
	private pendingFiles: File[] = [];
	private batches: Map<string, FileBatch> = new Map();
	private db: IDBDatabase | null = null;
	private pendingTotalFiles: number = 0;
	private pendingTotalSize: number = 0;

	constructor(config: Partial<VirtualQueueConfig> = {}) {
		this.config = {
			maxMemoryItems: 1000,
			batchSize: 100,
			...config
		};
		console.log('[MemoryManager] Initialized with config:', this.config);
	}

	// Add files in batches to avoid memory spikes
	async addFilesLazy(files: File[], batchSize = this.config.batchSize): Promise<string[]> {
		console.log(
			'[MemoryManager] addFilesLazy called with',
			files.length,
			'files, batchSize:',
			batchSize
		);
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
			console.log(`[MemoryManager] Created batch ${batchId} with ${batch.length} files`);
			batchIds.push(batchId);

			// Store in IndexedDB if persistence is enabled
			if (this.config.persistenceKey) {
				try {
					await this._persistBatch(fileBatch);
					console.log(`[MemoryManager] Persisted batch ${batchId}`);
				} catch (err) {
					console.error(`[MemoryManager] Error persisting batch ${batchId}:`, err);
				}
			}
		}

		return batchIds;
	}

	// Process a batch and return upload items
	async processBatch(batchId: string): Promise<UploadItem[]> {
		console.log(`[MemoryManager] processBatch called for batchId: ${batchId}`);
		const batch = this.batches.get(batchId);
		if (!batch || batch.processed) {
			console.warn(`[MemoryManager] Batch ${batchId} not found or already processed`);
			return [];
		}

		const uploadItems: UploadItem[] = [];

		for (const file of batch.files) {
			const fileId = this._generateFileId(file);
			const filePath = `uploads/${file.name}`;
			console.log(`[MemoryManager] Assigning file path: ${filePath} for file:`, file.name);
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

		console.log(
			`[MemoryManager] Batch ${batchId} processed, returning ${uploadItems.length} upload items`
		);
		return uploadItems;
	}

	// Get next batch to process
	getNextBatch(): FileBatch | null {
		console.log('[MemoryManager] getNextBatch called');
		for (const [batchId, batch] of this.batches) {
			if (!batch.processed) {
				console.log(`[MemoryManager] Next batch to process: ${batchId}`);
				return batch;
			}
		}
		console.log('[MemoryManager] No unprocessed batches found');
		return null;
	}

	// Clean up processed batches
	async cleanupProcessedBatches(): Promise<void> {
		console.log('[MemoryManager] cleanupProcessedBatches called');
		const processedBatches = Array.from(this.batches.entries()).filter(
			([_, batch]) => batch.processed
		);

		for (const [batchId, _] of processedBatches) {
			this.batches.delete(batchId);
			console.log(`[MemoryManager] Deleted processed batch: ${batchId}`);

			// Also remove from IndexedDB if persistence is enabled
			if (this.db && this.config.persistenceKey) {
				try {
					const transaction = this.db.transaction(['fileBatches'], 'readwrite');
					const store = transaction.objectStore('fileBatches');
					await store.delete(batchId);
					console.log(`[MemoryManager] Removed batch ${batchId} from IndexedDB`);
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

	// IndexedDB Persistence
	async initializePersistence(): Promise<void> {
		if (!this.config.persistenceKey) return;

		try {
			this.db = await this._openDatabase();
		} catch (error) {
			console.warn('Failed to initialize IndexedDB persistence:', error);
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
		console.log(`[MemoryManager] Generated batchId: ${batchId}`);
		return batchId;
	}

	private _generateFileId(file: File): string {
		const fileId = `${file.name}_${file.size}_${file.lastModified}_${Math.random().toString(36).substring(2, 11)}`;
		console.log(`[MemoryManager] Generated fileId: ${fileId} for file:`, file.name);
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
		}
	}
}
