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

export class UploadResumer {
	private storageKey = 'upload-resume-state';
	private chunkSize: number;
	private verifyChunks: boolean;
	private parallelChunks: number;

	constructor(options: ResumeOptions = {}) {
		this.chunkSize = options.chunkSize || 1024 * 1024; // 1MB chunks
		this.verifyChunks = options.verifyChunks || true;
		this.parallelChunks = options.parallelChunks || 3;
		console.log('[UploadResumer] Initialized with config:', options);
	}

	// Create resumable upload state
	async createResumableUpload(
		file: File,
		metadata: Record<string, any> = {}
	): Promise<ResumableUploadState> {
		console.log('[UploadResumer] createResumableUpload called for file:', file.name);
		const fileId = this.generateFileId(file);
		const chunks = this.createChunks(file.size);

		const state: ResumableUploadState = {
			fileId,
			fileName: file.name,
			fileSize: file.size,
			uploadedBytes: 0,
			chunks,
			metadata,
			createdAt: Date.now(),
			lastUpdated: Date.now()
		};

		await this.saveUploadState(state);
		console.log('[UploadResumer] createResumableUpload completed for file:', file.name);
		return state;
	}

	// Resume an interrupted upload
	async resumeUpload(
		file: File,
		state: ResumableUploadState
	): Promise<{
		state: ResumableUploadState;
		remainingChunks: ChunkState[];
		progress: number;
	}> {
		console.log('[UploadResumer] resumeUpload called for file:', file.name);
		// Verify file hasn't changed
		if (file.size !== state.fileSize || file.name !== state.fileName) {
			console.error(
				'[UploadResumer] File has changed since last upload attempt. File size:',
				file.size,
				'vs',
				state.fileSize,
				'File name:',
				file.name,
				'vs',
				state.fileName
			);
			throw new Error('File has changed since last upload attempt');
		}

		// Find remaining chunks to upload
		const remainingChunks = state.chunks.filter((chunk) => !chunk.uploaded);
		const uploadedBytes = state.chunks
			.filter((chunk) => chunk.uploaded)
			.reduce((total, chunk) => total + (chunk.end - chunk.start), 0);

		// Update state
		state.uploadedBytes = uploadedBytes;
		state.lastUpdated = Date.now();

		const progress = (uploadedBytes / state.fileSize) * 100;

		await this.saveUploadState(state);
		console.log('[UploadResumer] resumeUpload completed for file:', file.name);

		return {
			state,
			remainingChunks,
			progress
		};
	}

	// Upload a chunk
	async uploadChunk(
		file: File,
		state: ResumableUploadState,
		chunk: ChunkState,
		uploadFunction: (chunk: Blob, metadata: any) => Promise<string>
	): Promise<{ success: boolean; url?: string; error?: string }> {
		console.log('[UploadResumer] uploadChunk called for chunk index:', chunk.index);
		try {
			// Extract chunk from file
			const chunkBlob = file.slice(chunk.start, chunk.end);

			// Calculate chunk hash if verification is enabled
			if (this.verifyChunks) {
				chunk.hash = await this.calculateChunkHash(chunkBlob);
			}

			// Upload chunk
			const url = await uploadFunction(chunkBlob, {
				...state.metadata,
				chunkIndex: chunk.index,
				chunkHash: chunk.hash,
				fileId: state.fileId
			});

			// Mark chunk as uploaded
			chunk.uploaded = true;
			state.uploadedBytes += chunk.end - chunk.start;
			state.lastUpdated = Date.now();

			await this.saveUploadState(state);
			console.log('[UploadResumer] uploadChunk completed for chunk index:', chunk.index);

			return { success: true, url };
		} catch (error) {
			console.error('[UploadResumer] Error uploading chunk index:', chunk.index, error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			};
		}
	}

	// Upload multiple chunks in parallel
	async uploadChunksParallel(
		file: File,
		state: ResumableUploadState,
		chunks: ChunkState[],
		uploadFunction: (chunk: Blob, metadata: any) => Promise<string>
	): Promise<{
		successful: number;
		failed: number;
		errors: string[];
	}> {
		console.log('[UploadResumer] uploadChunksParallel called for', chunks.length, 'chunks');
		const results = {
			successful: 0,
			failed: 0,
			errors: [] as string[]
		};

		// Process chunks in parallel with concurrency limit
		const chunkGroups = this.chunkArray(chunks, this.parallelChunks);

		for (const chunkGroup of chunkGroups) {
			console.log('[UploadResumer] Processing chunk group with', chunkGroup.length, 'chunks');
			const promises = chunkGroup.map((chunk) =>
				this.uploadChunk(file, state, chunk, uploadFunction)
			);

			const chunkResults = await Promise.allSettled(promises);

			for (const result of chunkResults) {
				if (result.status === 'fulfilled') {
					if (result.value.success) {
						results.successful++;
						console.log('[UploadResumer] Chunk upload successful:', result.value.url);
					} else {
						results.failed++;
						results.errors.push(result.value.error || 'Unknown error');
						console.error('[UploadResumer] Chunk upload failed:', result.value.error);
					}
				} else {
					results.failed++;
					results.errors.push(result.reason?.message || 'Unknown error');
					console.error(
						'[UploadResumer] Chunk upload failed due to error:',
						result.reason?.message
					);
				}
			}
		}
		console.log(
			'[UploadResumer] uploadChunksParallel completed. Successful:',
			results.successful,
			'Failed:',
			results.failed
		);
		return results;
	}

	// Check if upload can be resumed
	async canResume(file: File): Promise<ResumableUploadState | null> {
		console.log('[UploadResumer] canResume called for file:', file.name);
		const states = await this.getAllUploadStates();

		for (const state of states) {
			if (
				state.fileName === file.name &&
				state.fileSize === file.size &&
				!this.isUploadComplete(state)
			) {
				console.log('[UploadResumer] Found resumable state for file:', file.name);
				return state;
			}
		}
		console.log('[UploadResumer] No resumable state found for file:', file.name);
		return null;
	}

	// Check if upload is complete
	isUploadComplete(state: ResumableUploadState): boolean {
		console.log('[UploadResumer] isUploadComplete called for file:', state.fileName);
		const isComplete = state.uploadedBytes >= state.fileSize;
		console.log('[UploadResumer] isUploadComplete result for file:', state.fileName, isComplete);
		return isComplete;
	}

	// Get upload progress
	getUploadProgress(state: ResumableUploadState): number {
		console.log('[UploadResumer] getUploadProgress called for file:', state.fileName);
		const progress = (state.uploadedBytes / state.fileSize) * 100;
		console.log('[UploadResumer] getUploadProgress result for file:', state.fileName, progress);
		return progress;
	}

	// Clean up completed uploads
	async cleanupCompletedUploads(): Promise<void> {
		console.log('[UploadResumer] cleanupCompletedUploads called');
		const states = await this.getAllUploadStates();
		const completedStates = states.filter((state) => this.isUploadComplete(state));

		for (const state of completedStates) {
			console.log('[UploadResumer] Removing completed upload state for file:', state.fileName);
			await this.removeUploadState(state.fileId);
		}
		console.log('[UploadResumer] cleanupCompletedUploads completed');
	}

	// Get all upload states
	async getAllUploadStates(): Promise<ResumableUploadState[]> {
		console.log('[UploadResumer] getAllUploadStates called');
		try {
			const stored = localStorage.getItem(this.storageKey);
			console.log(
				'[UploadResumer] Retrieved',
				stored ? 'existing' : 'no',
				'upload states from storage'
			);
			return stored ? JSON.parse(stored) : [];
		} catch (error) {
			console.error('[UploadResumer] Error retrieving upload states from storage:', error);
			return [];
		}
	}

	// Private methods
	private createChunks(fileSize: number): ChunkState[] {
		console.log('[UploadResumer] createChunks called for file size:', fileSize);
		const chunks: ChunkState[] = [];
		let index = 0;

		for (let start = 0; start < fileSize; start += this.chunkSize) {
			const end = Math.min(start + this.chunkSize, fileSize);
			chunks.push({
				index: index++,
				start,
				end,
				uploaded: false
			});
		}
		console.log('[UploadResumer] createChunks completed. Total chunks:', chunks.length);
		return chunks;
	}

	private async calculateChunkHash(chunk: Blob): Promise<string> {
		console.log('[UploadResumer] calculateChunkHash called for chunk size:', chunk.size);
		const buffer = await chunk.arrayBuffer();
		const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
		console.log('[UploadResumer] calculateChunkHash completed. Hash:', hash);
		return hash;
	}

	private generateFileId(file: File): string {
		console.log('[UploadResumer] generateFileId called for file:', file.name);
		const fileId = `${file.name}_${file.size}_${file.lastModified}_${Date.now()}`;
		console.log('[UploadResumer] generateFileId completed. File ID:', fileId);
		return fileId;
	}

	private chunkArray<T>(array: T[], size: number): T[][] {
		console.log(
			'[UploadResumer] chunkArray called with array size:',
			array.length,
			'and chunk size:',
			size
		);
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += size) {
			chunks.push(array.slice(i, i + size));
		}
		console.log('[UploadResumer] chunkArray completed. Total chunks:', chunks.length);
		return chunks;
	}

	private async saveUploadState(state: ResumableUploadState): Promise<void> {
		console.log('[UploadResumer] saveUploadState called for file:', state.fileName);
		const states = await this.getAllUploadStates();
		const existingIndex = states.findIndex((s) => s.fileId === state.fileId);

		if (existingIndex >= 0) {
			states[existingIndex] = state;
			console.log('[UploadResumer] Updated existing upload state for file:', state.fileName);
		} else {
			states.push(state);
			console.log('[UploadResumer] Added new upload state for file:', state.fileName);
		}

		try {
			localStorage.setItem(this.storageKey, JSON.stringify(states));
			console.log('[UploadResumer] Upload state saved successfully for file:', state.fileName);
		} catch (error) {
			console.error('[UploadResumer] Error saving upload state to storage:', error);
			throw error;
		}
	}

	// Remove upload state (public for external cleanup)
	async removeUploadState(fileId: string): Promise<void> {
		console.log('[UploadResumer] removeUploadState called for file ID:', fileId);
		const states = await this.getAllUploadStates();
		const filteredStates = states.filter((s) => s.fileId !== fileId);
		try {
			localStorage.setItem(this.storageKey, JSON.stringify(filteredStates));
			console.log('[UploadResumer] Upload state removed successfully for file ID:', fileId);
		} catch (error) {
			console.error('[UploadResumer] Error removing upload state from storage:', error);
			throw error;
		}
	}

	async resumeIncompleteUploads(): Promise<void> {
		console.log('[UploadResumer] resumeIncompleteUploads called');
		try {
			const states = await this.getAllUploadStates();
			const incompleteStates = states.filter((state) => !this.isUploadComplete(state));
			console.log('[UploadResumer] Found', incompleteStates.length, 'incomplete uploads to resume');

			for (const state of incompleteStates) {
				console.log('[UploadResumer] Attempting to resume upload for file:', state.fileName);
				try {
					const {
						state: resumedState,
						remainingChunks,
						progress
					} = await this.resumeUpload(
						new File([], state.fileName), // Create a dummy file object
						state
					);
					console.log(
						'[UploadResumer] Successfully resumed upload for file:',
						state.fileName,
						'Progress:',
						progress
					);
				} catch (err) {
					console.error('[UploadResumer] Failed to resume upload for file:', state.fileName, err);
				}
			}
			console.log('[UploadResumer] resumeIncompleteUploads completed');
		} catch (err) {
			console.error('[UploadResumer] Error in resumeIncompleteUploads:', err);
			throw err;
		}
	}
}
