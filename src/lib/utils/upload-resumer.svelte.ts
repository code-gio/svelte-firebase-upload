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
	}

	// Create resumable upload state
	async createResumableUpload(
		file: File,
		metadata: Record<string, any> = {}
	): Promise<ResumableUploadState> {
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
		const results = {
			successful: 0,
			failed: 0,
			errors: [] as string[]
		};

		// Process chunks in parallel with concurrency limit
		const chunkGroups = this.chunkArray(chunks, this.parallelChunks);

		for (const chunkGroup of chunkGroups) {
			const promises = chunkGroup.map((chunk) =>
				this.uploadChunk(file, state, chunk, uploadFunction)
			);

			const chunkResults = await Promise.allSettled(promises);

			for (const result of chunkResults) {
				if (result.status === 'fulfilled') {
					if (result.value.success) {
						results.successful++;
					} else {
						results.failed++;
						results.errors.push(result.value.error || 'Unknown error');
					}
				} else {
					results.failed++;
					results.errors.push(result.reason?.message || 'Unknown error');
				}
			}
		}
		return results;
	}

	// Check if upload can be resumed
	async canResume(file: File): Promise<ResumableUploadState | null> {
		const states = await this.getAllUploadStates();

		for (const state of states) {
			if (
				state.fileName === file.name &&
				state.fileSize === file.size &&
				!this.isUploadComplete(state)
			) {
				return state;
			}
		}
		return null;
	}

	// Check if upload is complete
	isUploadComplete(state: ResumableUploadState): boolean {
		const isComplete = state.uploadedBytes >= state.fileSize;
		return isComplete;
	}

	// Get upload progress
	getUploadProgress(state: ResumableUploadState): number {
		const progress = (state.uploadedBytes / state.fileSize) * 100;
		return progress;
	}

	// Clean up completed uploads
	async cleanupCompletedUploads(): Promise<void> {
		const states = await this.getAllUploadStates();
		const completedStates = states.filter((state) => this.isUploadComplete(state));

		for (const state of completedStates) {
			await this.removeUploadState(state.fileId);
		}
	}

	// Get all upload states
	async getAllUploadStates(): Promise<ResumableUploadState[]> {
		try {
			const stored = localStorage.getItem(this.storageKey);
			return stored ? JSON.parse(stored) : [];
		} catch (error) {
			console.error('[UploadResumer] Error retrieving upload states from storage:', error);
			return [];
		}
	}

	// Private methods
	private createChunks(fileSize: number): ChunkState[] {
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
		return chunks;
	}

	private async calculateChunkHash(chunk: Blob): Promise<string> {
		const buffer = await chunk.arrayBuffer();
		const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
		return hash;
	}

	private generateFileId(file: File): string {
		const fileId = `${file.name}_${file.size}_${file.lastModified}_${Date.now()}`;
		return fileId;
	}

	private chunkArray<T>(array: T[], size: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += size) {
			chunks.push(array.slice(i, i + size));
		}
		return chunks;
	}

	private async saveUploadState(state: ResumableUploadState): Promise<void> {
		const states = await this.getAllUploadStates();
		const existingIndex = states.findIndex((s) => s.fileId === state.fileId);

		if (existingIndex >= 0) {
			states[existingIndex] = state;
		} else {
			states.push(state);
		}

		try {
			localStorage.setItem(this.storageKey, JSON.stringify(states));
		} catch (error) {
			console.error('[UploadResumer] Error saving upload state to storage:', error);
			throw error;
		}
	}

	// Remove upload state (public for external cleanup)
	async removeUploadState(fileId: string): Promise<void> {
		const states = await this.getAllUploadStates();
		const filteredStates = states.filter((s) => s.fileId !== fileId);
		try {
			localStorage.setItem(this.storageKey, JSON.stringify(filteredStates));
		} catch (error) {
			console.error('[UploadResumer] Error removing upload state from storage:', error);
			throw error;
		}
	}

	async resumeIncompleteUploads(): Promise<void> {
		try {
			const states = await this.getAllUploadStates();
			const incompleteStates = states.filter((state) => !this.isUploadComplete(state));

			for (const state of incompleteStates) {
				try {
					const {
						state: resumedState,
						remainingChunks,
						progress
					} = await this.resumeUpload(
						new File([], state.fileName), // Create a dummy file object
						state
					);
				} catch (err) {
					console.error('[UploadResumer] Failed to resume upload for file:', state.fileName, err);
				}
			}
		} catch (err) {
			console.error('[UploadResumer] Error in resumeIncompleteUploads:', err);
			throw err;
		}
	}
}
