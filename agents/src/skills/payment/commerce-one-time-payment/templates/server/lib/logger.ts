type LogData = Record<string, unknown>;

export const logger = {
	info(message: string, data?: LogData) {
		console.info(message, data ?? {});
	},
	warn(message: string, data?: LogData) {
		console.warn(message, data ?? {});
	},
	error(message: string, data?: LogData) {
		console.error(message, data ?? {});
	},
};
