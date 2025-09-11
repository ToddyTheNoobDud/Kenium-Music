const handleEvent = (type, fn) => {
	process.on(type, fn);
};

const logEvent = (eventType, message) => {
	console.log(`${eventType}: ${message}`);
};
handleEvent("unhandledRejection", (reason) => {
	logEvent("Unhandled Rejection", reason);
});
handleEvent("uncaughtException", (error) =>
	logEvent("Uncaught Exception", error),
);
handleEvent("warning", (warning) => logEvent("Warning", warning));
handleEvent("rejectionHandled", (promise) =>
	logEvent("Rejection Handled", `Promise: ${promise}`),
);
handleEvent("beforeExit", (code) => logEvent("Before Exit", `Code: ${code}`));
handleEvent("exit", (code) => logEvent("Exit", `Code: ${code}`));
handleEvent("uncaughtExceptionMonitor", (error) =>
	logEvent("Uncaught Exception Monitor", error),
);
