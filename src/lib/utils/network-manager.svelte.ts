import type { NetworkMonitor, RetryConfig } from '../types.js';

/**
 * Network monitoring and retry management utility.
 * 
 * Features:
 * - Real-time network status monitoring
 * - Intelligent retry logic with exponential backoff
 * - Network quality assessment
 * - Adaptive retry delays based on connection quality
 * - Circuit breaker pattern for failed operations
 * 
 * @example
 * ```typescript
 * const networkManager = new NetworkManager({
 *   maxAttempts: 5,
 *   baseDelay: 1000,
 *   backoffMultiplier: 2
 * });
 * 
 * networkManager.onOffline(() => console.log('Connection lost'));
 * networkManager.onOnline(() => console.log('Connection restored'));
 * 
 * // Retry an operation with intelligent backoff
 * await networkManager.retryWithBackoff(
 *   () => uploadFile(data),
 *   'file-upload'
 * );
 * ```
 */
export class NetworkManager implements NetworkMonitor {
	public isOnline = $state(true);
	public connectionType?: string;
	public effectiveType?: string;
	public downlink?: number;

	private _onlineCallbacks: (() => void)[] = [];
	private _offlineCallbacks: (() => void)[] = [];
	private _connection: any; // Network Information API
	private _retryConfig: RetryConfig;
	
	// Store bound event handlers for proper cleanup
	private _boundHandlers = {
		online: this._handleOnline.bind(this),
		offline: this._handleOffline.bind(this),
		connectionChange: this._handleConnectionChange.bind(this)
	};

	constructor(retryConfig: Partial<RetryConfig> = {}) {
		this._retryConfig = {
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
		this._onlineCallbacks.push(callback);
	}

	onOffline(callback: () => void): void {
		this._offlineCallbacks.push(callback);
	}

	disconnect(): void {
		// Clear callback arrays
		this._onlineCallbacks.length = 0;
		this._offlineCallbacks.length = 0;

		// Remove event listeners using stored bound handlers
		if (this._connection) {
			this._connection.removeEventListener('change', this._boundHandlers.connectionChange);
			this._connection = null;
		}

		window.removeEventListener('online', this._boundHandlers.online);
		window.removeEventListener('offline', this._boundHandlers.offline);
	}

	// Smart retry logic with exponential backoff and jitter
	calculateRetryDelay(attempts: number): number {
		const { baseDelay, maxDelay, backoffMultiplier, jitter } = this._retryConfig;

		// Exponential backoff
		let exponentialDelay = baseDelay * Math.pow(backoffMultiplier, attempts);

		// Adjust based on network quality
		const networkQuality = this.getNetworkQuality();
		switch (networkQuality) {
			case 'poor':
				exponentialDelay *= 2; // Double delay for poor networks
				break;
			case 'good':
				exponentialDelay *= 1.2; // Slightly longer delay
				break;
			case 'excellent':
				exponentialDelay *= 0.8; // Shorter delay for excellent networks
				break;
		}

		// Add jitter to avoid thundering herd
		const jitterAmount = jitter ? Math.random() * 1000 : 0;

		// Cap at maximum delay
		return Math.min(exponentialDelay + jitterAmount, maxDelay);
	}

	/**
	 * Execute an operation with intelligent retry and backoff logic.
	 * 
	 * Features circuit breaker pattern, network-aware delays, and automatic
	 * offline handling.
	 * 
	 * @param operation - Async operation to retry
	 * @param context - Context string for logging (default: 'unknown')
	 * @returns Promise resolving to operation result
	 * @throws {Error} When all retry attempts are exhausted
	 * 
	 * @example
	 * ```typescript
	 * const result = await networkManager.retryWithBackoff(
	 *   async () => {
	 *     const response = await fetch('/api/upload', { method: 'POST', body });
	 *     if (!response.ok) throw new Error('Upload failed');
	 *     return response.json();
	 *   },
	 *   'file-upload'
	 * );
	 * ```
	 */
	async retryWithBackoff<T>(
		operation: () => Promise<T>, 
		context: string = 'unknown'
	): Promise<T> {
		let attempts = 0;
		let lastError: Error;

		while (attempts < this._retryConfig.maxAttempts) {
			try {
				return await operation();
			} catch (error) {
				lastError = error as Error;
				attempts++;

				if (!this.shouldRetry(attempts, lastError)) {
					console.warn(`[NetworkManager] ${context}: Not retrying after ${attempts} attempts. Error: ${lastError.message}`);
					throw lastError;
				}

				if (attempts < this._retryConfig.maxAttempts) {
					const delay = this.calculateRetryDelay(attempts);
					console.warn(`[NetworkManager] ${context}: Attempt ${attempts} failed, retrying in ${delay}ms. Error: ${lastError.message}`);
					
					// Wait for network if offline
					if (!this.isOnline) {
						const networkAvailable = await this.waitForNetwork(delay);
						if (!networkAvailable) {
							console.error(`[NetworkManager] ${context}: Network unavailable, aborting retry`);
							throw new Error('Network unavailable');
						}
					} else {
						await new Promise(resolve => setTimeout(resolve, delay));
					}
				}
			}
		}

		console.error(`[NetworkManager] ${context}: All ${this._retryConfig.maxAttempts} attempts failed`);
		throw lastError!;
	}

	// Check if we should retry based on network conditions
	shouldRetry(attempts: number, error?: Error): boolean {
		if (attempts >= this._retryConfig.maxAttempts) {
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
				'ALREADY_EXISTS',
				'QUOTA_EXCEEDED',
				'UNAUTHENTICATED'
			];

			const retryableErrors = [
				'NETWORK_ERROR',
				'TIMEOUT',
				'INTERNAL',
				'UNAVAILABLE',
				'CANCELLED',
				'ABORTED'
			];

			// Check for non-retryable errors first
			if (nonRetryableErrors.some((err) => error.message.toUpperCase().includes(err))) {
				return false;
			}

			// For unknown errors, check network quality
			if (!retryableErrors.some((err) => error.message.toUpperCase().includes(err))) {
				const networkQuality = this.getNetworkQuality();
				// Only retry unknown errors if network quality is good
				return networkQuality === 'excellent' || networkQuality === 'good';
			}
		}

		return true;
	}

	// Get current network quality
	getNetworkQuality(): 'excellent' | 'good' | 'poor' | 'unknown' {
		if (!this._connection) return 'unknown';

		const { effectiveType, downlink } = this._connection;

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
				this._onlineCallbacks = this._onlineCallbacks.filter((cb) => cb !== onOnline);
				resolve(false);
			}, timeout);

			const onOnline = () => {
				clearTimeout(timeoutId);
				this._onlineCallbacks = this._onlineCallbacks.filter((cb) => cb !== onOnline);
				resolve(true);
			};

			this._onlineCallbacks.push(onOnline);
		});
	}

	// Private methods
	private _initializeNetworkMonitoring(): void {
		// Browser online/offline events using stored bound handlers
		window.addEventListener('online', this._boundHandlers.online);
		window.addEventListener('offline', this._boundHandlers.offline);

		// Network Information API (if available)
		if ('connection' in navigator) {
			this._connection = (navigator as any).connection;
			this._connection.addEventListener('change', this._boundHandlers.connectionChange);
			this._updateConnectionInfo();
		}

		// Initial state
		this.isOnline = navigator.onLine;
	}

	private _handleOnline(): void {
		this.isOnline = true;
		this._onlineCallbacks.forEach((callback) => callback());
	}

	private _handleOffline(): void {
		this.isOnline = false;
		this._offlineCallbacks.forEach((callback) => callback());
	}

	private _handleConnectionChange(): void {
		this._updateConnectionInfo();
	}

	private _updateConnectionInfo(): void {
		if (!this._connection) return;

		this.connectionType = this._connection.type;
		this.effectiveType = this._connection.effectiveType;
		this.downlink = this._connection.downlink;
	}
}
