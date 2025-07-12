import type { NetworkMonitor, RetryConfig } from '../types.js';

export class NetworkManager implements NetworkMonitor {
	public isOnline = $state(true);
	public connectionType?: string;
	public effectiveType?: string;
	public downlink?: number;

	private onlineCallbacks: (() => void)[] = [];
	private offlineCallbacks: (() => void)[] = [];
	private connection: any; // Network Information API
	private retryConfig: RetryConfig;

	constructor(retryConfig: Partial<RetryConfig> = {}) {
		this.retryConfig = {
			maxAttempts: 3,
			baseDelay: 1000,
			maxDelay: 30000,
			backoffMultiplier: 2,
			jitter: true,
			...retryConfig
		};

		this._initializeNetworkMonitoring();
	}

	// Network event listeners
	onOnline(callback: () => void): void {
		this.onlineCallbacks.push(callback);
	}

	onOffline(callback: () => void): void {
		this.offlineCallbacks.push(callback);
	}

	disconnect(): void {
		this.onlineCallbacks = [];
		this.offlineCallbacks = [];

		if (this.connection) {
			this.connection.removeEventListener('change', this._handleConnectionChange.bind(this));
		}

		window.removeEventListener('online', this._handleOnline.bind(this));
		window.removeEventListener('offline', this._handleOffline.bind(this));
	}

	// Smart retry logic with exponential backoff and jitter
	calculateRetryDelay(attempts: number): number {
		const { baseDelay, maxDelay, backoffMultiplier, jitter } = this.retryConfig;

		// Exponential backoff
		const exponentialDelay = baseDelay * Math.pow(backoffMultiplier, attempts);

		// Add jitter to avoid thundering herd
		const jitterAmount = jitter ? Math.random() * 1000 : 0;

		// Cap at maximum delay
		return Math.min(exponentialDelay + jitterAmount, maxDelay);
	}

	// Check if we should retry based on network conditions
	shouldRetry(attempts: number, error?: Error): boolean {
		if (attempts >= this.retryConfig.maxAttempts) {
			return false;
		}

		// Don't retry if offline
		if (!this.isOnline) {
			return false;
		}

		// Don't retry certain types of errors
		if (error) {
			const nonRetryableErrors = [
				'PERMISSION_DENIED',
				'INVALID_ARGUMENT',
				'NOT_FOUND',
				'ALREADY_EXISTS'
			];

			if (nonRetryableErrors.some((err) => error.message.includes(err))) {
				return false;
			}
		}

		return true;
	}

	// Get current network quality
	getNetworkQuality(): 'excellent' | 'good' | 'poor' | 'unknown' {
		if (!this.connection) return 'unknown';

		const { effectiveType, downlink } = this.connection;

		if (effectiveType === '4g' && downlink && downlink > 8) {
			// Lowered from 10
			return 'excellent';
		} else if (effectiveType === '4g' || (downlink && downlink > 3)) {
			// Lowered from 5
			return 'good';
		} else {
			return 'poor';
		}
	}

	// Get recommended upload settings based on network
	getRecommendedSettings(): {
		maxConcurrent: number;
		chunkSize: number;
		timeout: number;
	} {
		const quality = this.getNetworkQuality();

		switch (quality) {
			case 'excellent':
				return { maxConcurrent: 5, chunkSize: 5 * 1024 * 1024, timeout: 30000 };
			case 'good':
				return { maxConcurrent: 3, chunkSize: 2 * 1024 * 1024, timeout: 60000 };
			case 'poor':
				return { maxConcurrent: 1, chunkSize: 512 * 1024, timeout: 120000 };
			default:
				return { maxConcurrent: 2, chunkSize: 1024 * 1024, timeout: 60000 };
		}
	}

	// Wait for network to be available
	async waitForNetwork(timeout = 30000): Promise<boolean> {
		if (this.isOnline) return true;

		return new Promise((resolve) => {
			const timeoutId = setTimeout(() => {
				this.offlineCallbacks = this.offlineCallbacks.filter((cb) => cb !== onOnline);
				resolve(false);
			}, timeout);

			const onOnline = () => {
				clearTimeout(timeoutId);
				this.offlineCallbacks = this.offlineCallbacks.filter((cb) => cb !== onOnline);
				resolve(true);
			};

			this.onlineCallbacks.push(onOnline);
		});
	}

	// Private methods
	private _initializeNetworkMonitoring(): void {
		// Browser online/offline events
		window.addEventListener('online', this._handleOnline.bind(this));
		window.addEventListener('offline', this._handleOffline.bind(this));

		// Network Information API (if available)
		if ('connection' in navigator) {
			this.connection = (navigator as any).connection;
			this.connection.addEventListener('change', this._handleConnectionChange.bind(this));
			this._updateConnectionInfo();
		}

		// Initial state
		this.isOnline = navigator.onLine;
	}

	private _handleOnline(): void {
		this.isOnline = true;
		this.onlineCallbacks.forEach((callback) => callback());
	}

	private _handleOffline(): void {
		this.isOnline = false;
		this.offlineCallbacks.forEach((callback) => callback());
	}

	private _handleConnectionChange(): void {
		this._updateConnectionInfo();
	}

	private _updateConnectionInfo(): void {
		if (!this.connection) return;

		this.connectionType = this.connection.effectiveType;
		this.effectiveType = this.connection.effectiveType;
		this.downlink = this.connection.downlink;
	}
}
