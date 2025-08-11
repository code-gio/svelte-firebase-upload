<!-- UploadPanel.svelte -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { UploadItem, UploadStatus, UploadManagerInterface } from '../types.js';

	// Props using Svelte 5 $props rune
	let { 
		uploadManager, 
		visible = false,
		onVisibilityChange
	} = $props<{
		uploadManager: UploadManagerInterface | null;
		visible?: boolean;
		onVisibilityChange?: (visible: boolean) => void;
	}>();

	// State using Svelte 5 $state rune
	let allUploads = $state<UploadItem[]>([]);
	let completed = $state<UploadItem[]>([]);
	let skipped = $state<UploadItem[]>([]); // Reserved for future use
	let failed = $state<UploadItem[]>([]);
	let activeTab = $state<'all' | 'completed' | 'skipped' | 'failed'>('all');
	let successMessage = $state<string | null>(null);
	let copySuccess = $state<string | null>(null);

	// Derived state using Svelte 5 $derived rune
	let currentList = $derived(
		activeTab === 'all'
			? allUploads
			: activeTab === 'completed'
				? completed
				: activeTab === 'skipped'
					? skipped
					: failed
	);

	let tabCounts = $derived({
		all: allUploads.length,
		completed: completed.length,
		skipped: skipped.length,
		failed: failed.length
	});

	// Update lists when uploadManager changes
	$effect(() => {
		if (uploadManager) {
			allUploads = uploadManager.getAllFiles() || [];
			completed = uploadManager.getAllFiles('completed') || [];
			skipped = []; // Reserved for future functionality
			failed = uploadManager.getAllFiles('failed') || [];

			// Check for completion
			if (uploadManager.isIdle && completed.length > 0 && failed.length === 0) {
				if (!successMessage) {
					showSuccessMessage();
				}
			}
		} else {
			// Reset state when no upload manager
			allUploads = [];
			completed = [];
			skipped = [];
			failed = [];
		}
	});

	// Success message display
	function showSuccessMessage() {
		if (uploadManager) {
			const total = uploadManager.totalFiles;
			const done = uploadManager.successCount;
			successMessage = `Upload successful! ${done} of ${total} uploads complete`;
			setTimeout(() => (successMessage = null), 5000);
		}
	}

	// Copy link function with error handling
	async function copyLink(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			copySuccess = 'Link copied!';
			setTimeout(() => (copySuccess = null), 2000);
		} catch (error) {
			console.error('Failed to copy link:', error);
			// Fallback for older browsers
			const textArea = document.createElement('textarea');
			textArea.value = url;
			document.body.appendChild(textArea);
			textArea.select();
			try {
				document.execCommand('copy');
				copySuccess = 'Link copied!';
				setTimeout(() => (copySuccess = null), 2000);
			} catch (fallbackError) {
				console.error('Fallback copy failed:', fallbackError);
			}
			document.body.removeChild(textArea);
		}
	}

	// Close panel function
	function closePanel() {
		visible = false;
		onVisibilityChange?.(false);
	}

	// Tab change functions
	function setActiveTab(tab: 'all' | 'completed' | 'skipped' | 'failed') {
		activeTab = tab;
	}
</script>

{#if visible}
	<div class="upload-panel" role="dialog" aria-label="Upload panel" aria-modal="true">
		<div class="panel-header">
			<h2 id="panel-title">Uploads</h2>
			<button 
				class="close-btn" 
				onclick={closePanel}
				aria-label="Close upload panel"
				type="button"
			>×</button>
		</div>

		<div class="tabs" role="tablist" aria-labelledby="panel-title">
			<button 
				class:active={activeTab === 'all'} 
				onclick={() => setActiveTab('all')}
				role="tab"
				aria-selected={activeTab === 'all'}
				aria-controls="upload-list"
				type="button"
			>All uploads ({tabCounts.all})</button>
			<button 
				class:active={activeTab === 'completed'} 
				onclick={() => setActiveTab('completed')}
				role="tab"
				aria-selected={activeTab === 'completed'}
				aria-controls="upload-list"
				type="button"
			>Completed ({tabCounts.completed})</button>
			<button 
				class:active={activeTab === 'skipped'} 
				onclick={() => setActiveTab('skipped')}
				role="tab"
				aria-selected={activeTab === 'skipped'}
				aria-controls="upload-list"
				type="button"
			>Skipped ({tabCounts.skipped})</button>
			<button 
				class:active={activeTab === 'failed'} 
				onclick={() => setActiveTab('failed')}
				role="tab"
				aria-selected={activeTab === 'failed'}
				aria-controls="upload-list"
				type="button"
			>Failed ({tabCounts.failed})</button>
		</div>

		<div 
			class="upload-list" 
			id="upload-list" 
			role="tabpanel" 
			aria-labelledby="panel-title"
		>
			{#if currentList.length === 0}
				<div class="empty-state">
					<p>No {activeTab === 'all' ? '' : activeTab} uploads to display</p>
				</div>
			{:else}
				{#each currentList as item, index}
					<div class="upload-item" role="listitem">
						<input 
							type="checkbox" 
							id="file-{item.id}"
							aria-label="Select {item.file.name}"
						/>
						<div class="item-info">
							<span class="file-name" title={item.file.name}>{item.file.name}</span>
							<span class="status" aria-live="polite">
								{item.status === 'uploading'
									? `Uploading... ${Math.round(item.progress)}%`
									: item.status === 'completed'
										? 'Uploaded'
										: item.status === 'failed'
											? `Failed: ${item.error || 'Unknown error'}`
											: 'Queued'}
							</span>
							{#if item.status === 'uploading'}
								<div class="progress-bar" role="progressbar" 
									 aria-valuenow={Math.round(item.progress)}
									 aria-valuemin="0" 
									 aria-valuemax="100">
									<div class="progress-fill" style="width: {item.progress}%"></div>
								</div>
							{/if}
						</div>
						{#if item.status === 'completed' && item.downloadURL}
							<button 
								class="copy-btn" 
								onclick={() => copyLink(item.downloadURL!)}
								type="button"
								aria-label="Copy download link for {item.file.name}"
							>
								Copy link
							</button>
						{/if}
					</div>
				{/each}
			{/if}
		</div>

		<!-- Copy success notification -->
		{#if copySuccess}
			<div class="copy-success" aria-live="polite">
				<span class="toast-icon">✓</span>
				{copySuccess}
			</div>
		{/if}

		{#if successMessage}
			<div class="success-toast">
				<span class="toast-icon">✓</span>
				{successMessage}
				<button class="add-btn">Add ↓</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.upload-panel {
		position: fixed;
		top: 0;
		right: 0; /* Changed from left to right for better UX */
		width: 320px; /* Slightly wider */
		height: 100vh;
		background: #1e1e1e;
		color: #fff;
		padding: 1rem;
		box-shadow: -2px 0 10px rgba(0, 0, 0, 0.3); /* Shadow from left */
		z-index: 1000;
		overflow-y: auto;
		font-family: system-ui, -apple-system, sans-serif;
		transform: translateX(100%);
		transition: transform 0.3s ease-in-out;
	}

	/* Show panel with slide-in animation */
	.upload-panel {
		transform: translateX(0);
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.panel-header h2 {
		font-size: 1.25rem;
		margin: 0;
	}

	.close-btn {
		background: none;
		border: none;
		color: #fff;
		font-size: 1.5rem;
		cursor: pointer;
	}

	.tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.tabs button {
		background: #333;
		border: none;
		color: #aaa;
		padding: 0.5rem 1rem;
		border-radius: 20px;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.tabs button.active {
		background: #444;
		color: #fff;
	}

	.upload-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.upload-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border-radius: 8px;
		background: #2a2a2a;
	}

	.item-info {
		flex: 1;
	}

	.file-name {
		display: block;
		font-size: 0.875rem;
	}

	.status {
		font-size: 0.75rem;
		color: #888;
	}

	.copy-btn {
		background: #fff;
		color: #000;
		border: none;
		padding: 0.25rem 0.75rem;
		border-radius: 20px;
		cursor: pointer;
		font-size: 0.75rem;
	}

	.success-toast {
		position: absolute;
		bottom: 1rem;
		left: 1rem;
		right: 1rem;
		background: #228b22; /* Green */
		color: #fff;
		padding: 0.75rem 1rem;
		border-radius: 8px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.toast-icon {
		font-size: 1rem;
	}

	.add-btn {
		background: rgba(255, 255, 255, 0.2);
		border: none;
		color: #fff;
		padding: 0.25rem 0.75rem;
		border-radius: 20px;
		margin-left: auto;
		cursor: pointer;
	}

	/* New styles for improved functionality */
	.empty-state {
		padding: 2rem 1rem;
		text-align: center;
		color: #888;
		font-style: italic;
	}

	.progress-bar {
		width: 100%;
		height: 4px;
		background: #333;
		border-radius: 2px;
		margin-top: 0.25rem;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #3b82f6, #1d4ed8);
		transition: width 0.3s ease;
	}

	.copy-success {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		background: #10b981;
		color: #fff;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		z-index: 1001;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
	}

	/* Responsive design */
	@media (max-width: 768px) {
		.upload-panel {
			width: 100vw;
			right: 0;
		}
	}
</style>
