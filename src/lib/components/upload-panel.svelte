<!-- UploadPanel.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { UploadItem, UploadStatus } from '../types.js'; // Adjust path to your types

	// Props using Svelte 5 $props rune
	let { uploadManager, visible = false } = $props<{
		uploadManager: any; // The FirebaseUploadManager instance
		visible?: boolean; // Control visibility
	}>();

	// State using Svelte 5 $state rune
	let allUploads = $state<UploadItem[]>([]);
	let completed = $state<UploadItem[]>([]);
	let skipped = $state<UploadItem[]>([]); // If you have skipped logic, else empty
	let failed = $state<UploadItem[]>([]);
	let activeTab = $state<'all' | 'completed' | 'skipped' | 'failed'>('all');
	let successMessage = $state<string | null>(null);

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

	// Update lists when uploadManager changes
	$effect(() => {
		if (uploadManager) {
			allUploads = uploadManager.getAllFiles();
			completed = uploadManager.getAllFiles('completed');
			skipped = []; // Implement if needed
			failed = uploadManager.getAllFiles('failed');
		}
	});

	// Listen for completion to show toast
	onMount(() => {
		if (uploadManager) {
			// Assuming pluginSystem or direct events; adjust if needed
			uploadManager.pluginSystem?.on('onUploadComplete', () => {
				const total = uploadManager.totalFiles;
				const done = uploadManager.successCount;
				if (done === total) {
					successMessage = `Upload successful! ${done} of ${total} uploads complete`;
					setTimeout(() => (successMessage = null), 5000); // Auto-hide after 5s
				}
			});
		}
	});

	// Copy link function
	function copyLink(url: string) {
		navigator.clipboard.writeText(url).then(() => {
			// Optional: Show toast "Link copied!"
		});
	}

	// Close panel function
	function closePanel() {
		visible = false;
	}

	// Tab change functions
	function setActiveTab(tab: 'all' | 'completed' | 'skipped' | 'failed') {
		activeTab = tab;
	}
</script>

{#if visible}
	<div class="upload-panel">
		<div class="panel-header">
			<h2>Uploads</h2>
			<button class="close-btn" onclick={closePanel}>×</button>
		</div>

		<div class="tabs">
			<button class:active={activeTab === 'all'} onclick={() => setActiveTab('all')}
				>All uploads</button
			>
			<button class:active={activeTab === 'completed'} onclick={() => setActiveTab('completed')}
				>Completed</button
			>
			<button class:active={activeTab === 'skipped'} onclick={() => setActiveTab('skipped')}
				>Skipped</button
			>
			<button class:active={activeTab === 'failed'} onclick={() => setActiveTab('failed')}
				>Failed</button
			>
		</div>

		<div class="upload-list">
			{#each currentList as item}
				<div class="upload-item">
					<input type="checkbox" />
					<div class="item-info">
						<span class="file-name">{item.file.name}</span>
						<span class="status">
							{item.status === 'uploading'
								? 'Uploading...'
								: item.status === 'completed'
									? 'Uploaded'
									: item.status === 'failed'
										? 'Failed'
										: 'Queued'}
						</span>
					</div>
					{#if item.status === 'completed' && item.downloadURL}
						<button class="copy-btn" onclick={() => copyLink(item.downloadURL!)}>Copy link</button>
					{/if}
				</div>
			{/each}
		</div>

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
		left: 0;
		width: 300px; /* Adjust width as needed */
		height: 100vh;
		background: #1e1e1e; /* Dark mode */
		color: #fff;
		padding: 1rem;
		box-shadow: 2px 0 10px rgba(0, 0, 0, 0.3);
		z-index: 1000;
		overflow-y: auto;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
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
</style>
