import type { ValidationRule, ValidationResult } from '../types.js';

/**
 * Comprehensive file validation utility with security and performance features.
 * 
 * Features:
 * - File size and type validation
 * - Content-based duplicate detection using SHA-256 hashing
 * - Image dimension extraction
 * - Video duration detection
 * - Security checks for dangerous file types
 * - Custom validation rules support
 * - Batch validation with error recovery
 * 
 * @example
 * ```typescript
 * const validator = new FileValidator();
 * 
 * // Validate single file
 * const result = await validator.validateFile(file, {
 *   maxSize: 10 * 1024 * 1024, // 10MB
 *   allowedTypes: ['image/*', '.pdf']
 * });
 * 
 * // Batch validate files
 * const results = await validator.validateFiles(files, {
 *   maxSize: 5 * 1024 * 1024,
 *   allowedTypes: ['image/jpeg', 'image/png']
 * });
 * 
 * // Detect duplicates
 * const duplicates = await validator.detectDuplicates(files);
 * ```
 */
export class FileValidator {
	// Track object URLs for cleanup
	private _objectUrls: Set<string> = new Set();

	// File signature constants for content validation
	private static readonly FILE_SIGNATURES = new Map([
		// Images
		['image/jpeg', [[0xFF, 0xD8, 0xFF]]],
		['image/png', [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]]],
		['image/gif', [[0x47, 0x49, 0x46, 0x38], [0x47, 0x49, 0x46, 0x39]]],
		['image/webp', [[0x52, 0x49, 0x46, 0x46]]],
		// Documents
		['application/pdf', [[0x25, 0x50, 0x44, 0x46]]],
		['application/zip', [[0x50, 0x4B, 0x03, 0x04], [0x50, 0x4B, 0x05, 0x06]]],
		// Executable files (dangerous)
		['application/x-msdownload', [[0x4D, 0x5A]]],
		['application/x-executable', [[0x7F, 0x45, 0x4C, 0x46]]],
	]);

	constructor() {
		// Initialized
	}

	private _defaultRules: ValidationRule = {
		maxSize: 100 * 1024 * 1024, // 100MB default
		allowedTypes: ['*/*'] // Allow all types by default
	};

	// Validate a single file against rules
	async validateFile(file: File, rules: Partial<ValidationRule> = {}): Promise<ValidationResult> {
		const mergedRules = { ...this._defaultRules, ...rules };
		const errors: string[] = [];
		const warnings: string[] = [];

		// Size validation
		if (mergedRules.maxSize && file.size > mergedRules.maxSize) {
			errors.push(
				`File size (${this.formatBytes(file.size)}) exceeds maximum allowed size (${this.formatBytes(mergedRules.maxSize)})`
			);
		}

		// Type validation
		if (mergedRules.allowedTypes && mergedRules.allowedTypes.length > 0) {
			const isAllowed = this.isFileTypeAllowed(file, [...mergedRules.allowedTypes]);
			if (!isAllowed) {
				errors.push(
					`File type '${file.type}' is not allowed. Allowed types: ${mergedRules.allowedTypes.join(', ')}`
				);
			}
		}

		// Content validation (virus scan, etc.)
		if (mergedRules.customValidator) {
			try {
				const isValid = await mergedRules.customValidator(file);
				if (!isValid) {
					errors.push('File failed custom validation');
				}
			} catch (error) {
				errors.push(
					`Custom validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
				);
			}
		}

		// Additional checks
		const additionalChecks = await this.performAdditionalChecks(file);
		errors.push(...additionalChecks.errors);
		warnings.push(...additionalChecks.warnings);

		// Content-based validation (security)
		const contentValidation = await this.validateFileContent(file);
		errors.push(...contentValidation.errors);
		warnings.push(...contentValidation.warnings);

		const result: ValidationResult = {
			valid: errors.length === 0,
			errors,
			warnings
		};

		if (!result.valid) {
			console.warn(`[FileValidator] File failed validation: ${file.name}`);
			console.warn(`[FileValidator] Errors: ${result.errors.join(', ')}`);
			console.warn(`[FileValidator] Warnings: ${result.warnings.join(', ')}`);
		}

		return result;
	}

	// Validate multiple files with error recovery
	async validateFiles(
		files: File[],
		rules: Partial<ValidationRule> = {}
	): Promise<Map<File, ValidationResult>> {
		const results = new Map<File, ValidationResult>();

		// Validate files in parallel for better performance
		const validationPromises = files.map(async (file) => {
			try {
				const result = await this.validateFile(file, rules);
				results.set(file, result);
			} catch (error) {
				console.error(`[FileValidator] Validation failed for file ${file.name}:`, error);
				// Set a failed validation result instead of crashing
				results.set(file, {
					valid: false,
					errors: [`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`],
					warnings: []
				});
			}
		});

		await Promise.allSettled(validationPromises);
		return results;
	}

	// Check for duplicate files based on content hash
	async detectDuplicates(files: File[]): Promise<Map<string, File[]>> {
		const hashMap = new Map<string, File[]>();

		for (const file of files) {
			const hash = await this.calculateFileHash(file);
			if (!hashMap.has(hash)) {
				hashMap.set(hash, []);
			}
			hashMap.get(hash)!.push(file);
		}

		// Return only groups with more than one file (duplicates)
		const duplicates = new Map<string, File[]>();
		for (const [hash, fileGroup] of hashMap) {
			if (fileGroup.length > 1) {
				duplicates.set(hash, fileGroup);
			}
		}

		return duplicates;
	}

	// Calculate file hash for duplicate detection with error recovery
	async calculateFileHash(file: File, algorithm: 'SHA-1' | 'SHA-256' = 'SHA-256'): Promise<string> {
		const maxAttempts = 3;
		let attempts = 0;

		while (attempts < maxAttempts) {
			try {
				const buffer = await file.arrayBuffer();
				const hashBuffer = await crypto.subtle.digest(algorithm, buffer);
				const hashArray = Array.from(new Uint8Array(hashBuffer));
				const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
				return hash;
			} catch (error) {
				attempts++;
				console.warn(`[FileValidator] Hash calculation attempt ${attempts} failed for file ${file.name}:`, error);

				if (attempts >= maxAttempts) {
					// Fallback to simple hash based on file properties
					console.warn(`[FileValidator] Using fallback hash for file ${file.name}`);
					const fallbackData = `${file.name}_${file.size}_${file.lastModified}_${file.type}`;
					const encoder = new TextEncoder();
					const data = encoder.encode(fallbackData);
					const hashBuffer = await crypto.subtle.digest('SHA-256', data);
					const hashArray = Array.from(new Uint8Array(hashBuffer));
					return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
				}

				// Exponential backoff for retries
				const delay = Math.min(100 * Math.pow(2, attempts - 1), 1000);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}

		throw new Error('Failed to calculate file hash after all attempts');
	}

	// Get file metadata for validation
	async getFileMetadata(file: File): Promise<{
		size: number;
		type: string;
		lastModified: number;
		hash: string;
		dimensions?: { width: number; height: number };
		duration?: number;
	}> {
		const hash = await this.calculateFileHash(file);
		const metadata: any = {
			size: file.size,
			type: file.type,
			lastModified: file.lastModified,
			hash
		};

		// Get image dimensions if it's an image
		if (file.type.startsWith('image/')) {
			const dimensions = await this.getImageDimensions(file);
			if (dimensions) {
				metadata.dimensions = dimensions;
			}
		}

		// Get video duration if it's a video
		if (file.type.startsWith('video/')) {
			const duration = await this.getVideoDuration(file);
			if (duration) {
				metadata.duration = duration;
			}
		}
		return metadata;
	}

	// Private methods
	private isFileTypeAllowed(file: File, allowedTypes: string[]): boolean {
		// Handle wildcard types
		if (allowedTypes.includes('*/*')) {
			return true;
		}

		for (const allowedType of allowedTypes) {
			// Exact match
			if (file.type === allowedType) {
				return true;
			}

			// Wildcard match (e.g., "image/*" matches "image/jpeg")
			if (allowedType.endsWith('/*')) {
				const baseType = allowedType.slice(0, -2);
				if (file.type.startsWith(baseType + '/')) {
					return true;
				}
			}

			// Extension match (e.g., ".pdf" matches "application/pdf")
			if (allowedType.startsWith('.')) {
				const extension = allowedType.toLowerCase();
				if (file.name.toLowerCase().endsWith(extension)) {
					return true;
				}
			}
		}
		return false;
	}

	private async performAdditionalChecks(
		file: File
	): Promise<{ errors: string[]; warnings: string[] }> {
		const errors: string[] = [];
		const warnings: string[] = [];

		// Check for empty files
		if (file.size === 0) {
			errors.push('File is empty');
		}

		// Check for suspicious file extensions
		const suspiciousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.pif'];
		const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
		if (suspiciousExtensions.includes(fileExtension)) {
			warnings.push(`File has potentially dangerous extension: ${fileExtension}`);
		}

		// Check for very large files
		if (file.size > 1024 * 1024 * 1024) {
			// 1GB
			warnings.push('File is very large and may take a long time to upload');
		}

		return { errors, warnings };
	}

	private async getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
		return new Promise((resolve) => {
			const img = new Image();
			const objectUrl = URL.createObjectURL(file);
			this._objectUrls.add(objectUrl);
			
			const cleanup = () => {
				URL.revokeObjectURL(objectUrl);
				this._objectUrls.delete(objectUrl);
			};
			
			img.onload = () => {
				cleanup();
				resolve({ width: img.width, height: img.height });
			};
			img.onerror = () => {
				cleanup();
				resolve(null);
			};
			img.src = objectUrl;
		});
	}

	private async getVideoDuration(file: File): Promise<number | null> {
		return new Promise((resolve) => {
			const video = document.createElement('video');
			const objectUrl = URL.createObjectURL(file);
			this._objectUrls.add(objectUrl);
			
			const cleanup = () => {
				URL.revokeObjectURL(objectUrl);
				this._objectUrls.delete(objectUrl);
			};
			
			video.onloadedmetadata = () => {
				cleanup();
				resolve(video.duration);
			};
			video.onerror = () => {
				cleanup();
				resolve(null);
			};
			video.src = objectUrl;
		});
	}

	// Content-based file validation for security
	private async validateFileContent(file: File): Promise<{ errors: string[]; warnings: string[] }> {
		const errors: string[] = [];
		const warnings: string[] = [];

		try {
			// Read first 32 bytes for signature check
			const headerBuffer = await this.readFileHeader(file, 32);
			const headerBytes = new Uint8Array(headerBuffer);

			// Check if claimed MIME type matches actual file signature
			const actualType = this.detectFileTypeFromSignature(headerBytes);
			if (actualType && actualType !== file.type) {
				if (this.isDangerousFileType(actualType)) {
					errors.push(`File appears to be ${actualType} but is masquerading as ${file.type}. This is potentially dangerous.`);
				} else {
					warnings.push(`File type mismatch: file appears to be ${actualType} but has type ${file.type}`);
				}
			}

			// Check for executable signatures regardless of claimed type
			if (this.containsExecutableSignature(headerBytes)) {
				errors.push('File contains executable code signatures and is not allowed');
			}

			// Check for script content in text files
			if (file.type.startsWith('text/') || file.name.endsWith('.txt')) {
				const textContent = await this.readTextSample(file, 1024);
				if (this.containsScriptContent(textContent)) {
					warnings.push('Text file contains potentially dangerous script content');
				}
			}

		} catch (error) {
			console.warn('[FileValidator] Content validation failed:', error);
			warnings.push('Could not perform content validation');
		}

		return { errors, warnings };
	}

	private async readFileHeader(file: File, bytes: number): Promise<ArrayBuffer> {
		const slice = file.slice(0, bytes);
		return await slice.arrayBuffer();
	}

	private async readTextSample(file: File, bytes: number): Promise<string> {
		const slice = file.slice(0, bytes);
		const text = await slice.text();
		return text;
	}

	private detectFileTypeFromSignature(bytes: Uint8Array): string | null {
		for (const [mimeType, signatures] of FileValidator.FILE_SIGNATURES) {
			for (const signature of signatures) {
				if (this.matchesSignature(bytes, signature)) {
					return mimeType;
				}
			}
		}
		return null;
	}

	private matchesSignature(bytes: Uint8Array, signature: number[]): boolean {
		if (bytes.length < signature.length) return false;
		
		for (let i = 0; i < signature.length; i++) {
			if (bytes[i] !== signature[i]) return false;
		}
		return true;
	}

	private isDangerousFileType(mimeType: string): boolean {
		const dangerousTypes = [
			'application/x-msdownload',
			'application/x-executable',
			'application/x-dosexec',
			'application/x-msdos-program'
		];
		return dangerousTypes.includes(mimeType);
	}

	private containsExecutableSignature(bytes: Uint8Array): boolean {
		// Check for common executable signatures
		const executableSignatures = [
			[0x4D, 0x5A], // PE/COFF (Windows exe)
			[0x7F, 0x45, 0x4C, 0x46], // ELF (Linux/Unix executable)
			[0xFE, 0xED, 0xFA, 0xCE], // Mach-O (macOS executable)
			[0xCE, 0xFA, 0xED, 0xFE], // Mach-O (macOS executable, reverse byte order)
		];

		return executableSignatures.some(signature => 
			this.matchesSignature(bytes, signature)
		);
	}

	private containsScriptContent(content: string): boolean {
		const scriptPatterns = [
			/<script[^>]*>/i,
			/javascript:/i,
			/vbscript:/i,
			/on\w+\s*=/i, // onclick, onload, etc.
			/eval\s*\(/i,
			/document\.(write|writeln)\s*\(/i,
			/window\.(location|open)\s*=/i,
		];

		return scriptPatterns.some(pattern => pattern.test(content));
	}

	// Cleanup method
	destroy(): void {
		// Revoke all remaining object URLs
		for (const url of this._objectUrls) {
			URL.revokeObjectURL(url);
		}
		this._objectUrls.clear();
	}

	private formatBytes(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		const formattedBytes = parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
		return formattedBytes;
	}
}
