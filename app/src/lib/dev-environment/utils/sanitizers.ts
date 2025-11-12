/**
 * Sanitize app ID for MySQL database and user names
 * MySQL identifiers allow letters, numbers, underscores, and dollar signs
 * but we restrict to alphanumeric and underscores for simplicity
 *
 * @param appId - The app ID to sanitize
 * @returns Sanitized ID safe for MySQL identifiers (max 40 chars)
 * @throws {Error} If sanitization results in empty string
 * @example
 * sanitizeForMySQL("my-app-123")  // Returns: "my_app_123"
 * sanitizeForMySQL("App@#$Name")  // Returns: "app_name"
 */
export function sanitizeForMySQL(appId: string): string {
	const sanitized = appId
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')     // Replace non-alphanumeric with underscore
		.replace(/_+/g, '_')             // Collapse multiple underscores
		.replace(/^_+|_+$/g, '')         // Remove leading/trailing underscores
		.substring(0, 40);               // Limit length for MySQL constraints

	if (!sanitized) {
		throw new Error(`Invalid app ID: cannot sanitize '${appId}' to valid MySQL identifier`);
	}

	return sanitized;
}

/**
 * Sanitize app ID for Docker container names
 * Docker names allow letters, numbers, dots, hyphens, and underscores
 * Must follow DNS label rules (RFC 1123)
 *
 * @param appId - The app ID to sanitize
 * @returns Sanitized ID safe for Docker container names (max 63 chars for DNS label compliance)
 * @throws {Error} If sanitization results in empty string
 * @example
 * sanitizeForDocker("my_app_123")  // Returns: "my_app_123"
 * sanitizeForDocker("App@#$Name")  // Returns: "appname"
 */
export function sanitizeForDocker(appId: string): string {
	const sanitized = appId
		.toLowerCase()
		.replace(/[^a-z0-9.-]/g, '')     // Remove invalid chars (allows dots/hyphens)
		.replace(/^[.-]+|[.-]+$/g, '')   // Remove leading/trailing dots or hyphens
		.substring(0, 63);                // DNS label max length

	if (!sanitized) {
		throw new Error(`Invalid app ID: cannot sanitize '${appId}' to valid Docker identifier`);
	}

	return sanitized;
}
