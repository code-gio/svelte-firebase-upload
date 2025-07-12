<script lang="ts">
	import FirebaseUploadManager from '../upload-manager.svelte.js';
	import type { UploadItem, UploadStatus } from '../types.js';
	import { onDestroy } from 'svelte';
	import FilesIcon from './files-icon.svelte';
	// Props
	let {
		storage = null,
		uploadPath = 'uploads/',
		autoStart = true,
		maxFileSize = 50 * 1024 * 1024, // 50MB default
		allowedFileTypes = [],
		showFileTypeError = true
	} = $props<{
		storage?: any;
		uploadPath?: string;
		autoStart?: boolean;
		maxFileSize?: number;
		allowedFileTypes?: string[];
		showFileTypeError?: boolean;
	}>();

	// Upload manager instance
	let uploadManager = $state<FirebaseUploadManager | null>(null);

	// File state
	let files = $state<File[]>([]);
	let isDragOver = $state<boolean>(false);
	let fileInput = $state<HTMLInputElement>();

	// Upload state
	let isUploading = $state<boolean>(false);
	let uploadProgress = $state<number>(0);
	let uploadStatus = $state<string>('idle');
	let uploadError = $state<string | null>(null);

	// Derived file arrays
	let queuedFiles = $derived(getFilesByStatus('queued'));
	let activeFiles = $derived(getFilesByStatus('uploading'));
	let completedFiles = $derived(getFilesByStatus('completed'));
	let failedFiles = $derived(getFilesByStatus('failed'));

	// File-based progress tracking
	let fileProgress = $derived(
		uploadManager ? Math.round((uploadManager.successCount / uploadManager.totalFiles) * 100) : 0
	);
	// Initialize upload manager when storage is provided
	$effect(() => {
		if (storage && !uploadManager) {
			uploadManager = new FirebaseUploadManager({
				autoStart: autoStart,
				maxConcurrentUploads: 5, // Reduced from 10 to prevent bandwidth overload
				chunkSize: 1024 * 1024 * 1, // 1MB chunks for better reliability (unchanged)
				retryAttempts: 3,
				retryDelay: 2000, // 2 second delay between retries (unchanged)
				enableHealthChecks: true,
				enableSmartScheduling: true,
				maxBandwidthMbps: 50, // Increased from 10 to allow faster starts
				adaptiveBandwidth: false // Disabled to prevent over-adjustments; set to true after testing
			});
			uploadManager.setStorage(storage);
		}
	});

	// Watch upload manager state changes
	$effect(() => {
		if (!uploadManager) return;

		// Update upload state based on manager
		isUploading = uploadManager.isProcessing;
		uploadProgress = uploadManager.totalProgress;

		if (uploadManager.isIdle) {
			uploadStatus = 'idle';
		} else if (uploadManager.isProcessing) {
			uploadStatus = 'uploading';
		} else if (uploadManager.isPaused) {
			uploadStatus = 'paused';
		}

		// Check for errors
		if (uploadManager.failureCount > 0) {
			uploadError = `${uploadManager.failureCount} upload(s) failed`;
		} else {
			uploadError = null;
		}
	});

	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		isDragOver = true;
	}

	function handleDragLeave(event: DragEvent): void {
		event.preventDefault();
		isDragOver = false;
	}

	async function handleDrop(event: DragEvent): Promise<void> {
		event.preventDefault();
		isDragOver = false;

		if (event.dataTransfer?.files) {
			const droppedFiles = Array.from(event.dataTransfer.files);
			await addFiles(droppedFiles);
		}
	}

	async function handleFileSelect(event: Event): Promise<void> {
		const target = event.target as HTMLInputElement;
		if (target.files) {
			const selectedFiles = Array.from(target.files);
			await addFiles(selectedFiles);
		}
	}

	async function addFiles(newFiles: File[]): Promise<void> {
		if (!uploadManager) {
			console.error('Upload manager not initialized');
			return;
		}

		// Validate files
		const validationResult = validateFiles(newFiles);
		if (!validationResult.valid) {
			uploadError = validationResult.error || 'Validation failed';
			return;
		}

		try {
			// Add files to the upload manager
			const addedCount = await uploadManager.addFiles(newFiles, {
				path: uploadPath
			});

			// Update local files state
			files = [...files, ...newFiles];

			// Clear file input
			if (fileInput) {
				fileInput.value = '';
			}
		} catch (error) {
			console.error('Error adding files:', error);
			uploadError = error instanceof Error ? error.message : 'Failed to add files';
		}
	}

	function validateFiles(files: File[]): { valid: boolean; error?: string } {
		for (const file of files) {
			// Check file size
			if (file.size > maxFileSize) {
				const maxSizeMB = Math.round(maxFileSize / (1024 * 1024));
				return {
					valid: false,
					error: `File "${file.name}" is too large. Maximum size is ${maxSizeMB}MB.`
				};
			}

			// Check file type only if allowedFileTypes is not empty
			if (allowedFileTypes.length > 0) {
				const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
				if (!allowedFileTypes.includes(fileExtension)) {
					if (showFileTypeError) {
						const allowedTypes = allowedFileTypes.join(', ');
						return {
							valid: false,
							error: `File "${file.name}" is not allowed. Allowed types: ${allowedTypes}`
						};
					}
				}
			}
		}

		return { valid: true };
	}

	function handleKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			triggerFileInput();
		}
	}

	function triggerFileInput(): void {
		fileInput?.click();
	}

	// Upload control functions
	async function startUpload(): Promise<void> {
		if (!uploadManager) return;
		try {
			await uploadManager.start();
		} catch (error) {
			console.error('Error starting upload:', error);
			uploadError = error instanceof Error ? error.message : 'Failed to start upload';
		}
	}

	async function pauseUpload(): Promise<void> {
		if (!uploadManager) return;
		try {
			await uploadManager.pause();
		} catch (error) {
			console.error('Error pausing upload:', error);
		}
	}

	async function resumeUpload(): Promise<void> {
		if (!uploadManager) return;
		try {
			await uploadManager.resume();
		} catch (error) {
			console.error('Error resuming upload:', error);
		}
	}

	async function stopUpload(): Promise<void> {
		if (!uploadManager) return;
		try {
			await uploadManager.stop();
		} catch (error) {
			console.error('Error stopping upload:', error);
		}
	}

	// Get upload statistics
	function getUploadStats() {
		if (!uploadManager) return null;

		return {
			totalFiles: uploadManager.totalFiles,
			uploadedSize: uploadManager.uploadedSize,
			totalSize: uploadManager.totalSize,
			successCount: uploadManager.successCount,
			failureCount: uploadManager.failureCount,
			currentSpeed: uploadManager.currentSpeed,
			estimatedTimeRemaining: uploadManager.estimatedTimeRemaining
		};
	}

	// Get files by status
	function getFilesByStatus(status: UploadStatus): UploadItem[] {
		if (!uploadManager) return [];
		return uploadManager.getAllFiles(status);
	}

	// Cleanup on component destroy
	onDestroy(() => {
		if (uploadManager) {
			uploadManager.destroy();
		}
	});
</script>

<div class="upload-container">
	<div
		role="button"
		tabindex="0"
		aria-label="Drop files here or click to browse"
		class="upload-area {isDragOver ? 'dragover' : ''}"
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		onclick={triggerFileInput}
		onkeydown={handleKeyDown}
	>
		<div class="upload-content">
			<div class="upload-icon">
				<FilesIcon />
			</div>

			<div class="upload-text">
				<span class="upload-main-text">Drop your files here or </span>
				<span class="upload-browse-text">browse</span>
			</div>

			<div class="upload-formats">
				{allowedFileTypes.length > 0 ? allowedFileTypes.join(', ').toUpperCase() : 'ALL FILE TYPES'}
			</div>
		</div>
	</div>

	<!-- Hidden file input -->
	<input
		id="file-upload"
		bind:this={fileInput}
		type="file"
		class="sr-only"
		multiple
		accept={allowedFileTypes.length > 0 ? allowedFileTypes.join(',') : undefined}
		onchange={handleFileSelect}
	/>

	<!-- Upload Progress -->
	{#if isUploading || uploadProgress > 0}
		<div class="upload-progress-container">
			<div class="upload-progress-header">
				<span class="upload-status">{uploadStatus}</span>
				<span class="upload-percentage"
					>{Math.round(uploadProgress)}% (bytes) / {fileProgress}% (files)</span
				>
			</div>

			<div class="upload-progress-bar">
				<div class="upload-progress-fill" style="width: {uploadProgress}%"></div>
			</div>

			{#if uploadManager}
				{@const stats = getUploadStats()}
				{#if stats}
					<div class="upload-stats">
						<span>Files: {stats.successCount} completed, {stats.failureCount} failed</span>
						<span>Speed: {Math.round(stats.currentSpeed / 1024)} KB/s</span>
						{#if stats.estimatedTimeRemaining}
							<span>ETA: {Math.round(stats.estimatedTimeRemaining)}s</span>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- Upload Controls -->
	{#if uploadManager && (uploadManager.hasQueuedFiles || uploadManager.isActive)}
		<div class="upload-controls">
			{#if uploadStatus === 'uploading'}
				<button class="upload-btn pause-btn" onclick={pauseUpload}> Pause </button>
			{:else if uploadStatus === 'paused'}
				<button class="upload-btn resume-btn" onclick={resumeUpload}> Resume </button>
			{:else if uploadManager.hasQueuedFiles}
				<button class="upload-btn start-btn" onclick={startUpload}> Start Upload </button>
			{/if}

			<button class="upload-btn stop-btn" onclick={stopUpload}> Stop </button>
		</div>
	{/if}

	<!-- Error Display -->
	{#if uploadError}
		<div class="upload-error">
			{uploadError}
		</div>
	{/if}

	<!-- File Lists -->
	{#if uploadManager}
		<div class="file-lists">
			<!-- Queued Files -->
			{#if queuedFiles.length > 0}
				<div class="file-section">
					<h3 class="file-section-title">Queued ({queuedFiles.length})</h3>
					<ul class="file-list">
						{#each queuedFiles as file}
							<li class="file-item queued">
								{file.file.name} ({Math.round(file.totalBytes / 1024)} KB)
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<!-- Active Files -->
			{#if activeFiles.length > 0}
				<div class="file-section">
					<h3 class="file-section-title">Uploading ({activeFiles.length})</h3>
					<ul class="file-list">
						{#each activeFiles as file}
							<li class="file-item uploading">
								{file.file.name} - {Math.round(file.progress)}%
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<!-- Completed Files -->
			{#if completedFiles.length > 0}
				<div class="file-section">
					<h3 class="file-section-title">Completed ({completedFiles.length})</h3>
					<ul class="file-list">
						{#each completedFiles as file}
							<li class="file-item completed">
								{file.file.name}
								{#if file.downloadURL}
									<a href={file.downloadURL} target="_blank" class="download-link">Download</a>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<!-- Failed Files -->

			{#if failedFiles.length > 0}
				<div class="file-section">
					<h3 class="file-section-title">Failed ({failedFiles.length})</h3>
					<ul class="file-list">
						{#each failedFiles as file}
							<li class="file-item failed">
								{file.file.name} - {file.error}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.upload-container {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.upload-area {
		background: white;
		border: 2px dashed #d1d5db;
		border-radius: 12px;
		padding: 80px 40px;
		text-align: center;
		cursor: pointer;
		transition: all 0.2s ease;
		position: relative;
	}

	.upload-area:hover {
		border-color: #3b82f6;
		background: #f8faff;
	}

	.upload-area:focus {
		outline: none;
		border-color: #3b82f6;
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
	}

	.upload-area.dragover {
		border-color: #3b82f6;
		background: #f0f7ff;
	}

	.upload-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 24px;
	}

	.upload-icon {
		color: #9ca3af;
		width: 64px;
		height: 64px;
	}

	.upload-text {
		font-size: 18px;
		line-height: 1.5;
	}

	.upload-main-text {
		color: #374151;
		font-weight: 500;
	}

	.upload-browse-text {
		color: #3b82f6;
		font-weight: 600;
		text-decoration: underline;
	}

	.upload-formats {
		color: #9ca3af;
		font-size: 14px;
		font-weight: 400;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* Upload Progress Styles */
	.upload-progress-container {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 16px;
	}

	.upload-progress-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}

	.upload-status {
		font-size: 14px;
		font-weight: 500;
		color: #374151;
		text-transform: capitalize;
	}

	.upload-percentage {
		font-size: 14px;
		font-weight: 600;
		color: #3b82f6;
	}

	.upload-progress-bar {
		width: 100%;
		height: 8px;
		background: #f3f4f6;
		border-radius: 4px;
		overflow: hidden;
		margin-bottom: 8px;
	}

	.upload-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #3b82f6, #1d4ed8);
		transition: width 0.3s ease;
	}

	.upload-stats {
		display: flex;
		gap: 16px;
		font-size: 12px;
		color: #6b7280;
	}

	/* Upload Controls */
	.upload-controls {
		display: flex;
		gap: 8px;
		justify-content: center;
	}

	.upload-btn {
		padding: 8px 16px;
		border: 1px solid #d1d5db;
		border-radius: 6px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.start-btn {
		background: #3b82f6;
		color: white;
		border-color: #3b82f6;
	}

	.start-btn:hover {
		background: #2563eb;
		border-color: #2563eb;
	}

	.pause-btn {
		background: #f59e0b;
		color: white;
		border-color: #f59e0b;
	}

	.pause-btn:hover {
		background: #d97706;
		border-color: #d97706;
	}

	.resume-btn {
		background: #10b981;
		color: white;
		border-color: #10b981;
	}

	.resume-btn:hover {
		background: #059669;
		border-color: #059669;
	}

	.stop-btn {
		background: #ef4444;
		color: white;
		border-color: #ef4444;
	}

	.stop-btn:hover {
		background: #dc2626;
		border-color: #dc2626;
	}

	/* Error Display */
	.upload-error {
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 6px;
		padding: 12px;
		color: #dc2626;
		font-size: 14px;
	}

	/* File Lists */
	.file-lists {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.file-section {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 16px;
	}

	.file-section-title {
		font-size: 14px;
		font-weight: 600;
		color: #374151;
		margin-bottom: 8px;
	}

	.file-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.file-item {
		padding: 8px 0;
		font-size: 14px;
		border-bottom: 1px solid #f3f4f6;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.file-item:last-child {
		border-bottom: none;
	}

	.file-item.queued {
		color: #6b7280;
	}

	.file-item.uploading {
		color: #3b82f6;
		font-weight: 500;
	}

	.file-item.completed {
		color: #10b981;
	}

	.file-item.failed {
		color: #ef4444;
	}

	.download-link {
		color: #3b82f6;
		text-decoration: none;
		font-size: 12px;
	}

	.download-link:hover {
		text-decoration: underline;
	}
</style>
